import type { Metadata } from "next";
import "@knitted/ui/globals.css";
import { THEME_SCRIPT } from "@knitted/ui";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: { default: "knitted.studio", template: "%s | knitted.studio" },
  description:
    "An open-source studio where you and your model knit social posts, ads and web graphics from reusable brand patterns.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Day is the default; Night is an option the user chooses. The attribute is
    // written explicitly, and corrected before first paint by THEME_SCRIPT, so
    // the chrome never moves with the OS and never flashes the wrong theme.
    <html lang="en" data-theme="day" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <a href="#main" className="skip-link">Skip to content</a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
