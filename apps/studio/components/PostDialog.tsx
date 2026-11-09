"use client";

// Post one knit, or several as a carousel, to the person's accounts: now, at a time, or as a
// draft. Each platform's limits are checked here, as the person writes, so nothing is
// scheduled that the platform would refuse at its time with nobody there to fix it.

import Link from "next/link";
import { useState } from "react";
import { PLATFORMS, captionLength, checkPost, fullCaption, type Platform } from "@knitted/core";
import { api, type KnitRecord, type SocialAccount, type TikTokCreator } from "@knitted/core/client";
import { Button, Dialog, Field, Input, SegmentedControl, Select, Switch, Textarea, icons, useToast } from "@knitted/ui";
import { useLive } from "@/lib/hooks";

const { AlertTriangle, Send, CalendarClock } = icons;
type When = "now" | "at" | "draft";

/** Tomorrow at nine, as a datetime-local input writes it. */
function tomorrowNine() {
  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T09:00`;
}
const PRIVACY: Record<string, string> = { PUBLIC_TO_EVERYONE: "Everyone", MUTUAL_FOLLOW_FRIENDS: "Friends", FOLLOWER_OF_CREATOR: "Followers", SELF_ONLY: "Only me" };

/** Open it with a key per set of knits: each opening starts from the first knit's own caption and hashtags. */
export function PostDialog({ projectId, knits, open, onOpenChange }: { projectId: string; knits: KnitRecord[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const toast = useToast();
  const { data: accounts } = useLive(() => api.social.accounts(), []);
  const first = knits[0];
  const [picked, setPicked] = useState<string[]>([]);
  const [caption, setCaption] = useState(() => fullCaption(first?.post?.caption ?? "", first?.post?.hashtags ?? []));
  const [own, setOwn] = useState<Partial<Record<Platform, string>>>({});
  const [title, setTitle] = useState(() => (first?.post?.caption ?? "").split(/(?<=[.!?])\s/)[0].slice(0, 100) || (first?.label ?? "").slice(0, 100));
  const [when, setWhen] = useState<When>("now");
  const [at, setAt] = useState(tomorrowNine);
  const [options, setOptions] = useState<Partial<Record<Platform, Record<string, unknown>>>>({});
  const [busy, setBusy] = useState(false);

  const media = knits.map((k) => ({ kind: k.kind, width: k.width, height: k.height, durationMs: k.durationMs }));
  const chosen = (accounts ?? []).filter((a) => picked.includes(a.id));
  const platforms = [...new Set(chosen.map((a) => a.platform))];
  const tiktok = chosen.find((a) => a.platform === "tiktok");
  const opt = (p: Platform) => options[p] ?? {};
  const setOpt = (p: Platform, k: string, v: unknown) => setOptions((o) => ({ ...o, [p]: { ...(o[p] ?? {}), [k]: v } }));
  // TikTok asks apps to show the account and its choices as they are now, each time.
  const tiktokId = tiktok?.id;
  const { data: creator, error: creatorErr } = useLive<TikTokCreator | null>(() => (tiktokId ? api.social.creator(tiktokId) : Promise.resolve(null)), [tiktokId]);

  const textFor = (p: Platform) => own[p] ?? caption;
  const checks = Object.fromEntries(platforms.map((p) => [p, checkPost(p, media, textFor(p), title)]));
  const problems = platforms.flatMap((p) => checks[p].problems.map((x) => `${PLATFORMS[p].name}: ${x}`));
  if (when !== "draft" && tiktok && !opt("tiktok").privacy) problems.push("TikTok: pick who can see it.");
  const notes = platforms.flatMap((p) => checks[p].notes.map((x) => `${PLATFORMS[p].name}: ${x}`));

  const submit = async () => {
    setBusy(true);
    try {
      const made = await api.posts.create(projectId, {
        accountIds: picked, knitIds: knits.map((k) => k.id), caption, title: platforms.includes("youtube") ? title : undefined,
        captions: own, options, at: when === "at" ? new Date(at).toISOString() : null, draft: when === "draft",
      });
      toast(when === "draft" ? `Saved ${made.length === 1 ? "a draft" : `${made.length} drafts`}.` : when === "at" ? `Scheduled for ${new Date(at).toLocaleString()}.` : "Posting now. See it in Posts.");
      onOpenChange(false);
      setPicked([]);
    } catch (e) { toast.problem((e as Error).message); } finally { setBusy(false); }
  };

  const none = accounts && accounts.length === 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} wide title={knits.length > 1 ? `Post ${knits.length} knits together` : `Post ${first?.label ?? "this knit"}`}
      actions={!none && <>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="primary" busy={busy} disabled={!picked.length || (when !== "draft" && problems.length > 0)} onClick={submit}>
          {when === "now" ? <><Send size={14} aria-hidden /> Post now</> : when === "at" ? <><CalendarClock size={14} aria-hidden /> Schedule</> : "Save draft"}
        </Button>
      </>}>
      {none ? (
        <p className="body">No accounts are connected yet. <Link className="link" href="/settings?tab=social">Connect one in Settings, Social</Link>.</p>
      ) : (
        <div style={{ display: "grid", gap: "var(--space-4)" }}>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 6 }}>
            <legend className="label" style={{ marginBottom: 6 }}>Post to</legend>
            {(accounts ?? []).map((a) => <AccountRow key={a.id} a={a} on={picked.includes(a.id)} why={checkPost(a.platform, media, caption, "t").problems.find((x) => !/caption|title|description|hashtags/i.test(x))}
              toggle={(on) => setPicked((p) => (on ? [...p, a.id] : p.filter((x) => x !== a.id)))} />)}
          </fieldset>

          <Field label="Caption" htmlFor="post-caption" hint={platforms.length ? platforms.map((p) => `${PLATFORMS[p].name} ${captionLength(p, textFor(p))} of ${PLATFORMS[p].caption}`).join(" · ") : "Pick an account to see each one's limit."}>
            <Textarea id="post-caption" rows={5} value={caption} onChange={(e) => setCaption(e.target.value)} />
          </Field>
          {platforms.filter((p) => own[p] !== undefined || captionLength(p, caption) > PLATFORMS[p].caption).map((p) => (
            <Field key={p} label={`Caption for ${PLATFORMS[p].name}`} htmlFor={`post-caption-${p}`} hint={`${captionLength(p, textFor(p))} of ${PLATFORMS[p].caption}${p === "x" ? ", a link counting as 23" : ""}.`}>
              <Textarea id={`post-caption-${p}`} rows={3} value={textFor(p)} onChange={(e) => setOwn((o) => ({ ...o, [p]: e.target.value }))} />
            </Field>
          ))}
          {platforms.includes("youtube") && (
            <Field label="Title on YouTube" htmlFor="post-title" hint={`${[...title].length} of 100.`}><Input id="post-title" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          )}

          {platforms.includes("tiktok") && (
            <section aria-label="On TikTok" style={{ display: "grid", gap: 8 }}>
              <h3 className="label" style={{ margin: 0 }}>On TikTok{creator?.creator_nickname ? `, as ${creator.creator_nickname}` : ""}</h3>
              {creatorErr && <p className="field-error" role="alert"><AlertTriangle size={14} aria-hidden /> {creatorErr}</p>}
              <div style={{ maxWidth: 280 }}>
                <Select aria-label="Who can see it on TikTok" placeholder="Who can see it" value={String(opt("tiktok").privacy ?? "")} onValueChange={(v) => setOpt("tiktok", "privacy", v)}
                  options={(creator?.privacy_level_options ?? []).map((v) => ({ value: v, label: PRIVACY[v] ?? v }))} />
              </div>
              {(["comments", "duet", "stitch"] as const).map((k) => {
                const off = k === "comments" ? creator?.comment_disabled : k === "duet" ? creator?.duet_disabled : creator?.stitch_disabled;
                return <label key={k} className="body-sm" style={{ display: "flex", gap: 10, alignItems: "center", opacity: off ? 0.5 : 1 }}><Switch label={`Allow ${k === "comments" ? "comments" : k === "duet" ? "duets" : "stitches"}`} checked={!!opt("tiktok")[k] && !off} onCheckedChange={(v) => setOpt("tiktok", k, v)} /> Allow {k === "comments" ? "comments" : k === "duet" ? "duets" : "stitches"}{off ? " (off in your TikTok settings)" : ""}</label>;
              })}
              <label className="body-sm" style={{ display: "flex", gap: 10, alignItems: "center" }}><Switch label="It promotes your own brand" checked={!!opt("tiktok").yourBrand} onCheckedChange={(v) => setOpt("tiktok", "yourBrand", v)} /> It promotes your own business</label>
              <label className="body-sm" style={{ display: "flex", gap: 10, alignItems: "center" }}><Switch label="It is paid for by someone else" checked={!!opt("tiktok").brandedContent} onCheckedChange={(v) => setOpt("tiktok", "brandedContent", v)} /> It is paid for by another brand</label>
              <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>By posting, you agree to TikTok&apos;s <a className="link" href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer">Music Usage Confirmation</a>{opt("tiktok").brandedContent ? <> and <a className="link" href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noreferrer">Branded Content Policy</a></> : null}. TikTok can take a few minutes to show it.</p>
            </section>
          )}
          {platforms.includes("youtube") && (
            <section aria-label="On YouTube" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <div style={{ minWidth: 200 }}><Select aria-label="Who can see it on YouTube" value={String(opt("youtube").privacy ?? "public")} onValueChange={(v) => setOpt("youtube", "privacy", v)} options={[{ value: "public", label: "Public" }, { value: "unlisted", label: "Unlisted" }, { value: "private", label: "Private" }]} /></div>
              <div style={{ minWidth: 240 }}><Select aria-label="Made for kids" value={opt("youtube").madeForKids ? "yes" : "no"} onValueChange={(v) => setOpt("youtube", "madeForKids", v === "yes")} options={[{ value: "no", label: "Not made for kids" }, { value: "yes", label: "Made for kids" }]} /></div>
            </section>
          )}
          {platforms.includes("linkedin") && (
            <div style={{ minWidth: 220, maxWidth: 280 }}><Select aria-label="Who can see it on LinkedIn" value={String(opt("linkedin").visibility ?? "PUBLIC")} onValueChange={(v) => setOpt("linkedin", "visibility", v)} options={[{ value: "PUBLIC", label: "Anyone on LinkedIn" }, { value: "CONNECTIONS", label: "Your connections" }]} /></div>
          )}
          {(platforms.includes("tiktok") || platforms.includes("youtube")) && (
            <label className="body-sm" style={{ display: "flex", gap: 10, alignItems: "center" }}><Switch label="Label it as made with AI" checked={!!(opt("tiktok").aiLabel ?? opt("youtube").aiLabel)} onCheckedChange={(v) => { setOpt("tiktok", "aiLabel", v); setOpt("youtube", "aiLabel", v); }} /> Label it as made with AI (for realistic people or places that were generated)</label>
          )}

          <SegmentedControl<When> label="When" value={when} onChange={setWhen} options={[{ value: "now", label: "Now" }, { value: "at", label: "At a time" }, { value: "draft", label: "Draft" }]} />
          {when === "at" && <Field label="Post at" htmlFor="post-at" hint="Your computer's time. knitted has to be open then, except for YouTube."><Input id="post-at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} style={{ maxWidth: 260 }} /></Field>}

          {when !== "draft" && problems.length > 0 && <ul aria-label="What to fix first" style={{ margin: 0, paddingLeft: 18 }}>{problems.map((p) => <li key={p} className="body-sm" style={{ color: "var(--danger)" }}>{p}</li>)}</ul>}
          {notes.length > 0 && <ul aria-label="Good to know" style={{ margin: 0, paddingLeft: 18 }}>{notes.map((p) => <li key={p} className="body-sm" style={{ color: "var(--ink-muted)" }}>{p}</li>)}</ul>}
        </div>
      )}
    </Dialog>
  );
}

function AccountRow({ a, on, why, toggle }: { a: SocialAccount; on: boolean; why?: string; toggle: (on: boolean) => void }) {
  const label = `${PLATFORMS[a.platform].name}${a.handle ? `, @${a.handle}` : a.name ? `, ${a.name}` : ""}`;
  const off = !!why || a.status === "reconnect";
  return (
    <label className="body-sm" style={{ display: "flex", gap: 10, alignItems: "center", opacity: off ? 0.6 : 1 }}>
      <input type="checkbox" checked={on && !off} disabled={off} onChange={(e) => toggle(e.target.checked)} aria-label={label} />
      <span><strong>{PLATFORMS[a.platform].name}</strong> {a.handle ? `@${a.handle}` : a.name}</span>
      {a.status === "reconnect" && <span style={{ color: "var(--danger)" }}>Connect it again in Settings first.</span>}
      {why && a.status !== "reconnect" && <span style={{ color: "var(--ink-muted)" }}>{why}</span>}
    </label>
  );
}
