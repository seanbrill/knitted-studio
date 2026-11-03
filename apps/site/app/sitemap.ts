import type { MetadataRoute } from "next";
import { PAGES, SITE_URL } from "../lib/site";
import { allDocs } from "../lib/docs";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const docs = allDocs().map((d) => ({ path: `/docs/${d.slug}/` }));
  return [...PAGES, ...docs].map((p) => ({ url: `${SITE_URL}${p.path}` }));
}
