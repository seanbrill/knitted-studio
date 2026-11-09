"use client";

// The pieces every Settings page is made of: cards of rows, what a row is on the left and its
// control on the right, and one way to ask for a key. A save says so with settingsChanged(), so
// the list beside the page can say how each part stands without a reload.

import { useEffect, useState } from "react";
import { Button, Input, icons, useToast } from "@knitted/ui";

const { AlertTriangle, Check } = icons;

const EVENT = "knitted-settings-changed";
/** Something in Settings was saved: the list of parts reads how each stands again. */
export const settingsChanged = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT)); };
export function useSettingsChanged(run: () => void) {
  useEffect(() => {
    window.addEventListener(EVENT, run);
    return () => window.removeEventListener(EVENT, run);
  }, [run]);
}

/** A card of rows, with a head of its own when it has a title or actions. */
export function SetCard({ title, label, actions, children }: { title?: string; label?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="set-card" aria-label={label ?? title}>
      {(title || actions) && (
        <div className="set-card-head">
          {title && <h3 className="set-card-title">{title}</h3>}
          {actions && <div className="set-card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * One setting: its name and what it does on the left, its control on the right. `stack` puts the
 * control under the words, for a field that needs the width; `htmlFor` makes the name its label.
 */
export function SetRow({ label, hint, htmlFor, children, stack, id }: { label: React.ReactNode; hint?: React.ReactNode; htmlFor?: string; children?: React.ReactNode; stack?: boolean; id?: string }) {
  return (
    <div className={`set-row${stack ? " set-row-stack" : ""}`}>
      <div className="set-row-words">
        {htmlFor ? <label className="set-row-label" htmlFor={htmlFor} id={id}>{label}</label> : <p className="set-row-label" id={id}>{label}</p>}
        {hint && <p className="set-row-hint">{hint}</p>}
      </div>
      {children !== undefined && <div className="set-row-control">{children}</div>}
    </div>
  );
}

export type KeyStatus = { present: boolean; source: "environment" | "keychain" | "none"; backend: string | null; canStore: boolean };

/**
 * A key, asked for the same way everywhere: where it is kept, then Save, Test and Remove in one
 * row. The key never comes back: the field is empty, and says it is saved.
 */
export function KeyField({ id, label, noun = "key", status, env, onSave, onRemove, onTest, tested, placeholder }: {
  id: string;
  /** The field's name, like "Google Gemini key". */
  label: string;
  /** What it is called in a sentence: "key", or "secret" for an app's secret. */
  noun?: string;
  status: KeyStatus;
  /** The variable to set when this computer has nowhere safe to keep a key. */
  env?: string;
  onSave: (key: string) => Promise<void>;
  onRemove?: () => Promise<void>;
  /** Checks the saved key without spending: what to say when it worked. */
  onTest?: () => Promise<{ ok: boolean; why?: string }>;
  /** What a test that worked says, like "Google Gemini took the key." */
  tested?: string;
  placeholder?: string;
}) {
  const toast = useToast();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<null | "save" | "test" | "remove">(null);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [err, setErr] = useState<string | undefined>();
  const where = status.source === "environment" ? "in your environment" : status.backend ? `in ${status.backend}` : "on this computer";
  const state = status.present ? `A ${noun} is saved ${where}.`
    : status.canStore ? `No ${noun} yet. It is kept ${status.backend ? `in ${status.backend}` : "on this computer"}, never in knitted's own files.`
    : `This computer has no secure place for a ${noun}.${env ? ` Set ${env} in your environment.` : ""}`;
  const run = async (what: "save" | "test" | "remove", f: () => Promise<void>) => {
    setBusy(what); setErr(undefined); if (what !== "test") setSaid(null);
    try { await f(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  const save = () => run("save", async () => { await onSave(key.trim()); setKey(""); settingsChanged(); toast(`${label[0].toUpperCase()}${label.slice(1)} saved.`); });
  const test = () => run("test", async () => { setSaid(null); const r = await onTest!(); setSaid(r.ok ? { ok: true, text: tested ?? "It took the key." } : { ok: false, text: r.why ?? "It did not take the key." }); });
  const remove = () => run("remove", async () => { await onRemove!(); settingsChanged(); toast(`${label[0].toUpperCase()}${label.slice(1)} removed.`); });
  return (
    <div className="key-field">
      <p className="key-state" id={`${id}-state`}><span className="key-dot" data-on={status.present || undefined} aria-hidden />{state}</p>
      <div className="key-row">
        <Input id={id} type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} disabled={!status.canStore}
          placeholder={placeholder ?? (status.present ? `Paste a new ${noun} to replace it` : `Paste a ${noun}`)} aria-describedby={`${id}-state`}
          onKeyDown={(e) => { if (e.key === "Enter" && key.trim() && !busy) void save(); }} />
        <Button disabled={!key.trim() || !!busy} busy={busy === "save"} onClick={save}>Save</Button>
        {onTest && status.present && <Button disabled={!!busy} busy={busy === "test"} onClick={test}>{busy === "test" ? "Testing..." : "Test"}</Button>}
        {onRemove && status.present && status.source !== "environment" && <Button variant="ghost" className="btn-danger-ink" disabled={!!busy} onClick={remove}>Remove</Button>}
      </div>
      {said && (said.ok
        ? <p className="key-said" role="status"><Check size={14} aria-hidden /> {said.text}</p>
        : <p className="field-error" role="alert"><AlertTriangle size={14} aria-hidden /> {said.text}</p>)}
      {err && <p className="field-error" role="alert"><AlertTriangle size={14} aria-hidden /> {err}</p>}
    </div>
  );
}
