"use client";

import { useState } from "react";
import { api } from "@knitted/core/client";
import { Button, Field, Input, Select, Slider, icons, useToast } from "@knitted/ui";
import { useLive } from "@/lib/hooks";

const { AlertTriangle, Check, Copy, RotateCcw } = icons;

export function ModelSettings() {
  return (
    <div style={{ display: "grid", gap: "var(--space-10)", maxWidth: 560 }}>
      <OwnKey />
      <Connect />
    </div>
  );
}

function OwnKey() {
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
    <div style={{ display: "grid", gap: "var(--space-5)" }}>
      <div>
        <h2 className="h3" style={{ marginBottom: 4 }}>Model</h2>
        <p className="body-sm" style={{ color: "var(--ink-muted)", margin: 0 }}>Bring your own Anthropic key and your model can edit patterns and knit posts with you: talk to it in Ask, in the side bar, or in the editor's Ask panel. It follows the same locks you do. Requests go straight from this computer to Anthropic.</p>
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
      <Slider label="Steps per request" value={cfg.maxTurns} min={5} max={100} step={1} unit="" onCommit={(maxTurns) => save({ maxTurns })} />
      <Slider label="Files it may knit per request" value={cfg.maxKnits} min={0} max={100} step={1} unit="" onCommit={(maxKnits) => save({ maxKnits })} />
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <Button variant="primary" onClick={test} disabled={busy || !cfg.key.present}>{busy ? "Checking..." : "Test connection"}</Button>
        {good && <span className="body-sm" style={{ color: "var(--success)", display: "flex", gap: 4, alignItems: "center" }}><Check size={14} aria-hidden /> Connected</span>}
        {err && <span className="field-error" role="alert"><AlertTriangle size={14} aria-hidden /> {err}</span>}
      </div>
    </div>
  );
}

/**
 * Claude Code, or any MCP client, working in this studio through the MCP address:
 * the same tools and locks as the model above, with its own account instead of a key here.
 */
function Connect() {
  const toast = useToast();
  const { data, refresh } = useLive(() => api.agent.mcp(), []);
  if (!data) return null;
  const url = `${window.location.origin}${data.path}`;
  const command = `claude mcp add --scope user --transport http knitted ${url}`;
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast(`${what} copied.`); } catch { toast("This window would not copy. Select the text and copy it."); }
  };
  const copyField = (id: string, value: string, what: string) => (
    <div style={{ display: "flex", gap: 8 }}>
      <Input id={id} mono readOnly value={value} onFocus={(e) => e.target.select()} />
      <Button onClick={() => copy(value, what)}><Copy size={14} aria-hidden /> Copy</Button>
    </div>
  );
  return (
    <div style={{ display: "grid", gap: "var(--space-5)" }}>
      <div>
        <h2 className="h3" style={{ marginBottom: 4 }}>Connect Claude Code</h2>
        <p className="body-sm" style={{ color: "var(--ink-muted)", margin: 0 }}>Or use a model you already have. Claude Code, or any app that speaks MCP, can work here through this address, with the same tools and the same locks. You see its changes as it makes them. It works while knitted is open.</p>
      </div>
      <Field label="For Claude Code" htmlFor="mcp-command" hint="Run it in a terminal, then start Claude Code. Or paste it into Claude Code and ask it to connect to knitted.">
        {copyField("mcp-command", command, "Command")}
      </Field>
      <Field label="The address, for other MCP apps" htmlFor="mcp-url" hint="It holds a key. Anyone with it can edit your library, so keep it to yourself.">
        {copyField("mcp-url", url, "Address")}
      </Field>
      <div>
        <Button variant="ghost" onClick={async () => { await api.agent.newMcpAddress(); await refresh(); toast("New address made. The old one no longer works."); }}><RotateCcw size={14} aria-hidden /> Make a new address</Button>
      </div>
    </div>
  );
}
