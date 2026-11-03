"use client";

import { api } from "@knitted/core/client";
import { Button, useToast } from "@knitted/ui";
import { useLive } from "@/lib/hooks";

const size = (b: number) => (b > 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${(b / 1024 ** 2).toFixed(1)} MB`);
const KIND = { daily: "Daily", manual: "You made this", "pre-migration": "Before an update" } as const;

export function StorageSettings() {
  const toast = useToast();
  const { data: s } = useLive(() => api.storage(), []);
  const { data: backups, refresh } = useLive(() => api.backups.list(), []);
  if (!s) return null;
  return (
    <div style={{ display: "grid", gap: "var(--space-5)", maxWidth: 620 }}>
      <div>
        <h2 className="h3" style={{ marginBottom: 4 }}>Where your work lives</h2>
        <p className="body-sm" style={{ margin: 0 }}><code className="mono">{s.root}</code></p>
        <p className="body-sm" style={{ margin: "4px 0 0", color: "var(--ink-muted)" }}>{s.projects} project{s.projects === 1 ? "" : "s"}, {size(s.bytes)}. Uninstalling knitted never deletes this folder.</p>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        <h2 className="h3" style={{ margin: 0 }}>Backups</h2>
        <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>knitted saves a copy of your library&apos;s database every day, keeps the last seven, and saves one before any update that changes it. They sit next to your library folder. Your picture and video files are not copied; they are not changed by updates.</p>
        <div><Button onClick={async () => { await api.backups.create(); await refresh(); toast("Backup saved."); }}>Back up now</Button></div>
        {backups && backups.length > 0 && (
          <ul aria-label="Backups" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
            {backups.slice(0, 12).map((b) => <li key={b.name} className="body-sm" style={{ display: "flex", justifyContent: "space-between" }}><span>{new Date(b.createdAt).toLocaleString()} <span style={{ color: "var(--ink-muted)" }}>{KIND[b.kind]}</span></span><span>{size(b.bytes)}</span></li>)}
          </ul>
        )}
        <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>To go back to a backup, close knitted and run <code className="mono">node scripts/restore-backup.mjs</code>, or follow docs/INSTALL.md. Your current file is set aside, not deleted.</p>
      </div>
    </div>
  );
}
