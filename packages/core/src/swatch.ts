// Swatches: the brand kit, one per brand, applied to every Pattern in a project.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { manifest as fontManifest } from "@knitted/fonts";
import { COLOR_ROLES, type Actor, type ColorRole, type FontRef, type LogoUse, type Swatch, type SwatchColor, type Yarn } from "./types.ts";
import { FALLBACK_SWATCH } from "./tokens.ts";
import { isHex } from "./contrast.ts";
import { newId } from "./ids.ts";
import { NotFoundError, ValidationError, type Store } from "./store.ts";
import { assertPublicUrl, dominantColors, getYarn, importYarn, importYarnFromUrl, listYarn, uploadTempPath, yarnPath } from "./yarn.ts";
import { looksLikeSvg } from "./svg.ts";
import { cleanFolder, fileInto } from "./folders.ts";
import { baseOf, logosOf, readSite, sameFamily, stylesheetsOf, svgColors, type SiteLogo, type SiteProposal } from "./site.ts";

/** A swatch's brand, which is what its file carries. Where it is filed is the project's, and is not part of it. */
export type SwatchData = Omit<Swatch, "id" | "projectId" | "folder" | "createdAt" | "updatedAt">;
type Row = Record<string, unknown>;

const font = (family: string): FontRef => ({ family });
const c = (role: ColorRole, name: string, hex: string): SwatchColor => ({ role, name, hex });

export const SWATCH_TEMPLATES: Record<string, { label: string; data: SwatchData }> = {
  knitted: {
    label: "knitted",
    data: {
      name: "knitted",
      colors: FALLBACK_SWATCH.colors,
      fonts: { display: font("Bricolage Grotesque"), body: font("Geist"), mono: font("Geist Mono") },
      logos: [],
      voice: { summary: "Short, warm and confident. Craft verbs: knit, stitch, pattern, finish.", do: ["Say what it does in under ten words", "Use craft verbs"], dont: ["Say generate", "Use exclamation marks"], examples: ["Make it knitted.", "Pattern once. Knit forever."] },
      rules: { cornerRadius: 0.012, heatGrade: { hue: "ember", strength: 0.7 } },
    },
  },
  starter: {
    label: "Warm starter",
    data: {
      name: "My brand",
      colors: [c("primary", "Primary", "#df5a0f"), c("secondary", "Secondary", "#17110b"), c("accent", "Accent", "#ffb347"), c("neutral", "Neutral", "#ebdfd2"), c("background", "Background", "#fffbf6"), c("text", "Text", "#17110b")],
      fonts: { display: font("Bricolage Grotesque"), body: font("Geist") },
      logos: [], voice: { summary: "", do: [], dont: [], examples: [] }, rules: { cornerRadius: 0.012 },
    },
  },
  mono: {
    label: "Black and white",
    data: {
      name: "Black and white",
      colors: [c("primary", "Black", "#111111"), c("secondary", "Charcoal", "#3a3a3a"), c("accent", "Signal", "#ff3b30"), c("neutral", "Grey", "#e5e5e5"), c("background", "White", "#ffffff"), c("text", "Black", "#111111")],
      fonts: { display: font("Inter"), body: font("Inter"), mono: font("JetBrains Mono") },
      logos: [], voice: { summary: "", do: [], dont: [], examples: [] }, rules: { cornerRadius: 0 },
    },
  },
  retail: {
    label: "Warm retail",
    data: {
      name: "Warm retail",
      colors: [c("primary", "Terracotta", "#c2410c"), c("secondary", "Sage", "#4d6b57"), c("accent", "Butter", "#f6d365"), c("neutral", "Sand", "#efe6d8"), c("background", "Cream", "#fbf7f0"), c("text", "Espresso", "#2b1d14")],
      fonts: { display: font("Fraunces"), body: font("DM Sans") },
      logos: [], voice: { summary: "", do: [], dont: [], examples: [] }, rules: { cornerRadius: 0.02 },
    },
  },
  blank: {
    label: "Blank",
    data: {
      name: "Untitled swatch",
      colors: [c("primary", "Primary", "#2563eb"), c("text", "Text", "#111111"), c("background", "Background", "#ffffff")],
      fonts: { display: font("Inter"), body: font("Inter") },
      logos: [], voice: { summary: "", do: [], dont: [], examples: [] }, rules: { cornerRadius: 0.01 },
    },
  },
};

// ── validation: one place, so the API, MCP and import all agree ──────────────
const trimList = (a: unknown, max = 12, len = 200) => (Array.isArray(a) ? a.map((x) => String(x).trim().slice(0, len)).filter(Boolean).slice(0, max) : []);

export function cleanSwatchData(raw: Partial<SwatchData>, base: SwatchData = SWATCH_TEMPLATES.blank.data): SwatchData {
  const name = String(raw.name ?? base.name).trim().replace(/\s+/g, " ");
  if (!name) throw new ValidationError("Give the swatch a name.");
  if (name.length > 80) throw new ValidationError("That swatch name is too long. Keep it under 80 characters.");
  const colors = (raw.colors ?? base.colors).map((col) => {
    if (!COLOR_ROLES.includes(col.role)) throw new ValidationError(`"${col.role}" is not a colour role. Use ${COLOR_ROLES.join(", ")}.`);
    if (!isHex(col.hex)) throw new ValidationError(`${col.hex} is not a colour. Use six digits, like #df5a0f.`);
    return { role: col.role, name: String(col.name || col.role).slice(0, 40), hex: col.hex.toLowerCase() };
  });
  if (colors.length === 0) throw new ValidationError("A swatch needs at least one colour.");
  if (colors.length > 8) throw new ValidationError("A swatch holds up to 8 colours. Remove one first.");
  for (const role of ["primary", "text", "background"] as const) {
    if (!colors.some((x) => x.role === role)) throw new ValidationError(`A swatch needs a ${role} colour, so patterns always have something to use.`);
  }
  const fonts = { ...base.fonts, ...(raw.fonts ?? {}) } as SwatchData["fonts"];
  for (const slot of ["display", "body"] as const) if (!fonts[slot]?.family) throw new ValidationError(`Pick a ${slot} font.`);
  const v = raw.voice ?? base.voice;
  return {
    name, colors, fonts,
    logos: (raw.logos ?? base.logos).slice(0, 12),
    voice: { summary: String(v.summary ?? "").slice(0, 1000), do: trimList(v.do), dont: trimList(v.dont), examples: trimList(v.examples, 6, 300) },
    rules: { cornerRadius: Math.min(0.2, Math.max(0, Number(raw.rules?.cornerRadius ?? base.rules.cornerRadius))), heatGrade: raw.rules?.heatGrade ?? base.rules.heatGrade },
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────────────
function toSwatch(r: Row): Swatch {
  return { id: r.id as string, projectId: r.project_id as string, ...(JSON.parse(r.data as string) as SwatchData), folder: (r.folder as string) ?? "", createdAt: r.created_at as string, updatedAt: r.updated_at as string };
}
const dataOf = ({ id: _i, projectId: _p, folder: _f, createdAt: _c, updatedAt: _u, ...data }: Swatch): SwatchData => data;
export function getSwatch(store: Store, id: string): Swatch {
  const r = store.db.prepare("select * from swatches where id = ?").get(id) as Row | undefined;
  if (!r) throw new NotFoundError("That swatch is not here.");
  return toSwatch(r);
}
export function listSwatches(store: Store, projectId: string): Swatch[] {
  return (store.db.prepare("select * from swatches where project_id = ? order by created_at, rowid").all(projectId) as Row[]).map(toSwatch);
}
export function activeSwatch(store: Store, projectId: string): Swatch {
  const p = store.getProject(projectId);
  if (p.swatchId) try { return getSwatch(store, p.swatchId); } catch { /* deleted: fall through */ }
  return listSwatches(store, projectId)[0] ?? { ...FALLBACK_SWATCH, projectId };
}

/** Insert a swatch row, filed in `folder`, which is there already. Runs inside the caller's transaction when there is one. */
export function insertSwatch(store: Store, projectId: string, data: SwatchData, folder = ""): string {
  const id = newId("sw"); const t = new Date().toISOString();
  store.db.prepare("insert into swatches (id, project_id, name, data, folder, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)").run(id, projectId, data.name, JSON.stringify(data), folder, t, t);
  return id;
}

/**
 * `activate`: true makes it the project's swatch; false never does; left out, it does
 * only when the project has none. `folder`: the folder in the Swatch tab it goes in.
 */
export function createSwatch(store: Store, projectId: string, input: { template?: string; data?: Partial<SwatchData>; folder?: string; activate?: boolean; actor?: Actor } = {}): Swatch {
  store.getProject(projectId);
  const base = SWATCH_TEMPLATES[input.template ?? "starter"]?.data ?? SWATCH_TEMPLATES.starter.data;
  const data = cleanSwatchData({ ...base, ...(input.data ?? {}) }, base);
  cleanFolder(input.folder);
  const id = store.write(() => {
    const sid = insertSwatch(store, projectId, data, fileInto(store, projectId, "swatches", input.folder));
    const hasActive = !!store.getProject(projectId).swatchId;
    if (input.activate ?? !hasActive) store.db.prepare("update projects set swatch_id = ?, updated_at = ? where id = ?").run(sid, new Date().toISOString(), projectId);
    store.logRow(projectId, input.actor ?? "human", "swatch.created", data.name, null);
    return sid;
  });
  return getSwatch(store, id);
}

export function updateSwatch(store: Store, id: string, patch: Partial<SwatchData>): Swatch {
  const cur = getSwatch(store, id);
  const curData = dataOf(cur);
  const data = cleanSwatchData({ ...curData, ...patch }, curData);
  store.write(() => {
    store.db.prepare("update swatches set name = ?, data = ?, updated_at = ? where id = ?").run(data.name, JSON.stringify(data), new Date().toISOString(), id);
    store.db.prepare("update projects set updated_at = ? where id = ?").run(new Date().toISOString(), cur.projectId);
  });
  return getSwatch(store, id);
}

/** The copy goes next to the original, in its folder. */
export function duplicateSwatch(store: Store, id: string): Swatch {
  const cur = getSwatch(store, id);
  const data = dataOf(cur);
  return createSwatch(store, cur.projectId, { data: { ...data, name: `${data.name} copy` }, folder: cur.folder });
}

export function setActiveSwatch(store: Store, projectId: string, swatchId: string): void {
  const s = getSwatch(store, swatchId);
  if (s.projectId !== projectId) throw new ValidationError("That swatch belongs to another project. Copy it here first.");
  store.updateProject(projectId, { swatchId });
}

export function deleteSwatch(store: Store, id: string): void {
  const s = getSwatch(store, id);
  if (listSwatches(store, s.projectId).length <= 1) throw new ValidationError("A project needs at least one swatch. Make another before deleting this one.");
  store.write(() => {
    store.db.prepare("delete from swatches where id = ?").run(id);
    const p = store.getProject(s.projectId);
    if (p.swatchId === id) {
      const next = listSwatches(store, s.projectId)[0];
      store.db.prepare("update projects set swatch_id = ?, updated_at = ? where id = ?").run(next?.id ?? null, new Date().toISOString(), s.projectId);
    }
  });
}

/** Copy one of this project's swatches into another project (logos are not carried; the Yarn belongs to the first project). */
export function copySwatchToProject(store: Store, id: string, projectId: string): Swatch {
  const data = dataOf(getSwatch(store, id));
  return createSwatch(store, projectId, { data: { ...data, logos: [] } });
}

// ── from Yarn ────────────────────────────────────────────────────────────────
/** Colours found in an image, as proposals. Nothing is applied until the user accepts. */
export function colorsFromYarn(store: Store, yarnId: string): string[] {
  const y = getYarn(store, yarnId);
  if (!y.meta.colors?.length) throw new ValidationError("There are no colours to read from that file. Try an image or a video.");
  return y.meta.colors;
}

// ── export and import: a brand moves between projects and people ─────────────
const MAX_LOGO_BYTES = 3 * 1024 * 1024;

export async function exportSwatch(store: Store, id: string) {
  const s = getSwatch(store, id);
  const logos = [];
  for (const l of s.logos) {
    let y: Yarn;
    try { y = getYarn(store, l.yarnId); } catch { continue; }
    if (y.bytes > MAX_LOGO_BYTES) continue;
    logos.push({ use: l.use, name: y.name, filename: y.originalName, dataUrl: `data:${y.mime};base64,${(await readFile(yarnPath(store, y))).toString("base64")}` });
  }
  const { logos: _l, ...data } = dataOf(s);
  return { format: "knitted-swatch", version: 1, swatch: data, logos };
}

/** A swatch from a file, into `folder` in the Swatch tab. */
export async function importSwatch(store: Store, projectId: string, file: unknown, folder?: string): Promise<Swatch> {
  cleanFolder(folder);
  const f = file as { format?: string; version?: number; swatch?: Partial<SwatchData>; logos?: { use: LogoUse; name: string; filename: string; dataUrl: string }[] };
  if (f?.format !== "knitted-swatch" || !f.swatch) throw new ValidationError("That is not a knitted swatch file.");
  if ((f.version ?? 1) > 1) throw new ValidationError("That swatch was made by a newer knitted. Update the app to import it.");
  const logos: SwatchData["logos"] = [];
  for (const l of (f.logos ?? []).slice(0, 12)) {
    const m = /^data:([^;]+);base64,(.+)$/.exec(l.dataUrl ?? "");
    if (!m) continue;
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > MAX_LOGO_BYTES) continue;
    const tmp = uploadTempPath(store, projectId);
    await mkdir(join(tmp, ".."), { recursive: true });
    await writeFile(tmp, buf);
    const { yarn } = await importYarn(store, projectId, tmp, l.filename || `${l.name}.png`, { name: l.name, tags: ["logo"], actor: "import" });
    logos.push({ yarnId: yarn.id, use: l.use });
  }
  return createSwatch(store, projectId, { data: { ...f.swatch, logos } as Partial<SwatchData>, folder });
}

// ── from a website ───────────────────────────────────────────────────────────
// The page, its stylesheets (up to 40) and its logo are fetched, every hop checked for
// a public address, and read as text by site.ts: nothing on them ever runs.
export type { SiteProposal } from "./site.ts";

// Some sites turn away a bare name, so this reads like the browser it stands in for.
const AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 knitted.studio";

function siteAnswer(status: number, what: string): ValidationError {
  if (status === 401 || status === 403 || status === 429) return new ValidationError(`That site turned knitted away (it answered ${status}). Some sites only let a browser in. Upload its logo to Yarn and pick colours from that instead.`);
  if (status === 404 || status === 410) return new ValidationError(`That ${what} is not there (it answered ${status}). Check the link opens in a browser.`);
  if (status >= 500) return new ValidationError(`That site had a problem of its own (it answered ${status}). Try again in a minute.`);
  return new ValidationError(`That site answered ${status}. Check the link opens in a browser.`);
}

/** Fetch a public address, following redirects one checked hop at a time, and keep the first `max` bytes. */
async function fetchPublic(raw: string, { max, accept, timeoutMs = 15_000, what = "page" }: { max: number; accept: string; timeoutMs?: number; what?: string }) {
  let url = await assertPublicUrl(raw);
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": AGENT, accept, "accept-language": "en" } });
    const to = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && to) { await res.body?.cancel(); url = await assertPublicUrl(new URL(to, url).href); continue; }
    if (!res.ok) { await res.body?.cancel(); throw siteAnswer(res.status, what); }
    const chunks: Uint8Array[] = []; let got = 0; let truncated = false;
    const reader = res.body?.getReader();
    for (;;) {
      const next = await reader?.read();
      if (!next || next.done) break;
      chunks.push(next.value); got += next.value.length;
      if (got > max) { truncated = true; await reader!.cancel(); break; }
    }
    return { buf: Buffer.concat(chunks).subarray(0, max), url, type: (res.headers.get("content-type") ?? "").toLowerCase(), truncated };
  }
  throw new ValidationError("That site redirected too many times.");
}

/** A logo's colours: the fills an SVG declares, or the ones a picture is mostly made of. */
async function logoColors(url: string): Promise<string[]> {
  const r = await fetchPublic(url, { max: 4_000_000, accept: "image/svg+xml,image/*;q=0.9", timeoutMs: 10_000, what: "logo" });
  if (r.truncated) return [];
  if (r.type.includes("svg") || looksLikeSvg(r.buf)) return svgColors(r.buf.toString("utf8"));
  return (await dominantColors(sharp(r.buf, { animated: false }))).colors;
}

/**
 * Read a website and PROPOSE a swatch from it: the colours its page, buttons and links
 * wear, the fonts it sets, its name and its logo. Nothing is saved; `createSwatchFromProposal`
 * makes the swatch once a person (or a model) has looked.
 */
export async function proposeFromWebsite(rawUrl: string): Promise<SiteProposal> {
  const typed = rawUrl.trim();
  const page = await fetchPublic(/^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`, { max: 3_000_000, accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5" });
  const html = page.buf.toString("utf8");
  if (!/html|xml/.test(page.type) && !/<(html|head|body|meta|link)\b/i.test(html.slice(0, 4000))) throw new ValidationError("That link is not a web page. Paste the address of the site itself, like https://example.com.");
  const notes: string[] = [];
  if (page.truncated) notes.push("The page is very large, so knitted read its first 3MB.");
  const base = baseOf(html, page.url.href);
  const missed = new Set<string>();
  let budget = 12_000_000; // bytes of CSS, across every sheet
  const sheet = async (href: string, depth: number): Promise<string> => {
    if (budget <= 0) return "";
    try {
      const r = await fetchPublic(href, { max: Math.min(2_000_000, budget), accept: "text/css,*/*;q=0.1", what: "stylesheet" });
      budget -= r.buf.length;
      const css = r.buf.toString("utf8");
      // One level of @import, read before the sheet that imports it, as a browser would.
      const imports = depth ? [] : [...css.slice(0, 20_000).matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?([^;]*);/gi)].filter((m) => !/\bprint\b/i.test(m[2])).map((m) => new URL(m[1], r.url).href).slice(0, 4);
      return [...(await Promise.all(imports.map((u) => sheet(u, depth + 1)))), css].join("\n");
    } catch { missed.add(href); return ""; }
  };
  // A site built from components can link dozens of small sheets; read them eight at a time, in order.
  const hrefs = stylesheetsOf(html, base).slice(0, 40);
  const sheets: string[] = new Array(hrefs.length).fill("");
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(8, hrefs.length) }, async () => { for (let i = next++; i < hrefs.length; i = next++) sheets[i] = await sheet(hrefs[i], 0); }));
  const css = sheets.join("\n");
  if (missed.size) notes.push(`${missed.size === 1 ? "One of its stylesheets" : `${missed.size} of its stylesheets`} could not be read, so some colours or fonts may be missing.`);
  // The first logo that loads: a site's own structured data can name a file that is not there.
  let logo: SiteLogo | null = null; let colors: string[] = [];
  for (const candidate of logosOf(html, base).slice(0, 4)) {
    try { colors = await logoColors(candidate.url); logo = candidate; break; } catch { /* try the next */ }
  }
  const read = readSite({ html, css, url: page.url.href, logo, logoColors: colors });
  return { ...read, notes: [...notes, ...read.notes] };
}

/** A swatch as proposed, by a website or by a model, before it is saved. */
export interface SwatchProposal {
  name: string;
  colors: SwatchColor[];
  fonts?: { display?: string; body?: string; mono?: string };
  /** A logo to bring in from a link, or logos already in this project's Yarn. */
  logo?: { url: string; use: LogoUse };
  logos?: SwatchData["logos"];
  voice?: Partial<SwatchData["voice"]>;
  rules?: Partial<SwatchData["rules"]>;
}
type FontSlot = "display" | "body" | "mono";
export type FontMatch = { family: string; yarnId?: string; from: "bundled" | "yarn" } | null;

/**
 * The fonts a proposal can really have: each family becomes a font in this project's
 * Yarn, else the bundled one of that name ("Geist Variable" and "GeistSans" are Geist).
 * One that is neither is named in a note, and the headlines fall back to the body font.
 */
export function matchFonts(store: Store, projectId: string, wanted: SwatchProposal["fonts"] = {}): { fonts: SwatchData["fonts"]; matched: Record<FontSlot, FontMatch>; notes: string[] } {
  const own = listYarn(store, projectId, { kind: "font" });
  const bundled = fontManifest.map((f) => f.family);
  // The family read from the file and the name it was given are both its names: either one finds it.
  const ownNames = own.flatMap((y) => [y.meta.family, y.name].filter((n): n is string => !!n));
  const find = (family?: string): FontMatch => {
    if (!family?.trim()) return null;
    const mine = sameFamily(family, ownNames);
    const y = mine ? own.find((x) => x.meta.family === mine || x.name === mine) : undefined;
    if (y) return { family: y.meta.family ?? y.name, yarnId: y.id, from: "yarn" };
    const b = sameFamily(family, bundled);
    return b ? { family: b, from: "bundled" } : null;
  };
  // knitted stores a font as {family}, so a proposal copied from a swatch may say it that way.
  const familyOf = (v: unknown): string | undefined => (typeof v === "string" ? v : typeof (v as { family?: unknown })?.family === "string" ? (v as { family: string }).family : undefined);
  wanted = { display: familyOf(wanted.display), body: familyOf(wanted.body), mono: familyOf(wanted.mono) };
  const matched = { display: find(wanted.display), body: find(wanted.body), mono: find(wanted.mono) };
  const ref = (m: FontMatch): FontRef | undefined => (m ? (m.yarnId ? { family: m.family, yarnId: m.yarnId } : { family: m.family }) : undefined);
  const body = ref(matched.body) ?? { family: "Inter" };
  const fonts: SwatchData["fonts"] = { display: ref(matched.display) ?? body, body, ...(matched.mono ? { mono: ref(matched.mono) } : {}) };
  const notes: string[] = [];
  const what = { display: "Headlines", body: "Body text", mono: "Labels and code" };
  for (const slot of ["display", "body", "mono"] as const) {
    const want = wanted[slot]?.trim();
    if (want && !matched[slot]) notes.push(`${want} is not bundled and not in this project's Yarn. ${what[slot]} use ${slot === "mono" ? "the body font" : fonts[slot]!.family} until you upload the font file to Yarn.`);
  }
  return { fonts, matched, notes: [...new Set(notes)] };
}

/**
 * Save a proposal as a NEW swatch. The logo is brought into Yarn like any link. It is
 * the project's swatch only when `activate` is true: a model proposes, and the person
 * decides in the studio.
 */
export async function createSwatchFromProposal(store: Store, projectId: string, input: SwatchProposal, { actor = "human", activate, folder }: { actor?: "human" | "model" | "import"; activate?: boolean; folder?: string } = {}): Promise<{ swatch: Swatch; notes: string[] }> {
  store.getProject(projectId);
  cleanFolder(folder);
  const radius = input.rules?.cornerRadius;
  if (radius !== undefined && !(typeof radius === "number" && radius >= 0 && radius <= 0.2)) throw new ValidationError("cornerRadius is a fraction of the frame's width, from 0 to 0.2, like 0.04.");
  const { fonts, notes } = matchFonts(store, projectId, input.fonts);
  const logos: SwatchData["logos"] = [];
  for (const l of input.logos ?? []) {
    const y = getYarn(store, l.yarnId);
    if (y.projectId !== projectId || y.kind !== "image" || y.deletedAt) throw new ValidationError("A logo has to be an image in this project's Yarn.");
    logos.push({ yarnId: y.id, use: l.use });
  }
  if (input.logo) {
    try {
      const { yarn } = await importYarnFromUrl(store, projectId, input.logo.url, { name: `${input.name} logo`, tags: ["logo"], actor, maxBytes: 20 * 1024 * 1024 });
      if (yarn.kind === "image") { if (!logos.some((l) => l.yarnId === yarn.id)) logos.push({ yarnId: yarn.id, use: input.logo.use }); }
      else notes.push("The logo link was not a picture, so it was left out.");
    } catch (e) { notes.push(`The logo could not be brought in: ${(e as Error).message}`); }
  }
  const base = SWATCH_TEMPLATES.blank.data;
  const voice = { ...base.voice, ...(input.voice ?? {}) } as SwatchData["voice"];
  const rules = { ...base.rules, ...(radius !== undefined ? { cornerRadius: radius } : {}) };
  const swatch = createSwatch(store, projectId, { template: "blank", data: { name: input.name, colors: input.colors, fonts, logos, voice, rules }, folder, activate, actor });
  return { swatch, notes };
}
