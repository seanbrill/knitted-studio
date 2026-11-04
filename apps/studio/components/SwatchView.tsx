"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, yarnThumbUrl } from "@knitted/core/client";
import { COLOR_ROLES, type ColorRole, type Swatch, type SwatchColor, type Yarn } from "@knitted/core";
import {
  Button, Chip, ColorField, ConfirmDialog, Dialog, EmptyState, Field, Input, Select, Skeleton, Slider, Switch, Textarea, icons, useToast,
} from "@knitted/ui";
import { useLive } from "@/lib/hooks";
import { SwatchPreview } from "./SwatchPreview";
import { ContrastPanel } from "./ContrastPanel";

const { Plus, Trash2, Copy, Download, Upload, Link2, Wand2, AlertTriangle, Check } = icons;

type Draft = Omit<Swatch, "id" | "projectId" | "createdAt" | "updatedAt">;
const toDraft = (s: Swatch): Draft => ({ name: s.name, colors: s.colors, fonts: s.fonts, logos: s.logos, voice: s.voice, rules: s.rules });
const lines = (v: string) => v.split("\n").map((x) => x.trim()).filter(Boolean);

const TEMPLATES = [
  { value: "starter", label: "Warm starter" }, { value: "knitted", label: "knitted" }, { value: "mono", label: "Black and white" },
  { value: "retail", label: "Warm retail" }, { value: "blank", label: "Blank" },
];

export function SwatchView({ projectId }: { projectId: string }) {
  const toast = useToast();
  const { data: swatches, refresh } = useLive(() => api.swatches.list(projectId), [projectId]);
  const { data: project, refresh: refreshProject } = useLive(() => api.projects.get(projectId), [projectId]);
  const { data: yarn } = useLive(() => api.yarn.list(projectId), [projectId]);
  const { data: fonts } = useLive(() => api.fonts(), []);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [dialog, setDialog] = useState<null | "new" | "yarn" | "site" | "delete">(null);
  const importRef = useRef<HTMLInputElement>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The latest draft lives in a ref as well as in state: the save fires from a
  // timer, and reading state inside a setState updater to do the save was a side
  // effect in a place React is free to skip or repeat.
  const draftRef = useRef<Draft | null>(null);

  const current = useMemo(() => swatches?.find((s) => s.id === (pickedId ?? project?.swatchId)) ?? swatches?.[0] ?? null, [swatches, pickedId, project]);
  const isActive = !!current && current.id === project?.swatchId;
  const images = useMemo(() => (yarn ?? []).filter((y) => y.kind === "image"), [yarn]);
  const fontYarn = useMemo(() => (yarn ?? []).filter((y) => y.kind === "font"), [yarn]);

  // Take the server's copy whenever we have no unsaved edits of our own.
  useEffect(() => {
     
    if (current && !dirty.current) { const d = toDraft(current); draftRef.current = d; setDraft(d); }
  }, [current]);

  const edit = useCallback((patch: Partial<Draft>) => {
    const next = { ...(draftRef.current as Draft), ...patch };
    draftRef.current = next;
    setDraft(next);
    dirty.current = true;
    setSaving("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const id = current?.id;
      const body = draftRef.current;
      if (!id || !body) return;
      try {
        await api.swatches.update(id, body);
        dirty.current = false;
        setSaving("saved");
        await refresh();
      } catch (e) {
        setSaving("error");
        toast((e as Error).message);
      }
    }, 500);
  }, [current?.id, refresh, toast]);

  const preview: Swatch | null = useMemo(() => (current && draft ? { ...current, ...draft } : null), [current, draft]);
  const logo = useMemo(() => (preview?.logos[0] ? yarn?.find((y) => y.id === preview.logos[0].yarnId) : undefined), [preview, yarn]);

  if (!swatches || !draft || !preview || !current) return <Skeleton height={400} />;

  const setColor = (i: number, p: Partial<SwatchColor>) => edit({ colors: draft.colors.map((c, k) => (k === i ? { ...c, ...p } : c)) });
  const unusedRole = COLOR_ROLES.find((r) => !draft.colors.some((c) => c.role === r)) ?? "accent";
  const fontOptions = [
    ...(fonts ?? []).map((f) => ({ value: f.family, label: f.family })),
    ...fontYarn.map((y) => ({ value: `yarn:${y.id}`, label: `${y.meta.family ?? y.name} (yours)` })),
  ];
  const fontValue = (ref?: { family: string; yarnId?: string }) => (ref?.yarnId ? `yarn:${ref.yarnId}` : ref?.family ?? "");
  const pickFont = (slot: "display" | "body" | "mono", v: string) => {
    const y = v.startsWith("yarn:") ? fontYarn.find((f) => f.id === v.slice(5)) : undefined;
    edit({ fonts: { ...draft.fonts, [slot]: y ? { family: y.meta.family ?? y.name, yarnId: y.id } : { family: v } } });
  };

  const exportFile = async () => {
    const res = await fetch(`/api/swatches/${current.id}/export`);
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: `${current.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.knitted-swatch.json` });
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 340px", gap: "var(--space-8)", alignItems: "start" }}>
      <link rel="stylesheet" href={`/api/projects/${projectId}/fonts.css`} />
      <div style={{ display: "grid", gap: "var(--space-6)" }}>
        <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
          {swatches.map((s) => (
            <button key={s.id} className="chip chip-button" aria-pressed={s.id === current.id} onClick={() => { dirty.current = false; setPickedId(s.id); }}>
              {s.name}{s.id === project?.swatchId && <Chip tone="ember">Active</Chip>}
            </button>
          ))}
          <Button size="sm" onClick={() => setDialog("new")}><Plus size={13} aria-hidden /> New swatch</Button>
          <div style={{ flex: 1 }} />
          <span className="body-sm" role="status" aria-live="polite" style={{ color: saving === "error" ? "var(--danger)" : "var(--ink-muted)" }}>
            {saving === "saving" ? "Saving..." : saving === "saved" ? "Saved" : saving === "error" ? "Not saved" : ""}
          </span>
        </div>

        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          {!isActive && <Button variant="primary" onClick={async () => { await api.swatches.activate(current.id); await refresh(); await refreshProject(); toast(`${current.name} is now this project's swatch`); }}>Use for this project</Button>}
          <Button onClick={async () => { const d = await api.swatches.duplicate(current.id); await refresh(); setPickedId(d.id); }}><Copy size={14} aria-hidden /> Duplicate</Button>
          <Button onClick={exportFile}><Download size={14} aria-hidden /> Export</Button>
          <Button onClick={() => importRef.current?.click()}><Upload size={14} aria-hidden /> Import file</Button>
          <input ref={importRef} type="file" accept=".json,application/json" hidden aria-label="Choose a swatch file" onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
            try { const s = await api.swatches.import(projectId, JSON.parse(await f.text())); await refresh(); setPickedId(s.id); toast(`Imported ${s.name}`); } catch (err) { toast((err as Error).message); }
          }} />
          <Button onClick={() => setDialog("site")}><Link2 size={14} aria-hidden /> From a website</Button>
          <Button variant="danger" disabled={swatches.length < 2} onClick={() => setDialog("delete")}><Trash2 size={14} aria-hidden /> Delete</Button>
        </div>

        <Field label="Name" htmlFor="sw-name"><Input id="sw-name" value={draft.name} onChange={(e) => edit({ name: e.target.value })} /></Field>

        <section aria-label="Colours" style={{ display: "grid", gap: "var(--space-3)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 className="h3">Colours</h3>
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              <Button size="sm" onClick={() => setDialog("yarn")} disabled={!images.length}><Wand2 size={13} aria-hidden /> Pick from Yarn</Button>
              <Button size="sm" disabled={draft.colors.length >= 8} onClick={() => edit({ colors: [...draft.colors, { role: unusedRole, name: unusedRole, hex: "#888888" }] })}><Plus size={13} aria-hidden /> Add colour</Button>
            </div>
          </div>
          {draft.colors.map((c, i) => (
            <div key={i} style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ width: 130 }}><Select aria-label={`Role of colour ${i + 1}`} value={c.role} onValueChange={(v) => setColor(i, { role: v as ColorRole })} options={COLOR_ROLES.map((r) => ({ value: r, label: r }))} /></div>
              <div style={{ width: 130 }}><Input aria-label={`Name of colour ${i + 1}`} value={c.name} onChange={(e) => setColor(i, { name: e.target.value })} /></div>
              <ColorField label={`Colour ${i + 1}`} value={c.hex} onChange={(hex) => setColor(i, { hex })} />
              <button className="icon-btn" aria-label={`Remove colour ${i + 1}`} disabled={draft.colors.length <= 3} onClick={() => edit({ colors: draft.colors.filter((_, k) => k !== i) })}><Trash2 size={14} /></button>
            </div>
          ))}
          {!draft.colors.some((c) => c.role === "primary") && <p className="field-error"><AlertTriangle size={13} aria-hidden /> A swatch needs a primary, a text and a background colour.</p>}
        </section>

        <section aria-label="Fonts" style={{ display: "grid", gap: "var(--space-3)" }}>
          <h3 className="h3">Fonts</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "var(--space-4)" }}>
            {(["display", "body", "mono"] as const).map((slot) => (
              <Field key={slot} label={slot === "display" ? "Headlines" : slot === "body" ? "Body text" : "Labels and code"}>
                <Select aria-label={`${slot} font`} value={fontValue(draft.fonts[slot])} onValueChange={(v) => pickFont(slot, v)} options={fontOptions} placeholder="Choose a font" />
                <span style={{ fontFamily: `"${draft.fonts[slot]?.family ?? "Geist"}", sans-serif`, fontSize: 22, fontWeight: slot === "display" ? 800 : 400, lineHeight: 1.2 }}>Make it knitted.</span>
              </Field>
            ))}
          </div>
          <p className="body-sm" style={{ color: "var(--ink-muted)", margin: 0 }}>Every font here works offline. Upload your own as Yarn to use it too.</p>
        </section>

        <section aria-label="Logos" style={{ display: "grid", gap: "var(--space-3)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 className="h3">Logos</h3>
            <Select aria-label="Add a logo" value="" onValueChange={(id) => edit({ logos: [...draft.logos, { yarnId: id, use: draft.logos.length ? "mark" : "full" }] })}
              options={images.filter((y) => !draft.logos.some((l) => l.yarnId === y.id)).map((y) => ({ value: y.id, label: y.name }))} placeholder="Add a logo from Yarn" />
          </div>
          {draft.logos.length === 0 && <p className="body-sm" style={{ color: "var(--ink-muted)", margin: 0 }}>{images.length ? "Pick an image from your Yarn." : "Upload a logo in the Yarn tab first."}</p>}
          {draft.logos.map((l, i) => {
            const y: Yarn | undefined = yarn?.find((x) => x.id === l.yarnId);
            const small = y?.width && y.width < 1000 && y.mime !== "image/svg+xml";
            return (
              <div key={l.yarnId} style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap" }}>
                {y ? <img src={yarnThumbUrl(y)} alt="" style={{ width: 56, height: 40, objectFit: "contain", background: "var(--surface-sunken)", borderRadius: 6 }} /> : <span className="body-sm">Missing yarn</span>}
                <span className="label" style={{ minWidth: 100 }}>{y?.name ?? "Deleted"}</span>
                <div style={{ width: 150 }}><Select aria-label={`Use of ${y?.name ?? "logo"}`} value={l.use} onValueChange={(v) => edit({ logos: draft.logos.map((x, k) => (k === i ? { ...x, use: v as typeof l.use } : x)) })} options={[{ value: "full", label: "Full logo" }, { value: "mark", label: "Mark only" }, { value: "mono-light", label: "Mono for light" }, { value: "mono-dark", label: "Mono for dark" }]} /></div>
                {small && <span className="field-error"><AlertTriangle size={13} aria-hidden /> {y!.width}px wide. Upload one at least 1000px wide to print sharp.</span>}
                <button className="icon-btn" aria-label={`Remove ${y?.name ?? "logo"}`} onClick={() => edit({ logos: draft.logos.filter((_, k) => k !== i) })}><Trash2 size={14} /></button>
              </div>
            );
          })}
        </section>

        <section aria-label="Voice" style={{ display: "grid", gap: "var(--space-3)" }}>
          <h3 className="h3">Voice</h3>
          <Field label="How this brand sounds" hint="Your model reads this whenever it writes copy for you." htmlFor="sw-voice"><Textarea id="sw-voice" rows={2} value={draft.voice.summary} onChange={(e) => edit({ voice: { ...draft.voice, summary: e.target.value } })} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "var(--space-4)" }}>
            <Field label="Do (one per line)" htmlFor="sw-do"><Textarea id="sw-do" rows={3} defaultValue={draft.voice.do.join("\n")} key={`do-${current.id}`} onChange={(e) => edit({ voice: { ...draft.voice, do: lines(e.target.value) } })} /></Field>
            <Field label="Do not (one per line)" htmlFor="sw-dont"><Textarea id="sw-dont" rows={3} defaultValue={draft.voice.dont.join("\n")} key={`dont-${current.id}`} onChange={(e) => edit({ voice: { ...draft.voice, dont: lines(e.target.value) } })} /></Field>
            <Field label="Example lines" htmlFor="sw-ex"><Textarea id="sw-ex" rows={3} defaultValue={draft.voice.examples.join("\n")} key={`ex-${current.id}`} onChange={(e) => edit({ voice: { ...draft.voice, examples: lines(e.target.value) } })} /></Field>
          </div>
        </section>

        <section aria-label="Rules" style={{ maxWidth: 360 }}>
          <h3 className="h3" style={{ marginBottom: "var(--space-3)" }}>Shape</h3>
          <Slider label="Corner radius" value={Math.round(draft.rules.cornerRadius * 1000) / 10} min={0} max={10} step={0.5} unit="%" onChange={(v) => edit({ rules: { ...draft.rules, cornerRadius: v / 100 } })} />
        </section>
      </div>

      <aside style={{ position: "sticky", top: "var(--space-4)", display: "grid", gap: "var(--space-6)" }}>
        <SwatchPreview swatch={preview} logo={logo} />
        <ContrastPanel swatch={preview} onFix={(role, hex) => edit({ colors: draft.colors.map((c) => (c.role === role ? { ...c, hex } : c)) })} />
      </aside>

      <NewSwatchDialog open={dialog === "new"} onOpenChange={(o) => !o && setDialog(null)} onCreate={async (template, name) => { const s = await api.swatches.create(projectId, { template, data: name ? { name } : undefined }); await refresh(); dirty.current = false; setPickedId(s.id); }} />
      <YarnColorsDialog open={dialog === "yarn"} onOpenChange={(o) => !o && setDialog(null)} images={images} onAccept={(hex, role) => { const has = draft.colors.some((c) => c.role === role); edit({ colors: has ? draft.colors.map((c) => (c.role === role ? { ...c, hex } : c)) : [...draft.colors, { role, name: role, hex }] }); }} />
      <SiteDialog open={dialog === "site"} onOpenChange={(o) => !o && setDialog(null)} projectId={projectId} onCreated={async (s, notes) => { await refresh(); dirty.current = false; setPickedId(s.id); toast(notes.find((n) => /logo/i.test(n)) ?? `Created ${s.name}. Press Use for this project when it looks right.`); }} />
      <ConfirmDialog open={dialog === "delete"} onOpenChange={(o) => !o && setDialog(null)} title={`Delete ${current.name}?`} description={isActive ? "It is this project's active swatch. Another one will take its place." : "Patterns using its colours will use this project's active swatch instead."} confirmLabel="Delete swatch"
        onConfirm={async () => { await api.swatches.remove(current.id); dirty.current = false; setPickedId(null); await refresh(); await refreshProject(); }} />
    </div>
  );
}

function NewSwatchDialog({ open, onOpenChange, onCreate }: { open: boolean; onOpenChange: (o: boolean) => void; onCreate: (template: string, name: string) => Promise<void> }) {
  const [tpl, setTpl] = useState("starter"); const [name, setName] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New swatch" description="Start from a template, then make it yours."
      actions={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" onClick={async () => { await onCreate(tpl, name); onOpenChange(false); setName(""); }}>Create swatch</Button></>}>
      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        <Field label="Name (optional)" htmlFor="ns-name"><Input id="ns-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Template"><Select aria-label="Template" value={tpl} onValueChange={setTpl} options={TEMPLATES} /></Field>
      </div>
    </Dialog>
  );
}

function YarnColorsDialog({ open, onOpenChange, images, onAccept }: { open: boolean; onOpenChange: (o: boolean) => void; images: Yarn[]; onAccept: (hex: string, role: ColorRole) => void }) {
  const [sel, setSel] = useState<string | null>(null);
  const [colors, setColors] = useState<string[]>([]);
  const [role, setRole] = useState<ColorRole>("primary");
  useEffect(() => { if (sel) void api.swatches.colorsFromYarn(sel).then(setColors).catch(() => setColors([])); }, [sel]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} wide title="Pick colours from Yarn" description="Choose an image, then click a colour to use it. Nothing changes until you do.">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: "var(--space-4)" }}>
        {images.map((y) => <button key={y.id} aria-label={y.name} aria-pressed={sel === y.id} onClick={() => setSel(y.id)} style={{ width: 72, height: 72, padding: 0, borderRadius: 8, overflow: "hidden", border: sel === y.id ? "2px solid var(--ember)" : "1px solid var(--line-strong)", cursor: "pointer" }}><img src={yarnThumbUrl(y)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /></button>)}
      </div>
      {sel && (
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ width: 150 }}><Select aria-label="Use as" value={role} onValueChange={(v) => setRole(v as ColorRole)} options={COLOR_ROLES.map((r) => ({ value: r, label: `Use as ${r}` }))} /></div>
          {colors.map((c) => <button key={c} aria-label={`Use ${c}`} onClick={() => { onAccept(c, role); }} style={{ width: 44, height: 44, borderRadius: "50%", background: c, border: "2px solid var(--surface-raised)", boxShadow: "0 0 0 1px var(--line-strong)", cursor: "pointer" }} />)}
        </div>
      )}
    </Dialog>
  );
}

const ROLE_LABEL: Record<ColorRole, string> = { primary: "Primary", secondary: "Secondary", accent: "Accent", neutral: "Neutral", background: "Background", text: "Text" };
const SLOT_LABEL = { display: "Headlines", body: "Body text", mono: "Labels and code" } as const;
// Where the reader found a colour, in words: "buttons", "--color-bg-2", "made from the others".
const sourceText = (from: string) => (from === "made from the others" ? "Made from the others" : from.startsWith("--") ? `Its ${from} variable` : from.startsWith("the ") ? `From ${from}` : `From its ${from}`);
const shortUrl = (u: string) => { try { const x = new URL(u); const s = x.hostname + x.pathname; return s.length > 48 ? `${s.slice(0, 47)}...` : s; } catch { return u; } };

function SiteDialog({ open, onOpenChange, projectId, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; projectId: string; onCreated: (s: Swatch, notes: string[]) => Promise<void> }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<null | "reading" | "creating">(null);
  const [err, setErr] = useState<string | undefined>();
  const [found, setFound] = useState<Awaited<ReturnType<typeof api.swatches.fromUrl>> | null>(null);
  const [name, setName] = useState("");
  const [colors, setColors] = useState<SwatchColor[]>([]);
  const [keepLogo, setKeepLogo] = useState(true);
  const read = async () => {
    setBusy("reading"); setErr(undefined);
    try {
      const f = await api.swatches.fromUrl(projectId, url);
      setFound(f); setName(f.name); setColors(f.colors.map(({ role, name: n, hex }) => ({ role, name: n, hex }))); setKeepLogo(!!f.logo);
    } catch (e) { setErr((e as Error).message); setFound(null); } finally { setBusy(null); }
  };
  const create = async () => {
    if (!found) return;
    setBusy("creating"); setErr(undefined);
    try {
      const r = await api.swatches.fromSite(projectId, { name: name.trim() || found.name, colors, fonts: found.fontRoles, logo: keepLogo ? found.logo : undefined });
      await onCreated(r.swatch, r.notes);
      onOpenChange(false); setFound(null); setUrl("");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  const valid = colors.every((c) => /^#[0-9a-fA-F]{6}$/.test(c.hex));
  const standIn = found?.matched.body?.family ?? "Inter";
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setFound(null); setErr(undefined); } }} wide title="Start from a website"
      description="knitted reads the site's own colours, fonts and logo and proposes a swatch. It fetches the page and its stylesheets when you press Read, and runs nothing from them.">
      <Field label="Website" htmlFor="site-url" error={found ? undefined : err}>
        <Input id="site-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="example.com" onKeyDown={(e) => { if (e.key === "Enter" && url && !busy) void read(); }} />
      </Field>
      <div className="dialog-actions"><Button variant={found ? "secondary" : "primary"} disabled={!!busy || !url} onClick={read}>{busy === "reading" ? "Reading..." : found ? "Read again" : "Read the site"}</Button></div>
      {found && (
        <div style={{ marginTop: "var(--space-5)", display: "grid", gap: "var(--space-4)" }}>
          <p className="label" style={{ margin: 0 }}>Found on {new URL(found.sourceUrl).hostname}. Change anything before you create it.</p>
          <Field label="Name" htmlFor="site-name"><Input id="site-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <section aria-label="Colours found" style={{ display: "grid", gap: "var(--space-2)" }}>
            {colors.map((c, i) => (
              <div key={c.role} style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap" }}>
                <span className="label" style={{ width: 96 }}>{ROLE_LABEL[c.role]}</span>
                <ColorField label={ROLE_LABEL[c.role]} value={c.hex} onChange={(hex) => setColors(colors.map((x, k) => (k === i ? { ...x, hex } : x)))} />
                <span className="body-sm" style={{ color: "var(--ink-muted)" }}>{c.hex.toLowerCase() === found.colors[i]?.hex ? sourceText(found.colors[i].from) : "Your choice"}</span>
              </div>
            ))}
          </section>
          <section aria-label="Fonts found" style={{ display: "grid", gap: "var(--space-1)" }}>
            {(["display", "body", "mono"] as const).map((slot) => {
              const want = found.fontRoles[slot]; const m = found.matched[slot];
              if (!want) return null;
              return (
                <p key={slot} className="body-sm" style={{ margin: 0 }}>
                  <span className="label">{SLOT_LABEL[slot]}:</span> {want}
                  {m ? (m.from === "yarn" ? ", from your Yarn" : m.family === want ? ", bundled" : `, as the bundled ${m.family}`)
                    : <span style={{ color: "var(--ink-muted)" }}>, not bundled. {slot === "mono" ? "The body font" : slot === "display" ? standIn : "Inter"} stands in until you upload the font to Yarn.</span>}
                </p>
              );
            })}
            {!found.fontRoles.body && !found.fontRoles.display && <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>No fonts of its own were found, so it starts with Inter.</p>}
          </section>
          {found.logo && (
            <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
              <Switch id="site-logo" checked={keepLogo} onCheckedChange={setKeepLogo} label={`Bring in its ${found.logo.use === "mark" ? "icon" : "logo"}`} />
              <label htmlFor="site-logo" className="body-sm">Bring in its {found.logo.use === "mark" ? "icon" : "logo"} as Yarn <span style={{ color: "var(--ink-muted)" }}>({shortUrl(found.logo.url)})</span></label>
            </div>
          )}
          {found.notes.map((n) => <p key={n} className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>{n}</p>)}
          {err && <p className="field-error" role="alert"><AlertTriangle size={13} aria-hidden /> {err}</p>}
          <div className="dialog-actions"><Button variant="primary" disabled={!!busy || !valid} onClick={create}><Check size={14} aria-hidden /> {busy === "creating" ? "Creating..." : "Create swatch"}</Button></div>
        </div>
      )}
    </Dialog>
  );
}

void EmptyState;
