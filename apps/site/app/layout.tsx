import type { Metadata, Viewport } from "next";
import "@knitted/ui/globals.css";
import "./site.css";
import { Footer } from "../components/Footer";
import { GITHUB, SITE_NAME, SITE_URL, TAGLINE } from "../lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "knitted.studio: make it knitted", template: `%s | ${SITE_NAME}` },
  description: TAGLINE,
  applicationName: SITE_NAME,
  authors: [{ name: "knitted.studio", url: GITHUB }],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: "knitted.studio: make it knitted",
    description: TAGLINE,
    url: "/",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Make it knitted. on an orange field." }],
  },
  twitter: { card: "summary_large_image", title: "knitted.studio: make it knitted", description: TAGLINE, images: ["/og.png"] },
};

export const viewport: Viewport = { themeColor: "#df5a0f", width: "device-width", initialScale: 1 };

// Marketing sections use the Day theme, which is also the default.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="day">
      <body>
        <a href="#main" className="skip">Skip to content</a>
        <main id="main">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
