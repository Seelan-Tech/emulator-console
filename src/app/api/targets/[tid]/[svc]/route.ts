import { isService, operations } from "@/lib/aws";
import { HttpError, json, route } from "@/lib/http";
import { getTarget } from "@/lib/targets";

export const GET = route<{ tid: string; svc: string }>(async (_req, { tid, svc }) => {
  await getTarget(tid);
  if (!isService(svc)) throw new HttpError(404, "unknown service");
  return json(await operations(svc));
});
