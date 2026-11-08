import { redirect } from "next/navigation";
import { LIBRARY_ID } from "@knitted/core";
import { ProjectShell } from "@/components/ProjectShell";

export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  // The Library is kept as a project, but it is not one to open: it has its own page.
  if (id === LIBRARY_ID) redirect("/library");
  return <ProjectShell id={id}>{children}</ProjectShell>;
}
