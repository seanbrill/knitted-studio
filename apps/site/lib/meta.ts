import type { Metadata } from "next";
import { SITE_NAME } from "./site";

/** Per-page metadata: title, description, canonical, Open Graph and Twitter. */
export function pageMeta(o: { title: string; description: string; path: string }): Metadata {
  return {
    title: o.title,
    description: o.description,
    alternates: { canonical: o.path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: `${o.title} | ${SITE_NAME}`,
      description: o.description,
      url: o.path,
      images: [{ url: "/og.png", width: 1200, height: 630, alt: "Make it knitted. on an orange field." }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${o.title} | ${SITE_NAME}`,
      description: o.description,
      images: ["/og.png"],
    },
  };
}
