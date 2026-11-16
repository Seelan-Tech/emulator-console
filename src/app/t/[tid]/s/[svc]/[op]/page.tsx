import { notFound } from "next/navigation";

import { OperationRunner } from "@/features/runner/operation-runner";
import { serviceMeta } from "@/features/services";

export default async function RunOperation({ params }: { params: Promise<{ svc: string; op: string }> }) {
  const { svc, op } = await params;
  if (!serviceMeta(svc) || !/^[A-Za-z0-9]{1,100}$/.test(op)) notFound();
  return <OperationRunner svc={svc} op={op} />;
}
