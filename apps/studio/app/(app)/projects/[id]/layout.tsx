import { ProjectShell } from "@/components/ProjectShell";

export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  return <ProjectShell id={(await params).id}>{children}</ProjectShell>;
}
