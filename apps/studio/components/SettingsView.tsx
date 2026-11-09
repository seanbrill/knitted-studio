"use client";

// Settings: one list of its parts in four groups, each saying how that part stands, beside one
// page of cards. `?tab=model` opens on one: where "Add a key" leads. The address is the page, so
// Back goes to the part before.

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback } from "react";
import { api } from "@knitted/core/client";
import { SegmentedControl, useTheme, type Theme, icons } from "@knitted/ui";
import { useLive } from "@/lib/hooks";
import { PageHeader } from "./AppShell";
import { StorageSettings, size } from "./StorageSettings";
import { RendererCard } from "./RendererCard";
import { ModelSettings } from "./ModelSettings";
import { SpendSettings } from "./SpendSettings";
import { VoiceSettings } from "./VoiceSettings";
import { SocialSettings, GUIDE } from "./SocialSettings";
import { StockSettings } from "./StockSettings";
import { GenerateSettings } from "./GenerateSettings";
import { SetCard, SetRow, useSettingsChanged } from "./SettingsParts";

const { ExternalLink } = icons;

type Pane = "appearance" | "storage" | "about" | "model" | "spending" | "generate" | "voice" | "stock" | "social";
const GROUPS: { name: string; panes: Pane[] }[] = [
  { name: "Studio", panes: ["appearance", "storage", "about"] },
  { name: "Your model", panes: ["model", "spending"] },
  { name: "Making", panes: ["generate", "voice", "stock"] },
  { name: "Posting", panes: ["social"] },
];
const PANES: Record<Pane, { label: string; title: string; lede: React.ReactNode }> = {
  appearance: { label: "Appearance", title: "Appearance", lede: "How the studio looks to you. The work you make is never affected." },
  storage: { label: "Storage and backups", title: "Storage and backups", lede: "Where your work lives on this computer, and the copies knitted keeps of its database." },
  about: { label: "About", title: "About", lede: "This copy of knitted.studio, and the browser it knits with." },
  model: { label: "Model", title: "Model", lede: "Your own Anthropic key lets your model edit patterns and knit posts with you, in Ask, the side bar and the editor. It follows the same locks you do. Or connect Claude Code, at the end of this page." },
  spending: { label: "Spending", title: "Spending", lede: "What your Anthropic key has spent through knitted: every answer from your model, priced as it comes in. A limit stops your model before it spends more. Work done from Claude Code is billed to Claude Code, and not counted here." },
  generate: { label: "Photos and video", title: "Make photos and video", lede: "With a key of your own, you and your model can make photos and short videos from a description and your own pictures, kept in Yarn. Each one is charged to your key, and counts toward your limits in Spending. Drawing as SVG and free stock need no key." },
  voice: { label: "Voice", title: "Voice", lede: "Voiceovers are made on your computer or a server you choose. Nothing is sent anywhere unless you point it there." },
  stock: { label: "Stock", title: "Free stock", lede: "Search free photos, videos and sounds on the Stock page, and add them to a project or the Library. Openverse works with no key. A free Pixabay key adds its photos and video. A key is only sent to its own site." },
  social: {
    label: "Social", title: "Social",
    lede: <>Post knits to your own accounts, now or at a time. Each network needs a developer app of your own, made once, so your sign-ins stay on this computer. <a className="link" href={GUIDE} target="_blank" rel="noreferrer">The guide</a> walks through each.</>,
  },
};
const IDS = Object.keys(PANES) as Pane[];

export function SettingsView() {
  return <Suspense><SettingsInner /></Suspense>;
}

function SettingsInner() {
  const asked = useSearchParams().get("tab");
  const tab: Pane = asked && (IDS as string[]).includes(asked) ? (asked as Pane) : "appearance";
  const notes = useNotes();
  const pane = PANES[tab];
  return (
    <div className="page">
      <PageHeader eyebrow="Settings" title="Make it yours" />
      <div className="settings">
        <nav aria-label="Settings" className="settings-nav">
          {GROUPS.map((g) => (
            <div key={g.name} className="settings-group" role="group" aria-labelledby={`set-g-${g.name}`}>
              <p className="settings-group-name" id={`set-g-${g.name}`}>{g.name}</p>
              {g.panes.map((id) => {
                const n = notes[id];
                return (
                  <Link key={id} href={`/settings?tab=${id}`} replace scroll={false} className="settings-link" aria-current={tab === id ? "page" : undefined}>
                    <span>{PANES[id].label}</span>
                    {n && <><span className="sr-only">, </span><span className="settings-note" data-tone={n.tone}>{n.text}</span></>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <section className="settings-pane" aria-labelledby="settings-title" key={tab}>
          <h2 className="h3" id="settings-title">{pane.title}</h2>
          <p className="body-sm settings-lede">{pane.lede}</p>
          {tab === "appearance" && <Appearance />}
          {tab === "storage" && <StorageSettings />}
          {tab === "about" && <About />}
          {tab === "model" && <ModelSettings />}
          {tab === "spending" && <SpendSettings />}
          {tab === "generate" && <GenerateSettings />}
          {tab === "voice" && <VoiceSettings />}
          {tab === "stock" && <StockSettings />}
          {tab === "social" && <SocialSettings />}
        </section>
      </div>
    </div>
  );
}

type Note = { text: string; tone?: "ok" | "warn" };
const VOICE: Record<string, string> = { system: "Built in", openai: "A voice server", piper: "Piper" };
const keys = (n: number) => (n === 1 ? "1 key" : `${n} keys`);

/** How each part stands, in a few words: read once, and again whenever something in Settings is saved. */
function useNotes(): Partial<Record<Pane, Note>> {
  const { theme } = useTheme();
  const { data, refresh } = useLive(async () => {
    const got = await Promise.allSettled([api.agent.config(), api.agent.usage(), api.generate.config(), api.voice.config(), api.stock.config(), api.social.accounts(), api.storage()]);
    const v = <T,>(r: PromiseSettledResult<T>) => (r.status === "fulfilled" ? r.value : null);
    return { model: v(got[0]), usage: v(got[1]), gen: v(got[2]), voice: v(got[3]), stock: v(got[4]), accounts: v(got[5]), storage: v(got[6]) };
  }, []);
  useSettingsChanged(useCallback(() => void refresh(), [refresh]));
  const out: Partial<Record<Pane, Note>> = { appearance: { text: theme === "night" ? "Night" : "Day" } };
  if (process.env.KNITTED_VERSION) out.about = { text: process.env.KNITTED_VERSION };
  if (!data) return out;
  if (data.storage) out.storage = { text: size(data.storage.bytes) };
  if (data.model) out.model = data.model.key.present ? { text: "Key saved", tone: "ok" } : { text: "No key yet" };
  if (data.usage) {
    const m = data.usage.month, l = data.usage.limits.monthly;
    out.spending = { text: l != null ? `$${Math.round(m)} of $${Math.round(l)}` : `$${Math.round(m)} this month`, tone: l != null && m >= l ? "warn" : undefined };
  }
  if (data.gen) { const n = data.gen.sources.filter((s) => s.key.present).length; out.generate = n ? { text: keys(n), tone: "ok" } : { text: "No key yet" }; }
  if (data.voice) out.voice = { text: VOICE[data.voice.provider] ?? data.voice.provider };
  if (data.stock) { const n = data.stock.sources.filter((s) => s.key?.present).length; out.stock = n ? { text: `Openverse and ${keys(n)}`, tone: "ok" } : { text: "No key needed" }; }
  if (data.accounts) { const n = data.accounts.length; out.social = n ? { text: `${n} connected`, tone: "ok" } : { text: "None connected" }; }
  return out;
}

function Appearance() {
  const { theme, setTheme } = useTheme();
  return (
    <SetCard label="Theme">
      <SetRow label="Theme" hint="Day is the default. Night is easier on the eyes in a dark room.">
        <SegmentedControl<Theme> label="Theme" value={theme} onChange={setTheme} options={[{ value: "day", label: "Day" }, { value: "night", label: "Night" }]} />
      </SetRow>
    </SetCard>
  );
}

function About() {
  return (
    <>
      <SetCard label="This copy">
        <SetRow label={`Version ${process.env.KNITTED_VERSION}`} hint="knitted.studio is open source under the MIT licence.">
          <a className="btn btn-secondary btn-sm" href="https://knitted.filefreak.page/changelog/" target="_blank" rel="noreferrer">What changed <ExternalLink size={12} aria-hidden /></a>
        </SetRow>
      </SetCard>
      <div className="set-card set-card-pad"><RendererCard /></div>
    </>
  );
}
