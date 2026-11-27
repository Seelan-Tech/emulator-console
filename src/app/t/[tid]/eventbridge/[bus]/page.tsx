import { EventBusView } from "@/features/eventbridge/bus-view";

export default async function EventBusPage({ params }: { params: Promise<{ bus: string }> }) {
  const { bus } = await params;
  return <EventBusView bus={decodeURIComponent(bus)} />;
}
