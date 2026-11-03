"use client";

import * as React from "react";
import * as S from "@radix-ui/react-select";
import * as SW from "@radix-ui/react-switch";
import * as SL from "@radix-ui/react-slider";
import { AlertTriangle, Check, ChevronDown } from "lucide-react";
import { cx } from "./cx.ts";

export function Field({ label, hint, error, children, htmlFor }: {
  label?: string; hint?: string; error?: string; children: React.ReactNode; htmlFor?: string;
}) {
  return (
    <div className="field">
      {label && <label htmlFor={htmlFor}>{label}</label>}
      {children}
      {error ? (
        <span className="field-error" role="alert"><AlertTriangle size={13} aria-hidden /> {error}</span>
      ) : hint ? (
        <span className="field-hint">{hint}</span>
      ) : null}
    </div>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }>(
  function Input({ className, mono, ...rest }, ref) {
    return <input ref={ref} className={cx("input", mono && "input-mono", className)} {...rest} />;
  },
);

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cx("textarea", className)} {...rest} />;
  },
);

export function Select({ value, onValueChange, options, placeholder, id, "aria-label": ariaLabel }: {
  value: string; onValueChange: (v: string) => void; options: { value: string; label: string }[];
  placeholder?: string; id?: string; "aria-label"?: string;
}) {
  return (
    <S.Root value={value} onValueChange={onValueChange}>
      <S.Trigger id={id} className="select-trigger" aria-label={ariaLabel}>
        <S.Value placeholder={placeholder} />
        <S.Icon><ChevronDown size={14} /></S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content className="select-content" position="popper" sideOffset={4}>
          <S.Viewport>
            {options.map((o) => (
              <S.Item key={o.value} value={o.value} className="select-item">
                <S.ItemText>{o.label}</S.ItemText>
                <S.ItemIndicator style={{ marginLeft: "auto" }}><Check size={14} /></S.ItemIndicator>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}

export function Switch({ checked, onCheckedChange, label, id }: { checked: boolean; onCheckedChange: (c: boolean) => void; label: string; id?: string }) {
  return (
    <SW.Root id={id} className="switch" checked={checked} onCheckedChange={onCheckedChange} aria-label={label}>
      <SW.Thumb className="switch-thumb" />
    </SW.Root>
  );
}

/** The slider from the reference images: 2px track, ember fill, 14px thumb, value in a sunken box. */
export function Slider({ label, value, onChange, onCommit, min = 0, max = 100, step = 1, unit }: {
  label: string; value: number; onChange: (v: number) => void;
  /** Fires once when the drag ends. Use it to save, and `onChange` to preview. */
  onCommit?: (v: number) => void;
  min?: number; max?: number; step?: number; unit?: string;
}) {
  return (
    <div style={{ display: "grid", gap: "var(--space-2)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="body-sm">{label}</span>
        <span className="slider-value">{Math.round(value * 100) / 100}{unit}</span>
      </div>
      <SL.Root className="slider" value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} onValueCommit={onCommit ? ([v]) => onCommit(v) : undefined} aria-label={label}>
        <SL.Track className="slider-track"><SL.Range className="slider-range" /></SL.Track>
        <SL.Thumb className="slider-thumb" aria-label={label} />
      </SL.Root>
    </div>
  );
}

export function SegmentedControl<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)} type="button">
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Hex field with a native colour well. Keeps the value a plain 6-digit hex. */
export function ColorField({ value, onChange, label }: { value: string; onChange: (hex: string) => void; label: string }) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
      <input
        type="color"
        aria-label={`${label} colour picker`}
        value={valid ? value : "#000000"}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: 36, height: 36, padding: 0, border: "1px solid var(--line-strong)", borderRadius: "var(--radius-sm)", background: "none", cursor: "pointer" }}
      />
      <Input mono aria-label={`${label} hex`} aria-invalid={!valid} value={value} onChange={(e) => onChange(e.target.value)} maxLength={7} style={{ width: 110 }} />
    </div>
  );
}
