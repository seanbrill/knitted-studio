"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, subscribeChanges } from "@knitted/core/client";
import type { Part, Pattern, Swatch, Yarn } from "@knitted/core";
import { Dialog, IconButton, Kbd, icons, useToast } from "@knitted/ui";
import { manifestFamilies } from "@/lib/editor/fonts";
import { useEditor } from "@/lib/editor/store";
import { Canvas } from "./Canvas";
import { FillForm } from "./FillForm";
import { HistoryDrawer } from "./HistoryDrawer";
import { KnitDialog } from "./KnitDialog";
import { Inspector } from "./Inspector";
import { SHORTCUTS, useEditorKeys } from "./keys";
import { PatternsPanel, ShapesPanel, SwatchPanel, TextPanel, YarnPanel } from "./Panels";
import { PartsPanel, SavePartDialog } from "./PartsUI";
import { VoicePanel } from "./VoicePanel";
import { AskPanel } from "./AskPanel";
import { TopBar } from "./TopBar";
import { Timeline } from "./Timeline";

const { LayoutGrid, Image: ImageIcon, Type, Shapes, Palette, Package, Mic, Sparkles } = icons;
type Tool = "patterns" | "yarn" | "text" | "shapes" | "parts" | "voice" | "swatch" | "ask";
const TOOLS: { id: Tool; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
  { id: "patterns", label: "Patterns", Icon: LayoutGrid }, { id: "yarn", label: "Yarn", Icon: ImageIcon }, { id: "text", label: "Text", Icon: Type },
  { id: "shapes", label: "Shapes", Icon: Shapes }, { id: "parts", label: "Parts", Icon: Package }, { id: "voice", label: "Voice", Icon: Mic }, { id: "swatch", label: "Swatch", Icon: Palette }, { id: "ask", label: "Ask", Icon: Sparkles },
];

export function EditorShell({ projectId, pattern, swatch, yarn, parts, patterns, onKnit }: { projectId: string; pattern: Pattern; swatch: Swatch; yarn: Yarn[]; parts: Part[]; patterns: { id: string; name: string; size: string }[]; onKnit?: () => void }) {
  const toast = useToast();
  const st = useEditor();
  const [tool, setTool] = useState<Tool | null>("patterns");
  const [history, setHistory] = useState(false);
  const [keys, setKeys] = useState(false);
  const [knit, setKnit] = useState(false);
  const [savePart, setSavePart] = useState(false);
  const [timeline, setTimeline] = useState(false);

  useEffect(() => { st.init({ pattern, swatch, yarn, parts }); }, [pattern.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshYarn = useCallback(async () => st.setYarn(await api.yarn.list(projectId)), [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  const refreshParts = useCallback(async () => st.setParts(await api.parts.list(projectId)), [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Another process (a model, MCP) changed the library: pick it up, unless we are mid-gesture or mid-save.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const off = subscribeChanges(() => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const s = useEditor.getState();
        if (!s.pattern || s.draft || s.status === "saving") return;
        try {
          const fresh = await api.patterns.get(s.pattern.id);
          if (fresh.version > s.serverVersion) { await s.reload(); s.say("Updated: this pattern was changed somewhere else."); }
          const sw = (await api.swatches.list(projectId)).find((x) => x.id === s.swatch.id);
          if (sw && sw.updatedAt !== s.swatch.updatedAt) s.setSwatch(sw);
          void refreshYarn();
          void refreshParts();
        } catch { /* a transient read: the next change event tries again */ }
      }, 200);
    });
    return () => { off(); clearTimeout(t); };
  }, [projectId, refreshYarn, refreshParts]);

  useEditorKeys({ onShortcuts: () => setKeys(true), onFit: () => st.setZoom("fit") });

  // Surface notices (refusals, conflicts) as toasts.
  const noticeId = st.notice?.id;
  useEffect(() => { if (st.notice) toast(st.notice.text); }, [noticeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const fonts = useMemo(() => manifestFamilies, []);
  if (!st.pattern || st.pattern.id !== pattern.id) return <div style={{ height: "100dvh", background: "var(--surface-sunken)" }} />;

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
      <TopBar projectId={projectId} timeline={timeline} onTimeline={() => setTimeline((t) => !t)} onHistory={() => setHistory(true)} onShortcuts={() => setKeys(true)} onKnit={onKnit ?? (() => setKnit(true))} />
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <nav aria-label="Tools" style={{ width: "var(--rail-w)", background: "var(--rail)", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: "var(--space-2)", gap: 4, flexShrink: 0 }}>
          {TOOLS.map(({ id, label, Icon }) => {
            const on = tool === id;
            return <button key={id} onClick={() => setTool(on ? null : id)} aria-label={label} aria-pressed={on} title={label}
              style={{ width: 40, height: 40, borderRadius: "var(--radius-md)", display: "grid", placeItems: "center", cursor: "pointer", background: on ? "var(--rail-active)" : "transparent", color: on ? "var(--rail-active-ink)" : "var(--on-rail-muted)", border: 0 }}><Icon size={18} /></button>;
          })}
        </nav>
        {tool && (
          <aside aria-label={`${tool} panel`} style={{ width: 264, background: "var(--surface-raised)", borderRight: "1px solid var(--line)", padding: "var(--space-4)", overflowY: "auto", flexShrink: 0 }}>
            {tool === "patterns" && <PatternsPanel projectId={projectId} current={pattern.id} list={patterns} />}
            {tool === "yarn" && <YarnPanel projectId={projectId} onYarnChanged={refreshYarn} />}
            {tool === "text" && <TextPanel />}
            {tool === "shapes" && <ShapesPanel />}
            {tool === "parts" && <PartsPanel projectId={projectId} />}
            {tool === "voice" && <VoicePanel projectId={projectId} />}
            {tool === "ask" && <AskPanel projectId={projectId} />}
            {tool === "swatch" && <SwatchPanel projectId={projectId} />}
          </aside>
        )}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <Canvas projectId={projectId} />
          {timeline && <Timeline />}
        </div>
        <div style={{ width: "var(--inspector-w)", background: "var(--surface-raised)", borderLeft: "1px solid var(--line)", overflowY: "auto", padding: "var(--space-4)", flexShrink: 0 }}>
          {st.mode === "fill" ? <FillForm /> : <Inspector fonts={fonts} onSavePart={() => setSavePart(true)} />}
        </div>
      </div>
      <HistoryDrawer open={history} onOpenChange={setHistory} />
      <SavePartDialog open={savePart} onOpenChange={setSavePart} projectId={projectId} />
      <KnitDialog open={knit} onOpenChange={setKnit} pattern={st.pattern} projectId={projectId} />
      <Dialog open={keys} onOpenChange={setKeys} title="Keyboard shortcuts" wide>
        <dl style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "8px 24px", margin: 0 }}>
          {SHORTCUTS.map(([a, b]) => <div key={a} style={{ display: "contents" }}><dt className="body-sm">{a}</dt><dd style={{ margin: 0 }}><Kbd>{b}</Kbd></dd></div>)}
        </dl>
      </Dialog>
    </div>
  );
}

void IconButton;
