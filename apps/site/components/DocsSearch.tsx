"use client";

import Link from "next/link";
import { useRef, useState } from "react";

interface Entry { slug: string; title: string; summary: string; text: string }

/** Client-side search over the JSON index built from the markdown. Loaded on first focus. */
export function DocsSearch() {
  const [index, setIndex] = useState<Entry[] | null>(null);
  const [q, setQ] = useState("");
  const loading = useRef(false);

  async function load() {
    if (index || loading.current) return;
    loading.current = true;
    try {
      const r = await fetch("/docs/search-index.json");
      setIndex((await r.json()) as Entry[]);
    } catch {
      setIndex([]);
    }
  }

  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const results =
    index && terms.length
      ? index
          .map((e) => {
            const title = e.title.toLowerCase();
            const hay = `${e.summary} ${e.text}`.toLowerCase();
            let score = 0;
            for (const t of terms) {
              if (title.includes(t)) score += 10;
              if (hay.includes(t)) score += 1;
              else if (!title.includes(t)) return { e, score: -1 };
            }
            return { e, score };
          })
          .filter((r) => r.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 6)
      : [];

  return (
    <div className="docs-search" role="search">
      <label htmlFor="docs-q" className="eyebrow">Search the docs</label>
      <input
        id="docs-q"
        type="search"
        value={q}
        placeholder="Try: locked, voice, MCP"
        autoComplete="off"
        onFocus={load}
        onChange={(e) => setQ(e.target.value)}
      />
      <div aria-live="polite" className="search-results">
        {terms.length > 0 && index && results.length === 0 ? <p className="body-sm muted">Nothing found. Try another word.</p> : null}
        {results.length > 0 ? (
          <ul>
            {results.map(({ e }) => (
              <li key={e.slug}>
                <Link href={`/docs/${e.slug}/`}>
                  <span className="label">{e.title}</span>
                  <span className="body-sm muted">{e.summary}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
