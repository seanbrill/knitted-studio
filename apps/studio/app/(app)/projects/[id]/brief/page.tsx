import { BriefView } from "@/components/BriefView";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <BriefView projectId={(await params).id} />;
}
