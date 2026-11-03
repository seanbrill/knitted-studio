import { PartsManager } from "@/components/PartsManager";

export const metadata = { title: "Parts" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <PartsManager projectId={(await params).id} />;
}
