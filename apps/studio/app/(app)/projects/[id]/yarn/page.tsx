import { YarnView } from "@/components/YarnView";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <YarnView projectId={(await params).id} />;
}
