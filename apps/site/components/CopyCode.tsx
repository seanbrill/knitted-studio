"use client";

import { useEffect } from "react";

/** Adds a Copy button to every code block inside the element with the given id. */
export function CopyCode({ targetId }: { targetId: string }) {
  useEffect(() => {
    const root = document.getElementById(targetId);
    if (!root) return;
    const cleanups: (() => void)[] = [];
    root.querySelectorAll("pre").forEach((pre) => {
      pre.tabIndex = 0;
      if (pre.parentElement?.classList.contains("code-wrap")) return;
      const wrap = document.createElement("div");
      wrap.className = "code-wrap";
      pre.replaceWith(wrap);
      wrap.appendChild(pre);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "copy-btn";
      btn.textContent = "Copy";
      const onClick = async () => {
        try {
          await navigator.clipboard.writeText(pre.textContent ?? "");
          btn.textContent = "Copied";
        } catch {
          btn.textContent = "Press Ctrl+C";
        }
        setTimeout(() => (btn.textContent = "Copy"), 1600);
      };
      btn.addEventListener("click", onClick);
      wrap.appendChild(btn);
      cleanups.push(() => btn.removeEventListener("click", onClick));
    });
    return () => cleanups.forEach((c) => c());
  }, [targetId]);
  return null;
}
