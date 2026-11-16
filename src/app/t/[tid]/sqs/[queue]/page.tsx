import { SqsQueueView } from "@/features/sqs/queue-view";

export default async function SqsQueuePage({ params }: { params: Promise<{ queue: string }> }) {
  const { queue } = await params;
  return <SqsQueueView queue={decodeURIComponent(queue)} />;
}
