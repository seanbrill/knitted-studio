"use client";

import { colorFor, COLOR_ROLES, type ColorRole, type Swatch } from "@knitted/core";
import { ColorField, Input } from "@knitted/ui";

/** A number field in the frame's own pixels: type a value, or use the arrow keys. */
export function NumberField({ label, value, onCommit, step = 1, min, max, suffix }: {
  label: string; value: number; onCommit: (v: number) => void; step?: number; min?: number; max?: number; suffix?: string;
}) {
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  const shown = String(Math.round(value * 100) / 100);
  const names: Record<string, string> = { X: "X position", Y: "Y position", W: "Width", H: "Height", R: "Rotation" };
  return (
    <label style={{ display: "grid", gridTemplateColumns: "18px 1fr", alignItems: "center", gap: 6 }}>
      <span className="eyebrow" style={{ letterSpacing: 0 }}>{label}</span>
      <span style={{ position: "relative" }}>
        {/* Uncontrolled and re-created when the saved value changes, so typing is never fought by a re-render. */}
        <Input key={shown} mono aria-label={names[label] ?? label} defaultValue={shown}
          onBlur={(e) => { const n = Number(e.target.value); if (!Number.isFinite(n)) { e.target.value = shown; return; } const v = clamp(n); if (v !== value) onCommit(v); else e.target.value = shown; }}
          onKeyDown={(e) => {
            const t = e.target as HTMLInputElement;
            if (e.key === "Enter") t.blur();
            if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); const v = clamp(Number(t.value) + (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1) * step); t.value = String(v); onCommit(v); }
          }}
          style={{ minHeight: 30, paddingRight: suffix ? 26 : undefined }} />
        {suffix && <span className="eyebrow" style={{ position: "absolute", right: 8, top: 7, letterSpacing: 0 }}>{suffix}</span>}
      </span>
    </label>
  );
}

/**
 * A colour that prefers the brand: the swatch's roles as chips, plus a free hex
 * for the rare off-brand case. A role is stored as a token ("$color.primary"),
 * so it follows the swatch if the brand changes.
 */
export function TokenColor({ label, value, swatch, onChange, allowNone }: { label: string; value: string | undefined; swatch: Swatch; onChange: (v: string | undefined) => void; allowNone?: boolean }) {
  const roles = COLOR_ROLES.filter((r) => swatch.colors.some((c) => c.role === r));
  const isRole = (r: ColorRole) => value === `$color.${r}`;
  const custom = value && !value.startsWith("$") ? value : undefined;
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="body-sm" style={{ marginBottom: 6 }}>{label}</legend>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {allowNone && <button type="button" aria-pressed={!value} aria-label={`${label}: none`} onClick={() => onChange(undefined)} style={{ width: 26, height: 26, borderRadius: "50%", border: !value ? "2px solid var(--ember)" : "1px solid var(--line-strong)", background: "linear-gradient(135deg, transparent 46%, var(--danger) 46% 54%, transparent 54%)", cursor: "pointer" }} />}
        {roles.map((r) => (
          <button key={r} type="button" aria-pressed={isRole(r)} aria-label={`${label}: ${r}`} title={r} onClick={() => onChange(`$color.${r}`)}
            style={{ width: 26, height: 26, borderRadius: "50%", background: colorFor(swatch, r), cursor: "pointer", border: isRole(r) ? "2px solid var(--ember)" : "1px solid var(--line-strong)", boxShadow: isRole(r) ? "0 0 0 2px var(--surface-raised) inset" : undefined }} />
        ))}
      </div>
      <div style={{ marginTop: 6 }}><ColorField label={`${label} custom`} value={custom ?? (value?.startsWith("$") ? colorFor(swatch, value.slice(7) as ColorRole) : "#888888")} onChange={(h) => onChange(h)} /></div>
    </fieldset>
  );
}

export function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} style={{ borderTop: "1px solid var(--line)", padding: "var(--space-3) 0" }}>
      <summary className="eyebrow" style={{ cursor: "pointer", listStyle: "none", padding: "4px 0" }}>{title}</summary>
      <div style={{ display: "grid", gap: "var(--space-3)", paddingTop: "var(--space-2)" }}>{children}</div>
    </details>
  );
}
