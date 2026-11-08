import type { Metadata } from "next";
import { OAuthHandoff } from "../../components/OAuthHandoff";

// Registered as the redirect with Instagram, Threads, LinkedIn and X (docs/user/social.md).
// Not a page to find: it is only ever reached from a platform's sign-in.
export const metadata: Metadata = {
  title: "Connecting to knitted",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function OAuth() {
  return (
    <section className="sec-tight">
      <div className="wrap-narrow doc">
        <h1>Connecting to knitted</h1>
        <OAuthHandoff />
      </div>
    </section>
  );
}
