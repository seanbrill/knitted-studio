export const SITE_URL = "https://knitted.studio";
export const GITHUB = "https://github.com/seanbrill/knitted-studio";
export const SITE_NAME = "knitted.studio";
export const TAGLINE = "A desktop studio for your brand's posts, ads and short videos: set the brand once as patterns, then fill them yourself or with your AI model, and knit every size.";

export const NAV = [
  { href: "/features/", label: "Features" },
  { href: "/how-it-works/", label: "How it works" },
  { href: "/gallery/", label: "Gallery" },
  { href: "/mcp/", label: "Your model" },
  { href: "/docs/", label: "Docs" },
  { href: "/download/", label: "Download" },
];

/** Every static page, for the sitemap and the broken-link check. Docs are added from the markdown. */
export const PAGES: { path: string; title: string }[] = [
  { path: "/", title: "Home" },
  { path: "/features/", title: "Features" },
  { path: "/how-it-works/", title: "How it works" },
  { path: "/gallery/", title: "Gallery" },
  { path: "/mcp/", title: "Use it from your model" },
  { path: "/download/", title: "Download" },
  { path: "/download/install/", title: "Install guide" },
  { path: "/docs/", title: "Docs" },
  { path: "/changelog/", title: "Changelog" },
  { path: "/open-source/", title: "Open source" },
  { path: "/privacy/", title: "Privacy" },
];
