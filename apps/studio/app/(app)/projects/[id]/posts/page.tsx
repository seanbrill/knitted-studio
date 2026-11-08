import { PostsView } from "@/components/PostsView";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <PostsView projectId={(await params).id} />;
}
