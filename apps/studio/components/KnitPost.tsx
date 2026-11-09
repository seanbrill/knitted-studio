"use client";

// What goes with a knit when it is posted: its caption, hashtags and a track from the
// project's music. Your model writes them, writes them again, or again with what you say to
// change; and you can change any of it yourself.

import { useState } from "react";
import { api, yarnFileUrl, type KnitRecord } from "@knitted/core/client";
import { Button, Input, Select, Textarea, icons, useToast } from "@knitted/ui";
import { useLive } from "@/lib/hooks";

const { Sparkles, Copy, RotateCw } = icons;
const NONE = "none";

export function KnitPost({ knit, onChanged }: { knit: KnitRecord; onChanged: (k: KnitRecord) => void }) {
  const toast = useToast();
  const { data: tracks } = useLive(() => api.yarn.list(knit.projectId, { kind: "audio" }), [knit.projectId]);
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState(false);
  const p = knit.post;
  const has = !!p.caption;
  const write = async (what?: string) => {
    setBusy(true);
    try { onChanged(await api.knit.writePost(knit.id, what?.trim() || undefined)); setAsk(""); }
    catch (e) { toast.problem((e as Error).message || "Your model could not write it. Try again."); }
    finally { setBusy(false); }
  };
  const save = async (change: Parameters<typeof api.knit.setPost>[1]) => onChanged(await api.knit.setPost(knit.id, change));
  const track = tracks?.find((t) => t.id === p.audioId);
  const tags = (p.hashtags ?? []).join(" ");

  return (
    <section aria-label="For the post" style={{ display: "grid", gap: "var(--space-3)", borderTop: "1px solid var(--line)", paddingTop: "var(--space-3)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <h3 className="label" style={{ margin: 0 }}>For the post</h3>
        {has && <Button size="sm" variant="ghost" onClick={async () => { await navigator.clipboard.writeText([p.caption, tags].filter(Boolean).join("\n\n")); toast("Caption and hashtags copied."); }}><Copy size={13} aria-hidden /> Copy caption and hashtags</Button>}
      </div>
      {has ? (<>
        <Textarea aria-label="Caption" key={`c-${p.at}`} defaultValue={p.caption} rows={3} onBlur={(e) => { if (e.target.value !== p.caption) void save({ caption: e.target.value }); }} />
        <Input aria-label="Hashtags" key={`h-${p.at}`} defaultValue={tags} placeholder="#hashtags" onBlur={(e) => { if (e.target.value !== tags) void save({ hashtags: e.target.value.split(/[\s,]+/) }); }} />
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className="body-sm" style={{ color: "var(--ink-muted)" }}>Music</span>
            <div style={{ minWidth: 220 }}>
              <Select aria-label="Music" value={p.audioId ?? NONE} onValueChange={(v) => void save({ audioId: v === NONE ? null : v })}
                options={[{ value: NONE, label: tracks?.length ? "No music" : "No music in Yarn yet" }, ...(tracks ?? []).map((t) => ({ value: t.id, label: t.name }))]} />
            </div>
            {track && <audio controls preload="none" src={yarnFileUrl(track)} style={{ height: 32 }} aria-label={`Play ${track.name}`} />}
          </div>
          {track && p.audioWhy && p.by === "model" && <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>{p.audioWhy}</p>}
        </div>
      </>) : (
        <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>Your model writes a caption and hashtags from the Brief and the post, and picks a track from the project's music.</p>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 240px" }}>
          <Input aria-label={has ? "What to change" : "Anything to say first"} placeholder={has ? "What to change, like: shorter, more playful, mention Saturday" : "Optional: what it is for, who it is for"} value={ask} disabled={busy}
            onChange={(e) => setAsk(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !busy) void write(ask); }} />
        </div>
        {has && ask.trim()
          ? <Button busy={busy} onClick={() => void write(ask)}><Sparkles size={14} aria-hidden /> {busy ? "Writing..." : "Change it"}</Button>
          : <Button busy={busy} onClick={() => void write()}>{has ? <RotateCw size={14} aria-hidden /> : <Sparkles size={14} aria-hidden />} {busy ? "Writing..." : has ? "Write again" : "Write caption and hashtags"}</Button>}
      </div>
    </section>
  );
}
