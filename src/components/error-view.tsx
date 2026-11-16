"use client";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";

// Shared by the error boundaries: say what happened, keep the rest of the app usable, offer a retry.
export function ErrorView({
  error,
  reset,
  title = "Something went wrong",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 p-10 text-center" role="alert">
      <AlertTriangle className="size-8 text-warning" />
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-muted-foreground">{error.message || "An unexpected error occurred."}</p>
      {error.digest && <p className="font-mono text-xs text-muted-foreground">ref {error.digest}</p>}
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
