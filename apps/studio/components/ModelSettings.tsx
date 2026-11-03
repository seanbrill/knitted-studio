"use client";

import { useState } from "react";
import { api } from "@knitted/core/client";
import { Button, Field, Input, Select, Slider, icons, useToast } from "@knitted/ui";
import { useLive } from "@/lib/hooks";

const { AlertTriangle, Check } = icons;

export function ModelSettings() {
  const toast = useToast();
  const { data: cfg, refresh } = useLive(() => api.agent.config(), []);
  const [key, setKey] = useState("");
  const [err, setErr] = useState<string | undefined>();
  const [good, setGood] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!cfg) return null;
  const save = async (p: Parameters<typeof api.agent.save>[0]) => { try { await api.agent.save(p); await refresh(); setErr(undefined); } catch (e) { setErr((e as Error).message); } };
  const test = async () => { setBusy(true); setErr(undefined); setGood(false); try { await api.agent.test(); setGood(true); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  return (
    <div style={{ display: "grid", gap: "var(--space-5)", maxWidth: 560 }}>
      <div>
        <h2 className="h3" style={{ marginBottom: 4 }}>Model</h2>
        <p className="body-sm" style={{ color: "var(--ink-muted)", margin: 0 }}>Bring your own Anthropic key and your model can edit patterns and knit posts with you. It follows the same locks you do. Requests go straight from this computer to Anthropic.</p>
      </div>
      <Field label="Anthropic API key" htmlFor="m-key" error={err}
        hint={cfg.key.present ? `A key is saved${cfg.key.source === "environment" ? " in your environment" : ` in ${cfg.key.backend}`}.` : cfg.key.canStore ? `It is kept in ${cfg.key.backend}, never in knitted's own files.` : "This computer has no secure place for a key. Set ANTHROPIC_API_KEY in your environment."}>
        <div style={{ display: "flex", gap: 8 }}>
          <Input id="m-key" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={cfg.key.present ? "Saved. Type to replace." : "Paste a key"} disabled={!cfg.key.canStore} />
          <Button disabled={!key} onClick={async () => { await save({ apiKey: key }); setKey(""); toast("Key saved."); }}>Save</Button>
          {cfg.key.present && cfg.key.source === "keychain" && <Button variant="danger" onClick={() => save({ clearKey: true })}>Remove</Button>}
        </div>
      </Field>
      <Field label="Model"><Select aria-label="Model" value={cfg.model} onValueChange={(model) => save({ model })} options={cfg.models.map((m) => ({ value: m.id, label: m.label }))} /></Field>
      <Slider label="Steps per request" value={cfg.maxTurns} min={5} max={60} step={1} unit="" onChange={() => {}} onCommit={(maxTurns) => save({ maxTurns })} />
      <Slider label="Files it may knit per request" value={cfg.maxKnits} min={0} max={100} step={1} unit="" onChange={() => {}} onCommit={(maxKnits) => save({ maxKnits })} />
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <Button variant="primary" onClick={test} disabled={busy || !cfg.key.present}>{busy ? "Checking..." : "Test connection"}</Button>
        {good && <span className="body-sm" style={{ color: "var(--success)", display: "flex", gap: 4, alignItems: "center" }}><Check size={14} aria-hidden /> Connected</span>}
        {err && <span className="field-error" role="alert"><AlertTriangle size={14} aria-hidden /> {err}</span>}
      </div>
    </div>
  );
}
