"use client";

// What a sync with a business's website is asked to do: the same choices when a project is
// made and when the Brief syncs again. A step that cannot run here says so, and why.

import type { SyncOptions } from "@knitted/core/client";
import { Field, Input, Select, Switch, Textarea } from "@knitted/ui";

/** What a sync is asked to do. The same choices as onboarding, with what the last sync used. */
export function SyncChoices({ value, onChange, hasKey, hasProfile, showUrl = true }: { value: SyncOptions; onChange: (v: SyncOptions) => void; hasKey: boolean | null; hasProfile: boolean; showUrl?: boolean }) {
  const set = (p: Partial<SyncOptions>) => onChange({ ...value, ...p });
  const devices = value.devices ?? ["desktop", "mobile"];
  const flip = (d: "desktop" | "mobile") => { const next = devices.includes(d) ? devices.filter((x) => x !== d) : [...devices, d]; set({ devices: next.length ? next : devices, pictures: next.length ? value.pictures : false }); };
  const row = (id: string, label: string, hint: string, checked: boolean, on: (c: boolean) => void, disabled?: boolean) => (
    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "var(--space-3)", alignItems: "start", opacity: disabled ? 0.6 : 1 }}>
      <Switch id={id} label={label} checked={checked && !disabled} onCheckedChange={(c) => !disabled && on(c)} />
      <label htmlFor={id} className="body-sm" style={{ cursor: disabled ? "default" : "pointer" }}><span style={{ fontWeight: 600 }}>{label}</span><span style={{ display: "block", color: "var(--ink-muted)" }}>{hint}</span></label>
    </div>
  );
  return (
    <div style={{ display: "grid", gap: "var(--space-4)" }}>
      {showUrl && <Field label="The business's website" htmlFor="sync-url" hint="Its public pages are read, the way a visitor sees them. Pages it asks robots not to read are left alone.">
        <Input id="sync-url" value={value.url ?? ""} onChange={(e) => set({ url: e.target.value })} placeholder="https://example.com" inputMode="url" autoComplete="url" />
      </Field>}
      {row("sync-profile", "Write the profile", hasKey === false ? "Your model writes it, so it needs your Anthropic key: add it in Settings, under Model." : "Your model reads every page and writes who they are, what they offer, how they sound, and what to get right.", value.profile ?? true, (c) => set({ profile: c }), hasKey === false)}
      {row("sync-pictures", "Picture every page", "As it looks now on a desktop and on a phone, the whole way down, into the reference. Taken again, each is replaced.", value.pictures ?? true, (c) => set({ pictures: c }))}
      {(value.pictures ?? true) && (
        <div role="group" aria-label="Which screens" style={{ display: "flex", gap: "var(--space-4)", paddingLeft: 52 }}>
          {(["desktop", "mobile"] as const).map((d) => <label key={d} className="body-sm" style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={devices.includes(d)} onChange={() => flip(d)} /> {d === "desktop" ? "Desktop" : "Phone"}</label>)}
        </div>
      )}
      {row("sync-swatch", "Read a swatch from it", "Its colours, fonts and logo, as a swatch to look over.", value.swatch ?? false, (c) => set({ swatch: c, activateSwatch: c ? value.activateSwatch : false }))}
      {value.swatch && row("sync-use", "Use it for this project", "Otherwise it waits in the Swatch tab for you to choose it.", value.activateSwatch ?? false, (c) => set({ activateSwatch: c }))}
      <Field label="A write-up, if you have one" htmlFor="sync-writeup" hint="Anything the website does not say: your story, what is new, who you are for. Your model writes it into the profile.">
        <Textarea id="sync-writeup" rows={4} value={value.writeUp ?? ""} onChange={(e) => set({ writeUp: e.target.value })} />
      </Field>
      <div style={{ display: "grid", gap: "var(--space-3)", gridTemplateColumns: hasProfile ? "1fr 1fr" : "1fr" }}>
        <Field label="How many pages" htmlFor="sync-pages">
          <Select id="sync-pages" aria-label="How many pages" value={String(value.maxPages ?? 40)} onValueChange={(v) => set({ maxPages: Number(v) })} options={[10, 20, 40, 80].map((n) => ({ value: String(n), label: `Up to ${n}` }))} />
        </Field>
        {hasProfile && <Field label="The profile there now" htmlFor="sync-mode">
          <Select id="sync-mode" aria-label="The profile there now" value={value.mode ?? "merge"} onValueChange={(v) => set({ mode: v as "merge" | "replace" })} options={[{ value: "merge", label: "Keep what is right, add what is new" }, { value: "replace", label: "Start again from the website" }]} />
        </Field>}
      </div>
    </div>
  );
}
