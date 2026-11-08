"use client";

// Keys for the free stock sources. Openverse needs none, so search works from the start;
// a free key from Pixabay (or a Pexels key someone already has) adds what they have. Each key is kept in the
// computer's own secret store, never in knitted's files, and is only sent to its own source.

import { useState } from "react";
import { api, type StockConfig } from "@knitted/core/client";
import { Button, Field, Input, icons, useToast } from "@knitted/ui";
import { useLive } from "@/lib/hooks";

const { Check, ExternalLink } = icons;
const KINDS = { image: "photos", video: "videos", audio: "sounds" } as const;

export function StockSettings() {
  const { data: cfg, refresh } = useLive(() => api.stock.config(), []);
  if (!cfg) return null;
  return (
    <div style={{ display: "grid", gap: "var(--space-6)", maxWidth: 600 }}>
      <div>
        <h2 className="h3" style={{ marginBottom: 4 }}>Free stock</h2>
        <p className="body-sm" style={{ color: "var(--ink-muted)", margin: 0 }}>Search free photos, videos and sounds on the Stock page, and add them to a project or the Library. Openverse works with no key. A free Pixabay key adds its photos and video. A key is only sent to its own site.</p>
      </div>
      {cfg.sources.map((s) => <Source key={s.provider} s={s} onChanged={refresh} />)}
    </div>
  );
}

function Source({ s, onChanged }: { s: StockConfig["sources"][number]; onChanged: () => void }) {
  const toast = useToast();
  const [key, setKey] = useState("");
  const [err, setErr] = useState<string | undefined>();
  const kinds = s.kinds.map((k) => KINDS[k]).join(" and ");
  const save = async (b: { apiKey?: string; clearKey?: boolean }) => {
    try { await api.stock.saveKey(s.provider, b); setErr(undefined); setKey(""); onChanged(); toast(b.clearKey ? `${s.name} key removed.` : `${s.name} key saved.`); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <section aria-labelledby={`stock-${s.provider}`} style={{ display: "grid", gap: 8 }}>
      <h3 id={`stock-${s.provider}`} className="label" style={{ margin: 0 }}>{s.name}<span className="body-sm" style={{ color: "var(--ink-muted)", fontWeight: 400 }}>, {kinds}</span></h3>
      {!s.key ? (
        <p className="body-sm" style={{ margin: 0, display: "flex", gap: 6, alignItems: "center" }}><Check size={14} aria-hidden style={{ color: "var(--success)" }} /> Works with no key.</p>
      ) : (
        <Field label={`${s.name} key`} htmlFor={`sk-${s.provider}`} error={err}
          hint={s.key.present ? `A key is saved${s.key.source === "environment" ? " in your environment" : ` in ${s.key.backend}`}.` : s.key.canStore ? `It is kept in ${s.key.backend}, never in knitted's own files.` : `This computer has no secure place for a key. Set KNITTED_SECRET_STOCK_${s.provider.toUpperCase()} in your environment.`}>
          <div style={{ display: "flex", gap: 8 }}>
            <Input id={`sk-${s.provider}`} type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={s.key.present ? "Saved. Type to replace." : "Paste a key"} disabled={!s.key.canStore} />
            <Button disabled={!key} onClick={() => save({ apiKey: key })}>Save</Button>
            {s.key.present && s.key.source === "keychain" && <Button variant="danger" onClick={() => save({ clearKey: true })}>Remove</Button>}
          </div>
        </Field>
      )}
      {s.note && <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>{s.note}</p>}
      {s.keyUrl && <a className="link body-sm" href={s.keyUrl} target="_blank" rel="noreferrer" style={{ display: "inline-flex", gap: 4, alignItems: "center", width: "fit-content" }}>{s.note ? `About ${s.name} keys` : `Get a free ${s.name} key`} <ExternalLink size={12} aria-hidden /></a>}
    </section>
  );
}
