import { buildInfo } from "@/lib/app-version";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await query("select 1");
    const { version, revision } = buildInfo();
    return Response.json({ ok: true, version, revision });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
