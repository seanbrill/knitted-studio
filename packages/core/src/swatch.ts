// Swatches: the brand kit, one per brand, applied to every Pattern in a project.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { COLOR_ROLES, type ColorRole, type FontRef, type LogoUse, type Swatch, type SwatchColor, type Yarn } from "./types.ts";
import { FALLBACK_SWATCH } from "./tokens.ts";
import { isHex } from "./contrast.ts";
import { newId } from "./ids.ts";
import { NotFoundError, ValidationError, type Store } from "./store.ts";
import { assertPublicUrl, getYarn, importYarn, uploadTempPath, yarnPath } from "./yarn.ts";

export type SwatchData = Omit<Swatch, "id" | "projectId" | "createdAt" | "updatedAt">;
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
  return { id: r.id as string, projectId: r.project_id as string, ...(JSON.parse(r.data as string) as SwatchData), createdAt: r.created_at as string, updatedAt: r.updated_at as string };
}
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

/** Insert a swatch row. Runs inside the caller's transaction when there is one. */
export function insertSwatch(store: Store, projectId: string, data: SwatchData): string {
  const id = newId("sw"); const t = new Date().toISOString();
  store.db.prepare("insert into swatches (id, project_id, name, data, created_at, updated_at) values (?, ?, ?, ?, ?, ?)").run(id, projectId, data.name, JSON.stringify(data), t, t);
  return id;
}

export function createSwatch(store: Store, projectId: string, input: { template?: string; data?: Partial<SwatchData>; activate?: boolean } = {}): Swatch {
  store.getProject(projectId);
  const base = SWATCH_TEMPLATES[input.template ?? "starter"]?.data ?? SWATCH_TEMPLATES.starter.data;
  const data = cleanSwatchData({ ...base, ...(input.data ?? {}) }, base);
  const id = store.write(() => {
    const sid = insertSwatch(store, projectId, data);
    const hasActive = !!store.getProject(projectId).swatchId;
    if (input.activate || !hasActive) store.db.prepare("update projects set swatch_id = ?, updated_at = ? where id = ?").run(sid, new Date().toISOString(), projectId);
    store.logRow(projectId, "human", "swatch.created", data.name, null);
    return sid;
  });
  return getSwatch(store, id);
}

export function updateSwatch(store: Store, id: string, patch: Partial<SwatchData>): Swatch {
  const cur = getSwatch(store, id);
  const { id: _i, projectId: _p, createdAt: _c, updatedAt: _u, ...curData } = cur;
  const data = cleanSwatchData({ ...curData, ...patch }, curData);
  store.write(() => {
    store.db.prepare("update swatches set name = ?, data = ?, updated_at = ? where id = ?").run(data.name, JSON.stringify(data), new Date().toISOString(), id);
    store.db.prepare("update projects set updated_at = ? where id = ?").run(new Date().toISOString(), cur.projectId);
  });
  return getSwatch(store, id);
}

export function duplicateSwatch(store: Store, id: string): Swatch {
  const cur = getSwatch(store, id);
  const { id: _i, projectId, createdAt: _c, updatedAt: _u, ...data } = cur;
  return createSwatch(store, projectId, { data: { ...data, name: `${data.name} copy` } });
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
  const { id: _i, projectId: _p, createdAt: _c, updatedAt: _u, ...data } = getSwatch(store, id);
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
  const { id: _i, projectId: _p, createdAt: _c, updatedAt: _u, logos: _l, ...data } = s;
  return { format: "knitted-swatch", version: 1, swatch: data, logos };
}

export async function importSwatch(store: Store, projectId: string, file: unknown): Promise<Swatch> {
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
  return createSwatch(store, projectId, { data: { ...f.swatch, logos } as Partial<SwatchData> });
}

// ── from a website ───────────────────────────────────────────────────────────
export interface SiteProposal { colors: SwatchColor[]; fonts: string[]; logoUrl?: string; sourceUrl: string; notes: string[]; }

async function fetchText(raw: string, max = 1_500_000): Promise<{ text: string; url: URL }> {
  let url = await assertPublicUrl(raw);
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { "user-agent": "knitted.studio", accept: "text/html,text/css" } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { url = await assertPublicUrl(new URL(res.headers.get("location")!, url).href); continue; }
    if (!res.ok) throw new ValidationError(`That site answered ${res.status}. Check the link opens in a browser.`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > max) throw new ValidationError("That page is too large to read.");
    return { text: buf.toString("utf8"), url };
  }
  throw new ValidationError("That site redirected too many times.");
}

const hex6 = (s: string) => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join("") : m[1];
  return "#" + h.toLowerCase();
};

/**
 * Read a site's own declared colours and fonts and PROPOSE a swatch. The page is
 * fetched and parsed as text, never rendered, so no script on it ever runs.
 */
export async function proposeFromWebsite(rawUrl: string): Promise<SiteProposal> {
  const { text: html, url } = await fetchText(rawUrl);
  const notes: string[] = [];
  let css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
  const sheets = [...html.matchAll(/<link[^>]+rel=["']?stylesheet["']?[^>]*>/gi)].map((m) => /href=["']([^"']+)["']/i.exec(m[0])?.[1]).filter(Boolean).slice(0, 2) as string[];
  for (const href of sheets) {
    try { css += "\n" + (await fetchText(new URL(href, url).href, 800_000)).text; } catch { notes.push(`Could not read the stylesheet ${href}.`); }
  }
  const found = new Map<ColorRole, { name: string; hex: string }>();
  const take = (role: ColorRole, name: string, v: string) => { const h = hex6(v); if (h && !found.has(role)) found.set(role, { name, hex: h }); };
  const theme = /<meta[^>]+name=["']theme-color["'][^>]*content=["']([^"']+)["']/i.exec(html)?.[1];
  if (theme) take("primary", "Theme colour", theme);
  const vars: Record<string, string> = {};
  for (const m of css.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-f]{3,6})\b/gi)) vars[m[1].toLowerCase()] = m[2];
  const want: [ColorRole, RegExp][] = [["primary", /^(primary|brand|accent-primary|color-primary)/], ["secondary", /^(secondary|color-secondary)/], ["accent", /^(accent|highlight)/], ["background", /^(bg|background|surface)/], ["text", /^(text|foreground|fg|ink)/], ["neutral", /^(muted|neutral|border|line)/]];
  for (const [role, re] of want) { const k = Object.keys(vars).find((x) => re.test(x)); if (k) take(role, k, vars[k]); }
  if (!found.size) notes.push("This site does not declare brand colours in a way knitted can read. Upload a logo and pick colours from it instead.");
  const fonts = [...new Set([...css.matchAll(/font-family\s*:\s*["']?([A-Za-z][A-Za-z0-9 ]+?)["']?\s*[,;}]/g)].map((m) => m[1].trim()).filter((f) => !/^(sans-serif|serif|monospace|system-ui|inherit|-apple-system|blinkmacsystemfont|arial|helvetica)/i.test(f)))].slice(0, 4);
  const icon = /<link[^>]+rel=["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]*>/i.exec(html)?.[0];
  const href = icon && /href=["']([^"']+)["']/i.exec(icon)?.[1];
  return {
    colors: [...found].map(([role, v]) => ({ role, name: v.name, hex: v.hex })),
    fonts, logoUrl: href ? new URL(href, url).href : undefined, sourceUrl: url.href, notes,
  };
}
