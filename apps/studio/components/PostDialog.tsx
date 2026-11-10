"use client";

// Post one knit, or several as a carousel, to the person's accounts: now, at a time, or as a
// draft. Each platform's limits are checked here, as the person writes, so nothing is
// scheduled that the platform would refuse at its time with nobody there to fix it. What is
// posted stays in sight beside it, and with no account connected yet it is not a dead end:
// connect one, or post it yourself, with the caption copied and the file downloaded.

import Link from "next/link";
import { useState } from "react";
import { PLATFORMS, PLATFORM_IDS, captionLength, checkPost, fullCaption, isLinkedInPage, type Platform } from "@knitted/core";
import { api, knitFileUrl, knitPosterUrl, type KnitRecord, type SocialAccount, type TikTokCreator } from "@knitted/core/client";
import { Button, Dialog, Field, Input, SegmentedControl, Select, Skeleton, Switch, Textarea, icons, useToast } from "@knitted/ui";
import { formatBytes, useLive } from "@/lib/hooks";
import { formatName } from "./KnitView";

const { AlertTriangle, Send, CalendarClock, Copy, Download, Check } = icons;
/** A network's mark: its letters on its colour. Not its logo. */
const MARK: Record<Platform, string> = { instagram: "IG", tiktok: "TT", linkedin: "in", threads: "@", x: "X", youtube: "YT" };
export function PlatformMark({ p, small }: { p: Platform; small?: boolean }) {
  return <span className="pf" data-p={p} data-small={small || undefined} aria-hidden>{MARK[p]}</span>;
}
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

  const copyCaption = async () => { await navigator.clipboard.writeText(caption); toast("Caption and hashtags copied."); };
  const download = knits.length === 1 ? knitFileUrl(first!, true) : `/api/projects/${projectId}/knits/zip?ids=${knits.map((k) => k.id).join(",")}`;
  const blocked = !picked.length ? "Pick where it goes first." : when !== "draft" && problems.length > 0 ? `${problems.length === 1 ? "One thing" : `${problems.length} things`} to fix first, above.` : null;
  const n = picked.length;

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
  const what = (
    <aside className="post-what" aria-label="What is posted">
      <div className="post-what-pics" data-many={knits.length > 1 || undefined}>
        {knits.slice(0, 4).map((k) => k.kind === "image" ? <img key={k.id} src={knitFileUrl(k)} alt={k.label} /> : <img key={k.id} src={knitPosterUrl(k)} alt={k.label} onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />)}
      </div>
      <p className="post-meta">
        {knits.length === 1 ? (first!.kind === "video" ? `1 video, ${Math.round((first!.durationMs ?? 0) / 1000)} seconds` : "1 picture") : `${knits.length} ${knits.every((k) => k.kind === "image") ? "pictures" : "files"}, as a carousel`}
        <br />{formatName(first!)}, {first!.width} × {first!.height}{knits.length === 1 ? `, ${formatBytes(first!.bytes)}` : ""}
      </p>
    </aside>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange} wide title={knits.length > 1 ? `Post ${knits.length} knits together` : `Post ${first?.label ?? "this knit"}`}
      actions={none ? <Button onClick={() => onOpenChange(false)}>Close</Button> : <>
        <span className="dialog-actions-note" role="status">{picked.length && blocked ? <span style={{ color: "var(--danger)" }}>{blocked}</span> : <>{picked.length ? "Or post it yourself" : "Pick where it goes, or post it yourself"}: <button type="button" className="link" onClick={() => void copyCaption()}>Copy caption</button> · <a className="link" href={download}>Download</a></>}</span>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="primary" busy={busy} disabled={!!blocked} tip={blocked ?? undefined} onClick={submit}>
          {when === "now" ? <><Send size={14} aria-hidden /> {n > 1 ? `Post to ${n} accounts` : "Post now"}</> : when === "at" ? <><CalendarClock size={14} aria-hidden /> {n > 1 ? `Schedule for ${n} accounts` : "Schedule"}</> : n > 1 ? `Save ${n} drafts` : "Save draft"}
        </Button>
      </>}>
      <div className="post-dialog">
        {what}
        {none ? (
          <div className="post-form">
            <section className="post-card" aria-label="Connect where you post">
              <p className="label" style={{ margin: 0 }}>Connect where you post</p>
              <p className="body-sm muted" style={{ margin: 0 }}>Each one once, and knitted posts for you: now, at a time, or as a draft to finish in the app.</p>
              <ul className="post-nets">{PLATFORM_IDS.map((p) => <li key={p}><PlatformMark p={p} small />{PLATFORMS[p].name}</li>)}</ul>
              <Link className="btn btn-secondary" href="/settings?tab=social" style={{ justifySelf: "start" }}>Connect accounts in Settings</Link>
            </section>
            <section className="post-card" aria-label="Or post it yourself">
              <p className="label" style={{ margin: 0 }}>Or post it yourself</p>
              <ol className="post-steps">
                <li><span className="post-step-n">1</span><span><b>Copy the caption and hashtags</b><small>{caption ? `${[...caption].length.toLocaleString()} characters, ready to paste` : "No caption yet: write one in the knit's Post tab"}</small></span>
                  <Button size="sm" disabled={!caption} onClick={() => void copyCaption()}><Copy size={13} aria-hidden /> Copy</Button></li>
                <li><span className="post-step-n">2</span><span><b>Download {knits.length === 1 ? (first!.kind === "video" ? "the video" : "the picture") : `the ${knits.length} files`}</b><small>{knits.length === 1 ? `${formatName(first!)}, ${first!.width} × ${first!.height}, ${formatBytes(first!.bytes)}` : "In one zip, in order"}</small></span>
                  <a className="btn btn-secondary btn-sm" href={download}><Download size={13} aria-hidden /> Download</a></li>
                <li><span className="post-step-n">3</span><span><b>Post it in the app</b><small>Paste the caption, and add the {knits.length === 1 ? "file" : "files"}.</small></span></li>
              </ol>
            </section>
          </div>
        ) : (
        <div className="post-form">
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 6, minWidth: 0 }}>
            <legend className="label" style={{ marginBottom: 6 }}>Where</legend>
            {!accounts ? [0, 1, 2].map((i) => <div key={i} className="acc-row" aria-hidden><Skeleton width={16} height={16} /><Skeleton width={30} height={30} /><span style={{ display: "grid", gap: 6 }}><Skeleton width="40%" height={12} /><Skeleton width="60%" height={10} /></span></div>)
              : accounts.map((a) => <AccountRow key={a.id} a={a} on={picked.includes(a.id)} why={checkPost(a.platform, media, caption, "t").problems.find((x) => !/caption|title|description|hashtags/i.test(x))}
                toggle={(on) => setPicked((p) => (on ? [...p, a.id] : p.filter((x) => x !== a.id)))} />)}
          </fieldset>

          <div style={{ display: "grid", gap: 6 }}>
            <label className="label" htmlFor="post-caption">Caption <span className="post-meta" style={{ fontWeight: 400 }}>{first?.post?.caption ? "from the knit" : ""}</span></label>
            <Textarea id="post-caption" rows={6} value={caption} onChange={(e) => setCaption(e.target.value)} />
            {platforms.length
              ? <ul className="fit-chips" aria-label="How it fits each network">{platforms.map((p) => { const len = captionLength(p, textFor(p)), max = PLATFORMS[p].caption; return <li key={p} data-over={len > max || undefined}>{PLATFORMS[p].name} {len.toLocaleString()} of {max.toLocaleString()}{len <= max && <Check size={11} aria-hidden />}</li>; })}</ul>
              : <p className="post-meta">Pick where it goes to see each one&apos;s limit.</p>}
          </div>
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
          {/* A page posts to anyone: who sees it is a person's choice. */}
          {(accounts ?? []).some((a) => picked.includes(a.id) && a.platform === "linkedin" && !isLinkedInPage(a)) && (
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
      </div>
    </Dialog>
  );
}

function AccountRow({ a, on, why, toggle }: { a: SocialAccount; on: boolean; why?: string; toggle: (on: boolean) => void }) {
  const page = isLinkedInPage(a);
  const label = `${PLATFORMS[a.platform].name}${a.handle ? `, @${a.handle}` : a.name ? `, ${a.name}` : ""}${page ? ", company page" : ""}`;
  const off = !!why || a.status === "reconnect";
  return (
    <label className="acc-row" data-on={(on && !off) || undefined} data-off={off || undefined}>
      <input type="checkbox" checked={on && !off} disabled={off} onChange={(e) => toggle(e.target.checked)} aria-label={label} />
      <PlatformMark p={a.platform} />
      <span className="acc-text">
        <b>{PLATFORMS[a.platform].name}</b>
        <small>{a.handle ? `@${a.handle}` : a.name}{page ? " · company page" : ""}{a.status === "reconnect" ? " · connect it again in Settings first" : why ? ` · ${why}` : ""}</small>
      </span>
    </label>
  );
}
