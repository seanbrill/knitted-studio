"use client";

// Keys for making photos and video, and which model makes each. A key is the person's own, kept
// in the computer's secret store and only sent to its own provider. Test checks a key without
// making anything, so it costs nothing.

import { useState } from "react";
import { api, type GenConfig } from "@knitted/core/client";
import type { GenKind, GenProvider } from "@knitted/core";
import { Button, Field, Input, Select, icons, useToast } from "@knitted/ui";
import { useLive } from "@/lib/hooks";

const { Check, ExternalLink, AlertTriangle } = icons;
const FIRST = "first";

export function GenerateSettings() {
  const { data: cfg, refresh } = useLive(() => api.generate.config(), []);
  if (!cfg) return null;
  return (
    <div style={{ display: "grid", gap: "var(--space-6)", maxWidth: 640 }}>
      <div>
        <h2 className="h3" style={{ marginBottom: 4 }}>Make photos and video</h2>
        <p className="body-sm" style={{ color: "var(--ink-muted)", margin: 0 }}>With a key of your own, you and your model can make photos and short videos from a description and your own pictures, kept in Yarn. Each one is charged to your key, and counts toward your limits in Spending. Drawing as SVG and free stock need no key.</p>
      </div>
      <Choose cfg={cfg} onChanged={refresh} />
      {cfg.sources.map((s) => <Provider key={s.provider} s={s} onChanged={refresh} />)}
    </div>
  );
}

function Choose({ cfg, onChanged }: { cfg: GenConfig; onChanged: () => void }) {
  const toast = useToast();
  const row = (kind: GenKind, label: string) => {
    const options = cfg.sources.flatMap((s) => s.models.filter((m) => m.kind === kind).map((m) => ({ value: `${s.provider}/${m.id}`, label: `${m.name}, ${s.name}${s.key.present ? "" : " (no key yet)"}`, group: s.name })));
    const now = cfg.choice[kind];
    return (
      <Field label={label} htmlFor={`gen-${kind}`} hint={options.find((o) => o.value === `${now?.provider}/${now?.model}`) ? cfg.sources.flatMap((s) => s.models).find((m) => m.id === now?.model)?.note : "The first provider with a key makes it."}>
        <Select id={`gen-${kind}`} value={now ? `${now.provider}/${now.model}` : FIRST}
          onValueChange={async (v) => {
            const [provider, model] = v.split("/");
            try { await api.generate.choose({ [kind]: v === FIRST ? null : { provider: provider as GenProvider, model } }); onChanged(); toast("Saved."); } catch (e) { toast((e as Error).message); }
          }}
          options={[{ value: FIRST, label: "The first with a key" }, ...options]} />
      </Field>
    );
  };
  return <section aria-label="What makes what" style={{ display: "grid", gap: "var(--space-4)" }}>{row("image", "Photos are made by")}{row("video", "Videos are made by")}</section>;
}

function Provider({ s, onChanged }: { s: GenConfig["sources"][number]; onChanged: () => void }) {
  const toast = useToast();
  const [key, setKey] = useState("");
  const [err, setErr] = useState<string | undefined>();
  const [tested, setTested] = useState<{ ok: boolean; why?: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const save = async (b: { apiKey?: string; clearKey?: boolean }) => {
    try { await api.generate.saveKey(s.provider, b); setErr(undefined); setKey(""); setTested(null); onChanged(); toast(b.clearKey ? `${s.name} key removed.` : `${s.name} key saved.`); } catch (e) { setErr((e as Error).message); }
  };
  const test = async () => {
    setTesting(true);
    try { const r = await api.generate.test(s.provider); setTested(r.ok ? { ok: true } : { ok: false, why: r.why }); } catch (e) { setTested({ ok: false, why: (e as Error).message }); } finally { setTesting(false); }
  };
  const makes = s.kinds.map((k) => (k === "image" ? "photos" : "video")).join(" and ");
  return (
    <section aria-labelledby={`gen-${s.provider}`} style={{ display: "grid", gap: 8 }}>
      <h3 id={`gen-${s.provider}`} className="label" style={{ margin: 0 }}>{s.name}<span className="body-sm" style={{ color: "var(--ink-muted)", fontWeight: 400 }}>, {makes}</span></h3>
      <Field label={`${s.name} key`} htmlFor={`gk-${s.provider}`} error={err}
        hint={s.key.present ? `A key is saved${s.key.source === "environment" ? " in your environment" : ` in ${s.key.backend}`}.` : s.key.canStore ? `It is kept in ${s.key.backend}, never in knitted's own files.` : `This computer has no secure place for a key. Set KNITTED_SECRET_GEN_${s.provider.toUpperCase()} in your environment.`}>
        <div style={{ display: "flex", gap: 8 }}>
          <Input id={`gk-${s.provider}`} type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={s.key.present ? "Saved. Type to replace." : "Paste a key"} disabled={!s.key.canStore} />
          <Button disabled={!key} onClick={() => save({ apiKey: key })}>Save</Button>
          {s.key.present && <Button disabled={testing} onClick={test}>{testing ? "Testing..." : "Test"}</Button>}
          {s.key.present && s.key.source === "keychain" && <Button variant="danger" onClick={() => save({ clearKey: true })}>Remove</Button>}
        </div>
      </Field>
      {tested && (tested.ok
        ? <p className="body-sm" role="status" style={{ margin: 0, display: "flex", gap: 6, alignItems: "center" }}><Check size={14} aria-hidden style={{ color: "var(--success)" }} /> {s.name} took the key.</p>
        : <p className="field-error" role="alert" style={{ margin: 0 }}><AlertTriangle size={14} aria-hidden /> {tested.why}</p>)}
      <ul className="body-sm" style={{ margin: 0, paddingLeft: 18, color: "var(--ink-muted)" }}>{s.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      <a className="link body-sm" href={s.keyUrl} target="_blank" rel="noreferrer" style={{ display: "inline-flex", gap: 4, alignItems: "center", width: "fit-content" }}>Get a {s.name} key <ExternalLink size={12} aria-hidden /></a>
    </section>
  );
}
