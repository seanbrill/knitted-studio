"use client";

import { useEffect, useState } from "react";
import { useLive } from "@/lib/hooks";
import { Button, useToast } from "@knitted/ui";

type State = { ready: boolean; install: { state: "running" | "done" | "failed"; progress: number | null; error?: string } | null };

/**
 * Knitting draws with a browser that is not bundled. The desktop app downloads it by
 * itself when it first starts; this card says how that is going, in Settings, About and in
 * the Knit dialog (missingOnly), which shows it only while the browser is not there and is
 * told through onReady when it is. After an attempt that failed, it offers Try again.
 */
export function RendererCard({ missingOnly = false, onReady }: { missingOnly?: boolean; onReady?: (ready: boolean) => void }) {
  const toast = useToast();
  // Once shown, it stays to say the download worked, rather than vanishing.
  const [missing, setMissing] = useState(false);
  const { data: s, refresh: load } = useLive<State>(async () => {
    const r: State = await (await fetch("/api/renderer")).json();
    if (!r.ready) setMissing(true);
    onReady?.(r.ready);
    return r;
  }, []);
  const [startError, setStartError] = useState<string | null>(null);
  useEffect(() => {
    if (s?.install?.state !== "running") return;
    const t = setInterval(load, 1000);
    return () => clearInterval(t);
  }, [s?.install?.state]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (s?.install?.state === "done") toast("The browser for knitting is ready."); }, [s?.install?.state]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s || (missingOnly && s.ready && !missing)) return null;
  const running = s.install?.state === "running";
  const failed = s.install?.state === "failed";
  const progress = s.install?.progress ?? null;
  const start = async () => {
    setStartError(null);
    const res = await fetch("/api/renderer", { method: "POST" });
    if (!res.ok) setStartError((await res.json().catch(() => null))?.error?.message ?? "The download could not start.");
    await load();
  };
  return (
    <section style={{ marginTop: missingOnly ? 0 : "var(--space-6)", display: "grid", gap: 8, maxWidth: 520 }} aria-label="Browser for knitting">
      <h2 className="h3" style={{ margin: 0 }}>Browser for knitting</h2>
      <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>
        Everything you see in the studio draws in this window, without it. Knitting, which makes the files you post, draws each frame in a separate browser, so every copy comes out the same. Your model uses it to see a Pattern, too.
      </p>
      {s.ready ? <p className="body-sm" style={{ margin: 0 }}>Installed. Knitting is ready.</p> : (
        <>
          <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>
            {running ? "knitted is downloading it now: about 100 MB, once, kept in your data folder. You can knit when it is done." : "It is about 100 MB, downloaded once and kept in your data folder."}
          </p>
          {!running && <div><Button variant="primary" onClick={start}>{failed || startError ? "Try again" : "Download it"}</Button></div>}
          {running && (
            <div style={{ display: "grid", gap: 4 }}>
              <div role="progressbar" aria-label="Downloading the browser for knitting" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress === null ? undefined : Math.round(progress * 100)}
                style={{ height: 4, background: "var(--line)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: `${Math.max(4, (progress ?? 0) * 100)}%`, height: "100%", background: "var(--ember)", borderRadius: 2, transition: "width 300ms linear" }} />
              </div>
              <span className="body-sm" style={{ color: "var(--ink-muted)" }}>{progress === null ? "Starting the download..." : `Downloading, ${Math.round(progress * 100)}%`}</span>
            </div>
          )}
          {(startError || s.install?.state === "failed") && (
            <p className="field-error" role="alert" style={{ margin: 0 }}>
              {startError ?? s.install?.error ?? "The download did not finish. Check your internet connection and try again."}
            </p>
          )}
        </>
      )}
    </section>
  );
}
