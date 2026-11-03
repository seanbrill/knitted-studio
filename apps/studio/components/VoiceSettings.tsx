"use client";

import { useState } from "react";
import { api } from "@knitted/core/client";
import { Button, Field, Input, SegmentedControl, Select, Slider, icons, useToast } from "@knitted/ui";
import { useLive } from "@/lib/hooks";

const { AlertTriangle, Check } = icons;

export function VoiceSettings() {
  const toast = useToast();
  const { data: cfg, refresh } = useLive(() => api.voice.config(), []);
  const { data: voices } = useLive(() => api.voice.voices(), [cfg?.provider, cfg?.baseUrl]);
  const [key, setKey] = useState("");
  const [heard, setHeard] = useState<{ url: string; durationMs: number } | null>(null);
  const [err, setErr] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  if (!cfg) return null;
  const save = async (p: Parameters<typeof api.voice.save>[0]) => { try { await api.voice.save(p); await refresh(); setErr(undefined); } catch (e) { setErr((e as Error).message); } };
  const test = async () => {
    setBusy(true); setErr(undefined); setHeard(null);
    try { setHeard(await api.voice.test("Make it knitted. Pattern once, knit forever.")); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div style={{ display: "grid", gap: "var(--space-5)", maxWidth: 560 }}>
      <div>
        <h2 className="h3" style={{ marginBottom: 4 }}>Voice</h2>
        <p className="body-sm" style={{ color: "var(--ink-muted)", margin: 0 }}>Voiceovers are made on your computer or a server you choose. Nothing is sent anywhere unless you point it there.</p>
      </div>
      <SegmentedControl<"system" | "openai" | "piper"> label="Where the voice comes from" value={cfg.provider} onChange={(provider) => save({ provider })}
        options={[{ value: "system", label: "Built in" }, { value: "openai", label: "A voice server" }, { value: "piper", label: "Piper" }]} />

      {cfg.provider === "system" && <p className="body-sm" style={{ margin: 0 }}>Uses the voice that came with your computer. It works with no setup, and it is the plainest sounding option.</p>}
      {cfg.provider === "openai" && (
        <>
          <Field label="Server address" hint="Anything that speaks the OpenAI speech API: Kokoro or Piper behind llm-factory, LM Studio, a cloud service." htmlFor="vs-url" error={err}>
            <Input id="vs-url" mono defaultValue={cfg.baseUrl} placeholder="http://127.0.0.1:8880" onBlur={(e) => e.target.value !== cfg.baseUrl && save({ baseUrl: e.target.value.trim() })} />
          </Field>
          <Field label="Model name" htmlFor="vs-model"><Input id="vs-model" mono defaultValue={cfg.model} onBlur={(e) => e.target.value !== cfg.model && save({ model: e.target.value.trim() })} /></Field>
          <Field label="Key (only if your server needs one)" hint={cfg.key.present ? `A key is saved${cfg.key.source === "environment" ? " in your environment" : ` in ${cfg.key.backend}`}.` : cfg.key.canStore ? `It is kept in ${cfg.key.backend}, never in knitted's own files.` : "This computer has no secure place for a key. Set KNITTED_SECRET_VOICE_OPENAI in your environment."} htmlFor="vs-key">
            <div style={{ display: "flex", gap: 8 }}>
              <Input id="vs-key" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={cfg.key.present ? "Saved. Type to replace." : "Paste a key"} disabled={!cfg.key.canStore} />
              <Button disabled={!key} onClick={async () => { await save({ apiKey: key }); setKey(""); toast("Key saved."); }}>Save</Button>
              {cfg.key.present && cfg.key.source === "keychain" && <Button variant="danger" onClick={() => save({ clearKey: true })}>Remove</Button>}
            </div>
          </Field>
        </>
      )}
      {cfg.provider === "piper" && <p className="body-sm" style={{ margin: 0 }}>Piper is small and fast and runs on a normal CPU. Set the path to its program and a voice file, and nothing is downloaded until you ask for it.</p>}

      {voices?.voices && voices.voices.length > 1 && (
        <Field label="Voice"><Select aria-label="Voice" value={cfg.voice} onValueChange={(voice) => save({ voice })} options={voices.voices.slice(0, 80).map((v) => ({ value: v.id, label: v.label }))} /></Field>
      )}
      <Slider label="Speed" value={cfg.speed} min={0.7} max={1.4} step={0.05} unit="x" onChange={() => {}} onCommit={(speed) => save({ speed })} />

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <Button variant="primary" onClick={test} disabled={busy}>{busy ? "Speaking..." : "Hear it"}</Button>
        {heard && <><audio controls autoPlay src={heard.url} aria-label="Test voice" /><span className="body-sm" style={{ color: "var(--success)", display: "flex", gap: 4, alignItems: "center" }}><Check size={14} aria-hidden /> Worked, {(heard.durationMs / 1000).toFixed(1)}s</span></>}
      </div>
      {err && cfg.provider !== "openai" && <p className="field-error" role="alert"><AlertTriangle size={14} aria-hidden /> {err}</p>}
      {err && cfg.provider === "openai" && heard === null && !busy && <p className="field-error" role="alert"><AlertTriangle size={14} aria-hidden /> {err}</p>}
    </div>
  );
}
