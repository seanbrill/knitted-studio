import Link from "next/link";
import { Wordmark } from "./Logo";
import { ChevronRow } from "./Chevrons";
import { GITHUB } from "../lib/site";

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap footer-grid">
        <div>
          <p className="footer-word"><Wordmark /></p>
          <p className="body-sm muted">Open source. Free forever. MIT licensed.</p>
          <ChevronRow count={5} className="footer-chev" />
        </div>
        <nav aria-label="Product">
          <p className="eyebrow">Product</p>
          <Link href="/features/">Features</Link>
          <Link href="/how-it-works/">How it works</Link>
          <Link href="/gallery/">Gallery</Link>
          <Link href="/mcp/">Use your model</Link>
          <Link href="/download/">Download</Link>
        </nav>
        <nav aria-label="Learn">
          <p className="eyebrow">Learn</p>
          <Link href="/docs/">Docs</Link>
          <Link href="/changelog/">Changelog</Link>
          <Link href="/download/install/">Install guide</Link>
        </nav>
        <nav aria-label="Project">
          <p className="eyebrow">Project</p>
          <a href={GITHUB}>GitHub</a>
          <Link href="/open-source/">Open source</Link>
          <a href={`${GITHUB}/blob/main/LICENSE`}>Licence</a>
          <Link href="/privacy/">Privacy</Link>
        </nav>
      </div>
    </footer>
  );
}
