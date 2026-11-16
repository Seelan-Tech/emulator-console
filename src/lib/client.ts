// Browser-side JSON fetch helper: throws ApiError(message) with the server's error text and optional code.
export class ApiError extends Error {
  constructor(
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

type ErrorBody = { error?: string; code?: string };

// `T` is the caller's description of the response body: the server is trusted to match it.
export async function api<T = unknown>(path: string, method = "GET", body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as ErrorBody;
  if (!r.ok) throw new ApiError(j.error ?? `HTTP ${r.status}`, j.code);
  return j as T;
}
