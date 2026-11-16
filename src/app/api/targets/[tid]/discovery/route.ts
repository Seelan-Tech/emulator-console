import { discover } from "@/lib/discovery";
import { json, route } from "@/lib/http";
import { getTarget, resolveConn } from "@/lib/targets";

export const maxDuration = 60;

export const GET = route<{ tid: string }>(async (_req, { tid }) => {
  return json(await discover(resolveConn(await getTarget(tid))));
});
