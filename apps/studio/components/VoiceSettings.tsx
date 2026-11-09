"use client";

import { useState } from "react";
import { api } from "@knitted/core/client";
import { Button, Input, SegmentedControl, Select, Slider, Textarea, icons } from "@knitted/ui";
import { useLive } from "@/lib/hooks";
import { KeyField, SetCard, SetRow, settingsChanged } from "./SettingsParts";

const { AlertTriangle, Check } = icons;

export function VoiceSettings() {
  const { data: cfg, refresh } = useLive(() => api.voice.config(), []);
  const { data: voices } = useLive(() => api.voice.voices(), [cfg?.provider, cfg?.baseUrl]);
  const [heard, setHeard] = useState<{ url: string; durationMs: number } | null>(null);
  const [err, setErr] = useState<string | undefined>();
  const [said, setSaid] = useState<string | undefined>(); // what the voice said back when it was tried
  const [badJson, setBadJson] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  if (!cfg) return null;
  const save = async (p: Parameters<typeof api.voice.save>[0]) => { try { await api.voice.save(p); await refresh(); settingsChanged(); setErr(undefined); } catch (e) { setErr((e as Error).message); } };
  const test = async () => {
    setBusy(true); setSaid(undefined); setHeard(null);
    try { setHeard(await api.voice.test("Make it knitted. Pattern once, knit forever.")); } catch (e) { setSaid((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      <SetCard label="Where the voice comes from">
        <SetRow label="Where the voice comes from" hint={cfg.provider === "system" ? "The voice that came with your computer. It works with no setup, and it is the plainest sounding option." : cfg.provider === "piper" ? "Piper is small and fast and runs on a normal CPU. Set the path to its program and a voice file, and nothing is downloaded until you ask for it." : "Anything that speaks the OpenAI speech API: Kokoro or Piper behind llm-factory, LM Studio, a cloud service."}>
          <SegmentedControl<"system" | "openai" | "piper"> label="Where the voice comes from" value={cfg.provider} onChange={(provider) => save({ provider })}
            options={[{ value: "system", label: "Built in" }, { value: "openai", label: "A voice server" }, { value: "piper", label: "Piper" }]} />
        </SetRow>
        {cfg.provider === "openai" && (
          <>
            <SetRow stack label="Server address" htmlFor="vs-url">
              <Input id="vs-url" mono defaultValue={cfg.baseUrl} placeholder="http://127.0.0.1:8880" onBlur={(e) => e.target.value !== cfg.baseUrl && save({ baseUrl: e.target.value.trim() })} />
              {err && <p className="field-error" role="alert"><AlertTriangle size={14} aria-hidden /> {err}</p>}
            </SetRow>
            <SetRow stack label="Model name" htmlFor="vs-model" hint={voices?.models?.length ? `Your server has: ${voices.models.map((m) => m.id).join(", ")}.` : undefined}>
              <Input id="vs-model" mono list="vs-models" defaultValue={cfg.model} key={`m-${cfg.model}`} onBlur={(e) => e.target.value !== cfg.model && save({ model: e.target.value.trim() })} />
              <datalist id="vs-models">{voices?.models?.map((m) => <option key={m.id} value={m.id} />)}</datalist>
            </SetRow>
            <SetRow stack label="Voice" htmlFor="vs-voice" hint="Pick one your server has, or type any voice name it takes.">
              <Input id="vs-voice" list="vs-voices" defaultValue={cfg.voice} key={`v-${cfg.voice}`} onBlur={(e) => e.target.value.trim() !== cfg.voice && save({ voice: e.target.value.trim() || "default" })} />
              <datalist id="vs-voices">{voices?.voices?.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</datalist>
            </SetRow>
            <SetRow stack label="Style (if your model takes one)" htmlFor="vs-style" hint="How to say it, in words. Sent as instructions; models that do not take one ignore it.">
              <Input id="vs-style" defaultValue={cfg.style ?? ""} key={`s-${cfg.style}`} placeholder="Warm and confident, a little faster at the end" onBlur={(e) => e.target.value !== (cfg.style ?? "") && save({ style: e.target.value })} />
            </SetRow>
            <SetRow stack label="Other options (JSON)" htmlFor="vs-options" hint="Anything else your server takes, sent with every request as it is, like a language or a seed.">
              <Textarea id="vs-options" rows={3} defaultValue={cfg.options && Object.keys(cfg.options).length ? JSON.stringify(cfg.options, null, 2) : ""} placeholder='{ "language": "English" }' style={{ fontFamily: "var(--font-mono)" }}
                onBlur={(e) => { const t = e.target.value.trim(); try { const o = t ? JSON.parse(t) : {}; if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error(); setBadJson(undefined); void save({ options: o }); } catch { setBadJson("That is not a JSON object, like { \"language\": \"English\" }."); } }} />
              {badJson && <p className="field-error" role="alert"><AlertTriangle size={14} aria-hidden /> {badJson}</p>}
            </SetRow>
            <SetRow stack label="Key (only if your server needs one)" htmlFor="vs-key">
              <KeyField id="vs-key" label="Voice server key" status={cfg.key} env="KNITTED_SECRET_VOICE_OPENAI"
                onSave={async (apiKey) => { await api.voice.save({ apiKey }); await refresh(); }}
                onRemove={cfg.key.source === "keychain" ? async () => { await api.voice.save({ clearKey: true }); await refresh(); } : undefined} />
            </SetRow>
          </>
        )}
        {cfg.provider !== "openai" && voices?.voices && voices.voices.length > 1 && (
          <SetRow label="Voice">
            <div className="set-select"><Select aria-label="Voice" value={cfg.voice} onValueChange={(voice) => save({ voice })} options={voices.voices.slice(0, 80).map((v) => ({ value: v.id, label: v.label }))} /></div>
          </SetRow>
        )}
        {err && cfg.provider !== "openai" && <p className="field-error set-error" role="alert"><AlertTriangle size={14} aria-hidden /> {err}</p>}
      </SetCard>
      <SetCard label="How it sounds">
        <SetRow label="Speed" hint="1x is the voice's own pace.">
          <div className="set-slider"><Slider bare label="Speed" value={cfg.speed} min={0.7} max={1.4} step={0.05} unit="x" onCommit={(speed) => save({ speed })} /></div>
        </SetRow>
        <SetRow label="Hear it" hint={'"Make it knitted. Pattern once, knit forever."'}>
          <Button variant="primary" onClick={test} busy={busy}>{busy ? "Speaking..." : "Hear it"}</Button>
        </SetRow>
        {heard && <div className="set-row set-row-stack"><div className="set-heard"><audio controls autoPlay src={heard.url} aria-label="Test voice" /><span className="key-said"><Check size={14} aria-hidden /> Worked, {(heard.durationMs / 1000).toFixed(1)}s</span></div></div>}
        {said && !busy && <p className="field-error set-error" role="alert"><AlertTriangle size={14} aria-hidden /> {said}</p>}
      </SetCard>
    </>
  );
}
