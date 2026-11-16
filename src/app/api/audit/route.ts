import { listAudit } from "@/lib/audit";
import { isUuid } from "@/lib/db";
import { json, route } from "@/lib/http";

export const GET = route(async (req) => {
  const q = new URL(req.url).searchParams;
  const targetId = q.get("targetId");
  return json(
    await listAudit({
      targetId: targetId && isUuid(targetId) ? targetId : undefined,
      all: q.get("all") === "1",
      limit: Math.min(Number(q.get("limit")) || 50, 200),
      before: Number(q.get("before")) || undefined,
    }),
  );
});
