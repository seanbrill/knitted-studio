import { YarnView } from "@/components/YarnView";

/** `?open=<a Yarn id>` opens that file, as a design sheet's "Open in Yarn" does. */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ open?: string }> }) {
  const open = (await searchParams).open;
  return <YarnView projectId={(await params).id} open={typeof open === "string" ? open : undefined} />;
}
