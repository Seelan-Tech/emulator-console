import { serviceNames } from "@/lib/aws";
import { json, route } from "@/lib/http";
import { getTarget } from "@/lib/targets";

export const GET = route<{ tid: string }>(async (_req, { tid }) => {
  const t = await getTarget(tid);
  return json({ name: t.name, endpoint: t.endpoint_url, region: t.region, services: serviceNames });
});
