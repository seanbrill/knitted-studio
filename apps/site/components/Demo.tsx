"use client";

import { useState, useSyncExternalStore } from "react";
import { PostArt } from "./PostArt";

const SIZES = [
  { name: "Story", aspect: "9 / 16", h: 150 },
  { name: "Square", aspect: "1 / 1", h: 104 },
  { name: "Portrait", aspect: "4 / 5", h: 120 },
  { name: "Wide", aspect: "16 / 9", h: 78 },
  { name: "Pin", aspect: "2 / 3", h: 140 },
  { name: "Banner", aspect: "3 / 1", h: 48 },
];

const START = "Make it knitted.";

/**
 * The product in ten seconds. No backend: click a locked stitch and it refuses
 * politely; edit the free headline and six sizes follow. Without JavaScript the
 * server-rendered start state stays on the page as a static picture.
 */
export function Demo() {
  const [headline, setHeadline] = useState(START);
  const [message, setMessage] = useState("");
  // False on the server and during hydration, true afterwards: the page is a static picture until JS runs.
  const live = useSyncExternalStore(() => () => {}, () => true, () => false);

  const shown = headline.trim() === "" ? START : headline;

  return (
    <div className="demo" data-live={live ? "true" : "false"}>
      <div className="demo-stage">
        <figure className="demo-main">
          <PostArt
            theme="ember"
            layout="headline"
            eyebrow="New this week"
            headline={shown}
            tag="Pattern: Launch story"
            aspect="1 / 1"
            alt="Sample post. The headline is free to change. The logo, brand colour and footer line are locked."
            onLocked={live ? (n) => setMessage(`The ${n.toLowerCase()} is locked by the pattern. Your model cannot change it either. Unlock it in the studio.`) : undefined}
          />
          <figcaption className="body-sm muted">
            <span className="key key-locked" aria-hidden="true" /> Dashed means locked.
            <span className="key key-free" aria-hidden="true" /> Solid means free.
          </figcaption>
        </figure>

        <div className="demo-side">
          <div className="demo-controls">
            <label htmlFor="demo-headline" className="eyebrow">Headline (free to change)</label>
            <input
              id="demo-headline"
              className="field"
              value={headline}
              maxLength={48}
              onChange={(e) => setHeadline(e.target.value)}
            />
            <p className="body-sm muted">Try clicking the logo, the colour dot or the footer line on the post.</p>
            <p className="demo-message body" role="status" aria-live="polite">{message}</p>
          </div>
          <p className="demo-static body">
            In the studio, the logo, colour and footer line are locked, and the headline is free. Change the headline once and every size follows.
          </p>
        </div>
      </div>

      <ul className="demo-sizes" aria-label="Six sizes, one headline">
        {SIZES.map((s) => (
          <li key={s.name}>
            <PostArt
              theme="ember"
              layout="headline"
              eyebrow="New this week"
              headline={shown}
              tag="Pattern: Launch story"
              aspect={s.aspect}
              alt={`${s.name} size with the headline ${shown}`}
              style={{ height: s.h }}
            />
            <span className="eyebrow">{s.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
