// A tool call in words, and where it works, for the studio to show while a model works:
// "Filling headline on Story", pointing at the headline. Read from the call's own
// arguments and the library, before the call, then from what it made, after.
//
// Nothing here may break a call: a lookup that fails only makes the words plainer.

import { getDesign, getPart, getYarn } from "@knitted/core/node";

const safe = (f) => { try { return f(); } catch { return undefined; } };
const quote = (s) => `"${String(s ?? "").trim().slice(0, 60)}"`;
const words = (xs) => (xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const host = (url) => safe(() => new URL(url).hostname) ?? "a website";
const fileOf = (url) => safe(() => decodeURIComponent(new URL(url).pathname.split("/").pop())) || "a file";
const possessive = (name, fallback) => (name ? `${name}'s` : fallback);
// The things each section holds, and the ids move_to_folder takes for them.
const HOLDS = { patterns: ["pattern", "patterns"], yarn: ["file", "files"], parts: ["part", "parts"], swatches: ["swatch", "swatches"], knits: ["knit", "knits"], reference: ["reference file", "reference files"] };
const SECTION_WORD = { patterns: "pattern", yarn: "Yarn", parts: "part", swatches: "swatch", knits: "knit", reference: "reference" };
const IDS_OF = { yarnIds: "yarn", patternIds: "patterns", partIds: "parts", swatchIds: "swatches", knitIds: "knits", referenceIds: "reference" };
/** The sections move_to_folder was given ids for, with how many. */
const moving = (a) => Object.entries(IDS_OF).filter(([k]) => Array.isArray(a[k]) && a[k].length).map(([k, sec]) => [sec, a[k].length]);
const filing = (a) => {
  const m = moving(a);
  const n = m.reduce((t, [, k]) => t + k, 0);
  const what = m.length === 1 ? `${n} ${HOLDS[m[0][0]][n === 1 ? 0 : 1]}` : `${n} things`;
  return `Filing ${what} ${a.folder ? `into ${quote(a.folder)}` : "at the top"}`;
};

/** The stitch a slot name or id stands for, and for `part.slot` the part's instance. */
function stitchIdFor(p, ref) {
  if (!p || typeof ref !== "string") return undefined;
  const [inst, sub] = ref.split(".", 2);
  return p.stitches.find((s) => s.id === ref || s.slot === (sub ? inst : ref))?.id;
}

// What each tool is doing, given its arguments and what was looked up for them.
const SAY = {
  get_studio_info: () => "Checking which knitted this is",
  list_projects: () => "Looking at your projects",
  create_project: (a) => `Making a project, ${quote(a.name)}`,
  get_project: (a, c) => `Reading ${c.project ?? "a project"}`,
  set_project_picture: (a, c) => (a.yarnId ? `Choosing ${possessive(c.project, "the project's")} picture` : `Taking away ${possessive(c.project, "the project's")} picture`),
  list_yarn: (a, c) => `Looking through ${possessive(c.project, "the")} ${a.reference ? "reference" : "Yarn"}`,
  view_yarn: (a, c) => (a.text ? `Reading ${c.yarn ? quote(c.yarn) : "a file"}` : `Looking at ${c.yarn ? quote(c.yarn) : "a picture"}${a.page ? `, page ${a.page}` : ""}`),
  crop_to_yarn: (a, c) => `Cutting ${a.name ? quote(a.name) : "a part"} out of ${c.yarn ? quote(c.yarn) : "a picture"}`,
  import_yarn: (a, c) => (a.yarnId ? `Changing the saved text ${quote(c.yarn ?? a.name ?? "")}` : a.text ? `Saving text, ${quote(a.name ?? "Saved text")}` : `Bringing ${a.name ? quote(a.name) : fileOf(a.url)} into ${a.reference ? "the reference" : a.library ? "the Library" : "Yarn"}`),
  import_yarn_file: (a) => `Bringing ${quote(a.name ?? String(a.path ?? "").split(/[\\/]/).pop())} into ${a.reference ? "the reference" : a.library ? "the Library" : "Yarn"} from this computer`,
  search_stock: (a) => `Searching free stock for ${quote(String(a.q ?? ""))}`,
  add_stock: (a) => `Adding ${a.name ? quote(a.name) : "a stock file"} to ${a.library ? "the Library" : "Yarn"}`,
  draw_svg: (a) => (a.redraw ? `Drawing ${a.name ? quote(a.name) : "a drawing"} again` : `Drawing ${a.name ? quote(a.name) : "a picture"}`),
  generate_image: (a) => (a.estimate ? "Pricing photos" : `Making ${Number(a.count) > 1 ? `${a.count} photos` : "a photo"}${Array.isArray(a.from) && a.from.length ? " from your pictures" : ""}`),
  generate_video: (a) => (a.estimate ? "Pricing a video" : `Making a ${a.seconds ?? 6}-second video`),
  list_designs: (a, c) => `Looking at ${possessive(c.project, "a project's")} designs`,
  get_design: (a, c) => `Reading the design ${c.design ? quote(c.design) : ""}`.trim(),
  create_design: (a) => `Starting a design, ${quote(a.name)}`,
  set_design_frame: (a, c) => `${a.frameId ? "Designing" : "Adding"} ${a.name ? quote(a.name) : a.frameId ? `frame ${a.frameId}` : "a frame"}${c.design ? ` on ${quote(c.design)}` : ""}`,
  arrange_design: (a, c) => `Arranging ${c.design ? quote(c.design) : "a design"}`,
  view_design: (a, c) => `Looking at ${a.frameId ? `frame ${a.frameId} of ` : a.sectionId ? `a section of ` : ""}${c.design ? quote(c.design) : "a design"}`,
  view_sheet: (a) => `Looking at ${Array.isArray(a.yarnIds) ? `${a.yarnIds.length} pictures` : a.folder ? `the pictures in ${quote(a.folder)}` : a.tag ? `the pictures tagged ${a.tag}` : "pictures"} side by side`,
  share_yarn: (a, c) => `Moving ${c.yarn ? quote(c.yarn) : "a file"} ${a.library ? "into the Library, for every project" : "out of the Library"}`,
  tag_yarn: (a, c) => `Tagging ${c.yarn ? quote(c.yarn) : "a file"}${Array.isArray(a.tags) && a.tags.length ? ` ${a.tags.join(", ")}` : ""}`,
  rename: (a, c) => `Renaming ${a.folder ? `the folder ${quote(a.folder)}` : c.pattern ? c.pattern.name : c.yarn ? quote(c.yarn) : "something"} to ${quote(a.name)}`,
  get_brand_guidelines: (a, c) => `Reading ${possessive(c.project, "the")} brand`,
  propose_swatch: (a) => (a.url ? `Reading the brand from ${host(a.url)}` : "Proposing a swatch"),
  get_brief: (a, c) => `Reading ${possessive(c.project, "the")} brief`,
  set_profile: (a, c) => `Writing ${possessive(c.project, "the")} profile`,
  read_website: (a) => `Reading ${host(a.url)}`,
  capture_website: (a, c) => `Taking pictures of ${a.url ? host(a.url) : `${possessive(c.project, "the")} website`}`,
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
  edit_part: (a, c) => `Opening ${c.part ? quote(c.part) : "a part"} to change it`,
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
  tag_knit: (a) => `Tagging a knit${Array.isArray(a.tags) && a.tags.length ? ` ${a.tags.join(", ")}` : ""}`,
  set_knit_post: (a) => (a.caption ? `Writing a caption: ${quote(a.caption)}` : "Choosing what goes with a knit"),
  get_guide: (a) => `Reading the guide${a.topic ? ` on ${a.topic}` : ""}`,
  list_folders: (a, c) => `Looking at ${possessive(c.project, "the")} ${HOLDS[a.section] ? `${SECTION_WORD[a.section]} ` : ""}folders`,
  move_to_folder: (a) => (moving(a).length ? filing(a) : `Making the folder ${quote(a.folder)}`),
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

// The calls that work on the Brief, whose page Follow opens.
const BRIEF_TOOLS = new Set(["get_brief", "set_profile", "capture_website"]);

/** Before a call: what it is doing, in words, and where. */
export function describeCall(name, a, store) {
  const p = a.patternId ? safe(() => store.getPattern(a.patternId)) : undefined;
  const yarn = a.yarnId ? safe(() => getYarn(store, a.yarnId)) : undefined;
  const design = a.designId ? safe(() => getDesign(store, a.designId)) : undefined;
  const projectId = a.projectId ?? p?.projectId ?? yarn?.projectId ?? design?.projectId;
  const c = {
    pattern: p, p: p ? p.name : "a pattern", yarn: yarn?.name,
    project: projectId ? safe(() => store.getProject(projectId).name) : undefined,
    part: a.partId ? safe(() => getPart(store, a.partId).name) : undefined,
    design: design?.name,
  };
  const summary = safe(() => SAY[name]?.(a, c)) ?? name.replace(/_/g, " ");
  const stitchIds = p ? stitchesOf(name, a, p) : [];
  // A call on folders works in one section: the page Follow opens. Moving things of several kinds, the first.
  const section = (name === "move_to_folder" ? moving(a)[0]?.[0] : undefined) ?? ((name === "move_to_folder" || name === "list_folders" || (name === "rename" && a.folder)) && HOLDS[a.section] ? a.section : undefined)
    ?? (BRIEF_TOOLS.has(name) || (a.reference && (name === "list_yarn" || name.startsWith("import_yarn"))) || yarn?.shelf === "reference" ? "reference" : undefined);
  const where = Object.fromEntries(Object.entries({ projectId, patternId: p?.id, stitchIds: stitchIds.length ? stitchIds : undefined, yarnId: yarn?.id, partId: a.partId, designId: design?.id, jobId: a.jobId, section }).filter(([, v]) => v !== undefined));
  return { summary, where };
}

/** After a call: how it went, and what it made, so the studio can point at it. */
export function endOf(name, a, out, store) {
  const refused = Array.isArray(out?.refused) ? out.refused : [];
  const where = {};
  if (name === "create_project" && out?.id) where.projectId = out.id;
  if ((name === "create_pattern" || name === "duplicate_pattern") && out?.id) { where.patternId = out.id; where.stitchIds = undefined; }
  if (name === "add_stitch" && out?.id) where.stitchIds = [out.id];
  if ((name === "add_stock" || name === "draw_svg" || name === "generate_image" || name === "generate_video") && out?.id) where.yarnId = out.id;
  if ((name === "import_yarn" || name === "import_yarn_file" || name === "crop_to_yarn") && out?.id) { where.yarnId = out.id; where.section = out.in === "reference" || a.reference ? "reference" : undefined; }
  if (name === "propose_swatch" && out?.id) where.swatchId = out.id;
  if (name === "create_part" && out?.id) where.partId = out.id;
  if (name === "create_design" && out?.id) where.designId = out.id;
  if (name === "insert_part" && out?.inserted) { const id = stitchIdFor(safe(() => store.getPattern(a.patternId)), out.inserted); if (id) where.stitchIds = [id]; }
  if ((name === "knit_pattern" || name === "synthesize_voiceover" || name === "capture_website") && out?.jobId) where.jobId = out.jobId;
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
