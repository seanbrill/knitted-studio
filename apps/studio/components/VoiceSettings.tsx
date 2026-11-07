"use client";

import { useState } from "react";
import { api } from "@knitted/core/client";
import { Button, Field, Input, SegmentedControl, Select, Slider, Textarea, icons, useToast } from "@knitted/ui";
import { useLive } from "@/lib/hooks";

const { AlertTriangle, Check } = icons;

export function VoiceSettings() {
  const toast = useToast();
  const { data: cfg, refresh } = useLive(() => api.voice.config(), []);
  const { data: voices } = useLive(() => api.voice.voices(), [cfg?.provider, cfg?.baseUrl]);
  const [key, setKey] = useState("");
  const [heard, setHeard] = useState<{ url: string; durationMs: number } | null>(null);
  const [err, setErr] = useState<string | undefined>();
  const [said, setSaid] = useState<string | undefined>(); // what the voice said back when it was tried
  const [badJson, setBadJson] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  if (!cfg) return null;
  const save = async (p: Parameters<typeof api.voice.save>[0]) => { try { await api.voice.save(p); await refresh(); setErr(undefined); } catch (e) { setErr((e as Error).message); } };
  const test = async () => {
    setBusy(true); setSaid(undefined); setHeard(null);
    try { setHeard(await api.voice.test("Make it knitted. Pattern once, knit forever.")); } catch (e) { setSaid((e as Error).message); } finally { setBusy(false); }
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
          <Field label="Model name" hint={voices?.models?.length ? `Your server has: ${voices.models.map((m) => m.id).join(", ")}.` : undefined} htmlFor="vs-model">
            <Input id="vs-model" mono list="vs-models" defaultValue={cfg.model} key={`m-${cfg.model}`} onBlur={(e) => e.target.value !== cfg.model && save({ model: e.target.value.trim() })} />
            <datalist id="vs-models">{voices?.models?.map((m) => <option key={m.id} value={m.id} />)}</datalist>
          </Field>
          <Field label="Voice" hint="Pick one your server has, or type any voice name it takes." htmlFor="vs-voice">
            <Input id="vs-voice" list="vs-voices" defaultValue={cfg.voice} key={`v-${cfg.voice}`} onBlur={(e) => e.target.value.trim() !== cfg.voice && save({ voice: e.target.value.trim() || "default" })} />
            <datalist id="vs-voices">{voices?.voices?.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</datalist>
          </Field>
          <Field label="Style (if your model takes one)" hint="How to say it, in words. Sent as instructions; models that do not take one ignore it." htmlFor="vs-style">
            <Input id="vs-style" defaultValue={cfg.style ?? ""} key={`s-${cfg.style}`} placeholder="Warm and confident, a little faster at the end" onBlur={(e) => e.target.value !== (cfg.style ?? "") && save({ style: e.target.value })} />
          </Field>
          <Field label="Other options (JSON)" hint="Anything else your server takes, sent with every request as it is, like a language or a seed." htmlFor="vs-options" error={badJson}>
            <Textarea id="vs-options" rows={3} defaultValue={cfg.options && Object.keys(cfg.options).length ? JSON.stringify(cfg.options, null, 2) : ""} placeholder='{ "language": "English" }' style={{ fontFamily: "var(--font-mono)" }}
              onBlur={(e) => { const t = e.target.value.trim(); try { const o = t ? JSON.parse(t) : {}; if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error(); setBadJson(undefined); void save({ options: o }); } catch { setBadJson("That is not a JSON object, like { \"language\": \"English\" }."); } }} />
          </Field>
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

      {cfg.provider !== "openai" && voices?.voices && voices.voices.length > 1 && (
        <Field label="Voice"><Select aria-label="Voice" value={cfg.voice} onValueChange={(voice) => save({ voice })} options={voices.voices.slice(0, 80).map((v) => ({ value: v.id, label: v.label }))} /></Field>
      )}
      <Slider label="Speed" value={cfg.speed} min={0.7} max={1.4} step={0.05} unit="x" onCommit={(speed) => save({ speed })} />

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <Button variant="primary" onClick={test} disabled={busy}>{busy ? "Speaking..." : "Hear it"}</Button>
        {heard && <><audio controls autoPlay src={heard.url} aria-label="Test voice" /><span className="body-sm" style={{ color: "var(--success)", display: "flex", gap: 4, alignItems: "center" }}><Check size={14} aria-hidden /> Worked, {(heard.durationMs / 1000).toFixed(1)}s</span></>}
      </div>
      {err && cfg.provider !== "openai" && <p className="field-error" role="alert"><AlertTriangle size={14} aria-hidden /> {err}</p>}
      {said && !busy && <p className="field-error" role="alert"><AlertTriangle size={14} aria-hidden /> {said}</p>}
    </div>
  );
}
