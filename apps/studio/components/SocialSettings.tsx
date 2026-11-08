"use client";

// Settings, Social: the person's own developer app on each platform, the accounts signed in
// through it, the media host Instagram and Threads fetch from, and what their model may do.
// knitted has no server between the person and a platform, so each platform needs an app of
// their own, made once: the guide on the site walks through each.

import { useState } from "react";
import { PLATFORMS, PLATFORM_IDS, appCallback, redirectToRegister, type Platform } from "@knitted/core";
import { api, type SocialAccount, type SocialConfigView } from "@knitted/core/client";
import { Button, ConfirmDialog, Field, Input, SegmentedControl, Switch, icons, useToast } from "@knitted/ui";
import { useLive } from "@/lib/hooks";

const { AlertTriangle, Check, Copy, ExternalLink } = icons;
const GUIDE = "https://knitted.filefreak.page/docs/social/";

/** What each platform calls its app's id and secret, and what knitted posts there. */
const ABOUT: Record<Platform, { id: string; secret: string; does: string }> = {
  instagram: { id: "Instagram app ID", secret: "Instagram app secret", does: "Pictures, carousels of up to 10, and Reels. A tall picture goes to your Story. Needs a media host." },
  tiktok: { id: "Client key", secret: "Client secret", does: "Videos. Until TikTok reviews your app, a post is seen only by you, and the account has to be private." },
  linkedin: { id: "Client ID", secret: "Client secret", does: "Words, pictures (up to 20 at once) and video, as you. A sign-in lasts 60 days." },
  threads: { id: "Threads app ID", secret: "Threads app secret", does: "Words, pictures, video and carousels. Needs a media host." },
  x: { id: "Client ID", secret: "Client secret (a web app's only)", does: "Words, up to 4 pictures, or a video. Each post is paid for from your X developer credits." },
  youtube: { id: "Client ID", secret: "Client secret", does: "Videos, and Shorts when upright. A post scheduled ahead is published by YouTube at its time, even with knitted closed." },
};

export function SocialSettings() {
  const toast = useToast();
  const { data: cfg, refresh } = useLive(() => api.social.config(), []);
  const { data: accounts } = useLive(() => api.social.accounts(), []);
  const [err, setErr] = useState<string | undefined>();
  if (!cfg) return null;
  const save = async (b: Parameters<typeof api.social.save>[0]) => {
    try { await api.social.save(b); await refresh(); setErr(undefined); return true; } catch (e) { setErr((e as Error).message); toast((e as Error).message); return false; }
  };
  return (
    <div style={{ display: "grid", gap: "var(--space-6)", maxWidth: 680 }}>
      <div>
        <h2 className="h3" style={{ marginBottom: 4 }}>Social</h2>
        <p className="body-sm" style={{ color: "var(--ink-muted)", margin: 0 }}>
          Post knits to your own accounts, now or at a time. Each platform needs a developer app of your own, made once: there is no knitted server in between, so your sign-ins stay on this computer. <a className="link" href={GUIDE} target="_blank" rel="noreferrer">The guide</a> walks through each.
        </p>
        <p className="body-sm" style={{ color: "var(--ink-muted)", margin: "var(--space-2) 0 0" }}>Posts go out while knitted is running. One due while it was closed goes out when it opens, if that is within two hours.</p>
      </div>
      {err && <p className="field-error" role="alert"><AlertTriangle size={14} aria-hidden /> {err}</p>}
      {PLATFORM_IDS.map((p) => <PlatformCard key={p} platform={p} cfg={cfg} accounts={(accounts ?? []).filter((a) => a.platform === p)} save={save} />)}
      <HostCard cfg={cfg} save={save} />
      <section aria-label="Your model and posts" className="card" style={{ padding: "var(--space-4)", display: "grid", gap: 8 }}>
        <h3 className="label" style={{ margin: 0 }}>Your model</h3>
        <label style={{ display: "flex", gap: 10, alignItems: "center" }} className="body-sm">
          <Switch label="Let your model schedule posts" checked={cfg.modelMaySchedule} onCheckedChange={(v) => void save({ modelMaySchedule: v })} />
          Let your model schedule posts
        </label>
        <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>{cfg.modelMaySchedule ? "It can schedule and post for you. You can still cancel anything in a project's Posts." : "Off: it makes drafts, and you schedule them from a project's Posts."}</p>
      </section>
      <section aria-label="While posts wait" className="card" style={{ padding: "var(--space-4)", display: "grid", gap: 8 }}>
        <h3 className="label" style={{ margin: 0 }}>While posts wait</h3>
        <label style={{ display: "flex", gap: 10, alignItems: "center" }} className="body-sm">
          <Switch label="Keep knitted running when its window is closed" checked={cfg.stayOpen} onCheckedChange={(v) => void save({ stayOpen: v })} />
          Keep knitted running when its window is closed
        </label>
        <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>{cfg.stayOpen ? "On: with posts still to go out, closing the window leaves knitted in the menu bar (the system tray on Windows and Linux) until the last one is out, then it quits. YouTube posts scheduled ahead go out without it." : "Off: closing the window quits knitted, and posts wait until you open it again."}</p>
      </section>
      <section aria-label="How posts did" className="card" style={{ padding: "var(--space-4)", display: "grid", gap: 8 }}>
        <h3 className="label" style={{ margin: 0 }}>How posts did</h3>
        <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>knitted asks each platform how a post is doing an hour after it goes out, then after 6 hours, a day, 3 days, a week, 2 weeks and a month, and shows it in Posts and Insights. LinkedIn gives no numbers to apps like this one.</p>
        <label style={{ display: "flex", gap: 10, alignItems: "center" }} className="body-sm">
          <Switch label="Ask X for numbers too" checked={cfg.metricsX} onCheckedChange={(v) => void save({ metricsX: v })} />
          Ask X for numbers too
        </label>
        <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>X takes credits from your developer account for each look: about 7 looks per post over its first month.</p>
      </section>
    </div>
  );
}

function CopyLine({ text, label }: { text: string; label: string }) {
  const toast = useToast();
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <code className="body-sm" style={{ fontFamily: "var(--font-mono)", background: "var(--surface-sunken)", padding: "4px 8px", borderRadius: "var(--radius-sm)", wordBreak: "break-all" }}>{text}</code>
      <Button size="sm" variant="ghost" aria-label={`Copy ${label}`} onClick={async () => { await navigator.clipboard.writeText(text); toast("Copied."); }}><Copy size={13} aria-hidden /> Copy</Button>
    </div>
  );
}

function PlatformCard({ platform, cfg, accounts, save }: { platform: Platform; cfg: SocialConfigView; accounts: SocialAccount[]; save: (b: Parameters<typeof api.social.save>[0]) => Promise<boolean> }) {
  const toast = useToast();
  const info = PLATFORMS[platform], about = ABOUT[platform];
  const app = cfg.apps[platform];
  const [secret, setSecret] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState<SocialAccount | null>(null);
  const ready = !!app.clientId && (app.secret || !!info.secretOptional);
  // Open while it is being set up, and stays as the person leaves it: filling in the id must not fold it away from the secret.
  const [setupOpen, setSetupOpen] = useState(!ready);
  const redirect = redirectToRegister(platform, cfg.port);
  const connect = async () => {
    setBusy(true);
    try { const { url } = await api.social.connect(platform); window.open(url, "_blank", "noopener"); setWaiting(true); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const finish = async () => {
    setBusy(true);
    try { const a = await api.social.paste(pasted); setPasted(""); setWaiting(false); toast(`${info.name} is connected${a.handle ? ` as @${a.handle}` : ""}.`); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const status = accounts.length ? `${accounts.length} connected` : ready ? "Ready to connect" : "Not set up";
  return (
    <section aria-label={info.name} className="card" style={{ padding: "var(--space-4)", display: "grid", gap: "var(--space-3)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <h3 className="h4" style={{ margin: 0 }}>{info.name} <span className="eyebrow" style={{ marginLeft: 8 }}>{status}</span></h3>
        <a className="link body-sm" href={`${GUIDE}#${platform}`} target="_blank" rel="noreferrer">How to set it up <ExternalLink size={12} aria-hidden /></a>
      </div>
      <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>{about.does}</p>

      {accounts.map((a) => (
        <div key={a.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {a.avatar ? <img src={a.avatar} alt="" width={28} height={28} style={{ borderRadius: "50%" }} referrerPolicy="no-referrer" /> : <span aria-hidden style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--surface-sunken)" }} />}
          <span className="body-sm"><strong>{a.name || a.handle}</strong>{a.handle && a.name ? ` @${a.handle}` : ""}</span>
          {a.status === "reconnect"
            ? <span className="body-sm" style={{ color: "var(--danger)", display: "flex", gap: 4, alignItems: "center" }}><AlertTriangle size={13} aria-hidden /> {a.note ?? "Connect it again."}</span>
            : <span className="body-sm" style={{ color: "var(--success)", display: "flex", gap: 4, alignItems: "center" }}><Check size={13} aria-hidden /> Connected{a.expiresAt ? `, until ${new Date(a.expiresAt).toLocaleDateString()}` : ""}</span>}
          <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            {(a.status === "reconnect" || a.expiresAt) && ready && <Button size="sm" onClick={connect} disabled={busy}>Connect again</Button>}
            <Button size="sm" variant="ghost" onClick={() => setGone(a)}>Disconnect</Button>
          </span>
        </div>
      ))}

      <details open={setupOpen} onToggle={(e) => setSetupOpen(e.currentTarget.open)}>
        <summary className="body-sm" style={{ cursor: "pointer" }}>{ready ? "Your app" : "Set up your app"}</summary>
        <div style={{ display: "grid", gap: "var(--space-3)", paddingTop: "var(--space-3)" }}>
          {redirect && <Field label={`Redirect to register with ${info.name}`}><CopyLine text={redirect} label={`the ${info.name} redirect`} /></Field>}
          {platform === "tiktok" && <Field label="If TikTok will not take the star" hint="This one, with the port knitted uses now. knitted keeps the same port from one launch to the next when it can."><CopyLine text={appCallback(cfg.port, "tiktok")} label="the TikTok redirect with its port" /></Field>}
          {!redirect && <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>Make the client a Desktop app: Google needs no redirect registered for one.</p>}
          <Field label={about.id} htmlFor={`so-${platform}-id`}>
            <Input id={`so-${platform}-id`} mono defaultValue={app.clientId} key={`id-${app.clientId}`} autoComplete="off" onBlur={(e) => e.target.value.trim() !== app.clientId && void save({ apps: { [platform]: { clientId: e.target.value } } })} />
          </Field>
          <Field label={about.secret} hint={app.secret ? "Saved in your computer's secret store. Type to replace." : "Kept in your computer's secret store, never in knitted's files."} htmlFor={`so-${platform}-secret`}>
            <div style={{ display: "flex", gap: 8 }}>
              <Input id={`so-${platform}-secret`} type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={app.secret ? "Saved" : "Paste it here"} />
              <Button disabled={!secret} onClick={async () => { if (await save({ apps: { [platform]: { clientSecret: secret } } })) { setSecret(""); toast("Saved."); } }}>Save</Button>
              {app.secret && <Button variant="ghost" onClick={() => void save({ apps: { [platform]: { clearSecret: true } } })}>Remove</Button>}
            </div>
          </Field>
        </div>
      </details>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Button variant={accounts.length ? "secondary" : "primary"} disabled={!ready || busy} onClick={connect}>{accounts.length ? `Connect another ${info.name} account` : `Connect ${info.name}`}</Button>
        {!ready && <span className="body-sm" style={{ color: "var(--ink-muted)" }}>Add your app&apos;s {about.id.toLowerCase()}{info.secretOptional ? "" : " and secret"} first.</span>}
      </div>
      {waiting && (
        <div style={{ display: "grid", gap: 6 }}>
          <p className="body-sm" style={{ margin: 0 }}>Sign in in your browser. It comes back to knitted by itself; if it shows a code instead, paste it here.</p>
          <div style={{ display: "flex", gap: 8 }}>
            <Input aria-label={`Code from ${info.name}'s sign-in`} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste what the page shows" />
            <Button disabled={!pasted.trim() || busy} onClick={finish}>Finish</Button>
          </div>
        </div>
      )}
      <ConfirmDialog open={!!gone} onOpenChange={(o) => !o && setGone(null)} title={`Disconnect ${gone?.handle ? `@${gone.handle}` : gone?.name ?? "this account"}?`}
        description={`knitted forgets its sign-in, and cancels its posts still to go out. Posted posts stay on ${info.name}. To take away the app's access there too, remove it in your ${info.name} settings.`} confirmLabel="Disconnect"
        onConfirm={async () => { await api.social.disconnect(gone!.id); toast("Disconnected."); }} />
    </section>
  );
}

function HostCard({ cfg, save }: { cfg: SocialConfigView; save: (b: Parameters<typeof api.social.save>[0]) => Promise<boolean> }) {
  const toast = useToast();
  const h = cfg.host;
  const [secret, setSecret] = useState("");
  const [testing, setTesting] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const s3 = (k: keyof typeof h.s3, label: string, hint?: string, placeholder?: string) => (
    <Field label={label} hint={hint} htmlFor={`host-${k}`}>
      <Input id={`host-${k}`} mono autoComplete="off" defaultValue={String(h.s3[k] ?? "")} key={`${k}-${h.s3[k]}`} placeholder={placeholder} onBlur={(e) => e.target.value.trim() !== h.s3[k] && void save({ host: { s3: { [k]: e.target.value } } })} />
    </Field>
  );
  const test = async () => { setTesting(true); setSaid(null); try { await api.social.testHost(); setSaid({ ok: true, text: "It works: a file went in, was read from its public address, and was taken away." }); } catch (e) { setSaid({ ok: false, text: (e as Error).message }); } finally { setTesting(false); } };
  return (
    <section aria-label="Media host" className="card" style={{ padding: "var(--space-4)", display: "grid", gap: "var(--space-3)" }}>
      <h3 className="h4" style={{ margin: 0 }}>Media host</h3>
      <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>Instagram and Threads take nothing sent to them: they fetch it from a public address. knitted puts each file in your own storage just before posting, and removes it straight after. The other platforms do not need this.</p>
      <SegmentedControl<"none" | "s3" | "filefreak"> label="Where files go" value={h.kind} onChange={(kind) => void save({ host: { kind } })}
        options={[{ value: "none", label: "None" }, { value: "s3", label: "A bucket" }, { value: "filefreak", label: "FileFreak" }]} />
      {h.kind === "s3" && (<>
        <p className="body-sm" style={{ margin: 0 }}>Any storage that speaks S3: Cloudflare R2, Amazon S3, Backblaze B2, DigitalOcean Spaces, MinIO. Its files have to be readable by anyone at their public address.</p>
        {s3("endpoint", "Address", "Leave it empty for Amazon S3.", "https://<account>.r2.cloudflarestorage.com")}
        {s3("bucket", "Bucket")}
        {s3("region", "Region", "auto for R2; the bucket's region elsewhere, like us-east-1.")}
        {s3("publicBase", "Public address", "Where its files are read by anyone: the bucket's public URL or your own domain on it.", "https://media.example.com")}
        {s3("keyId", "Access key ID")}
        <Field label="Secret access key" hint={h.s3.secret ? "Saved in your computer's secret store. Type to replace." : "Kept in your computer's secret store."} htmlFor="host-secret">
          <div style={{ display: "flex", gap: 8 }}>
            <Input id="host-secret" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={h.s3.secret ? "Saved" : "Paste it here"} />
            <Button disabled={!secret} onClick={async () => { if (await save({ host: { s3: { secret } } })) { setSecret(""); toast("Saved."); } }}>Save</Button>
          </div>
        </Field>
      </>)}
      {h.kind === "filefreak" && (<>
        <p className="body-sm" style={{ margin: 0 }}>A folder in your FileFreak account. Each file is made public for as long as the platform takes to fetch it. Your FileFreak public page has to be on.</p>
        <Field label="Folder" htmlFor="host-ff-folder"><Input id="host-ff-folder" defaultValue={h.filefreak.folder} key={h.filefreak.folder} onBlur={(e) => e.target.value.trim() !== h.filefreak.folder && void save({ host: { filefreak: { folder: e.target.value } } })} /></Field>
        <Field label="FileFreak API key" hint={h.filefreak.apiKey ? "Saved in your computer's secret store. Type to replace." : "An app's key from FileFreak's developer settings. Kept in your computer's secret store."} htmlFor="host-ff-key">
          <div style={{ display: "flex", gap: 8 }}>
            <Input id="host-ff-key" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={h.filefreak.apiKey ? "Saved" : "Paste it here"} />
            <Button disabled={!secret} onClick={async () => { if (await save({ host: { filefreak: { apiKey: secret } } })) { setSecret(""); toast("Saved."); } }}>Save</Button>
          </div>
        </Field>
      </>)}
      {h.kind !== "none" && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Button onClick={test} disabled={testing}>{testing ? "Testing..." : "Test"}</Button>
          {said && <span role={said.ok ? "status" : "alert"} className="body-sm" style={{ color: said.ok ? "var(--success)" : "var(--danger)", display: "flex", gap: 4, alignItems: "center" }}>{said.ok ? <Check size={13} aria-hidden /> : <AlertTriangle size={13} aria-hidden />} {said.text}</span>}
        </div>
      )}
    </section>
  );
}
