import { DesignsView } from "@/components/DesignsView";

export const metadata = { title: "Designs" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <DesignsView projectId={(await params).id} />;
}
