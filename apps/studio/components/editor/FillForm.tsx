"use client";

import { Field, Input, Select, Textarea } from "@knitted/ui";
import { useEditor } from "@/lib/editor/store";

/**
 * Fill mode's inspector: the pattern's free slots as a plain form. Someone who
 * is not a designer types a headline and picks a photo; the brand parts are not
 * on offer at all. A model sees exactly this set of slots, and no others.
 */
export function FillForm() {
  const { pattern, yarn, dispatch, selection, select } = useEditor();
  const free = pattern.stitches.filter((s) => !s.locked && s.slot);
  const lockedCount = pattern.stitches.filter((s) => s.locked).length;
  const images = Object.values(yarn).filter((y) => y.kind === "image" || y.kind === "video");
  return (
    <aside aria-label="Fill" className="inspector">
      <p className="eyebrow">Fill mode</p>
      <h2 className="h3" style={{ margin: "4px 0 var(--space-3)" }}>What changes each time</h2>
      <p className="body-sm" style={{ color: "var(--ink-muted)", marginTop: 0 }}>{lockedCount} brand {lockedCount === 1 ? "part is" : "parts are"} locked and stay put.</p>
      {free.length === 0 && <p className="body-sm">This pattern has no free slots. Switch to Pattern mode and name a stitch to make it fillable.</p>}
      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        {free.map((s) => (
          <div key={s.id} onFocus={() => select([s.id])} style={{ outline: selection.includes(s.id) ? "1px solid var(--ember)" : undefined, borderRadius: 6 }}>
            {s.kind === "text" ? (
              <Field label={s.slot!} htmlFor={`fill-${s.id}`}>
                {(s.content ?? "").length > 40 || (s.h > 0.12) ? (
                  <Textarea id={`fill-${s.id}`} rows={3} defaultValue={s.content} key={`${s.id}-${s.content}`} onBlur={(e) => e.target.value !== s.content && dispatch({ type: "fillSlot", slot: s.slot!, content: e.target.value }, { label: `Fill ${s.slot}` })} />
                ) : (
                  <Input id={`fill-${s.id}`} defaultValue={s.content} key={`${s.id}-${s.content}`} onBlur={(e) => e.target.value !== s.content && dispatch({ type: "fillSlot", slot: s.slot!, content: e.target.value }, { label: `Fill ${s.slot}` })} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
                )}
              </Field>
            ) : s.kind === "image" || s.kind === "video" ? (
              <Field label={s.slot!}>
                <Select aria-label={s.slot} value={s.yarnId ?? ""} onValueChange={(v) => dispatch({ type: "updateStitch", id: s.id, patch: { yarnId: v } }, { label: `Fill ${s.slot}` })} options={images.map((y) => ({ value: y.id, label: y.name }))} placeholder="Choose from Yarn" />
              </Field>
            ) : null}
          </div>
        ))}
      </div>
    </aside>
  );
}
