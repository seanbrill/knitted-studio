// ONE tool set, two doors.
//
// The MCP server (for Claude Desktop, Claude Code, Cursor...) and the studio's own
// model loop both get their tools from this list, so a capability exists for both
// or for neither. A test asserts they are identical; that is what "two equal front
// doors" means when it is enforced instead of promised.
//
// RULES EVERY TOOL FOLLOWS
//  - Edits go through `store.apply(..., "model")`, so the lock rule is enforced in
//    ONE place (core), and a refused edit is returned and logged, never skipped.
//  - Results are small and structured: ids, counts, short text. A model drowns in
//    giant JSON, and so does its context window.
//  - Errors say what happened and the fix, in a line.
//  - Long work returns a job id. Nothing here holds a request open for a render.
//  - There is deliberately NO tool to unlock, delete a project, delete Yarn, or
//    change the Swatch's brand colours. Those are a human's call in the studio.
//    propose_swatch adds a NEW swatch the person may choose to use; it never changes
//    one, and never makes one the project's.

import { applyCommand, instanceOf, motionLint, partFromStitches, preflight, uniqueSlotName, COLOR_ROLES, PRESETS, SIZES, CommandSchema } from "@knitted/core";
import { activeSwatch, createPart, createSwatch, createSwatchFromProposal, getKnit, getPart, importYarn, importYarnFromUrl, createCopy, knitPath, listKnits, listParts, listYarn, proposeFromWebsite, uploadTempPath, updateYarn, ensureBuiltinParts, SUPPORTED } from "@knitted/core/node";

const obj = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const str = (description) => ({ type: "string", description });
const PROJECT = str("The project id, like pj_01...");
const PATTERN = str("The pattern id, like pt_01...");

// Text that came from outside (a Yarn file, a website) is DATA. It is wrapped, so a
// model can tell instructions (from its user) from content (from a file), and the
// system prompt says never to follow the second kind.
const untrusted = (label, text) => `<untrusted_data source="${label}">\n${String(text).replace(/<\/?untrusted_data[^>]*>/g, "")}\n</untrusted_data>`;

// The tools that only look. They change nothing, so a client may run them without asking
// (tools/list says readOnlyHint), and they still work while the person has paused the
// model in the studio. Every other tool changes something.
export const READ_ONLY = new Set(["list_projects", "get_project", "list_yarn", "get_brand_guidelines", "list_patterns", "get_pattern", "describe_pattern", "list_parts", "list_presets", "list_voices", "preview_pattern", "check_pattern", "get_job", "list_knits"]);

function brief(p) {
  return { id: p.id, name: p.name, size: `${p.size.name} ${p.size.w}x${p.size.h}`, durationMs: p.durationMs, version: p.version };
}

/** A pattern as a short piece of text a model can read cheaply: what is on it, what is locked, what it may fill. */
export function describePattern(p, store) {
  const lines = [`Pattern "${p.name}" (${p.id}): ${p.size.name}, ${p.size.w}x${p.size.h}px${p.durationMs ? `, ${(p.durationMs / 1000).toFixed(1)}s video` : ", a still"}.`];
  const free = [], locked = [];
  for (const s of p.stitches) {
    const where = `at ${Math.round(s.x * 100)}%,${Math.round(s.y * 100)}% size ${Math.round(s.w * 100)}x${Math.round(s.h * 100)}%`;
    const what = s.kind === "text" ? `text "${(s.content ?? "").slice(0, 60)}"` : s.kind === "part" ? `part ${s.slot}${(s.partSlots ?? []).length ? ` (slots: ${s.partSlots.map((x) => `${s.slot}.${x.name}${x.locked ? " [locked]" : ""}`).join(", ")})` : ""}` : s.kind;
    (s.locked ? locked : free).push(`  - ${s.slot ?? "(no slot)"}: ${what} ${where}`);
  }
  lines.push(`Free slots you may fill (${free.length}):`, ...free, `Locked by the brand, do NOT try to change (${locked.length}):`, ...locked);
  const clips = Object.entries(p.motion?.tracks ?? {}).flatMap(([id, cs]) => cs.map((c) => `${p.stitches.find((s) => s.id === id)?.slot ?? id}: ${c.preset} ${c.startMs}-${c.endMs}ms`));
  if (clips.length) lines.push("Animation:", ...clips.map((c) => `  - ${c}`));
  if (store) lines.push(...guidance(store, p.projectId));
  return lines.join("\n");
}
function guidance(store, projectId) {
  const sw = activeSwatch(store, projectId);
  const v = sw.voice;
  return [`Brand "${sw.name}": colours ${sw.colors.map((c) => `${c.role} ${c.hex}`).join(", ")}; display font ${sw.fonts.display.family}, body ${sw.fonts.body.family}.`, v.summary && `Voice: ${v.summary}`, v.do.length && `Do: ${v.do.join("; ")}`, v.dont.length && `Do not: ${v.dont.join("; ")}`, v.examples.length && `Examples of how this brand writes: ${v.examples.map((e) => `"${e}"`).join(" | ")}`].filter(Boolean);
}

// The renderer gate, said for a model: it can still check a pattern without the browser.
const CHECK_STILL_WORKS = " check_pattern still works without it: it finds missing files, low contrast, text that will not fit and busy animation without drawing anything.";
const browserGate = (message) => /download its browser|downloaded its browser|could not find its browser|needs a browser to draw|part that starts its browser|browser would not start/.test(message ?? "");

/** A Yarn file for an image slot, by id, by name, or `tag:product` for the first with that tag. */
function yarnFor(store, projectId, ref) {
  const all = listYarn(store, projectId).filter((y) => y.kind === "image" || y.kind === "video");
  const v = String(ref).trim();
  return all.find((y) => y.id === v) ?? all.find((y) => y.name.toLowerCase() === v.toLowerCase()) ?? (v.startsWith("tag:") ? all.find((y) => y.tags.includes(v.slice(4).trim().toLowerCase())) : undefined);
}

/** Resolve a stitch given by id or slot name. Slots are the stable address. */
function stitchRef(p, ref) {
  const s = p.stitches.find((x) => x.id === ref || x.slot === ref);
  if (!s) throw new Error(`No stitch "${ref}" in this pattern. Its slots are: ${p.stitches.map((x) => x.slot).filter(Boolean).join(", ") || "none"}.`);
  return s;
}

/** A pattern by its id, which is enough on its own. A projectId given as well has to be the pattern's. */
function patternIn(store, patternId, projectId) {
  const p = store.getPattern(patternId);
  if (projectId && p.projectId !== projectId) throw new Error(`Pattern ${patternId} is in project ${p.projectId}, not ${projectId}. Leave out projectId, or give that one.`);
  return p;
}

// A swatch stores a font as {family}, so a model holding one may pass that straight back.
const FONT_SHAPE = "Give fonts as family names, like {\"display\": \"Chango\", \"body\": \"Inter\"}.";
function fontNames(fonts) {
  if (fonts == null) return {};
  if (typeof fonts !== "object" || Array.isArray(fonts)) throw new Error(FONT_SHAPE);
  return Object.fromEntries(Object.entries(fonts).map(([slot, v]) => {
    const family = typeof v === "string" ? v : typeof v?.family === "string" ? v.family : null;
    if (family === null) throw new Error(`fonts.${slot} is not a family name. ${FONT_SHAPE}`);
    return [slot, family];
  }));
}

export const TOOLS = [
  // ── projects ──
  { name: "list_projects", description: "List the projects in this studio: id, name and how many patterns each has. Start here when you do not know a project id.", inputSchema: obj({}),
    async handler(_, { store }) { return store.listProjects().map((p) => ({ id: p.id, name: p.name, patterns: p.counts.patterns, yarn: p.counts.yarn })); } },
  { name: "create_project", description: "Create a project. `starter: social` gives it five ready patterns (Story, Post, Square, Landscape, Banner) with a headline slot each; `blank` gives one empty pattern.", inputSchema: obj({ name: str("What to call it"), starter: { type: "string", enum: ["social", "blank"] } }, ["name"]),
    async handler({ name, starter = "social" }, { store }) { const p = store.createProject({ name, starter, actor: "model" }); return { id: p.id, name: p.name, patterns: store.listPatterns(p.id).map(brief) }; } },
  { name: "get_project", description: "A project's patterns, how much Yarn it has, and its brand (colours, fonts and voice).", inputSchema: obj({ projectId: PROJECT }, ["projectId"]),
    async handler({ projectId }, { store }) { const p = store.getProject(projectId); return { id: p.id, name: p.name, patterns: store.listPatterns(projectId).map(brief), yarn: listYarn(store, projectId).length, brand: guidance(store, projectId) }; } },
  { name: "set_project_picture", description: "Show one of a project's images or videos (from its Yarn) on the project's card in the studio, so the person knows it at a glance. A logo or a key photo works well. Leave out yarnId to take the picture away.", inputSchema: obj({ projectId: PROJECT, yarnId: str("An image's yarn id, from list_yarn") }, ["projectId"]),
    async handler({ projectId, yarnId }, { store }) { const p = store.updateProject(projectId, { coverYarnId: yarnId || null }, "model"); return { id: p.id, picture: p.coverYarnId }; } },

  // ── yarn ──
  { name: "list_yarn", description: "List the files (Yarn) in a project: images, video, audio, fonts and saved copy. Filter by kind, tag or a search word. Use a Yarn name or id when filling an image slot.", inputSchema: obj({ projectId: PROJECT, kind: { type: "string", enum: ["image", "video", "audio", "font", "copy"] }, tag: str("Only Yarn with this tag"), q: str("Search the names") }, ["projectId"]),
    async handler({ projectId, kind, tag, q }, { store }) {
      return listYarn(store, projectId, { kind, tag, q }).slice(0, 60).map((y) => ({ id: y.id, name: y.name, kind: y.kind, tags: y.tags, ...(y.width ? { size: `${y.width}x${y.height}` } : {}), ...(y.durationMs ? { seconds: +(y.durationMs / 1000).toFixed(1) } : {}), ...(y.kind === "copy" ? { text: untrusted(`yarn:${y.name}`, (y.meta.text ?? "").slice(0, 800)) } : {}), ...(y.meta.warnings?.length ? { warnings: y.meta.warnings } : {}) }));
    } },
  { name: "import_yarn", description: "Add a file to a project's Yarn from a public web address: an image, a video, a sound, a font (to use it in a swatch) or a text file. Or save a piece of text as reusable copy. Local files are not accepted here; ask the person to upload them in the studio. A file that is already there is not added twice: you get the one there, with these tags added.", inputSchema: obj({ projectId: PROJECT, url: str(`A public https link to a ${SUPPORTED} file`), text: str("Copy to save, instead of a file"), name: str("What to call it"), tags: { type: "array", items: { type: "string" }, description: "Tags to give it, like [\"product\"], so a slot can take `tag:product`" } }, ["projectId"]),
    async handler({ projectId, url, text, name, tags }, { store }) {
      if (tags !== undefined && !(Array.isArray(tags) && tags.every((t) => typeof t === "string"))) throw new Error("tags is a list of words, like [\"product\", \"shot\"].");
      let r;
      if (text) r = await createCopy(store, projectId, { name: name ?? "Copy", text, tags }, "model");
      else if (url) r = await importYarnFromUrl(store, projectId, url, { name, tags, actor: "model" });
      else throw new Error("Give a url to fetch, or text to save.");
      // The same file twice is the same Yarn, so the tags asked for land on the one there.
      const y = r.existing && tags?.length ? updateYarn(store, r.yarn.id, { tags: [...r.yarn.tags, ...tags] }) : r.yarn;
      return { id: y.id, name: y.name, kind: y.kind, tags: y.tags, existing: r.existing };
    } },
  { name: "tag_yarn", description: "Set the tags on a piece of Yarn. Tags let a batch pick from a group, like `tag:product`.", inputSchema: obj({ yarnId: str("The yarn id"), tags: { type: "array", items: { type: "string" } } }, ["yarnId", "tags"]),
    async handler({ yarnId, tags }, { store }) { return { id: yarnId, tags: updateYarn(store, yarnId, { tags }).tags }; } },
  // Undoing a draft of your own is a rename away: deleting stays a person's call (see the top).
  { name: "rename", description: "Rename a pattern or a piece of Yarn: give its patternId or its yarnId, and the new name. Use it to label a draft of your own, like \"Draft: spring post\"; only a person deletes, in the studio.", inputSchema: obj({ patternId: PATTERN, yarnId: str("A yarn id, from list_yarn"), name: str("The new name") }, ["name"]),
    async handler({ patternId, yarnId, name }, { store }) {
      if (!patternId === !yarnId) throw new Error("Give one of patternId or yarnId.");
      if (patternId) { const r = store.apply(patternId, { type: "setMeta", name }, "model", { label: "Model renamed the pattern" }); return { id: patternId, name: store.getPattern(patternId).name, changed: r.changed }; }
      const y = updateYarn(store, yarnId, { name });
      return { id: y.id, name: y.name };
    } },

  // ── brand ──
  { name: "get_brand_guidelines", description: "The brand's colours, fonts and how it writes (voice, do and do-not lists, examples). Read this before writing any copy.", inputSchema: obj({ projectId: PROJECT }, ["projectId"]),
    async handler({ projectId }, { store }) { return guidance(store, projectId); } },
  { name: "propose_swatch", description: "Propose a brand (a swatch) for the person to review: read it from the brand's website (url), give it yourself (colors, fonts, voice), or both, and what you give wins over what the site says. It is saved as a NEW swatch and never made the project's: the person looks it over in the Swatch tab and presses Use for this project. Fonts are matched to the bundled ones and to font files in the project's Yarn, so import_yarn a brand's font file first to use it. A swatch needs a primary, a text and a background colour.",
    inputSchema: obj({
      projectId: PROJECT, url: str("The brand's website, to read its colours, fonts, name and logo from"), name: str("What to call the swatch"),
      colors: { type: "array", description: "Colours by role", items: obj({ role: { type: "string", enum: COLOR_ROLES }, name: str("A name for it, like Violet"), hex: str("Six digits, like #b16cf8") }, ["role", "hex"]) },
      fonts: obj({ display: str("Headline font family"), body: str("Body text font family"), mono: str("Labels and code font family") }),
      voice: obj({ summary: str("How the brand sounds, in a sentence or two"), do: { type: "array", items: { type: "string" } }, dont: { type: "array", items: { type: "string" } }, examples: { type: "array", items: { type: "string" } } }),
      rules: { ...obj({ cornerRadius: { type: "number", description: "How round the brand's corners are, as a fraction of the frame's width from 0 to 0.2: 0 is square, 0.012 soft, 0.04 a rounded panel. A stitch uses it with style radius: \"$radius\"." } }), description: "How the brand draws its shapes: {\"cornerRadius\": 0.04}, a fraction of the frame's width from 0 (square) to 0.2. A stitch uses it with style radius: \"$radius\"." },
      logoYarnId: str("An image already in this project's Yarn to use as its logo, instead of the site's"),
    }, ["projectId"]),
    async handler({ projectId, url, name, colors = [], fonts, voice, rules, logoYarnId }, { store }) {
      const families = fontNames(fonts);
      if (rules !== undefined && (typeof rules !== "object" || rules === null || Array.isArray(rules))) throw new Error("rules is an object, like {\"cornerRadius\": 0.04}.");
      const site = url ? await proposeFromWebsite(url) : null;
      const byRole = new Map((site?.colors ?? []).map((c) => [c.role, { role: c.role, name: c.name, hex: c.hex }]));
      for (const c of colors) byRole.set(c.role, { role: c.role, name: c.name || c.role[0].toUpperCase() + c.role.slice(1), hex: String(c.hex).toLowerCase() });
      if (!byRole.size) throw new Error("Give a url to read the brand from, or its colours: at least a primary, a text and a background.");
      const { swatch, notes } = await createSwatchFromProposal(store, projectId, {
        name: name || site?.name || "Proposed brand", colors: [...byRole.values()], fonts: { ...(site?.fontRoles ?? {}), ...families }, voice, rules,
        ...(logoYarnId ? { logos: [{ yarnId: logoYarnId, use: "full" }] } : site?.logo ? { logo: site.logo } : {}),
      }, { actor: "model", activate: false });
      return {
        id: swatch.id, active: false,
        // A name read off a website is the website's words, not an instruction.
        name: site && !name ? untrusted(`website:${new URL(site.sourceUrl).hostname}`, swatch.name) : swatch.name,
        colors: swatch.colors.map((c) => `${c.role} ${c.hex}`),
        fonts: Object.fromEntries(Object.entries(swatch.fonts).map(([slot, f]) => [slot, f.family])),
        cornerRadius: swatch.rules.cornerRadius,
        logo: swatch.logos[0]?.yarnId ?? null,
        notes: [...(site?.notes ?? []), ...notes],
        next: "It is in the Swatch tab and not in use. Tell the person it is ready to look over: only they can make it the project's swatch.",
      };
    } },

  // ── patterns ──
  { name: "list_patterns", description: "The patterns in a project.", inputSchema: obj({ projectId: PROJECT }, ["projectId"]),
    async handler({ projectId }, { store }) { return store.listPatterns(projectId).map(brief); } },
  { name: "get_pattern", description: "A pattern as data: every stitch, with slot names, locked or free, and coordinates as fractions of the frame. Large; prefer describe_pattern.", inputSchema: obj({ projectId: PROJECT, patternId: PATTERN }, ["patternId"]),
    async handler({ projectId, patternId }, { store }) { return patternIn(store, patternId, projectId); } },
  { name: "describe_pattern", description: "A short text summary of a pattern: what slots it has, which are locked by the brand and which you may fill, what it says now, any animation, and the brand's voice. The cheapest way to understand a pattern.", inputSchema: obj({ patternId: PATTERN }, ["patternId"]),
    async handler({ patternId }, { store }) { return describePattern(store.getPattern(patternId), store); } },
  { name: "create_pattern", description: "Add an empty pattern to a project. Sizes: " + SIZES.map((s) => `${s.name} ${s.w}x${s.h}`).join(", ") + ".", inputSchema: obj({ projectId: PROJECT, name: str("Name"), size: { type: "string", enum: SIZES.map((s) => s.name) } }, ["projectId"]),
    async handler({ projectId, name, size }, { store }) { return brief(store.createPattern(projectId, { name, size: SIZES.find((s) => s.name === size) ?? SIZES[0], actor: "model" })); } },
  { name: "duplicate_pattern", description: "Copy a pattern, locks and all.", inputSchema: obj({ patternId: PATTERN }, ["patternId"]),
    async handler({ patternId }, { store }) { return brief(store.duplicatePattern(patternId, "model")); } },

  // ── editing ──
  { name: "fill_slots", description: "Write into a pattern's named slots. A text slot takes text. An image or video slot takes a Yarn name or id from list_yarn, or `tag:product` for the first file with that tag. A slot inside a part is addressed `part.slot`, like `lower_third.name`. Locked slots are REFUSED and reported: if you are refused, tell the person, do not look for another way around it. Returns what was filled and what was refused with the reason.", inputSchema: obj({ projectId: PROJECT, patternId: PATTERN, slots: { type: "object", description: "slot name to content, like {\"headline\": \"Spring sale\", \"photo\": \"Hero shot\"}", additionalProperties: { type: "string" } } }, ["patternId", "slots"]),
    async handler({ projectId, patternId, slots }, { store }) {
      const p = patternIn(store, patternId, projectId);
      const commands = [], refused = [];
      for (const [slot, raw] of Object.entries(slots)) {
        const s = p.stitches.find((x) => x.slot === slot);
        if (s && (s.kind === "image" || s.kind === "video")) {
          const y = yarnFor(store, p.projectId, raw);
          if (y) commands.push({ type: "updateStitch", id: s.id, patch: { yarnId: y.id } });
          else refused.push({ slot, why: `no image or video in this project's Yarn is called "${String(raw).slice(0, 60)}"; list_yarn shows the names` });
        } else commands.push({ type: "fillSlot", slot, content: String(raw) });
      }
      const r = commands.length ? store.apply(patternId, { type: "batch", commands }, "model", { label: "Model filled slots" }) : { refusals: [] };
      refused.push(...r.refusals.map((x) => ({ slot: x.slot ?? p.stitches.find((s) => s.id === x.stitchId)?.slot ?? x.stitchId, why: x.why })));
      const bad = new Set(refused.map((x) => x.slot));
      return { filled: Object.keys(slots).filter((k) => !bad.has(k)), refused };
    } },
  { name: "add_stitch", description: "Add a stitch. Coordinates are fractions of the frame (0 to 1). kind: text, image, shape. Give it a slot name so it can be filled later. Text sizes in style.fontSize are fractions of the frame WIDTH (0.05 is a modest body size, 0.1 a headline).", inputSchema: obj({ patternId: PATTERN, kind: { type: "string", enum: ["text", "image", "shape"] }, slot: str("Optional lowercase name"), x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" }, content: str("Text, for a text stitch"), yarnId: str("A yarn id, for an image stitch"), style: { type: "object", description: "Use brand tokens like $color.primary and $font.display rather than hex values" } }, ["patternId", "kind", "x", "y", "w", "h"]),
    async handler({ patternId, ...s }, { store }) {
      const stitch = { id: `st_${Math.random().toString(36).slice(2, 9)}`, locked: false, ...s };
      const r = store.apply(patternId, { type: "addStitch", stitch }, "model", { label: "Model added a stitch" });
      // `id`, like create_pattern and import_yarn; `added` too, for clients written against it.
      return { id: r.changed ? stitch.id : null, added: r.changed ? stitch.id : null, refused: r.refusals };
    } },
  { name: "update_stitch", description: "Change a stitch's text, position, size, image or style. Address it by slot name.", inputSchema: obj({ patternId: PATTERN, stitch: str("Slot name or id"), patch: { type: "object", description: "Any of x, y, w, h, content, yarnId, style (merged over the existing style)" } }, ["patternId", "stitch", "patch"]),
    async handler({ patternId, stitch, patch }, { store }) {
      const p = store.getPattern(patternId); const s = stitchRef(p, stitch);
      const { style, ...rest } = patch;
      const r = store.apply(patternId, { type: "updateStitch", id: s.id, patch: { ...rest, ...(style ? { style: { ...(s.style ?? {}), ...style } } : {}) } }, "model", { label: "Model edited a stitch" });
      return { changed: r.changed, refused: r.refusals };
    } },
  { name: "remove_stitch", description: "Remove a stitch. Locked stitches are refused.", inputSchema: obj({ patternId: PATTERN, stitch: str("Slot name or id") }, ["patternId", "stitch"]),
    async handler({ patternId, stitch }, { store }) { const s = stitchRef(store.getPattern(patternId), stitch); const r = store.apply(patternId, { type: "removeStitch", id: s.id }, "model", { label: "Model removed a stitch" }); return { changed: r.changed, refused: r.refusals }; } },
  { name: "set_size", description: "Change a pattern's size. Everything is stored as fractions, so it re-lays out. Check the result with preview_pattern.", inputSchema: obj({ patternId: PATTERN, size: { type: "string", enum: SIZES.map((s) => s.name) } }, ["patternId", "size"]),
    async handler({ patternId, size }, { store }) { const sz = SIZES.find((s) => s.name === size); if (!sz) throw new Error(`Unknown size. Use one of: ${SIZES.map((s) => s.name).join(", ")}.`); const r = store.apply(patternId, { type: "setSize", size: sz }, "model", { label: "Model resized" }); return { changed: r.changed }; } },
  { name: "apply_batch", description: "Apply several edit commands as ONE step, so a person can undo it as one. `atomic: true` applies all or nothing. Each command is {type, ...}: addStitch {stitch}, updateStitch {id, patch}, removeStitch {id}, reorder {id, toIndex}, setSize {size}, fillSlot {slot, content} (text slots only; set an image with updateStitch and a yarnId), setMeta {name, durationMs}, setMotion {stitchId, clips}, setAudio {audio}. setLocked is refused: only a person locks or unlocks.", inputSchema: obj({ patternId: PATTERN, commands: { type: "array", items: { type: "object" } }, atomic: { type: "boolean" } }, ["patternId", "commands"]),
    async handler({ patternId, commands, atomic }, { store }) {
      const parsed = CommandSchema.safeParse({ type: "batch", commands, atomic });
      if (!parsed.success) throw new Error(`Those commands are not valid: ${parsed.error.issues[0].path.join(".")}: ${parsed.error.issues[0].message}`);
      const r = store.apply(patternId, parsed.data, "model", { label: "Model applied a batch" });
      return { changed: r.changed, refused: r.refusals };
    } },

  // ── parts and motion ──
  { name: "list_parts", description: "Reusable parts you can insert: lower thirds, quotes, price tags and the project's own. Each lists its slots.", inputSchema: obj({ projectId: PROJECT }, ["projectId"]),
    async handler({ projectId }, { store }) { ensureBuiltinParts(store); return listParts(store, projectId).map((p) => ({ id: p.id, name: p.name, category: p.category, slots: p.slots.map((s) => `${s.name}${s.locked ? " [locked]" : ""}`), aspect: +p.aspect.toFixed(2) })); } },
  { name: "insert_part", description: "Put a part into a pattern. Then fill its slots with fill_slots using `instance.slot`.", inputSchema: obj({ patternId: PATTERN, partId: str("From list_parts"), slot: str("A name for this instance"), x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, overrides: { type: "object", additionalProperties: { type: "string" } } }, ["patternId", "partId"]),
    async handler({ patternId, partId, slot, x = 0.1, y = 0.7, w = 0.6, overrides = {} }, { store }) {
      const part = getPart(store, partId); const p = store.getPattern(patternId);
      const name = (slot ?? part.name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "part";
      let unique = name; for (let n = 2; p.stitches.some((s) => s.slot === unique); n++) unique = `${name}_${n}`;
      const h = (w * p.size.w) / part.aspect / p.size.h;
      const stitch = { id: `st_${Math.random().toString(36).slice(2, 9)}`, kind: "part", slot: unique, x, y, w, h, locked: false, partId: part.id, partVersion: part.version, overrides, partSlots: part.slots };
      const r = store.apply(patternId, { type: "addStitch", stitch }, "model", { label: `Model added ${part.name}` });
      return { inserted: r.changed ? unique : null, slots: part.slots.map((s) => `${unique}.${s.name}`), refused: r.refusals };
    } },
  // The studio's Save as part, for a model: what it makes is a new thing of its own, like a
  // pattern it creates. A stitch the brand locked stays locked as a slot of the part, so a
  // part is never a way around a lock.
  { name: "create_part", description: "Make a reusable part out of stitches already in a pattern, like a footer every pattern repeats, so insert_part can put it anywhere and a change to the part lands everywhere it is used. Each stitch with a slot name becomes a slot of the part; a slot the brand locked stays locked. `replace: true` also swaps those stitches in this pattern for one linked copy of the part. The part belongs to the pattern's project.", inputSchema: obj({ patternId: PATTERN, stitches: { type: "array", items: { type: "string" }, description: "The slot names or ids of the stitches to make it from" }, name: str("What to call the part, like Footer"), description: str("What it is for, in a sentence"), category: { type: "string", enum: ["text", "media", "motion", "frame", "cta", "other"] }, replace: { type: "boolean" } }, ["patternId", "stitches", "name"]),
    async handler({ patternId, stitches, name, description, category, replace = false }, { store }) {
      if (!Array.isArray(stitches) || !stitches.length) throw new Error("Give the stitches to make the part from, by slot name or id.");
      const p = store.getPattern(patternId);
      const sel = [...new Set(stitches.map((ref) => stitchRef(p, String(ref))))];
      const locked = sel.filter((s) => s.locked);
      if (replace && locked.length) throw new Error(`${locked.map((s) => s.slot ?? s.id).join(", ")} ${locked.length === 1 ? "is" : "are"} locked by the brand, so only a person can swap ${locked.length === 1 ? "it" : "them"} for a part. Leave out replace to make the part without changing this pattern.`);
      const { draft, box } = partFromStitches(sel, p.size, { name, description, category, lockedSlots: locked.map((s) => s.slot).filter(Boolean) });
      const part = createPart(store, p.projectId, draft, "model");
      const out = { id: part.id, name: part.name, slots: part.slots.map((s) => `${s.name}${s.locked ? " [locked]" : ""}`), aspect: +part.aspect.toFixed(2) };
      if (!replace) return out;
      const slot = uniqueSlotName(part.name, p.stitches.filter((s) => !sel.includes(s)).map((s) => s.slot));
      const inst = instanceOf(part, box, slot);
      const r = store.apply(patternId, { type: "batch", atomic: true, commands: [...sel.map((s) => ({ type: "removeStitch", id: s.id })), { type: "addStitch", stitch: inst }] }, "model", { label: `Model made ${part.name} a part` });
      return { ...out, instance: r.changed ? slot : null, refused: r.refusals };
    } },
  { name: "list_presets", description: "The animation presets available to set_motion.", inputSchema: obj({}),
    async handler() { return PRESETS.map((p) => ({ id: p.id, label: p.label, kind: p.kind, defaultMs: p.defaultMs, ...(p.text ? { onlyText: true } : {}), ...(p.image ? { onlyImages: true } : {}) })); } },
  { name: "set_motion", description: "Animate a stitch: give it clips, each {preset, startMs, endMs}. Replaces that stitch's clips. Also set the pattern's length with durationMs if the animation runs past it. Keep text on screen long enough to read (about 3 words a second).", inputSchema: obj({ patternId: PATTERN, stitch: str("Slot name or id"), clips: { type: "array", items: obj({ preset: { type: "string", enum: PRESETS.map((p) => p.id) }, startMs: { type: "number" }, endMs: { type: "number" }, ease: { type: "string" } }, ["preset", "startMs", "endMs"]) }, durationMs: { type: "number" } }, ["patternId", "stitch", "clips"]),
    async handler({ patternId, stitch, clips, durationMs }, { store }) {
      const s = stitchRef(store.getPattern(patternId), stitch);
      const cmds = [{ type: "setMotion", stitchId: s.id, clips: clips.map((c, i) => ({ id: `cl_${Date.now().toString(36)}${i}`, ...c })) }, ...(durationMs ? [{ type: "setMeta", durationMs }] : [])];
      const r = store.apply(patternId, { type: "batch", commands: cmds }, "model", { label: "Model animated a stitch" });
      return { changed: r.changed, refused: r.refusals, warnings: motionLint(store.getPattern(patternId)).map((i) => i.message) };
    } },

  // ── voice ──
  { name: "list_voices", description: "The voices available for voiceover, and whether the configured voice works right now.", inputSchema: obj({}),
    async handler(_, { engine }) { const { provider } = await engine.activeVoice(); const ok = await provider.available(); return { provider: provider.id, available: ok, voices: ok ? (await provider.voices()).slice(0, 40) : [] }; } },
  { name: "synthesize_voiceover", description: "Speak lines and put them on the pattern's timeline as sound, optionally with timed captions. Returns a job id: check it with get_job. The pattern becomes a video long enough for the speech.", inputSchema: obj({ patternId: PATTERN, lines: { type: "array", items: { type: "string" } }, voice: { type: "string" }, captions: { type: "boolean" } }, ["patternId", "lines"]),
    async handler({ patternId, lines, voice, captions = true }, { store, engine }) { const p = store.getPattern(patternId); const j = engine.startVoiceJob(store, { projectId: p.projectId, patternId, lines, voice, captions, actor: "model" }); return { jobId: j.id }; } },

  // ── seeing, checking, making ──
  { name: "preview_pattern", description: "Render the pattern and SEE it: returns a PNG. Use it after layout changes to check your own work. `time` is milliseconds for animated patterns.", inputSchema: obj({ patternId: PATTERN, time: { type: "number" } }, ["patternId"]),
    async handler({ patternId, time = 0 }, { engine, store }) {
      const png = await engine.renderPreview(store, patternId, { timeMs: time }).catch((e) => { if (browserGate(e?.message)) e.message += CHECK_STILL_WORKS; throw e; });
      return { __image: png.toString("base64"), mime: "image/png", caption: `Preview of ${store.getPattern(patternId).name}${time ? ` at ${time}ms` : ""}.` };
    } },
  { name: "check_pattern", description: "Run the same quality checks Knit runs, without drawing anything: missing files, low contrast, text that will not fit, animation that is too busy. Fix errors before knitting.", inputSchema: obj({ patternId: PATTERN, params: { type: "object" } }, ["patternId"]),
    async handler({ patternId, params = {} }, { store, engine }) { const p = store.getPattern(patternId); return engine.previewKnit(store, { projectId: p.projectId, patternId, params }).map((u) => ({ unit: u.label, issues: u.issues.map((i) => `${i.level}: ${i.message}`) })); } },
  { name: "knit_pattern", description: "Make real files (PNG, JPEG, WebP or MP4) from a pattern, through the same job the studio's Knit button uses, with the same checks. `params`: sizes (array of {name,w,h}), format, scale (1 or 2), rows (an array of objects of slot values, one per post, to make many). A row may only fill free slots. Returns file paths and any issues, or a jobId when wait is false.", inputSchema: obj({ projectId: PROJECT, patternId: PATTERN, params: { type: "object" }, wait: { type: "boolean" } }, ["patternId"]),
    async handler({ projectId, patternId, params = {}, wait = true }, { store, engine, limits }) {
      projectId = patternIn(store, patternId, projectId).projectId;
      const n = (params.rows?.length || 1) * (params.sizes?.length || 1);
      if (limits?.maxKnits && n > limits.maxKnits) throw new Error(`That would make ${n} files, and this session is limited to ${limits.maxKnits} at a time. Ask the person to raise the limit in Settings, or knit fewer.`);
      if (limits) limits.knitted = (limits.knitted ?? 0) + n;
      if (limits?.maxKnits && limits.knitted > limits.maxKnits * 4) throw new Error("This conversation has already made a lot of files. Ask the person before making more.");
      const job = engine.startKnitJob(store, { projectId, patternId, params });
      if (!wait) return { jobId: job.id, status: job.status };
      const r = await engine.waitForJob(store, job.id, { files: (id) => knitPath(store, getKnit(store, id)) });
      if (browserGate(r.error)) r.error += CHECK_STILL_WORKS;
      return r;
    } },
  { name: "get_job", description: "Check on a job: a knit or a voiceover.", inputSchema: obj({ jobId: str("From knit_pattern or synthesize_voiceover") }, ["jobId"]),
    async handler({ jobId }, { store }) { const j = store.getJob(jobId); return { jobId: j.id, status: j.status, progress: j.progress && { done: j.progress.done, total: j.progress.total, current: j.progress.current }, result: j.result, error: j.error }; } },
  { name: "cancel_job", description: "Stop a running job.", inputSchema: obj({ jobId: str("The job id") }, ["jobId"]),
    async handler({ jobId }, { store, engine }) { return { status: engine.cancelJob(store, jobId).status }; } },
  { name: "list_knits", description: "What has been knitted in a project, newest first.", inputSchema: obj({ projectId: PROJECT }, ["projectId"]),
    async handler({ projectId }, { store }) { return listKnits(store, projectId, { limit: 30 }).map((k) => ({ id: k.id, label: k.label, format: k.format, size: `${k.width}x${k.height}`, path: knitPath(store, k) })); } },
];

export const toolByName = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
void applyCommand; void preflight; void importYarn; void createSwatch; void uploadTempPath;
