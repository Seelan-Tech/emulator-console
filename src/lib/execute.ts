import { run, type ServiceName } from "./aws";
import { NOW, query } from "./db";
import { type ErrorInfo, errorInfo } from "./errors";
import { log } from "./log";
import { isMutating } from "./mutating";
import { resolveConn, type TargetRow } from "./targets";

// The emulator drops connections under bursts, so cap in-flight requests per target (per process).
const MAX_INFLIGHT = 4;
class Semaphore {
  private n = 0;
  private waiters: (() => void)[] = [];
  async acquire() {
    if (this.n < MAX_INFLIGHT) return void this.n++;
    await new Promise<void>((r) => this.waiters.push(r));
  }
  release() {
    const next = this.waiters.shift();
    if (next) next();
    else this.n--;
  }
}
const semaphores = new Map<string, Semaphore>();
const semaphore = (id: string) => semaphores.get(id) ?? (semaphores.set(id, new Semaphore()), semaphores.get(id)!);

export type ExecResult = { ok: true; ms: number; output: unknown } | { ok: false; ms: number; error: ErrorInfo };

type Ctx = { target: TargetRow; source: "console" | "fixture" };

// The activity log is capped: with no cleanup job, the oldest rows are dropped every so often.
const AUDIT_KEEP = 50_000;
const TRIM_EVERY = 500;
let sinceTrim = 0;

// Audit is best-effort: never fail (or slow) the operation because logging failed.
export function logAudit(ctx: Ctx, service: string, operation: string, ok: boolean, ms: number, error?: string) {
  query(
    "insert into audit_log(target_id, source, service, operation, mutating, ok, duration_ms, error) values ($1,$2,$3,$4,$5,$6,$7,$8)",
    [ctx.target.id, ctx.source, service, operation, isMutating(operation), ok, ms, error?.slice(0, 500) ?? null],
  ).catch((e: unknown) => log.error("audit insert failed", { error: errorInfo(e).message }));
  if (++sinceTrim >= TRIM_EVERY) {
    sinceTrim = 0;
    query("delete from audit_log where id <= (select max(id) from audit_log) - $1", [AUDIT_KEEP]).catch((e: unknown) =>
      log.debug("could not trim the audit log", { error: errorInfo(e).message }),
    );
  }
  query(`update targets set last_seen_at = ${NOW} where id = $1`, [ctx.target.id]).catch((e: unknown) =>
    log.debug("could not update last_seen_at", { error: errorInfo(e).message }),
  );
}

export async function execute(
  ctx: Ctx,
  service: ServiceName,
  operation: string,
  input: unknown,
  region?: string,
  opts: { audit?: boolean } = {},
): Promise<ExecResult> {
  const sem = semaphore(ctx.target.id);
  await sem.acquire();
  const started = Date.now();
  let result: ExecResult;
  try {
    const output = await run(resolveConn(ctx.target), service, operation, input, region || undefined);
    result = { ok: true, ms: Date.now() - started, output };
  } catch (e) {
    result = { ok: false, ms: Date.now() - started, error: errorInfo(e) };
  } finally {
    sem.release();
  }
  if (opts.audit !== false)
    logAudit(ctx, service, operation, result.ok, result.ms, result.ok ? undefined : result.error.message);
  return result;
}
