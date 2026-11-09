"use client";

import Link from "next/link";
import { useMemo, useRef } from "react";
import { api, uploadYarn, yarnThumbUrl } from "@knitted/core/client";
import { colorFor, COLOR_ROLES, foldersIn, nameOf, LIBRARY_ID, type Stitch, type Yarn } from "@knitted/core";
import { Button, EmptyState, icons, useToast } from "@knitted/ui";
import { useEditor } from "@/lib/editor/store";
import { useLive } from "@/lib/hooks";
import { FolderCrumbs, FolderDialogs, FolderList, useFolders, type FolderKit } from "../Folders";
import { Layers } from "./Layers";

const { Plus, Upload } = icons;
const rid = () => `st_${Math.random().toString(36).slice(2, 9)}`;

/** Add something to the middle of the canvas and select it. */
export function addStitch(s: Omit<Stitch, "id">, label: string) {
  const st = useEditor.getState();
  const id = rid();
  st.dispatch({ type: "addStitch", stitch: { ...s, id } }, { label });
  st.select([id]);
  return id;
}

const PanelHead = ({ title }: { title: string }) => <h2 className="eyebrow" style={{ margin: "0 0 var(--space-3)" }}>{title}</h2>;

/** A panel's folders: where it is, the folders in it, and a line when the folder is empty. */
export function PanelFolders({ kit, empty }: { kit: FolderKit; empty: boolean }) {
  return (
    <>
      <FolderCrumbs kit={kit} />
      <FolderList kit={kit} compact />
      {empty && kit.here && !kit.gone && kit.folders && foldersIn(kit.folders, kit.here).length === 0 && <p className="body-sm" style={{ color: "var(--ink-muted)", margin: "0 0 12px" }}>Nothing in {nameOf(kit.here)} yet.</p>}
      <FolderDialogs kit={kit} />
    </>
  );
}

export type PanelPattern = { id: string; name: string; size: string; folder: string };
const brief = (p: { id: string; name: string; size: { name: string; w: number; h: number }; folder: string }): PanelPattern => ({ id: p.id, name: p.name, size: `${p.size.name} ${p.size.w}x${p.size.h}`, folder: p.folder });

export function PatternsPanel({ projectId, current, list }: { projectId: string; current: string; list: PanelPattern[] }) {
  // Kept fresh, so a pattern filed somewhere else, or a folder renamed here, shows where it is now.
  const { data } = useLive(() => api.patterns.list(projectId).then((ps) => ps.map(brief)), [projectId]);
  const items = data ?? list;
  // It opens in the folder of the pattern being edited.
  const kit = useFolders(projectId, "patterns", items, { inAddress: false, start: list.find((p) => p.id === current)?.folder ?? "" });
  const here = items.filter((p) => p.folder === kit.here);
  return (
    <div>
      <PanelHead title="Patterns" />
      <PanelFolders kit={kit} empty={here.length === 0} />
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
        {here.map((p) => (
          <li key={p.id}><Link href={`/projects/${projectId}/patterns/${p.id}`} aria-current={p.id === current ? "page" : undefined} className="card card-link" draggable onDragStart={kit.dragThings([p.id])} style={{ padding: "8px 10px", display: "block", borderColor: p.id === current ? "var(--ember)" : undefined }}>
            <span className="label">{p.name}</span><br /><span className="eyebrow">{p.size}</span>
          </Link></li>
        ))}
      </ul>
      <h2 className="eyebrow" style={{ margin: "var(--space-6) 0 var(--space-2)" }}>Layers</h2>
      <Layers />
    </div>
  );
}

export function YarnPanel({ projectId, onYarnChanged }: { projectId: string; onYarnChanged: () => void }) {
  const st = useEditor();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const items = useMemo(() => Object.values(st.yarn).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [st.yarn]);
  // The project's own files are in its folders; the Library's, which every project shares, come after.
  const own = useMemo(() => items.filter((y) => y.projectId !== LIBRARY_ID), [items]);
  const shared = useMemo(() => items.filter((y) => y.projectId === LIBRARY_ID && (y.kind === "image" || y.kind === "video" || y.kind === "copy")), [items]);
  const kit = useFolders(projectId, "yarn", own, { inAddress: false, onChanged: onYarnChanged });
  const here = own.filter((y) => y.folder === kit.here);
  const visual = here.filter((y) => y.kind === "image" || y.kind === "video");
  const copy = here.filter((y) => y.kind === "copy");
  // Onto the canvas it places the file; onto a folder here it files it.
  const drag = (y: Yarn) => (e: React.DragEvent) => { kit.dragThings([y.id])(e); e.dataTransfer.setData("application/x-knitted-yarn", y.id); e.dataTransfer.effectAllowed = "copyMove"; };

  const use = (y: Yarn) => {
    const sel = st.pattern.stitches.find((s) => s.id === st.selection[0]);
    if (sel && (sel.kind === "image" || sel.kind === "video") && (y.kind === "image" || y.kind === "video")) { st.dispatch({ type: "updateStitch", id: sel.id, patch: { yarnId: y.id } }, { label: "Set image" }); return; }
    if (y.kind === "copy" && sel?.kind === "text") { st.dispatch({ type: "updateStitch", id: sel.id, patch: { content: y.meta.text ?? "" } }, { label: "Use saved text" }); return; }
    if (y.kind === "copy") { addStitch({ kind: "text", x: 0.08, y: 0.4, w: 0.84, h: 0.12, locked: false, content: y.meta.text ?? "", style: { fontFamily: "$font.body", fontSize: 0.04, fontWeight: 500, color: "$color.text" } }, "Add saved text"); return; }
    const w = 0.6, ratio = y.width && y.height ? y.width / y.height : 1;
    addStitch({ kind: y.kind === "video" ? "video" : "image", x: 0.2, y: 0.2, w, h: (w * st.pattern.size.w) / ratio / st.pattern.size.h, locked: false, yarnId: y.id, style: { fit: "cover" } }, "Add image");
  };

  const upload = async (files: File[]) => {
    for (const f of files) {
      try { await uploadYarn(projectId, f, () => {}, { folder: kit.here }).promise; } catch (e) { toast.problem((e as Error).message); }
    }
    onYarnChanged();
  };

  return (
    <div>
      <PanelHead title="Yarn" />
      <Button block onClick={() => input.current?.click()}><Upload size={14} aria-hidden /> Upload</Button>
      <input ref={input} type="file" multiple hidden aria-label="Upload Yarn" onChange={(e) => { void upload([...(e.target.files ?? [])]); e.target.value = ""; }} />
      <p className="body-sm" style={{ color: "var(--ink-muted)", margin: "8px 0 12px" }}>Click to add or swap. Drag onto the canvas to place it exactly{kit.folders?.length ? ", or onto a folder to file it" : ""}. <Link className="link" href={`/stock?to=${projectId}`}>Find free stock</Link></p>
      <PanelFolders kit={kit} empty={visual.length === 0 && copy.length === 0} />
      {items.length === 0 && !kit.folders?.length ? <EmptyState title="No yarn yet" body="Upload a photo or logo to use it here." /> : <YarnTiles list={visual} drag={drag} use={use} />}
      <SavedText list={copy} drag={drag} use={use} />
      {!kit.here && shared.length > 0 && (
        <section aria-label="From the Library" style={{ marginTop: "var(--space-5)" }}>
          <h3 className="eyebrow" style={{ margin: "0 0 4px" }}>From the Library</h3>
          <p className="body-sm" style={{ color: "var(--ink-muted)", margin: "0 0 var(--space-2)" }}>Every project can use these. <Link className="link" href="/library">The Library</Link></p>
          <YarnTiles list={shared.filter((y) => y.kind !== "copy")} drag={drag} use={use} />
          <SavedText list={shared.filter((y) => y.kind === "copy")} drag={drag} use={use} heading={false} />
        </section>
      )}
    </div>
  );
}

type Use = { drag: (y: Yarn) => (e: React.DragEvent) => void; use: (y: Yarn) => void };
function YarnTiles({ list, drag, use }: { list: Yarn[] } & Use) {
  if (!list.length) return null;
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      {list.map((y) => (
        <li key={y.id}>
          <button draggable aria-label={`Use ${y.name}`} onDragStart={drag(y)} onClick={() => use(y)}
            style={{ width: "100%", padding: 0, border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden", background: "var(--surface-sunken)", cursor: "grab", aspectRatio: "1" }}>
            {y.meta.thumb ? <img src={yarnThumbUrl(y)} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /> : <span className="eyebrow">{y.kind}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
function SavedText({ list, drag, use, heading = true }: { list: Yarn[]; heading?: boolean } & Use) {
  if (!list.length) return null;
  return <>
    {heading && <h3 className="eyebrow" style={{ margin: "var(--space-4) 0 var(--space-2)" }}>Saved text</h3>}
    <ul style={{ listStyle: "none", margin: heading ? 0 : "var(--space-2) 0 0", padding: 0, display: "grid", gap: 6 }}>
      {list.map((y) => <li key={y.id}><button className="card card-link" draggable onDragStart={drag(y)} onClick={() => use(y)} style={{ width: "100%", textAlign: "left", padding: 8, cursor: "pointer", font: "inherit", color: "inherit" }}><span className="label">{y.name}</span><br /><span className="body-sm" style={{ color: "var(--ink-muted)" }}>{(y.meta.text ?? "").slice(0, 60)}</span></button></li>)}
    </ul>
  </>;
}

const TEXT_PRESETS: { label: string; sample: string; stitch: Omit<Stitch, "id"> }[] = [
  { label: "Headline", sample: "Make it knitted.", stitch: { kind: "text", x: 0.08, y: 0.4, w: 0.84, h: 0.16, locked: false, slot: undefined, content: "Your headline", style: { fontFamily: "$font.display", fontSize: 0.09, fontWeight: 800, color: "$color.text", lineHeight: 0.95, letterSpacing: -0.03 } } },
  { label: "Subhead", sample: "A short supporting line", stitch: { kind: "text", x: 0.08, y: 0.58, w: 0.84, h: 0.08, locked: false, content: "A short supporting line", style: { fontFamily: "$font.body", fontSize: 0.04, fontWeight: 600, color: "$color.text", lineHeight: 1.25, letterSpacing: -0.01 } } },
  { label: "Body", sample: "Longer text goes here.", stitch: { kind: "text", x: 0.08, y: 0.68, w: 0.84, h: 0.12, locked: false, content: "Longer text goes here.", style: { fontFamily: "$font.body", fontSize: 0.03, fontWeight: 400, color: "$color.text", lineHeight: 1.4, letterSpacing: 0 } } },
  { label: "Eyebrow", sample: "NEW THIS WEEK", stitch: { kind: "text", x: 0.08, y: 0.34, w: 0.6, h: 0.04, locked: false, content: "NEW THIS WEEK", style: { fontFamily: "$font.mono", fontSize: 0.022, fontWeight: 500, color: "$color.primary", letterSpacing: 0.14, textTransform: "uppercase" } } },
];

export function TextPanel() {
  return (
    <div>
      <PanelHead title="Text" />
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
        {TEXT_PRESETS.map((p) => (
          <li key={p.label}><button className="card card-link" onClick={() => addStitch(p.stitch, `Add ${p.label.toLowerCase()}`)} style={{ width: "100%", textAlign: "left", padding: "10px 12px", cursor: "pointer", font: "inherit", color: "inherit" }}>
            <span className="eyebrow">{p.label}</span><br /><span style={{ fontWeight: p.label === "Headline" ? 800 : 500, fontSize: p.label === "Headline" ? 20 : 14 }}>{p.sample}</span>
          </button></li>
        ))}
      </ul>
    </div>
  );
}

export function ShapesPanel() {
  const shapes: { label: string; stitch: Omit<Stitch, "id"> }[] = [
    { label: "Rectangle", stitch: { kind: "shape", x: 0.1, y: 0.1, w: 0.4, h: 0.2, locked: false, style: { shape: "rect", background: "$color.primary", radius: 0.01 } } },
    { label: "Circle", stitch: { kind: "shape", x: 0.1, y: 0.1, w: 0.3, h: 0.3 * (1080 / 1920), locked: false, style: { shape: "ellipse", background: "$color.accent" } } },
    { label: "Line", stitch: { kind: "shape", x: 0.1, y: 0.5, w: 0.8, h: 0.004, locked: false, style: { shape: "rect", background: "$color.text" } } },
    { label: "Stitch row", stitch: { kind: "shape", x: 0.08, y: 0.5, w: 0.5, h: 0.03, locked: false, style: { shape: "chevrons", color: "$color.neutral", count: 8 } } },
  ];
  return (
    <div>
      <PanelHead title="Shapes" />
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {shapes.map((s) => <li key={s.label}><button className="card card-link" onClick={() => addStitch(s.stitch, `Add ${s.label.toLowerCase()}`)} style={{ width: "100%", padding: "14px 8px", cursor: "pointer", font: "inherit", color: "inherit", textAlign: "center" }}><Plus size={14} aria-hidden /><br /><span className="label">{s.label}</span></button></li>)}
      </ul>
      <p className="body-sm" style={{ color: "var(--ink-muted)", marginTop: 12 }}>The stitch row is the knitted motif. Use it as a divider, not wallpaper.</p>
    </div>
  );
}

export function SwatchPanel({ projectId }: { projectId: string }) {
  const st = useEditor();
  const apply = (role: string) => {
    const sel = st.pattern.stitches.filter((s) => st.selection.includes(s.id));
    if (!sel.length) { st.say("Select a stitch first, then click a colour."); return; }
    st.dispatch({ type: "batch", commands: sel.map((s) => ({ type: "updateStitch" as const, id: s.id, patch: { style: { ...(s.style ?? {}), [s.kind === "text" ? "color" : "background"]: `$color.${role}` } } })) }, { label: "Apply colour" });
  };
  return (
    <div>
      <PanelHead title={`Swatch: ${st.swatch.name}`} />
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {COLOR_ROLES.filter((r) => st.swatch.colors.some((c) => c.role === r)).map((r) => (
          <li key={r}><button onClick={() => apply(r)} aria-label={`Apply ${r}`} style={{ width: "100%", padding: 0, border: "1px solid var(--line-strong)", borderRadius: 8, overflow: "hidden", cursor: "pointer", background: "var(--surface-raised)" }}>
            <span style={{ display: "block", height: 40, background: colorFor(st.swatch, r) }} /><span className="eyebrow" style={{ display: "block", padding: "4px 0" }}>{r}</span>
          </button></li>
        ))}
      </ul>
      <p className="body-sm" style={{ margin: "12px 0" }}>Colours applied here follow the swatch if the brand changes.</p>
      <Link className="link body-sm" href={`/projects/${projectId}/swatch`}>Edit this swatch</Link>
    </div>
  );
}

void api;
