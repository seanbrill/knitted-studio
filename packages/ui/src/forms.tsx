"use client";

import * as React from "react";
import * as S from "@radix-ui/react-select";
import * as SW from "@radix-ui/react-switch";
import * as SL from "@radix-ui/react-slider";
import { AlertTriangle, Check, ChevronDown } from "lucide-react";
import { cx } from "./cx.ts";

export function Field({ label, hint, error, children, htmlFor, optional }: {
  label?: string; hint?: React.ReactNode; error?: string; children: React.ReactNode; htmlFor?: string;
  /** Says, quietly beside the label, that it can be left empty. */
  optional?: boolean;
}) {
  return (
    <div className="field">
      {label && <label htmlFor={htmlFor}>{label}{optional && <span className="field-optional">optional</span>}</label>}
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

/**
 * A list to choose one from. Options with a `group` are listed under it, in the order the
 * groups first appear, after the ones with none: a Yarn file under the folder it is in.
 */
/** `shown`: what the closed select shows for the value, when that should be shorter than its option. */
export function Select({ value, onValueChange, options, placeholder, id, "aria-label": ariaLabel, shown }: {
  value: string; onValueChange: (v: string) => void; options: { value: string; label: string; group?: string }[];
  placeholder?: string; id?: string; "aria-label"?: string; shown?: React.ReactNode;
}) {
  const item = (o: { value: string; label: string }) => (
    <S.Item key={o.value} value={o.value} className="select-item">
      <S.ItemText>{o.label}</S.ItemText>
      <S.ItemIndicator style={{ marginLeft: "auto" }}><Check size={14} /></S.ItemIndicator>
    </S.Item>
  );
  const groups = [...new Set(options.map((o) => o.group).filter((g): g is string => !!g))];
  return (
    <S.Root value={value} onValueChange={onValueChange}>
      <S.Trigger id={id} className="select-trigger" aria-label={ariaLabel}>
        <S.Value placeholder={placeholder}>{shown}</S.Value>
        <S.Icon><ChevronDown size={14} /></S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content className="select-content" position="popper" sideOffset={4}>
          <S.Viewport>
            {options.filter((o) => !o.group).map(item)}
            {groups.map((g) => (
              <S.Group key={g}>
                <S.Label className="select-label">{g}</S.Label>
                {options.filter((o) => o.group === g).map(item)}
              </S.Group>
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
export function Slider({ label, value, onChange, onCommit, min = 0, max = 100, step = 1, unit, bare }: {
  label: string; value: number;
  /** Track and value only, in a row: for where its name is said beside it already. */
  bare?: boolean;
  /** Each move, to preview. Without it the slider still moves, and `onCommit` saves where it ends. */
  onChange?: (v: number) => void;
  /** Fires once when the drag ends. Use it to save, and `onChange` to preview. */
  onCommit?: (v: number) => void;
  min?: number; max?: number; step?: number; unit?: string;
}) {
  // Where it was moved to, while the value it is given is still the one it was moved from: so it
  // moves under the hand even when only a save, once the drag ends, changes that value, and does
  // not jump back meanwhile. A new value, saved or previewed, is what it shows from then on.
  const [moved, setMoved] = React.useState<{ from: number; to: number } | null>(null);
  const shown = moved?.from === value ? moved.to : value;
  const root = (
    <SL.Root className="slider" value={[shown]} min={min} max={max} step={step} onValueChange={([v]) => { setMoved({ from: value, to: v }); onChange?.(v); }} onValueCommit={onCommit ? ([v]) => onCommit(v) : undefined} aria-label={label}>
      <SL.Track className="slider-track"><SL.Range className="slider-range" /></SL.Track>
      <SL.Thumb className="slider-thumb" aria-label={label} />
    </SL.Root>
  );
  const shownValue = <span className="slider-value">{Math.round(shown * 100) / 100}{unit}</span>;
  if (bare) return <div className="slider-bare">{root}{shownValue}</div>;
  return (
    <div style={{ display: "grid", gap: "var(--space-2)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="body-sm">{label}</span>
        {shownValue}
      </div>
      {root}
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

/**
 * Choose one, as cards: each shows what it is (`art`, a shape or a picture), its name, and a
 * line or two on it. A radio group: the arrow keys move between the cards and choose.
 */
export function ChoiceCards<T extends string>({ label, value, onChange, options, columns = 2, align }: {
  label: string; value: T; onChange: (v: T) => void; columns?: number; align?: "start";
  options: { value: T; title: string; meta?: React.ReactNode; hint?: React.ReactNode; art?: React.ReactNode; dashed?: boolean }[];
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const step = (from: number, by: number) => {
    const i = (from + by + options.length) % options.length;
    onChange(options[i]!.value); refs.current[i]?.focus();
  };
  return (
    <div className="choice-cards" role="radiogroup" aria-label={label} data-align={align} style={{ "--cols": columns } as React.CSSProperties}>
      {options.map((o, i) => (
        <button key={o.value} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1} className="choice-card" data-dashed={o.dashed || undefined} onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            const by = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
            if (by) { e.preventDefault(); step(i, by); }
          }}>
          {o.art && <span className="choice-card-art" aria-hidden>{o.art}</span>}
          <span className="choice-card-title">{o.title}</span>
          {o.meta && <span className="choice-card-meta">{o.meta}</span>}
          {o.hint && <span className="choice-card-hint">{o.hint}</span>}
        </button>
      ))}
    </div>
  );
}
