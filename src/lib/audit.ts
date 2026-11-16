import { query } from "./db";

export type AuditRow = {
  id: string;
  created_at: string;
  source: string;
  service: string;
  operation: string;
  mutating: boolean;
  ok: boolean;
  duration_ms: number;
  error: string | null;
  target_name: string | null;
};

// Keyset pagination on the identity column (`before` = last id of the previous page).
export function listAudit(o: { targetId?: string; all?: boolean; limit: number; before?: number }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (o.targetId) where.push(`a.target_id = $${params.push(o.targetId)}`);
  if (!o.all) where.push("a.mutating");
  if (o.before) where.push(`a.id < $${params.push(o.before)}`);
  params.push(o.limit);
  return query<Omit<AuditRow, "id"> & { id: number }>(
    `select a.id, a.created_at, a.source, a.service, a.operation, a.mutating, a.ok, a.duration_ms, a.error,
            t.name as target_name
     from audit_log a left join targets t on t.id = a.target_id
     ${where.length ? `where ${where.join(" and ")}` : ""} order by a.id desc limit $${params.length}`,
    params,
  ).then((rows) => rows.map((r) => ({ ...r, id: String(r.id) })));
}
