import Link from "next/link";
import { PageHero } from "../components/PageHero";

export const metadata = { title: "Page not found", robots: { index: false } };

export default function NotFound() {
  return (
    <>
      <PageHero eyebrow="Error 404" title="Dropped a stitch." lead="That page is not here. It may have moved, or it may never have been knitted." />
      <section className="sec-tight">
        <div className="wrap not-found">
          <Link href="/" className="btn btn-primary btn-lg">Back to the start</Link>
        </div>
      </section>
    </>
  );
}
