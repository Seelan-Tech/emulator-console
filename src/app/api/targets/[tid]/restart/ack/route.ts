import { NOW, one } from "@/lib/db";
import { json, route } from "@/lib/http";
import { getTarget } from "@/lib/targets";

// Dismisses the "emulator restarted" banner.
export const POST = route<{ tid: string }>(async (_req, { tid }) => {
  await getTarget(tid);
  await one(`update targets set restart_acknowledged_at = ${NOW} where id = $1`, [tid]);
  return json({ ok: true });
});
