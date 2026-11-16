import { NextRequest } from "next/server";

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

export type Call = {
  body?: unknown;
  params?: Record<string, string>;
  headers?: Record<string, string>;
  query?: string;
};

// Invokes a route handler the way Next would, and returns the status and parsed JSON body.
export async function call(handler: unknown, method: string, path: string, c: Call = {}) {
  const req = new NextRequest(`http://localhost:3000${path}${c.query ? `?${c.query}` : ""}`, {
    method,
    headers: { host: "localhost:3000", "content-type": "application/json", ...c.headers },
    body: c.body === undefined ? undefined : JSON.stringify(c.body),
  });
  const res = await (handler as Handler)(req, { params: Promise.resolve(c.params ?? {}) });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Record<string, any> };
}
