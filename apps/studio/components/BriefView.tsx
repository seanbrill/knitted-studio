"use client";

// The Brief: what the person's model knows about the business. A profile (built from their
// website by their model, written by them, or both), notes for whoever builds it next, and the
// reference: files about the business to look at and read, like pictures of every page of
// the website, a menu or a brochure. Sync reads the website again, any time, and brings it
// all up to date.

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, type SyncJob, type SyncOptions, type SyncStep, type SyncStepState } from "@knitted/core/client";
import type { Brief } from "@knitted/core";
import { Button, Dialog, EmptyState, Field, Markdown, Skeleton, Textarea, icons, useToast } from "@knitted/ui";
import { timeAgo, useLive } from "@/lib/hooks";
import { YarnView } from "./YarnView";
import { SyncChoices } from "./SyncChoices";

const { Globe, RefreshCw, Pencil, Undo2, Check, X, AlertTriangle, Sparkles, Clock } = icons;

const STEP_WORDS: Record<SyncStep, string> = {
  read: "Read the website",
  swatch: "Read a swatch from it",
  profile: "Write the profile",
  pictures: "Picture every page, on a desktop and a phone",
};
const KEEP = (projectId: string) => `knitted.sync.${projectId}`;
const RUNNING = (j: SyncJob | null) => !!j && (j.status === "running" || j.status === "queued");

/** The sync running for a project, or the last one: kept in the address and on this computer, so a reload keeps showing it. */
function useSync(projectId: string) {
  const params = useSearchParams();
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<SyncJob | null>(null);
  useEffect(() => {
    let id = params.get("sync");
    try { id ??= localStorage.getItem(KEEP(projectId)); } catch { /* not kept */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (id) setJobId(id);
  }, [projectId, params]);
  useEffect(() => {
    if (!jobId) return;
    let live = true, t: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const j = await api.brief.job(jobId);
        if (!live) return;
        setJob(j);
        if (RUNNING(j)) t = setTimeout(tick, 600);
      } catch { if (live) { setJob(null); try { localStorage.removeItem(KEEP(projectId)); } catch { /* fine */ } } }
    };
    void tick();
    return () => { live = false; clearTimeout(t); };
  }, [jobId, projectId]);
  const started = useCallback((j: SyncJob) => { setJob(j); setJobId(j.id); try { localStorage.setItem(KEEP(projectId), j.id); } catch { /* for now only */ } }, [projectId]);
  const dismiss = useCallback(() => { setJob(null); setJobId(null); try { localStorage.removeItem(KEEP(projectId)); } catch { /* fine */ } }, [projectId]);
  return { job, started, dismiss };
}

export function BriefView({ projectId }: { projectId: string }) {
  const toast = useToast();
  const router = useRouter();
  const { data: brief, refresh } = useLive(() => api.brief.get(projectId), [projectId]);
  const sync = useSync(projectId);
  const [asking, setAsking] = useState(false);
  const [editing, setEditing] = useState(false);
  const running = RUNNING(sync.job);

  // When a sync ends, what it made is shown.
  const ended = sync.job && !running ? sync.job.status : null;
  useEffect(() => { if (ended) void refresh(); }, [ended, refresh]);

  if (!brief) return <div style={{ display: "grid", gap: "var(--space-4)" }}><Skeleton height={40} /><Skeleton height={260} /></div>;

  return (
    <div style={{ display: "grid", gap: "var(--space-6)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <h2 className="h2" style={{ margin: 0 }}>Brief</h2>
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          {!editing && <Button tip="Write the profile yourself, or change what your model wrote" onClick={() => setEditing(true)}><Pencil size={14} aria-hidden /> {brief.profile ? "Edit" : "Write it yourself"}</Button>}
          <Button variant="primary" disabled={running} tip={brief.site.url ? `Read ${host(brief.site.url)} again and bring the profile, the swatch and the pictures up to date` : "Read the business's website: the profile, a swatch and pictures of every page"} onClick={() => setAsking(true)}>
            <RefreshCw size={14} aria-hidden /> {brief.site.url ? "Sync again" : "Sync with a website"}
          </Button>
        </div>
      </div>

      <SiteLine brief={brief} />
      {sync.job && <SyncProgress job={sync.job} onDismiss={() => { sync.dismiss(); router.replace(`/projects/${projectId}/brief`, { scroll: false }); }} onStop={async () => { await api.brief.cancel(sync.job!.id).catch(() => {}); }} onSwatch={() => router.push(`/projects/${projectId}/swatch`)} />}

      <section aria-labelledby="brief-profile" className="card" style={{ padding: "var(--space-5)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap", marginBottom: "var(--space-3)" }}>
          <h3 id="brief-profile" className="h3" style={{ margin: 0 }}>Profile</h3>
          <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}>
            <SourceLine brief={brief} />
            {brief.canUndo && !editing && (
              <Button size="sm" variant="ghost" tip="Put back the profile from before your model's last change" onClick={async () => { try { await api.brief.undo(projectId); await refresh(); toast("Put back the profile from before"); } catch (e) { toast.problem((e as Error).message); } }}>
                <Undo2 size={13} aria-hidden /> Undo
              </Button>
            )}
          </div>
        </div>
        {editing ? <ProfileEditor brief={brief} onCancel={() => setEditing(false)} onSaved={async () => { setEditing(false); await refresh(); toast("Saved the profile"); }} />
          : brief.profile ? <Markdown text={brief.profile} topLevel={4} className="brief-profile" />
          : running && sync.job?.progress?.live ? <LiveText text={sync.job.progress.live} />
          : <EmptyState title="No profile yet" body="Sync with the business's website and your model writes one from every page it reads. Or write it yourself: who they are, what they offer, how they talk." action={<Button variant="primary" onClick={() => setAsking(true)}><Globe size={14} aria-hidden /> Sync with a website</Button>} />}
      </section>

      <NotesCard brief={brief} projectId={projectId} onSaved={refresh} />

      <section aria-label="Reference">
        <p className="body-sm" style={{ margin: "0 0 var(--space-3)", color: "var(--ink-muted)", maxWidth: "70ch" }}>
          Files about the business for your model to look at and read: pictures of the website, menus, brochures, price lists. They are not for putting in a pattern: cut a part out of one into Yarn for that. Useful for designing a new version of a page, too.
        </p>
        <YarnView projectId={projectId} shelf="reference" heading={false} />
      </section>

      <SyncDialog open={asking} onOpenChange={setAsking} brief={brief} projectId={projectId} onStarted={(j) => { setAsking(false); sync.started(j); }} />
    </div>
  );
}

const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

function SiteLine({ brief }: { brief: Brief }) {
  const s = brief.site;
  if (!s.url) return null;
  return (
    <p className="body-sm" style={{ margin: 0, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", color: "var(--ink-muted)" }}>
      <Globe size={14} aria-hidden />
      <a className="link" href={s.url} target="_blank" rel="noreferrer">{host(s.url)}</a>
      {s.syncedAt && <span><Clock size={12} aria-hidden style={{ verticalAlign: -1 }} /> Synced {timeAgo(s.syncedAt)}{s.pages ? `, ${s.pages} page${s.pages === 1 ? "" : "s"} read` : ""}{s.pictures ? `, ${s.pictures} picture${s.pictures === 1 ? "" : "s"}` : ""}</span>}
    </p>
  );
}

function SourceLine({ brief }: { brief: Brief }) {
  if (!brief.profile) return null;
  const src = brief.source;
  const what = brief.by === "model"
    ? src.kind === "site" && src.url ? `Written by your model from ${host(src.url)}${src.pages?.length ? `, ${src.pages.length} pages` : ""}` : "Changed by your model"
    : "Written by you";
  const when = brief.updatedAt ? `, ${timeAgo(brief.updatedAt)}` : "";
  return <span className="eyebrow" title={src.pages?.map((p) => p.url).join("\n")}>{what}{when}</span>;
}

function LiveText({ text }: { text: string }) {
  return (
    <div aria-live="off" className="body-sm" style={{ whiteSpace: "pre-wrap", color: "var(--ink-muted)", maxHeight: 260, overflow: "hidden", maskImage: "linear-gradient(to bottom, transparent, black 30%)" }}>
      {text}
    </div>
  );
}

function ProfileEditor({ brief, onCancel, onSaved }: { brief: Brief; onCancel: () => void; onSaved: () => void }) {
  const [text, setText] = useState(brief.profile || "# Name\n\n# What they offer\n\n# Who it is for\n\n# How they sound\n\n# Facts to get right\n");
  const [err, setErr] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try { await api.brief.save(brief.projectId, { profile: text }); onSaved(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  return (
    <div style={{ display: "grid", gap: "var(--space-3)" }}>
      <Field label="The profile, in markdown" htmlFor="brief-text" error={err} hint={`A # starts a part. ${text.length.toLocaleString()} characters.`}>
        <Textarea id="brief-text" rows={22} value={text} onChange={(e) => setText(e.target.value)} style={{ fontFamily: "var(--font-mono)", fontSize: 13 }} />
      </Field>
      <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "end" }}>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" busy={busy} onClick={save}>{busy ? "Saving..." : "Save profile"}</Button>
      </div>
    </div>
  );
}

function NotesCard({ brief, projectId, onSaved }: { brief: Brief; projectId: string; onSaved: () => void }) {
  const toast = useToast();
  const [text, setText] = useState(brief.notes);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText(brief.notes);
  }, [brief.notes]);
  const save = async () => { if (text === brief.notes) return; try { await api.brief.save(projectId, { notes: text }); onSaved(); toast("Saved the notes"); } catch (e) { toast.problem((e as Error).message); } };
  return (
    <section aria-labelledby="brief-notes" className="card" style={{ padding: "var(--space-5)" }}>
      <h3 id="brief-notes" className="h3" style={{ margin: "0 0 4px" }}>Notes for your model</h3>
      <p className="body-sm" style={{ margin: "0 0 var(--space-3)", color: "var(--ink-muted)" }}>What to stress, and what the website has wrong or out of date. Your model reads them each time it builds the profile.</p>
      <Textarea aria-label="Notes for your model" rows={4} value={text} onChange={(e) => setText(e.target.value)} onBlur={save} placeholder="The summer menu is not on the site yet. We are dog friendly. Never call it a cafe." />
    </section>
  );
}

const ICON: Record<SyncStepState["status"], React.ReactNode> = {
  waiting: <span className="sync-dot" aria-hidden />,
  running: <span className="sync-dot sync-dot-live" aria-hidden />,
  done: <Check size={14} aria-hidden style={{ color: "var(--success)" }} />,
  skipped: <span className="sync-dot sync-dot-off" aria-hidden />,
  failed: <AlertTriangle size={14} aria-hidden style={{ color: "var(--danger)" }} />,
};
const SAID: Record<SyncStepState["status"], string> = { waiting: "waiting", running: "going now", done: "done", skipped: "skipped", failed: "could not be done" };

/** A sync, step by step, while it runs and after: what each step did, the pages it read, the profile as it is written. */
export function SyncProgress({ job, onStop, onDismiss, onSwatch }: { job: SyncJob; onStop: () => void; onDismiss?: () => void; onSwatch?: () => void }) {
  const p = job.progress;
  const running = RUNNING(job);
  const steps = (Object.keys(STEP_WORDS) as SyncStep[]).filter((s) => p?.steps[s] && !(p.steps[s].status === "skipped" && !p.steps[s].note));
  const title = running ? "Syncing with the website" : job.status === "done" ? "Synced" : job.status === "cancelled" ? "Sync stopped" : "The sync could not finish";
  return (
    <section aria-label={title} className="card sync-card" data-state={job.status} style={{ padding: "var(--space-4) var(--space-5)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-3)" }}>
        <h3 className="h3" style={{ margin: 0, display: "flex", gap: 8, alignItems: "center" }}>{running ? <Sparkles size={16} aria-hidden style={{ color: "var(--ember-ink)" }} /> : null}{title}</h3>
        {running ? <Button size="sm" variant="ghost" onClick={onStop}><X size={13} aria-hidden /> Stop</Button>
          : onDismiss && <Button size="sm" variant="ghost" onClick={onDismiss}>Done</Button>}
      </div>
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
        {steps.map((s) => {
          const st = p!.steps[s];
          const extra = s === "read" && st.status === "running" && p!.pages.length ? `${p!.pages.length} page${p!.pages.length === 1 ? "" : "s"} so far: ${p!.pages.at(-1)!.title || p!.pages.at(-1)!.url}`
            : s === "pictures" && st.status === "running" && p!.shots.total ? `${p!.shots.done} of ${p!.shots.total}`
            : s === "profile" && st.status === "running" && p!.chars ? `${p!.chars.toLocaleString()} characters written` : null;
          return (
            <li key={s} style={{ display: "grid", gridTemplateColumns: "18px 1fr", gap: 8, alignItems: "start" }}>
              <span style={{ display: "grid", placeItems: "center", height: 20 }}>{ICON[st.status]}</span>
              <span className="body-sm">
                <span style={{ fontWeight: st.status === "running" ? 600 : 400 }}>{STEP_WORDS[s]}</span>
                <span className="sr-only">, {SAID[st.status]}</span>
                {(st.note || extra) && <span style={{ display: "block", color: st.status === "failed" ? "var(--danger)" : "var(--ink-muted)" }}>{extra ?? st.note}</span>}
                {s === "swatch" && st.status === "done" && onSwatch && <button type="button" className="link" onClick={onSwatch}>Look at it in the Swatch tab</button>}
              </span>
            </li>
          );
        })}
      </ol>
      {running && p?.current === "profile" && p.live && <div style={{ marginTop: "var(--space-3)" }}><LiveText text={p.live} /></div>}
      {!running && job.error && <p className="field-error" role="alert" style={{ margin: "var(--space-3) 0 0" }}>{job.error}</p>}
      {!running && job.result?.notes?.length ? <ul className="body-sm" style={{ margin: "var(--space-3) 0 0", paddingLeft: 18, color: "var(--ink-muted)" }}>{job.result.notes.slice(0, 5).map((n) => <li key={n}>{n}</li>)}</ul> : null}
    </section>
  );
}

function SyncDialog({ open, onOpenChange, brief, projectId, onStarted }: { open: boolean; onOpenChange: (o: boolean) => void; brief: Brief; projectId: string; onStarted: (j: SyncJob) => void }) {
  const { data: model } = useLive(() => api.agent.config(), []);
  const [opts, setOpts] = useState<SyncOptions>({});
  const [err, setErr] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // Each time it opens: the website from before, and the profile left as it is unless asked.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) { setOpts({ url: brief.site.url ?? "", profile: true, pictures: true, swatch: false, mode: "merge", maxPages: 40 }); setErr(undefined); }
  }, [open, brief.site.url]);
  const hasKey = model ? model.key.present : null;
  const go = async () => {
    setBusy(true); setErr(undefined);
    try {
      const { url, writeUp, ...rest } = opts;
      onStarted(await api.brief.sync(projectId, { ...rest, ...(url?.trim() ? { url: url.trim() } : {}), ...(writeUp?.trim() ? { writeUp } : {}), profile: (rest.profile ?? true) && hasKey !== false }));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={brief.site.url ? "Sync again" : "Sync with a website"} description="Read the business's website and bring the Brief up to date. Run it again whenever the site changes."
      actions={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" busy={busy} onClick={go}><RefreshCw size={14} aria-hidden /> {busy ? "Starting..." : "Sync"}</Button></>}>
      <SyncChoices value={opts} onChange={setOpts} hasKey={hasKey} hasProfile={!!brief.profile} />
      {err && <p className="field-error" role="alert" style={{ margin: "var(--space-3) 0 0" }}>{err}</p>}
    </Dialog>
  );
}
