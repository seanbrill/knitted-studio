import { ProjectsView } from "@/components/ProjectsView";

export const metadata = { title: "Projects" };
// The first screen is the projects: a welcome sits above them until there is one of the person's own.
export default function Page() { return <ProjectsView />; }
