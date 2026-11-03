import Link from "next/link";
import { Mark, Wordmark } from "./Logo";
import { NAV } from "../lib/site";

/** Glass nav on a brand field: warm black at 45% with a 16px blur, inset from the edges. */
export function Nav() {
  return (
    <header className="nav">
      <Link href="/" className="nav-brand" aria-label="knitted.studio, home">
        <Mark size={28} />
        <Wordmark />
      </Link>
      <nav aria-label="Main" className="nav-links">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href}>{n.label}</Link>
        ))}
      </nav>
      <details className="nav-menu">
        <summary aria-label="Menu">Menu</summary>
        <nav aria-label="Mobile">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href}>{n.label}</Link>
          ))}
        </nav>
      </details>
    </header>
  );
}
