"use client";

// Settings, Social: the person's own developer app on each platform, the accounts signed in
// through it, the media host Instagram and Threads fetch from, and what their model may do.
// knitted has no server between the person and a platform, so each platform needs an app of
// their own, made once: the guide on the site walks through each. Six networks are six rows;
// one opens at a time, as three steps. `?network=x` opens one.

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { PLATFORMS, PLATFORM_IDS, appCallback, redirectToRegister, type Platform } from "@knitted/core";
import { api, type SocialAccount, type SocialConfigView } from "@knitted/core/client";
import { Button, ConfirmDialog, Field, Input, SegmentedControl, Switch, icons, useToast } from "@knitted/ui";
import { useLive } from "@/lib/hooks";
import { KeyField, SetCard, SetRow, settingsChanged, type KeyStatus } from "./SettingsParts";
import { PlatformMark } from "./PostDialog";

const { AlertTriangle, Check, ChevronRight, Copy, ExternalLink } = icons;
export const GUIDE = "https://knitted.filefreak.page/docs/social/";

/** What each platform calls its app's id and secret, and what knitted posts there. */
const ABOUT: Record<Platform, { id: string; secret: string; does: string; where?: string }> = {
  instagram: { id: "Instagram app ID", secret: "Instagram app secret", does: "Pictures, carousels of up to 10, and Reels. A tall picture goes to your Story. Needs a media host.",
    where: "In your Meta app, on the Instagram use case's page, API setup with Instagram login. Not the App ID in App settings: Instagram turns that one away as an invalid platform app." },
  tiktok: { id: "Client key", secret: "Client secret", does: "Videos. Until TikTok reviews your app, a post is seen only by you, and the account has to be private." },
  linkedin: { id: "Client ID", secret: "Client secret", does: "Words, pictures (up to 20 at once) and video, as you. A sign-in lasts 60 days." },
  threads: { id: "Threads app ID", secret: "Threads app secret", does: "Words, pictures, video and carousels. Needs a media host.",
    where: "In your Meta app, App settings, Basic, under the app's own App ID: the one named Threads app ID." },
  x: { id: "Client ID", secret: "Client secret (a web app's only)", does: "Words, up to 4 pictures, or a video. Each post is paid for from your X developer credits." },
  youtube: { id: "Client ID", secret: "Client secret", does: "Videos, and Shorts when upright. A post scheduled ahead is published by YouTube at its time, even with knitted closed." },
};
type Save = (b: Parameters<typeof api.social.save>[0]) => Promise<boolean>;
const SECRET_STORE = "your computer's secret store";
const secretStatus = (present: boolean): KeyStatus => ({ present, source: present ? "keychain" : "none", backend: SECRET_STORE, canStore: true });

export function SocialSettings() {
  const toast = useToast();
  const asked = useSearchParams().get("network");
  const [open, setOpen] = useState<Platform | null>(asked && (PLATFORM_IDS as string[]).includes(asked) ? (asked as Platform) : null);
  const { data: cfg, refresh } = useLive(() => api.social.config(), []);
  const { data: accounts } = useLive(() => api.social.accounts(), []);
  const [err, setErr] = useState<string | undefined>();
  if (!cfg) return null;
  const save: Save = async (b) => {
    try { await api.social.save(b); await refresh(); setErr(undefined); settingsChanged(); return true; } catch (e) { setErr((e as Error).message); toast.problem((e as Error).message); return false; }
  };
  return (
    <>
      {err && <p className="field-error" role="alert" style={{ marginBottom: "var(--space-3)" }}><AlertTriangle size={14} aria-hidden /> {err}</p>}
      <div className="set-card nets" role="group" aria-label="Networks">
        {PLATFORM_IDS.map((p) => (
          <Network key={p} platform={p} cfg={cfg} accounts={(accounts ?? []).filter((a) => a.platform === p)} save={save} open={open === p} onToggle={() => setOpen(open === p ? null : p)} />
        ))}
      </div>
      <HostCard cfg={cfg} save={save} />
      <SetCard label="Posting">
        <SetRow label="Let your model schedule posts" htmlFor="so-model" hint={cfg.modelMaySchedule ? "On: it can schedule and post for you. You can still cancel anything in a project's Posts." : "Off: it makes drafts, and you schedule them from a project's Posts."}>
          <Switch id="so-model" label="Let your model schedule posts" checked={cfg.modelMaySchedule} onCheckedChange={(v) => void save({ modelMaySchedule: v })} />
        </SetRow>
        <SetRow label="Keep knitted running when its window is closed" htmlFor="so-stay" hint={cfg.stayOpen ? "On: with posts still to go out, closing the window leaves knitted in the menu bar (the system tray on Windows and Linux) until the last one is out, then it quits. YouTube posts scheduled ahead go out without it." : "Off: closing the window quits knitted, and posts wait until you open it again. One due while it was closed goes out when it opens, if that is within two hours."}>
          <Switch id="so-stay" label="Keep knitted running when its window is closed" checked={cfg.stayOpen} onCheckedChange={(v) => void save({ stayOpen: v })} />
        </SetRow>
        <SetRow label="Ask X for numbers too" htmlFor="so-x" hint="knitted asks each platform how a post is doing an hour after it goes out, then after 6 hours, a day, 3 days, a week, 2 weeks and a month, for Posts and Insights. X takes credits from your developer account for each look: about 7 looks per post over its first month. LinkedIn gives no numbers to apps like this one.">
          <Switch id="so-x" label="Ask X for numbers too" checked={cfg.metricsX} onCheckedChange={(v) => void save({ metricsX: v })} />
        </SetRow>
      </SetCard>
    </>
  );
}

function CopyLine({ text, label }: { text: string; label: string }) {
  const toast = useToast();
  return (
    <div className="net-copy">
      <code className="mono">{text}</code>
      <Button size="sm" aria-label={`Copy ${label}`} onClick={async () => { try { await navigator.clipboard.writeText(text); toast("Copied."); } catch { toast("This window would not copy. Select the text and copy it."); } }}><Copy size={13} aria-hidden /> Copy</Button>
    </div>
  );
}

function Network({ platform, cfg, accounts, save, open, onToggle }: { platform: Platform; cfg: SocialConfigView; accounts: SocialAccount[]; save: Save; open: boolean; onToggle: () => void }) {
  const toast = useToast();
  const info = PLATFORMS[platform], about = ABOUT[platform];
  const app = cfg.apps[platform];
  const [waiting, setWaiting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState<SocialAccount | null>(null);
  const ready = !!app.clientId && (app.secret || !!info.secretOptional);
  const redirect = redirectToRegister(platform, cfg.port);
  const connect = async () => {
    setBusy(true);
    try { const { url } = await api.social.connect(platform); window.open(url, "_blank", "noopener"); setWaiting(true); }
    catch (e) { toast.problem((e as Error).message); } finally { setBusy(false); }
  };
  const finish = async () => {
    setBusy(true);
    try { const a = await api.social.paste(pasted); setPasted(""); setWaiting(false); settingsChanged(); toast(`${info.name} is connected${a.handle ? ` as @${a.handle}` : ""}.`); }
    catch (e) { toast.problem((e as Error).message); } finally { setBusy(false); }
  };
  const who = (a: SocialAccount) => (a.handle ? `@${a.handle}` : a.name);
  const again = accounts.some((a) => a.status === "reconnect");
  // Closed, it says who is connected; open, the accounts are listed under it, so it says how many.
  const status = accounts.length
    ? (open || accounts.length > 1 ? `${accounts.length} connected` : `${who(accounts[0])}${again ? ", connect it again" : ""}`)
    : ready ? "Ready to connect" : "Not set up";
  const tone = again ? "warn" : accounts.length ? "ok" : ready ? "ready" : undefined;
  const throwing = (b: Parameters<Save>[0]) => async () => { if (!(await save(b))) throw new Error("It was not saved."); };
  return (
    <section aria-label={info.name} className="net" data-open={open || undefined}>
      <button type="button" className="net-head" aria-expanded={open} aria-controls={`net-${platform}`} onClick={onToggle}>
        <PlatformMark p={platform} />
        <span className="net-words"><span className="net-name">{info.name}</span><span className="net-does">{about.does}</span></span>
        <span className="net-status" data-tone={tone}>{status}</span>
        <ChevronRight size={16} aria-hidden className="net-chev" />
      </button>
      {open && (
        <div className="net-body" id={`net-${platform}`}>
          <ol className="net-steps">
            <li>
              <p className="net-step">{redirect ? `Register this redirect in your ${info.name} app` : "Make your client a Desktop app"}</p>
              {redirect ? <CopyLine text={redirect} label={`the ${info.name} redirect`} /> : <p className="body-sm net-say">Google needs no redirect registered for one.</p>}
              {platform === "tiktok" && <>
                <p className="body-sm net-say">If TikTok will not take the star, this one, with the port knitted uses now. knitted keeps the same port from one launch to the next when it can.</p>
                <CopyLine text={appCallback(cfg.port, "tiktok")} label="the TikTok redirect with its port" />
              </>}
            </li>
            <li>
              <p className="net-step">Give knitted your app</p>
              <div className="net-app">
                <Field label={about.id} hint={about.where} htmlFor={`so-${platform}-id`}>
                  <Input id={`so-${platform}-id`} mono defaultValue={app.clientId} key={`id-${app.clientId}`} autoComplete="off" onBlur={(e) => e.target.value.trim() !== app.clientId && void save({ apps: { [platform]: { clientId: e.target.value } } })} />
                </Field>
                <Field label={about.secret} htmlFor={`so-${platform}-secret`}>
                  <KeyField id={`so-${platform}-secret`} label={`${info.name} app secret`} noun="secret" status={secretStatus(app.secret)}
                    onSave={(clientSecret) => throwing({ apps: { [platform]: { clientSecret } } })()}
                    onRemove={throwing({ apps: { [platform]: { clearSecret: true } } })} />
                </Field>
              </div>
            </li>
            <li>
              <p className="net-step">Connect an account</p>
              {accounts.map((a) => (
                <div key={a.id} className="net-account">
                  {a.avatar ? <img src={a.avatar} alt="" width={28} height={28} referrerPolicy="no-referrer" /> : <span aria-hidden className="net-avatar" />}
                  <span className="body-sm"><strong>{a.name || a.handle}</strong>{a.handle && a.name ? ` @${a.handle}` : ""}</span>
                  {a.status === "reconnect"
                    ? <span className="body-sm net-warn"><AlertTriangle size={13} aria-hidden /> {a.note ?? "Connect it again."}</span>
                    : <span className="body-sm key-said"><Check size={13} aria-hidden /> Connected{a.expiresAt ? `, until ${new Date(a.expiresAt).toLocaleDateString()}` : ""}</span>}
                  <span className="net-account-actions">
                    {(a.status === "reconnect" || a.expiresAt) && ready && <Button size="sm" onClick={connect} busy={busy}>Connect again</Button>}
                    <Button size="sm" variant="ghost" onClick={() => setGone(a)}>Disconnect</Button>
                  </span>
                </div>
              ))}
              <div className="net-connect">
                <Button variant={accounts.length ? "secondary" : "primary"} disabled={!ready || busy} onClick={connect}>{accounts.length ? `Connect another ${info.name} account` : `Connect ${info.name}`}</Button>
                {!ready && <span className="body-sm net-say">Add the {/^Client/.test(about.id) ? about.id.toLowerCase() : about.id}{info.secretOptional ? "" : " and secret"} first.</span>}
                <a className="link body-sm" href={`${GUIDE}#${platform}`} target="_blank" rel="noreferrer">How to set it up <ExternalLink size={12} aria-hidden /></a>
              </div>
              {waiting && (
                <div className="net-wait">
                  <p className="body-sm" style={{ margin: 0 }}>Sign in in your browser. It comes back to knitted by itself; if it shows a code instead, paste it here.</p>
                  <div className="key-row">
                    <Input aria-label={`Code from ${info.name}'s sign-in`} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste what the page shows" />
                    <Button disabled={!pasted.trim() || busy} onClick={finish}>Finish</Button>
                  </div>
                </div>
              )}
            </li>
          </ol>
        </div>
      )}
      <ConfirmDialog open={!!gone} onOpenChange={(o) => !o && setGone(null)} title={`Disconnect ${gone?.handle ? `@${gone.handle}` : gone?.name ?? "this account"}?`}
        description={`knitted forgets its sign-in, and cancels its posts still to go out. Posted posts stay on ${info.name}. To take away the app's access there too, remove it in your ${info.name} settings.`} confirmLabel="Disconnect"
        onConfirm={async () => { await api.social.disconnect(gone!.id); settingsChanged(); toast("Disconnected."); }} />
    </section>
  );
}

function HostCard({ cfg, save }: { cfg: SocialConfigView; save: Save }) {
  const h = cfg.host;
  const [testing, setTesting] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const throwing = (b: Parameters<Save>[0]) => async () => { if (!(await save(b))) throw new Error("It was not saved."); };
  const s3 = (k: keyof typeof h.s3, label: string, hint?: string, placeholder?: string) => (
    <SetRow stack label={label} hint={hint} htmlFor={`host-${k}`}>
      <Input id={`host-${k}`} mono autoComplete="off" defaultValue={String(h.s3[k] ?? "")} key={`${k}-${h.s3[k]}`} placeholder={placeholder} onBlur={(e) => e.target.value.trim() !== h.s3[k] && void save({ host: { s3: { [k]: e.target.value } } })} />
    </SetRow>
  );
  const test = async () => { setTesting(true); setSaid(null); try { await api.social.testHost(); setSaid({ ok: true, text: "It works: a file went in, was read from its public address, and was taken away." }); } catch (e) { setSaid({ ok: false, text: (e as Error).message }); } finally { setTesting(false); } };
  return (
    <SetCard title="Media host" actions={h.kind !== "none" ? <Button size="sm" onClick={test} disabled={testing}>{testing ? "Testing..." : "Test"}</Button> : undefined}>
      <SetRow label="Where files go" hint="Instagram and Threads take nothing sent to them: they fetch it from a public address. knitted puts each file in your own storage just before posting, and removes it straight after. The other platforms do not need this.">
        <SegmentedControl<"none" | "s3" | "filefreak"> label="Where files go" value={h.kind} onChange={(kind) => void save({ host: { kind } })}
          options={[{ value: "none", label: "None" }, { value: "s3", label: "A bucket" }, { value: "filefreak", label: "FileFreak" }]} />
      </SetRow>
      {said && <p role={said.ok ? "status" : "alert"} className={`body-sm set-error ${said.ok ? "key-said" : "field-error"}`}>{said.ok ? <Check size={13} aria-hidden /> : <AlertTriangle size={13} aria-hidden />} {said.text}</p>}
      {h.kind === "s3" && (<>
        <SetRow label="A bucket" hint="Any storage that speaks S3: Cloudflare R2, Amazon S3, Backblaze B2, DigitalOcean Spaces, MinIO. Its files have to be readable by anyone at their public address." />
        {s3("endpoint", "Address", "Leave it empty for Amazon S3.", "https://<account>.r2.cloudflarestorage.com")}
        {s3("bucket", "Bucket")}
        {s3("region", "Region", "auto for R2; the bucket's region elsewhere, like us-east-1.")}
        {s3("publicBase", "Public address", "Where its files are read by anyone: the bucket's public URL or your own domain on it.", "https://media.example.com")}
        {s3("keyId", "Access key ID")}
        <SetRow stack label="Secret access key" htmlFor="host-secret">
          <KeyField id="host-secret" label="Secret access key" status={secretStatus(h.s3.secret)}
            onSave={(secret) => throwing({ host: { s3: { secret } } })()} />
        </SetRow>
      </>)}
      {h.kind === "filefreak" && (<>
        <SetRow label="A FileFreak folder" hint="A folder in your FileFreak account. Each file is made public for as long as the platform takes to fetch it. Your FileFreak public page has to be on." />
        <SetRow stack label="Folder" htmlFor="host-ff-folder">
          <Input id="host-ff-folder" defaultValue={h.filefreak.folder} key={h.filefreak.folder} onBlur={(e) => e.target.value.trim() !== h.filefreak.folder && void save({ host: { filefreak: { folder: e.target.value } } })} />
        </SetRow>
        <SetRow stack label="FileFreak API key" htmlFor="host-ff-key" hint="An app's key from FileFreak's developer settings.">
          <KeyField id="host-ff-key" label="FileFreak API key" status={secretStatus(h.filefreak.apiKey)}
            onSave={(apiKey) => throwing({ host: { filefreak: { apiKey } } })()} />
        </SetRow>
      </>)}
    </SetCard>
  );
}
