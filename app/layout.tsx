import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "knitted.studio",
  description:
    "An open-source studio where you and your model knit social posts, ads and web graphics from reusable brand patterns.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Night is the default and the app does not offer a toggle yet: Day exists
    // for docs and print, not for the workspace. The attribute is written
    // explicitly rather than left to the media query, because the canvas shows
    // the USER's colours and the chrome around it must not move with the OS.
    <html lang="en" data-theme="night">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* The four families the theme document names, and nothing else. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Geist:wght@400;600&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@1&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
