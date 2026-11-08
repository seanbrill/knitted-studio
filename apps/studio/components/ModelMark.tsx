"use client";

// Where a model works, on any card in the studio: the thing outlined in the model's colour, with
// who it is and what it is doing. Following it, the one it is on now is brought into view.

import { useEffect, useRef } from "react";
import type { Mark } from "@/lib/agent";
import { useFollow } from "@/lib/follow";

/** Inside a card that is position: relative. `lead`: the one the model is on now, of those marked. */
export function ModelMark({ mark, lead = false }: { mark?: Mark | null; lead?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const following = useFollow((f) => f.on);
  useEffect(() => {
    if (!mark || !lead || !following) return;
    ref.current?.parentElement?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [mark?.at, lead, following]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!mark) return null;
  return (
    <span ref={ref} aria-hidden className="model-on" data-testid="model-on" data-running={mark.running || undefined}>
      <span className="model-tag model-on-tag">
        {mark.running && <span className="working model-tag-dot" />}
        <strong>{mark.who}</strong>
        <span className="model-tag-what">{mark.what}</span>
      </span>
    </span>
  );
}
