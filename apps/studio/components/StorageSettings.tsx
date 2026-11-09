"use client";

import { api } from "@knitted/core/client";
import { Button, useToast } from "@knitted/ui";
import { timeAgo, useLive } from "@/lib/hooks";
import { SetCard, SetRow, settingsChanged } from "./SettingsParts";

export const size = (b: number) => (b > 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${(b / 1024 ** 2).toFixed(1)} MB`);
const KIND = { daily: "Daily", manual: "You made this", "pre-migration": "Before an update" } as const;

export function StorageSettings() {
  const toast = useToast();
  const { data: s } = useLive(() => api.storage(), []);
  const { data: backups, refresh } = useLive(() => api.backups.list(), []);
  if (!s) return null;
  return (
    <>
      <SetCard label="Where your work lives">
        <SetRow stack label="Where your work lives" hint={`${s.projects} project${s.projects === 1 ? "" : "s"}, ${size(s.bytes)}. Uninstalling knitted never deletes this folder.`}>
          <code className="mono set-path">{s.root}</code>
        </SetRow>
      </SetCard>
      <SetCard title="Backups" actions={<Button size="sm" onClick={async () => { await api.backups.create(); await refresh(); settingsChanged(); toast("Backup saved."); }}>Back up now</Button>}>
        <SetRow label="Every day, and before an update" hint="knitted saves a copy of your library's database every day, keeps the last seven, and saves one before any update that changes it. They sit next to your library folder. Your picture and video files are not copied; they are not changed by updates." />
        {backups && backups.length > 0 && (
          <ul aria-label="Backups" className="set-list">
            {backups.slice(0, 12).map((b) => (
              <li key={b.name}>
                <span><time dateTime={b.createdAt} title={new Date(b.createdAt).toLocaleString()}>{timeAgo(b.createdAt)}</time> <span className="set-muted">{KIND[b.kind]}</span></span>
                <span className="set-muted">{size(b.bytes)}</span>
              </li>
            ))}
          </ul>
        )}
        <SetRow label="Going back to one" hint={<>Close knitted and run <code className="mono">node scripts/restore-backup.mjs</code>, or follow docs/INSTALL.md. Your current file is set aside, not deleted.</>} />
      </SetCard>
    </>
  );
}
