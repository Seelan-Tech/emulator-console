import { execute } from "@/lib/execute";
import { json, route } from "@/lib/http";
import { getTarget } from "@/lib/targets";

// Connectivity check: STS GetCallerIdentity proves reachability, TLS and credentials in one call.
export const POST = route<{ tid: string }>(async (_req, { tid }) => {
  const target = await getTarget(tid);
  const r = await execute({ target, source: "console" }, "sts", "GetCallerIdentity", {});
  return json(
    r.ok
      ? { ok: true, ms: r.ms, identity: (r.output as { Arn?: string }).Arn }
      : { ok: false, ms: r.ms, error: r.error.message },
  );
});
