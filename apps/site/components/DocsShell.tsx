import Link from "next/link";
import type { Doc } from "../lib/docs";
import { DocsSearch } from "./DocsSearch";

/** The docs frame: search and the page list on the left, content on the right. */
export function DocsShell({ docs, current, children }: { docs: Doc[]; current?: string; children: React.ReactNode }) {
  const list = (
    <ul>
      {docs.map((d) => (
        <li key={d.slug}>
          <Link href={`/docs/${d.slug}/`} aria-current={d.slug === current ? "page" : undefined}>{d.title}</Link>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="docs-layout">
      <aside className="docs-side" aria-label="Docs navigation">
        <DocsSearch />
        <nav aria-label="Docs pages" className="docs-pages-desktop">{list}</nav>
        <details className="docs-pages-mobile">
          <summary>All docs pages</summary>
          <nav aria-label="Docs pages, mobile">{list}</nav>
        </details>
      </aside>
      <div>{children}</div>
    </div>
  );
}
