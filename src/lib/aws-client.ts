"use client";
import {
  useMutation,
  type UseMutationOptions,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { toast } from "sonner";

import { useRecorder } from "@/components/recorder";
import { useTarget } from "@/components/target-context";

import type { ServiceName } from "./aws"; // type-only: erased, so no server code reaches the browser
import { isRecordable } from "./mutating";

export class OpError extends Error {
  constructor(
    message: string,
    public awsName?: string,
    public status?: number,
  ) {
    super(message);
  }
}

export type Svc = ServiceName;

// The one transport to the emulator: POST /api/targets/:tid/:svc/:op. Result types are supplied by callers via
// type-only SDK imports (erased at build time), e.g. callOp<ListBucketsCommandOutput>(...).
type OpResponse = {
  ok?: boolean;
  output?: unknown;
  error?: string | { message?: string; name?: string; status?: number };
};

export async function callOp<Out = unknown>(
  tid: string,
  svc: Svc,
  op: string,
  input: unknown = {},
  region?: string,
): Promise<Out> {
  const r = await fetch(`/api/targets/${tid}/${svc}/${op}${region ? `?region=${encodeURIComponent(region)}` : ""}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input ?? {}),
  });
  const j = (await r.json().catch(() => ({}))) as OpResponse;
  const detail = typeof j.error === "object" ? j.error : undefined;
  if (!r.ok)
    throw new OpError(
      typeof j.error === "string" ? j.error : (detail?.message ?? `HTTP ${r.status}`),
      undefined,
      r.status,
    );
  if (!j.ok) throw new OpError(detail?.message ?? "request failed", detail?.name, detail?.status);
  return j.output as Out;
}

// Cached read. Keys are [tid, svc, op, input, region], so mutations can invalidate a whole service.
export function useOp<Out = unknown>(
  svc: Svc,
  op: string,
  input: unknown = {},
  options: Omit<UseQueryOptions<Out, OpError>, "queryKey" | "queryFn"> = {},
) {
  const { tid, region } = useTarget();
  return useQuery<Out, OpError>({
    queryKey: [tid, svc, op, input, region],
    queryFn: () => callOp<Out>(tid, svc, op, input, region),
    ...options,
  });
}

// State-changing call: invalidates the service's cached reads, records the step for fixtures, toasts failures.
export function useMutateOp<Out = unknown, In = Record<string, unknown>>(
  svc: Svc,
  op: string,
  options: { invalidate?: Svc[]; record?: boolean; silentError?: boolean } & Omit<
    UseMutationOptions<Out, OpError, In>,
    "mutationFn"
  > = {},
) {
  const { tid, region } = useTarget();
  const qc = useQueryClient();
  const recorder = useRecorder();
  const { invalidate, record, silentError, onSuccess, onError, ...rest } = options;
  return useMutation<Out, OpError, In>({
    mutationFn: (input) => callOp<Out>(tid, svc, op, input, region),
    onSuccess: (out, input, ctx, meta) => {
      for (const s of invalidate ?? [svc]) void qc.invalidateQueries({ queryKey: [tid, s] });
      if (record !== false && isRecordable(op))
        recorder.add({
          service: svc,
          operation: op,
          input: input ?? {},
          ...(region !== undefined ? { region } : {}),
        });
      return onSuccess?.(out, input, ctx, meta);
    },
    onError: (e, input, ctx, meta) => {
      if (!silentError) toast.error(e.message);
      return onError?.(e, input, ctx, meta);
    },
    ...rest,
  });
}

// Imperative variant for multi-step flows (loops, sequential calls): same recording and invalidation.
export function useRunOp() {
  const { tid, region } = useTarget();
  const qc = useQueryClient();
  const recorder = useRecorder();
  return async <Out = unknown>(
    svc: Svc,
    op: string,
    input: unknown = {},
    o: { record?: boolean; invalidate?: boolean } = {},
  ): Promise<Out> => {
    const out = await callOp<Out>(tid, svc, op, input, region);
    if (o.invalidate !== false) void qc.invalidateQueries({ queryKey: [tid, svc] });
    if (o.record !== false && isRecordable(op))
      recorder.add({
        service: svc,
        operation: op,
        input: (input ?? {}) as Record<string, unknown>,
        ...(region !== undefined ? { region } : {}),
      });
    return out;
  };
}
