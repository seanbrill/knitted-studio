import { PatternsView } from "@/components/PatternsView";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <PatternsView projectId={(await params).id} />;
}
