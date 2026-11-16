import { notFound } from "next/navigation";

import { OperationList } from "@/features/runner/operations";
import { serviceMeta } from "@/features/services";

export default async function ServiceOperations({ params }: { params: Promise<{ svc: string }> }) {
  const { svc } = await params;
  if (!serviceMeta(svc)) notFound();
  return <OperationList svc={svc} />;
}
