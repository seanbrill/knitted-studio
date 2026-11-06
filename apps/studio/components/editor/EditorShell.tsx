"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, subscribeChanges } from "@knitted/core/client";
import type { Part, Pattern, Swatch, Yarn } from "@knitted/core";
import { Dialog, IconButton, Kbd, Tooltip, icons, useToast } from "@knitted/ui";
import { manifestFamilies } from "@/lib/editor/fonts";
import { namesOf, useEditor } from "@/lib/editor/store";
import { agentNow, whoChanged } from "@/lib/agent";
import { Canvas } from "./Canvas";
import { FillForm } from "./FillForm";
import { HistoryDrawer } from "./HistoryDrawer";
import { KnitDialog } from "./KnitDialog";
import { Inspector } from "./Inspector";
import { SHORTCUTS, useEditorKeys } from "./keys";
import { PatternsPanel, ShapesPanel, SwatchPanel, TextPanel, YarnPanel, type PanelPattern } from "./Panels";
import { PartsPanel, SavePartDialog } from "./PartsUI";
import { VoicePanel } from "./VoicePanel";
import { AskPanel } from "./AskPanel";
import { TopBar } from "./TopBar";
import { Timeline } from "./Timeline";

const { LayoutGrid, Image: ImageIcon, Type, Shapes, Palette, Package, Mic, Sparkles, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } = icons;
type Tool = "patterns" | "yarn" | "text" | "shapes" | "parts" | "voice" | "swatch" | "ask";
const TOOLS: { id: Tool; label: string; hint: string; Icon: React.ComponentType<{ size?: number }> }[] = [
  { id: "patterns", label: "Patterns", hint: "The patterns in this project, and the layers of this one.", Icon: LayoutGrid },
  { id: "yarn", label: "Yarn", hint: "Your files: photos, logos, video, sound and copy. Drag one onto the canvas.", Icon: ImageIcon },
  { id: "text", label: "Text", hint: "Add a headline, a line of body copy or a label.", Icon: Type },
  { id: "shapes", label: "Shapes", hint: "Add a box, a circle or a line in the brand's colours.", Icon: Shapes },
  { id: "parts", label: "Parts", hint: "Reusable pieces, like a logo lockup or a button. Add one, or save your own.", Icon: Package },
  { id: "voice", label: "Voice", hint: "A voiceover and music, for a pattern that plays as a video.", Icon: Mic },
  { id: "swatch", label: "Swatch", hint: "The brand's colours and fonts, to use on what is selected.", Icon: Palette },
  { id: "ask", label: "Ask", hint: "Ask your model to write, change or check this pattern.", Icon: Sparkles },
];
// Whether each side is open, remembered as the nav rail is (AppShell).
const PANEL_KEY = "knitted.editor.panel";
const INSPECTOR_KEY = "knitted.editor.inspector";
const BOTH = "Ctrl+\\ hides or shows both sides.";
const railButton = { width: 40, height: 40, borderRadius: "var(--radius-md)", display: "grid", placeItems: "center", cursor: "pointer", border: 0 } as const;

export function EditorShell({ projectId, pattern, swatch, yarn, parts, patterns, onKnit }: { projectId: string; pattern: Pattern; swatch: Swatch; yarn: Yarn[]; parts: Part[]; patterns: PanelPattern[]; onKnit?: () => void }) {
  const toast = useToast();
  const st = useEditor();
  const [tool, setTool] = useState<Tool>("patterns");
  const [panel, setPanel] = useState(true);
  const [inspector, setInspector] = useState(true);
  const [history, setHistory] = useState(false);
  const [keys, setKeys] = useState(false);
  const [knit, setKnit] = useState(false);
  const [savePart, setSavePart] = useState(false);
  const [timeline, setTimeline] = useState(false);

  useEffect(() => { st.init({ pattern, swatch, yarn, parts }); }, [pattern.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshYarn = useCallback(async () => st.setYarn(await api.yarn.list(projectId)), [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  const refreshParts = useCallback(async () => st.setParts(await api.parts.list(projectId)), [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Another process (a model, MCP) changed the library: pick it up. Mid-gesture or mid-save
  // it waits its turn rather than skipping, so a model's change is never missed; a save that
  // lands under it is carried over onto it instead (lib/editor/store.ts, rebase).
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const check = async () => {
      const s = useEditor.getState();
      if (!s.pattern) return;
      if (s.draft || s.status === "saving") { t = setTimeout(check, 400); return; }
      try {
        const fresh = await api.patterns.get(s.pattern.id);
        if (fresh.version > useEditor.getState().serverVersion) {
          const steps = s.undoStack.length + s.redoStack.length;
          // Null when a save of the person's is carrying it over instead: that says so itself.
          const theirs = await s.reload();
          if (theirs) {
            const now = useEditor.getState();
            const who = whoChanged(agentNow(), s.pattern.id, Date.now());
            const what = namesOf(theirs, now.pattern);
            // Their change is on the canvas, marked with their name: a toast only when Undo changed under the person.
            if (now.undoStack.length + now.redoStack.length < steps) now.say(`${who ?? "Someone else"} changed ${what}. Undo will leave that alone.`);
            else if (who) now.announce(`${who} changed ${what}.`);
            else now.say("Updated: this pattern was changed somewhere else.");
          }
        }
        const sw = (await api.swatches.list(projectId)).find((x) => x.id === s.swatch.id);
        if (sw && sw.updatedAt !== s.swatch.updatedAt) s.setSwatch(sw);
        void refreshYarn();
        void refreshParts();
      } catch { /* a transient read: the next change event tries again */ }
    };
    const off = subscribeChanges(() => { clearTimeout(t); t = setTimeout(check, 200); });
    return () => { off(); clearTimeout(t); };
  }, [projectId, refreshYarn, refreshParts]);

  useEffect(() => {
    // Read after mount on purpose, as AppShell does: the server cannot know these preferences,
    // and reading them during render would mismatch the server's HTML.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { setPanel(localStorage.getItem(PANEL_KEY) !== "closed"); setInspector(localStorage.getItem(INSPECTOR_KEY) !== "closed"); } catch {}
  }, []);
  const showPanel = (open: boolean) => { setPanel(open); try { localStorage.setItem(PANEL_KEY, open ? "open" : "closed"); } catch {} };
  const showInspector = (open: boolean) => { setInspector(open); try { localStorage.setItem(INSPECTOR_KEY, open ? "open" : "closed"); } catch {} };
  // A tool opens its panel; the open one, pressed again, hides it.
  const pick = (id: Tool) => { if (panel && tool === id) showPanel(false); else { setTool(id); showPanel(true); } };
  const toolLabel = TOOLS.find((t) => t.id === tool)!.label;

  useEditorKeys({ onShortcuts: () => setKeys(true), onFit: () => st.setZoom("fit"), onPanels: () => { const open = !panel && !inspector; showPanel(open); showInspector(open); } });

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
          {TOOLS.map(({ id, label, hint, Icon }) => {
            const on = panel && tool === id;
            return (
              <Tooltip key={id} label={label} hint={hint} side="right">
                <button onClick={() => pick(id)} aria-label={label} aria-pressed={on}
                  style={{ ...railButton, background: on ? "var(--rail-active)" : "transparent", color: on ? "var(--rail-active-ink)" : "var(--on-rail-muted)" }}><Icon size={18} /></button>
              </Tooltip>
            );
          })}
          <span style={{ flex: 1 }} />
          <Tooltip label={panel ? "Hide the panel" : "Show the panel"} hint={panel ? `More room for the canvas. ${BOTH}` : `Opens ${toolLabel} again. ${BOTH}`} side="right">
            <button onClick={() => showPanel(!panel)} aria-label={panel ? "Hide the panel" : "Show the panel"}
              style={{ ...railButton, marginBottom: "var(--space-2)", background: "transparent", color: "var(--on-rail-muted)" }}>{panel ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}</button>
          </Tooltip>
        </nav>
        {panel && (
          <aside aria-label={`${tool} panel`} style={{ width: tool === "ask" ? 340 : 264, background: "var(--surface-raised)", borderRight: "1px solid var(--line)", padding: "var(--space-4)", flexShrink: 0,
            // A conversation scrolls inside itself, so its box to write in stays in view.
            ...(tool === "ask" ? { display: "flex", flexDirection: "column", overflow: "hidden" } : { overflowY: "auto" }) }}>
            {tool === "patterns" && <PatternsPanel projectId={projectId} current={pattern.id} list={patterns} />}
            {tool === "yarn" && <YarnPanel projectId={projectId} onYarnChanged={refreshYarn} />}
            {tool === "text" && <TextPanel />}
            {tool === "shapes" && <ShapesPanel />}
            {tool === "parts" && <PartsPanel projectId={projectId} onPartsChanged={refreshParts} />}
            {tool === "voice" && <VoicePanel projectId={projectId} />}
            {tool === "ask" && <AskPanel key={pattern.id} projectId={projectId} />}
            {tool === "swatch" && <SwatchPanel projectId={projectId} />}
          </aside>
        )}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <Canvas projectId={projectId} chatOpen={panel && tool === "ask"} onOpenChat={() => { setTool("ask"); showPanel(true); }} />
          {timeline && <Timeline />}
        </div>
        {inspector ? (
          <div style={{ width: "var(--inspector-w)", background: "var(--surface-raised)", borderLeft: "1px solid var(--line)", overflowY: "auto", padding: "var(--space-4)", flexShrink: 0, position: "relative" }}>
            <IconButton label="Hide the Inspector" hint={`More room for the canvas. ${BOTH}`} onClick={() => showInspector(false)} style={{ position: "absolute", top: 8, right: 8, zIndex: 1 }}><PanelRightClose size={16} /></IconButton>
            {st.mode === "fill" ? <FillForm /> : <Inspector fonts={fonts} onSavePart={() => setSavePart(true)} />}
          </div>
        ) : (
          <div style={{ width: 44, background: "var(--surface-raised)", borderLeft: "1px solid var(--line)", display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-3)", paddingTop: 8, flexShrink: 0 }}>
            <IconButton label="Show the Inspector" hint={`What is selected, and how it looks. ${BOTH}`} onClick={() => showInspector(true)}><PanelRightOpen size={16} /></IconButton>
            <span aria-hidden className="eyebrow" style={{ writingMode: "vertical-rl", color: "var(--ink-muted)" }}>{st.mode === "fill" ? "Fill" : "Inspector"}</span>
          </div>
        )}
      </div>
      <div className="sr-only" role="status" data-testid="editor-announcement">{st.announcement}</div>
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

