"use client";

// Keys for the free stock sources. Openverse needs none, so search works from the start;
// a free key from Pixabay (or a Pexels key someone already has) adds what they have. Each key is kept in the
// computer's own secret store, never in knitted's files, and is only sent to its own source.

import { api, type StockConfig } from "@knitted/core/client";
import { icons } from "@knitted/ui";
import { useLive } from "@/lib/hooks";
import { KeyField, SetCard, SetRow } from "./SettingsParts";

const { Check, ExternalLink } = icons;
const KINDS = { image: "photos", video: "videos", audio: "sounds" } as const;

export function StockSettings() {
  const { data: cfg, refresh } = useLive(() => api.stock.config(), []);
  if (!cfg) return null;
  return <>{cfg.sources.map((s) => <Source key={s.provider} s={s} onChanged={refresh} />)}</>;
}

function Source({ s, onChanged }: { s: StockConfig["sources"][number]; onChanged: () => void }) {
  const kinds = s.kinds.map((k) => KINDS[k]).join(" and ");
  const save = async (b: { apiKey?: string; clearKey?: boolean }) => { await api.stock.saveKey(s.provider, b); onChanged(); };
  const link = s.keyUrl && <a className="link body-sm set-get" href={s.keyUrl} target="_blank" rel="noreferrer">{s.note ? `About ${s.name} keys` : `Get a free ${s.name} key`} <ExternalLink size={12} aria-hidden /></a>;
  return (
    <SetCard label={`${s.name}, ${kinds}`} title={s.name} actions={link || undefined}>
      {!s.key ? (
        <SetRow label={`Its ${kinds}`} hint="Openly licensed, from across the web.">
          <p className="key-said" style={{ margin: 0 }}><Check size={14} aria-hidden /> Works with no key.</p>
        </SetRow>
      ) : (
        <SetRow stack label={`${s.name} key`} htmlFor={`sk-${s.provider}`} hint={s.note ?? `Adds its ${kinds}.`}>
          <KeyField id={`sk-${s.provider}`} label={`${s.name} key`} status={s.key} env={`KNITTED_SECRET_STOCK_${s.provider.toUpperCase()}`}
            onSave={(apiKey) => save({ apiKey })}
            onRemove={s.key.source === "keychain" ? () => save({ clearKey: true }) : undefined} />
        </SetRow>
      )}
    </SetCard>
  );
}
