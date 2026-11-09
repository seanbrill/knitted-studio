"use client";

import { useState } from "react";
import { api } from "@knitted/core/client";
import { Button, Input, Select, Slider, icons, useToast } from "@knitted/ui";
import { useLive } from "@/lib/hooks";
import { choiceSaved } from "@/lib/model-choice";
import { DoneSettings } from "./ModelDone";
import { KeyField, SetCard, SetRow, settingsChanged } from "./SettingsParts";

const { AlertTriangle, Copy, ExternalLink, RotateCcw } = icons;

export function ModelSettings() {
  return (
    <>
      <OwnKey />
      <DoneSettings />
      <Connect />
    </>
  );
}

function OwnKey() {
  const { data: cfg, refresh } = useLive(() => api.agent.config(), []);
  const [err, setErr] = useState<string | undefined>();
  if (!cfg) return null;
  const save = async (p: Parameters<typeof api.agent.save>[0]) => {
    const c = await api.agent.save(p); choiceSaved(c.model, c.models); await refresh(); settingsChanged();
  };
  const choose = async (p: Parameters<typeof api.agent.save>[0]) => { try { await save(p); setErr(undefined); } catch (e) { setErr((e as Error).message); } };
  return (
    <>
      <SetCard label="Anthropic key">
        <SetRow stack label="Anthropic API key" htmlFor="m-key" hint={<>Only ever sent to Anthropic, straight from this computer. <a className="link" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">Get a key <ExternalLink size={11} aria-hidden /></a></>}>
          <KeyField id="m-key" label="Anthropic API key" status={cfg.key} env="ANTHROPIC_API_KEY"
            onSave={(apiKey) => save({ apiKey })}
            onRemove={cfg.key.source === "keychain" ? () => save({ clearKey: true }) : undefined}
            onTest={async () => { try { await api.agent.test(); return { ok: true }; } catch (e) { return { ok: false, why: (e as Error).message }; } }}
            tested="Anthropic took the key." />
        </SetRow>
      </SetCard>
      <SetCard label="How it works">
        <SetRow label="Model" hint="Auto starts each task on the least model it needs: Haiku for a quick change, Opus for layout and design, Sonnet for the rest. If the task turns out harder, it steps up part way, never down. You can change it beside any message too.">
          <div className="set-select"><Select aria-label="Model" value={cfg.model} onValueChange={(model) => choose({ model })} options={cfg.models.map((m) => ({ value: m.id, label: m.label }))} /></div>
        </SetRow>
        <SetRow label="Steps per request" hint="How many steps it may take on one message before it stops.">
          <div className="set-slider"><Slider bare label="Steps per request" value={cfg.maxTurns} min={5} max={100} step={1} unit="" onCommit={(maxTurns) => choose({ maxTurns })} /></div>
        </SetRow>
        <SetRow label="Files it may knit per request" hint="The most files one knit of its may make. At 0 there is no limit.">
          <div className="set-slider"><Slider bare label="Files it may knit per request" value={cfg.maxKnits} min={0} max={100} step={1} unit="" onCommit={(maxKnits) => choose({ maxKnits })} /></div>
        </SetRow>
        {err && <p className="field-error set-error" role="alert"><AlertTriangle size={14} aria-hidden /> {err}</p>}
      </SetCard>
    </>
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
    <div className="key-row">
      <Input id={id} mono readOnly value={value} onFocus={(e) => e.target.select()} />
      <Button onClick={() => copy(value, what)}><Copy size={14} aria-hidden /> Copy</Button>
    </div>
  );
  return (
    <SetCard title="Connect Claude Code" actions={<Button size="sm" variant="ghost" onClick={async () => { await api.agent.newMcpAddress(); await refresh(); toast("New address made. The old one no longer works."); }}><RotateCcw size={13} aria-hidden /> Make a new address</Button>}>
      <SetRow label="Or use a model you already have" hint="Claude Code, or any app that speaks MCP, can work here through this address, with the same tools and the same locks. You see its changes as it makes them. It works while knitted is open." />
      <SetRow stack label="For Claude Code" htmlFor="mcp-command" hint="Run it in a terminal, then start Claude Code. Or paste it into Claude Code and ask it to connect to knitted.">
        {copyField("mcp-command", command, "Command")}
      </SetRow>
      <SetRow stack label="The address, for other MCP apps" htmlFor="mcp-url" hint="It holds a key. Anyone with it can edit your library, so keep it to yourself.">
        {copyField("mcp-url", url, "Address")}
      </SetRow>
    </SetCard>
  );
}
