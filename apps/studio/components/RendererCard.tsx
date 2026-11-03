"use client";

import { useEffect } from "react";
import { useLive } from "@/lib/hooks";
import { Button, useToast } from "@knitted/ui";

type State = { ready: boolean; install: { state: "running" | "done" | "failed"; log: string } | null };

/** Knitting draws with a browser that is not bundled. This is where someone says yes to downloading it. */
export function RendererCard() {
  const toast = useToast();
  const { data: s, refresh: load } = useLive<State>(async () => (await fetch("/api/renderer")).json(), []);
  useEffect(() => {
    if (s?.install?.state !== "running") return;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [s?.install?.state]);
  useEffect(() => { if (s?.install?.state === "done") toast("The browser for knitting is ready."); }, [s?.install?.state]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return null;
  const running = s.install?.state === "running";
  return (
    <section style={{ marginTop: "var(--space-6)", display: "grid", gap: 8, maxWidth: 520 }} aria-label="Browser for knitting">
      <h2 className="h3" style={{ margin: 0 }}>Browser for knitting</h2>
      {s.ready ? <p className="body-sm" style={{ margin: 0 }}>Installed. Knitting is ready.</p> : (
        <>
          <p className="body-sm" style={{ margin: 0, color: "var(--ink-muted)" }}>Knitting draws your posts with a small browser, about 100 MB, downloaded once and kept in your data folder.</p>
          <div><Button variant="primary" onClick={async () => { await fetch("/api/renderer", { method: "POST" }); await load(); }} disabled={running}>{running ? "Downloading..." : "Download it"}</Button></div>
          {s.install?.state === "failed" && <p className="field-error" role="alert">The download did not finish. Check your internet connection and try again.</p>}
        </>
      )}
    </section>
  );
}
