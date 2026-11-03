import { KnitsView } from "@/components/KnitsView";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <KnitsView projectId={(await params).id} />;
}
