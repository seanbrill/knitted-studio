"use client";

// The studio's own model finishing, said wherever the person is: a note in the app on any page,
// and a notification from the system while knitted is behind another window. Not for a run the
// person is watching in its chat, and not for one that ended before the page opened.

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Switch, useToast } from "@knitted/ui";
import { SetCard, SetRow } from "./SettingsParts";
import { chatOnScreen, useAgent } from "@/lib/agent";

const APP_KEY = "knitted.done.app";
const SYSTEM_KEY = "knitted.done.system";
const read = (k: string) => { try { return localStorage.getItem(k) !== "off"; } catch { return true; } };
const write = (k: string, on: boolean) => { try { localStorage.setItem(k, on ? "on" : "off"); } catch { /* kept for this visit */ } };

/** The first line of what it said last, short enough for a note. */
const gist = (text: string) => {
  const line = text.trim().split("\n").map((l) => l.replace(/^[#>*\-\s]+/, "").trim()).find(Boolean) ?? "";
  return line.length > 140 ? `${line.slice(0, 137).trimEnd()}...` : line;
};

/** Ask once for leave to send notifications, where it is not given yet. */
export function askToNotify() {
  try { if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission(); } catch { /* not here */ }
}

export function ModelDone() {
  const s = useAgent();
  const toast = useToast();
  const router = useRouter();
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!s) return;
    const ended = (s.live ?? []).filter((l) => l.ended);
    // What had ended before this page opened was seen already, or is old news.
    if (!seen.current) { seen.current = new Set(ended.map((l) => l.jobId)); return; }
    for (const l of ended) {
      if (seen.current.has(l.jobId)) continue;
      seen.current.add(l.jobId);
      const away = document.hidden || !document.hasFocus();
      if (l.chatId && chatOnScreen(l.chatId) && !away) continue;
      const title = l.ended === "done" ? `${l.client} is done` : l.ended === "failed" ? `${l.client} could not finish` : `${l.client} stopped`;
      const said = l.ended === "done" && l.kind === "text" ? gist(l.text) : l.ended === "failed" ? "The chat says why." : "";
      const open = () => { window.focus(); if (l.chatId) router.push(`/ask?chat=${l.chatId}`); };
      if (read(APP_KEY)) toast(said ? `${title}: ${said}` : `${title}.`, l.chatId ? { label: "Open the chat", onClick: open } : undefined, 15_000);
      if (away && read(SYSTEM_KEY)) {
        try {
          if ("Notification" in window && Notification.permission === "granted") {
            const n = new Notification(title, { body: said || "Open knitted to see what it did.", tag: l.jobId });
            n.onclick = () => { open(); n.close(); };
          } else askToNotify();
        } catch { /* no notifications here */ }
      }
    }
  }, [s, toast, router]);
  return null;
}

/** In Settings: whether the person is told, and how. */
export function DoneSettings() {
  const [app, setApp] = useState(true);
  const [system, setSystem] = useState(true);
  useEffect(() => {
    // Read after mount on purpose: the server cannot know these.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setApp(read(APP_KEY)); setSystem(read(SYSTEM_KEY));
  }, []);
  return (
    <SetCard title="When your model finishes">
      <SetRow label="Say so in the app, on any page" hint="With what it said last, and a way to its chat." htmlFor="done-app">
        <Switch id="done-app" label="Say so in the app, on any page" checked={app} onCheckedChange={(on) => { setApp(on); write(APP_KEY, on); }} />
      </SetRow>
      <SetRow label="Send a notification while knitted is in the background" hint="From your computer, so you can work in another app meanwhile." htmlFor="done-system">
        <Switch id="done-system" label="Send a notification while knitted is in the background" checked={system} onCheckedChange={(on) => { setSystem(on); write(SYSTEM_KEY, on); if (on) askToNotify(); }} />
      </SetRow>
    </SetCard>
  );
}
