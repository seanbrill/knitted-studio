// A tool call in words, and where it works, for the studio to show while a model works:
// "Filling headline on Story", pointing at the headline. Read from the call's own
// arguments and the library, before the call, then from what it made, after.
//
// Nothing here may break a call: a lookup that fails only makes the words plainer.

import { getPart, getYarn } from "@knitted/core/node";

const safe = (f) => { try { return f(); } catch { return undefined; } };
const quote = (s) => `"${String(s ?? "").trim().slice(0, 60)}"`;
const words = (xs) => (xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const host = (url) => safe(() => new URL(url).hostname) ?? "a website";
const fileOf = (url) => safe(() => decodeURIComponent(new URL(url).pathname.split("/").pop())) || "a file";
const possessive = (name, fallback) => (name ? `${name}'s` : fallback);

/** The stitch a slot name or id stands for, and for `part.slot` the part's instance. */
function stitchIdFor(p, ref) {
  if (!p || typeof ref !== "string") return undefined;
  const [inst, sub] = ref.split(".", 2);
  return p.stitches.find((s) => s.id === ref || s.slot === (sub ? inst : ref))?.id;
}

// What each tool is doing, given its arguments and what was looked up for them.
const SAY = {
  list_projects: () => "Looking at your projects",
  create_project: (a) => `Making a project, ${quote(a.name)}`,
  get_project: (a, c) => `Reading ${c.project ?? "a project"}`,
  set_project_picture: (a, c) => (a.yarnId ? `Choosing ${possessive(c.project, "the project's")} picture` : `Taking away ${possessive(c.project, "the project's")} picture`),
  list_yarn: (a, c) => `Looking through ${possessive(c.project, "the")} Yarn`,
  import_yarn: (a) => (a.text ? `Saving copy, ${quote(a.name ?? "Copy")}` : `Bringing ${a.name ? quote(a.name) : fileOf(a.url)} into Yarn`),
  tag_yarn: (a, c) => `Tagging ${c.yarn ? quote(c.yarn) : "a file"}${Array.isArray(a.tags) && a.tags.length ? ` ${a.tags.join(", ")}` : ""}`,
  rename: (a, c) => `Renaming ${c.pattern ? c.pattern.name : c.yarn ? quote(c.yarn) : "something"} to ${quote(a.name)}`,
  get_brand_guidelines: (a, c) => `Reading ${possessive(c.project, "the")} brand`,
  propose_swatch: (a) => (a.url ? `Reading the brand from ${host(a.url)}` : "Proposing a swatch"),
  list_patterns: (a, c) => `Looking at ${possessive(c.project, "the")} patterns`,
  get_pattern: (a, c) => `Reading ${c.p}`,
  describe_pattern: (a, c) => `Reading ${c.p}`,
  create_pattern: (a) => `Making a pattern, ${quote(a.name ?? "Untitled")}`,
  duplicate_pattern: (a, c) => `Copying ${c.p}`,
  fill_slots: (a, c) => `Filling ${words(Object.keys(a.slots ?? {})) || "slots"} on ${c.p}`,
  add_stitch: (a, c) => `Adding ${a.slot ?? `a ${a.kind ?? "stitch"}`} to ${c.p}`,
  update_stitch: (a, c) => `Changing ${a.stitch} on ${c.p}`,
  remove_stitch: (a, c) => `Removing ${a.stitch} from ${c.p}`,
  set_size: (a, c) => `Making ${c.p} a ${a.size}`,
  apply_batch: (a, c) => { const n = Array.isArray(a.commands) ? a.commands.length : 0; return `Editing ${c.p}, ${n} change${n === 1 ? "" : "s"}`; },
  list_parts: () => "Looking at the parts",
  insert_part: (a, c) => `Adding ${c.part ? quote(c.part) : "a part"} to ${c.p}`,
  create_part: (a, c) => `Making a part, ${quote(a.name)}, from ${c.p}`,
  list_presets: () => "Looking at the animations",
  set_motion: (a, c) => `Animating ${a.stitch} on ${c.p}`,
  list_voices: () => "Looking at the voices",
  synthesize_voiceover: (a, c) => `Recording a voiceover for ${c.p}`,
  preview_pattern: (a, c) => `Looking at ${c.p}`,
  check_pattern: (a, c) => `Checking ${c.p}`,
  knit_pattern: (a, c) => `Knitting ${c.p}`,
  get_job: () => "Checking on a job",
  cancel_job: () => "Stopping a job",
  list_knits: (a, c) => `Looking at what ${c.project ?? "the project"} has knitted`,
};

/** The stitches a call works on, by id, from the slot names and ids it was given. */
function stitchesOf(name, a, p) {
  let refs = [a.stitch], added = [];
  if (name === "fill_slots") refs = Object.keys(a.slots ?? {});
  if (name === "create_part") refs = Array.isArray(a.stitches) ? a.stitches : [];
  if (name === "apply_batch") {
    const cmds = Array.isArray(a.commands) ? a.commands : [];
    refs = cmds.flatMap((c) => [c?.id, c?.stitchId, c?.slot]);
    // A stitch the batch adds is not in the pattern yet: its own id is where it will be.
    added = cmds.map((c) => c?.stitch?.id);
  }
  return [...new Set([...refs.map((r) => stitchIdFor(p, r)), ...added].filter((x) => typeof x === "string"))];
}

/** Before a call: what it is doing, in words, and where. */
export function describeCall(name, a, store) {
  const p = a.patternId ? safe(() => store.getPattern(a.patternId)) : undefined;
  const yarn = a.yarnId ? safe(() => getYarn(store, a.yarnId)) : undefined;
  const projectId = a.projectId ?? p?.projectId ?? yarn?.projectId;
  const c = {
    pattern: p, p: p ? p.name : "a pattern", yarn: yarn?.name,
    project: projectId ? safe(() => store.getProject(projectId).name) : undefined,
    part: a.partId ? safe(() => getPart(store, a.partId).name) : undefined,
  };
  const summary = safe(() => SAY[name]?.(a, c)) ?? name.replace(/_/g, " ");
  const stitchIds = p ? stitchesOf(name, a, p) : [];
  const where = Object.fromEntries(Object.entries({ projectId, patternId: p?.id, stitchIds: stitchIds.length ? stitchIds : undefined, yarnId: yarn?.id, partId: a.partId, jobId: a.jobId }).filter(([, v]) => v !== undefined));
  return { summary, where };
}

/** After a call: how it went, and what it made, so the studio can point at it. */
export function endOf(name, a, out, store) {
  const refused = Array.isArray(out?.refused) ? out.refused : [];
  const where = {};
  if (name === "create_project" && out?.id) where.projectId = out.id;
  if ((name === "create_pattern" || name === "duplicate_pattern") && out?.id) { where.patternId = out.id; where.stitchIds = undefined; }
  if (name === "add_stitch" && out?.id) where.stitchIds = [out.id];
  if (name === "import_yarn" && out?.id) where.yarnId = out.id;
  if (name === "propose_swatch" && out?.id) where.swatchId = out.id;
  if (name === "create_part" && out?.id) where.partId = out.id;
  if (name === "insert_part" && out?.inserted) { const id = stitchIdFor(safe(() => store.getPattern(a.patternId)), out.inserted); if (id) where.stitchIds = [id]; }
  if ((name === "knit_pattern" || name === "synthesize_voiceover") && out?.jobId) where.jobId = out.jobId;
  const note = refused.length ? refused.map((r) => `${r.slot ? `${r.slot}: ` : ""}${r.why}`).join("; ") : undefined;
  if (!refused.length) return { state: "done", note, where };
  // Partly refused, a call still did the rest: it is done, with the refusal said, and the
  // canvas marks only what it changed. A locked stitch marked with a model's name would
  // say the model changed it.
  const p = a.patternId ? safe(() => store.getPattern(a.patternId)) : undefined;
  if (p && !where.stitchIds) {
    const no = new Set(refused.map((r) => r.stitchId ?? stitchIdFor(p, r.slot)));
    const left = name === "fill_slots" && Array.isArray(out.filled)
      ? stitchesOf(name, { slots: Object.fromEntries(out.filled.map((k) => [k, ""])) }, p)
      : stitchesOf(name, a, p).filter((id) => !no.has(id));
    where.stitchIds = left.length ? left : undefined;
  }
  const did = out.changed === true || (Array.isArray(out.filled) && out.filled.length > 0) || !!out.inserted || !!out.instance || !!out.added;
  return { state: did ? "done" : "refused", note, where };
}
