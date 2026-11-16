import { isService } from "@/lib/aws";
import { HttpError, json, route } from "@/lib/http";
import { operationInput } from "@/lib/schema";

// Input shape of an operation, for the generated form. Independent of any target, so the answer is cacheable.
export const GET = route<{ svc: string; op: string }>(async (_req, { svc, op }) => {
  if (!isService(svc)) throw new HttpError(404, "unknown service");
  if (!/^[A-Za-z0-9]{1,100}$/.test(op)) throw new HttpError(400, "invalid operation name");
  const input = await operationInput(svc, op);
  const res = json({ input });
  res.headers.set("cache-control", "private, max-age=3600");
  return res;
});
