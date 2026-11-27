import { EventRuleView } from "@/features/eventbridge/rule-view";

export default async function EventRulePage({ params }: { params: Promise<{ bus: string; rule: string }> }) {
  const { bus, rule } = await params;
  return <EventRuleView bus={decodeURIComponent(bus)} rule={decodeURIComponent(rule)} />;
}
