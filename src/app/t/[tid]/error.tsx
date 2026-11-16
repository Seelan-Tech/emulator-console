"use client";
import { ErrorView } from "@/components/error-view";

// A screen that throws keeps the target shell (sidebar, recorder) intact.
export default function TargetError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorView error={error} reset={reset} title="This screen failed to load" />;
}
