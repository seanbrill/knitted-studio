"use client";

import * as React from "react";
import { UploadCloud } from "lucide-react";
import { StitchRow } from "./motifs.tsx";

// ── Toasts ─────────────────────────────────────────────────────────────────
interface ToastItem { id: number; message: string; action?: { label: string; onClick: () => void }; }
const ToastCtx = React.createContext<(message: string, action?: ToastItem["action"], ms?: number) => void>(() => {});
export const useToast = () => React.useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const next = React.useRef(1);
  const push = React.useCallback((message: string, action?: ToastItem["action"], ms = 6000) => {
    const id = next.current++;
    setItems((p) => [...p, { id, message, action }]);
    setTimeout(() => setItems((p) => p.filter((t) => t.id !== id)), ms);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="region" aria-label="Notifications" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="toast">
            <span>{t.message}</span>
            {t.action && (
              <button className="toast-action" onClick={() => { t.action!.onClick(); setItems((p) => p.filter((x) => x.id !== t.id)); }}>
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ── Empty state: the stitch chevrons are the illustration ───────────────────
export function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <div style={{ color: "var(--ember)", display: "grid", gap: 6, justifyItems: "center" }}>
        <StitchRow count={5} size={22} />
        <StitchRow count={4} size={22} color="var(--oxblood)" />
      </div>
      <h3 className="h3">{title}</h3>
      <p className="body">{body}</p>
      {action}
    </div>
  );
}

// ── Drop zone: visual and event plumbing; what happens to files is the caller's ──
export function DropZone({ onFiles, children, accept, multiple = true, className }: {
  onFiles: (files: File[]) => void; children?: React.ReactNode; accept?: string; multiple?: boolean; className?: string;
}) {
  const [over, setOver] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);
  return (
    <div
      className={`dropzone ${className ?? ""}`}
      data-over={over}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = [...e.dataTransfer.files]; if (f.length) onFiles(f); }}
    >
      <input ref={input} type="file" hidden accept={accept} multiple={multiple}
        onChange={(e) => { const f = [...(e.target.files ?? [])]; if (f.length) onFiles(f); e.target.value = ""; }} />
      {children ?? (
        <>
          <UploadCloud size={28} aria-hidden style={{ marginBottom: 8 }} />
          <p className="label" style={{ margin: 0 }}>Drop files here</p>
          <p className="body-sm" style={{ margin: "4px 0 12px" }}>or</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => input.current?.click()}>Choose files</button>
        </>
      )}
    </div>
  );
}
