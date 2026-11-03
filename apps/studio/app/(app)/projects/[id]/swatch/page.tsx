import { SwatchView } from "@/components/SwatchView";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <SwatchView projectId={(await params).id} />;
}
