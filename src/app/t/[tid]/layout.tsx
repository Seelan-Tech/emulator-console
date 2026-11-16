import { notFound } from "next/navigation";

import { RecorderProvider } from "@/components/recorder";
import { TargetProvider } from "@/components/target-context";
import { TargetShell } from "@/components/target-shell";
import { getTarget } from "@/lib/targets";

export const dynamic = "force-dynamic";

export default async function TargetLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tid: string }>;
}) {
  const { tid } = await params;
  const target = await getTarget(tid).catch(() => notFound());
  return (
    <TargetProvider
      target={{ id: target.id, name: target.name, endpointUrl: target.endpoint_url, region: target.region }}
    >
      <RecorderProvider targetId={target.id}>
        <TargetShell>{children}</TargetShell>
      </RecorderProvider>
    </TargetProvider>
  );
}
