import { TargetsView } from "@/components/target-manager";
import { query } from "@/lib/db";
import { ensureLocalTarget } from "@/lib/local-target";
import { localFilesEnabled, publicTarget, type TargetRow } from "@/lib/targets";

export const dynamic = "force-dynamic";
export const metadata = { title: "Targets" };

export default async function Targets() {
  await ensureLocalTarget();
  const rows = await query<TargetRow>("select * from targets order by created_at");
  return <TargetsView targets={rows.map(publicTarget)} filesEnabled={localFilesEnabled()} />;
}
