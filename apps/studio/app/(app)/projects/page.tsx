import { redirect } from "next/navigation";

// The projects are the first screen now. An old link here, like ?new=1, still lands where it meant to.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = new URLSearchParams(Object.entries(await searchParams).flatMap(([k, v]) => (v === undefined ? [] : Array.isArray(v) ? v : [v]).map((x): [string, string] => [k, x])));
  redirect(q.size ? `/?${q}` : "/");
}
