import { SnsTopicView } from "@/features/sns/topic-view";

export default async function SnsTopicPage({ params }: { params: Promise<{ topic: string }> }) {
  const { topic } = await params;
  return <SnsTopicView topic={decodeURIComponent(topic)} />;
}
