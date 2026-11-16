import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import { type ReactElement, type ReactNode, useState } from "react";
import { vi } from "vitest";

import { RecorderProvider } from "@/components/recorder";
import { TargetProvider } from "@/components/target-context";

type Opts = { tid?: string; region?: string; client?: QueryClient };

export const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

// Everything a target screen expects from its surroundings: a query cache, the target, and the recorder.
export function AppProviders({ children, tid = "t1", region = "us-east-1", client }: Opts & { children: ReactNode }) {
  const [qc] = useState(() => client ?? newClient());
  return (
    <QueryClientProvider client={qc}>
      <TargetProvider target={{ id: tid, name: "Target", endpointUrl: "https://emulator:9297", region }}>
        <RecorderProvider targetId={tid}>{children}</RecorderProvider>
      </TargetProvider>
    </QueryClientProvider>
  );
}

export function renderApp(ui: ReactElement, opts: Opts & Omit<RenderOptions, "wrapper"> = {}) {
  const { tid, region, client, ...rest } = opts;
  return render(ui, {
    wrapper: ({ children }) => <AppProviders {...{ tid, region, client }}>{children}</AppProviders>,
    ...rest,
  });
}

type Handler = (url: string, init?: RequestInit) => unknown;

// What the Nth fetch call was: URL, method and the parsed JSON body (if any).
export function callInfo(fn: { mock: { calls: unknown[][] } }, n = 0) {
  const [url, init] = fn.mock.calls[n] as [string, RequestInit | undefined];
  const raw = init?.body;
  return { url, method: init?.method, body: typeof raw === "string" ? (JSON.parse(raw) as unknown) : undefined };
}

// A fetch stand-in: the first route whose pattern matches the URL answers. Returns the mock so tests can inspect calls.
// True when some fetch call was a POST whose URL ends with `suffix`.
export const posted = (fn: { mock: { calls: unknown[][] } }, suffix: string) =>
  fn.mock.calls.some((_, i) => {
    const c = callInfo(fn, i);
    return c.method === "POST" && c.url.endsWith(suffix);
  });

export function mockFetch(routes: [RegExp | string, unknown][]) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    for (const [pattern, handler] of routes) {
      if (typeof pattern === "string" ? url.includes(pattern) : pattern.test(url)) {
        const body = typeof handler === "function" ? (handler as Handler)(url, init) : handler;
        if (body instanceof Response) return Promise.resolve(body.clone()); // a body can be read only once
        return Promise.resolve(
          new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
        );
      }
    }
    return Promise.resolve(new Response(JSON.stringify({ error: `no mock for ${url}` }), { status: 404 }));
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

// The envelope our generic runner answers with.
export const opOk = (output: unknown) => ({ ok: true, ms: 1, output });
export const opFail = (name: string, message: string, status = 400) => ({
  ok: false,
  ms: 1,
  error: { name, message, status },
});
