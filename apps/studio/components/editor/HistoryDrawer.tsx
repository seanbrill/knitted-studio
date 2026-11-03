"use client";

import { api, type RevisionItem } from "@knitted/core/client";
import { Button, Drawer, Skeleton, useToast } from "@knitted/ui";
import { timeAgo, useLive } from "@/lib/hooks";
import { useEditor } from "@/lib/editor/store";

const WHO: Record<string, string> = { human: "You", fill: "You", model: "Your model", import: "Import", system: "knitted" };

export function HistoryDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { pattern, reload } = useEditor();
  const toast = useToast();
  const { data, refresh } = useLive(() => (open ? api.patterns.revisions(pattern.id) : Promise.resolve([] as RevisionItem[])), [open, pattern.id, pattern.version]);
  return (
    <Drawer open={open} onOpenChange={onOpenChange} title="History">
      <h2 className="h2" style={{ marginBottom: 4 }}>History</h2>
      <p className="body-sm" style={{ color: "var(--ink-muted)", marginTop: 0 }}>Every saved change, newest first. Restoring is itself a change, so you can undo it.</p>
      {!data ? <Skeleton height={120} /> : (
        <ol style={{ listStyle: "none", margin: "var(--space-4) 0 0", padding: 0, display: "grid", gap: 6 }}>
          {data.map((r, i) => (
            <li key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p className="label" style={{ margin: 0 }}>{r.label ?? "Edit"}</p>
                <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>{WHO[r.author] ?? r.author}, {timeAgo(r.createdAt)}</p>
              </div>
              {i === 0 ? <span className="eyebrow">Current</span> : <Button size="sm" onClick={async () => { await api.patterns.restore(pattern.id, r.id); await reload(); await refresh(); toast("Restored. Undo it from History if you change your mind."); onOpenChange(false); }}>Restore</Button>}
            </li>
          ))}
        </ol>
      )}
    </Drawer>
  );
}
