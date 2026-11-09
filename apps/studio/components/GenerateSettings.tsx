"use client";

// Keys for making photos and video, and which model makes each. A key is the person's own, kept
// in the computer's secret store and only sent to its own provider. Test checks a key without
// making anything, so it costs nothing.

import { api, type GenConfig } from "@knitted/core/client";
import type { GenKind, GenProvider } from "@knitted/core";
import { Select, icons, useToast } from "@knitted/ui";
import { useLive } from "@/lib/hooks";
import { KeyField, SetCard, SetRow } from "./SettingsParts";

const { ExternalLink } = icons;
const FIRST = "first";

export function GenerateSettings() {
  const { data: cfg, refresh } = useLive(() => api.generate.config(), []);
  if (!cfg) return null;
  return (
    <>
      <Choose cfg={cfg} onChanged={refresh} />
      {cfg.sources.map((s) => <Provider key={s.provider} s={s} onChanged={refresh} />)}
    </>
  );
}

function Choose({ cfg, onChanged }: { cfg: GenConfig; onChanged: () => void }) {
  const toast = useToast();
  const row = (kind: GenKind, label: string) => {
    const options = cfg.sources.flatMap((s) => s.models.filter((m) => m.kind === kind).map((m) => ({ value: `${s.provider}/${m.id}`, label: `${m.name}, ${s.name}${s.key.present ? "" : " (no key yet)"}`, group: s.name })));
    const now = cfg.choice[kind];
    return (
      <SetRow label={label} htmlFor={`gen-${kind}`} hint={options.find((o) => o.value === `${now?.provider}/${now?.model}`) ? cfg.sources.flatMap((s) => s.models).find((m) => m.id === now?.model)?.note : "The first provider with a key makes it."}>
        <div className="set-select">
          <Select id={`gen-${kind}`} value={now ? `${now.provider}/${now.model}` : FIRST}
            onValueChange={async (v) => {
              const [provider, model] = v.split("/");
              try { await api.generate.choose({ [kind]: v === FIRST ? null : { provider: provider as GenProvider, model } }); onChanged(); toast("Saved."); } catch (e) { toast.problem((e as Error).message); }
            }}
            options={[{ value: FIRST, label: "The first with a key" }, ...options]} />
        </div>
      </SetRow>
    );
  };
  return <SetCard label="What makes what">{row("image", "Photos are made by")}{row("video", "Videos are made by")}</SetCard>;
}

function Provider({ s, onChanged }: { s: GenConfig["sources"][number]; onChanged: () => void }) {
  const makes = s.kinds.map((k) => (k === "image" ? "photos" : "video")).join(" and ");
  const save = async (b: { apiKey?: string; clearKey?: boolean }) => { await api.generate.saveKey(s.provider, b); onChanged(); };
  return (
    <SetCard label={`${s.name}, ${makes}`} title={s.name} actions={<a className="link body-sm set-get" href={s.keyUrl} target="_blank" rel="noreferrer">Get {/^[AEIOU]/.test(s.name) ? "an" : "a"} {s.name} key <ExternalLink size={12} aria-hidden /></a>}>
      <SetRow stack label={`${s.name} key`} htmlFor={`gk-${s.provider}`} hint={<>Makes {makes}.</>}>
        <KeyField id={`gk-${s.provider}`} label={`${s.name} key`} status={s.key} env={`KNITTED_SECRET_GEN_${s.provider.toUpperCase()}`}
          onSave={(apiKey) => save({ apiKey })}
          onRemove={s.key.source === "keychain" ? () => save({ clearKey: true }) : undefined}
          onTest={async () => { try { const r = await api.generate.test(s.provider); return r.ok ? { ok: true } : { ok: false, why: r.why }; } catch (e) { return { ok: false, why: (e as Error).message }; } }}
          tested={`${s.name} took the key.`} />
      </SetRow>
      <ul className="set-notes">{s.notes.map((n) => <li key={n}>{n}</li>)}</ul>
    </SetCard>
  );
}
