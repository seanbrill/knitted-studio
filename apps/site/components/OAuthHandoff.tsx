"use client";

// The page Instagram, Threads, LinkedIn and X send the browser back to after the person
// signs in. They need an https address, and the knitted app has none: it runs on the
// person's own computer. So this page hands what came back to the app, at
// http://127.0.0.1:<port>, the port read from the `state` the app made. Nothing is sent
// anywhere else, and this page keeps nothing. If the browser will not go there, the person
// copies what came back and pastes it into the app.

import { useEffect, useState, useSyncExternalStore } from "react";

const none = () => () => {};
/** What came back, on the person's computer only: the page is built without it. */
const useSearch = () => useSyncExternalStore(none, () => window.location.search, () => null);
/** Whether this tab already went on to knitted with this sign-in: then the person pressed
 * Back, most likely because knitted was not open, and the page shows the code instead. */
const useTried = (key: string) => useSyncExternalStore(none, () => sessionStorage.getItem(key), () => null);

export function OAuthHandoff() {
  const search = useSearch();
  const [copied, setCopied] = useState(false);
  const q = new URLSearchParams(search ?? "");
  const port = Number((q.get("state") ?? "").split(".")[1]);
  const fine = !!(q.get("code") || q.get("error")) && Number.isInteger(port) && port >= 1024 && port <= 65535;
  const to = fine ? `http://127.0.0.1:${port}/api/social/callback${search}` : null;
  const key = `knitted-oauth:${q.get("state")}`;
  const tried = useTried(key);

  // assign, not replace: if knitted is closed the browser shows its own error, and Back
  // has to come here, to the code.
  useEffect(() => {
    if (!to || tried) return;
    sessionStorage.setItem(key, "1");
    window.location.assign(to);
  }, [to, tried, key]);

  if (search === null) return <p className="lead">One moment.</p>;
  if (!fine) return (
    <>
      <p className="lead">This page finishes connecting an account to knitted.</p>
      <p>Open knitted, go to Settings, Social, and press Connect. The platform sends you back here, and this page hands you on to knitted.</p>
    </>
  );
  return (
    <>
      <p className="lead">{tried ? "Did knitted not open? Check it is running, then try again." : q.get("error") ? "Taking you back to knitted to say it did not connect." : "Taking you back to knitted to finish connecting."}</p>
      {tried && to && <p><a className="btn btn-primary" href={to}>Try again</a></p>}
      <p>{tried ? "Or copy this" : "If knitted does not open in a few seconds, copy this"} and paste it into knitted, in Settings, Social, where it asks for a code:</p>
      <div className="code-wrap">
        <pre aria-label="The code to paste into knitted" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{search}</pre>
        <button type="button" className="copy-btn" onClick={async () => { try { await navigator.clipboard.writeText(search); setCopied(true); } catch { /* the person can select it */ } }}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <p className="body-sm">It works once, for a few minutes, and only with what knitted kept on your computer when you pressed Connect.</p>
    </>
  );
}
