import { type NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

import { HttpError } from "./http-error";
import { log } from "./log";

export { HttpError };

// First hop of X-Forwarded-For (set by a reverse proxy), or "local" when there is none. Only used to key rate limits.
export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

// Byte arrays that are small valid text (e.g. Lambda payloads) become strings; the rest are shown as sizes.
const utf8 = new TextDecoder("utf-8", { fatal: true });
function bytes(v: Uint8Array) {
  if (v.length <= 1024 * 1024) {
    try {
      const s = utf8.decode(v);
      if (!s.includes("\0")) return s;
    } catch {
      // not valid UTF-8: binary, shown as a size below
    }
  }
  return `<${v.length} bytes>`;
}
export const sdkJson = (body: unknown, status = 200) =>
  new NextResponse(
    JSON.stringify(body, (_k, v: unknown) =>
      v instanceof Uint8Array ? bytes(v) : typeof v === "bigint" ? v.toString() : v,
    ),
    {
      status,
      headers: { "content-type": "application/json" },
    },
  );

// Cookies are SameSite=Lax; this also rejects state-changing requests whose Origin is another site.
function checkOrigin(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (new URL(origin).host !== host) throw new HttpError(403, "cross-origin request blocked");
}

export function errorResponse(e: unknown) {
  if (e instanceof HttpError) return json({ error: e.message, ...(e.code ? { code: e.code } : {}) }, e.status);
  if (e instanceof ZodError) {
    return json({ error: e.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") }, 400);
  }
  if (e instanceof SyntaxError) return json({ error: "invalid JSON body" }, 400);
  log.error("unhandled error in route", { error: e instanceof Error ? (e.stack ?? e.message) : String(e) });
  return json({ error: "internal error" }, 500);
}

// Wraps a route handler: origin check, params resolution and uniform error responses.
export function route<P extends Record<string, string> = Record<string, never>>(
  fn: (req: NextRequest, params: P) => Promise<Response>,
) {
  return async (req: NextRequest, ctx: { params: Promise<P> }): Promise<Response> => {
    try {
      checkOrigin(req);
      return await fn(req, await ctx.params);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export async function body<T>(req: NextRequest, schema: { parse(v: unknown): T }): Promise<T> {
  return schema.parse(await req.json());
}
