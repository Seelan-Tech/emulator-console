import { operations, serviceNames } from "@/lib/aws";
import { json, route } from "@/lib/http";

// Operation names of every service (static SDK data, the same for every target): feeds the command palette.
export const GET = route(async () => {
  const entries = await Promise.all(serviceNames.map(async (s) => [s, await operations(s)] as const));
  const res = json(Object.fromEntries(entries));
  res.headers.set("cache-control", "private, max-age=3600");
  return res;
});
