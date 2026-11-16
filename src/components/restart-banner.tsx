"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Spinner } from "@/components/common";
import { useTarget } from "@/components/target-context";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client";
import type { EmulatorVersion } from "@/lib/emulator-version";
import { timeAgo } from "@/lib/utils";

export type TargetStatus = {
  canDetect: boolean;
  emulator: EmulatorVersion | null;
  restartedAt: string | null;
  bannerVisible: boolean;
  baseline: { id: string; name: string } | null;
  autoReplay: boolean;
  lastRun: {
    id: string;
    status: string;
    trigger: string;
    startedAt: string;
    fixtureName: string;
    steps: number;
    failedStep: { index: number; operation: string; error?: string } | null;
  } | null;
};

// Polled by the banner and the target header; they share one cache entry.
export const useTargetStatus = (tid: string) =>
  useQuery({
    queryKey: ["status", tid],
    queryFn: () => api<TargetStatus>(`/api/targets/${tid}/status`),
    refetchInterval: 4000,
  });

// The emulator keeps everything in memory, so a restart wipes it: say so, and offer to put it back.
// `onChooseBaseline` opens the target's restart-recovery settings, where the baseline is picked.
export function RestartBanner({ onChooseBaseline }: { onChooseBaseline: () => void }) {
  const { tid } = useTarget();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const status = useTargetStatus(tid);
  const s = status.data;
  if (!s?.bannerVisible) return null;

  const run =
    s.lastRun &&
    s.lastRun.trigger === "restart" &&
    s.restartedAt &&
    new Date(s.lastRun.startedAt) >= new Date(s.restartedAt)
      ? s.lastRun
      : null;
  const refresh = () => {
    void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === tid });
    void qc.invalidateQueries({ queryKey: ["status", tid] });
  };
  const dismiss = async () => {
    await api(`/api/targets/${tid}/restart/ack`, "POST");
    refresh();
  };
  const replay = async () => {
    setBusy(true);
    try {
      const r = await api<{ status: string }>(`/api/targets/${tid}/baseline/replay`, "POST");
      if (r.status === "succeeded") toast.success(`Baseline “${s.baseline?.name}” replayed`);
      else toast.error("Baseline replay failed");
    } catch (e) {
      toast.error((e as Error).message);
    }
    setBusy(false);
    refresh();
  };

  let tone = "border-warning/40 bg-warning/10";
  let icon = <AlertTriangle className="size-4 text-warning" />;
  let body: React.ReactNode;
  let actions: React.ReactNode = (
    <Button size="sm" variant="ghost" onClick={dismiss}>
      <X /> Dismiss
    </Button>
  );

  if (s.autoReplay && s.baseline && run?.status === "running") {
    icon = <Spinner />;
    body = (
      <>
        Replaying baseline <b>{s.baseline.name}</b>…
      </>
    );
    actions = null;
  } else if (s.autoReplay && s.baseline && run?.status === "succeeded") {
    tone = "border-success/40 bg-success/10";
    icon = <CheckCircle2 className="size-4 text-success" />;
    body = (
      <>
        The emulator restarted {timeAgo(s.restartedAt)}. Baseline <b>{run.fixtureName}</b> was replayed ({run.steps}{" "}
        steps): state restored.
      </>
    );
  } else if (s.autoReplay && s.baseline && run?.status === "failed") {
    body = (
      <>
        The emulator restarted {timeAgo(s.restartedAt)}, but replaying <b>{run.fixtureName}</b> failed
        {run.failedStep ? (
          <>
            {" "}
            at step {run.failedStep.index} ({run.failedStep.operation}): {run.failedStep.error}
          </>
        ) : null}
        .
      </>
    );
    actions = (
      <>
        <Button size="sm" onClick={replay} disabled={busy}>
          {busy ? <Spinner /> : <RotateCcw />} Retry
        </Button>
        <Button size="sm" variant="ghost" onClick={dismiss}>
          <X /> Dismiss
        </Button>
      </>
    );
  } else if (s.baseline) {
    body = <>The emulator restarted {timeAgo(s.restartedAt)}. Its state was reset.</>;
    actions = (
      <>
        <Button size="sm" onClick={replay} disabled={busy}>
          {busy ? <Spinner /> : <RotateCcw />} Replay “{s.baseline.name}”
        </Button>
        <Button size="sm" variant="ghost" onClick={dismiss}>
          <X /> Dismiss
        </Button>
      </>
    );
  } else {
    body = (
      <>
        The emulator restarted {timeAgo(s.restartedAt)}. Its state was reset. Set a baseline fixture to restore it with
        one click.
      </>
    );
    actions = (
      <>
        <Button size="sm" variant="outline" onClick={onChooseBaseline}>
          Choose a baseline
        </Button>
        <Button size="sm" variant="ghost" onClick={dismiss}>
          <X /> Dismiss
        </Button>
      </>
    );
  }

  return (
    <div
      role="status"
      data-testid="restart-banner"
      className={`flex flex-wrap items-center gap-3 border-b px-4 py-2 text-sm ${tone}`}
    >
      {icon}
      <span className="min-w-0 flex-1">{body}</span>
      {actions}
    </div>
  );
}
