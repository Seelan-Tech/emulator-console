"use client";
import { Terminal } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

// Copies the AWS CLI form of a call (or a script of several); `command` is computed lazily so a half-typed input
// that is not JSON yet can disable the button instead of throwing while rendering.
export function CopyCliButton({
  command,
  label = "Copy as AWS CLI",
  iconOnly = false,
  variant = "outline",
}: {
  command: () => string | null;
  label?: string;
  iconOnly?: boolean;
  variant?: "outline" | "ghost";
}) {
  let text: string | null = null;
  try {
    text = command();
  } catch {
    text = null;
  }
  return (
    <Button
      type="button"
      size={iconOnly ? "icon-sm" : "sm"}
      variant={variant}
      aria-label={label}
      title={label}
      disabled={text === null}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text!);
          toast.success('Copied. Run the exports from "Use with the AWS CLI" first.');
        } catch {
          toast.error("Could not copy: clipboard access was denied");
        }
      }}
    >
      <Terminal />
      {!iconOnly && label}
    </Button>
  );
}
