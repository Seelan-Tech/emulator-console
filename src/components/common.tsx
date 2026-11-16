"use client";
import { Check, Copy, Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {children}
        <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
      {icon && <div className="text-muted-foreground [&_svg]:size-8">{icon}</div>}
      <div className="font-medium">{title}</div>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export const Spinner = ({ className }: { className?: string }) => (
  <Loader2 className={cn("size-4 animate-spin", className)} aria-label="Loading" />
);

export function CopyButton({
  value,
  className,
  label = "Copy",
}: {
  value: string;
  className?: string;
  label?: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={className}
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          // clipboard access denied (insecure context or permissions): nothing useful to show
        }
      }}
    >
      {done ? <Check className="text-success" /> : <Copy />}
    </Button>
  );
}

// Destructive actions confirm in a dialog; `typeToConfirm` makes the user type the resource name (buckets, tables…).
export function ConfirmDialog(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  typeToConfirm?: string;
  destructive?: boolean;
  onConfirm: () => unknown;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const blocked = props.typeToConfirm !== undefined && typed !== props.typeToConfirm;
  return (
    <Dialog
      open={props.open}
      onOpenChange={(v) => {
        props.onOpenChange(v);
        if (!v) setTyped("");
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          {props.description && <DialogDescription>{props.description}</DialogDescription>}
        </DialogHeader>
        {props.typeToConfirm !== undefined && (
          <div className="grid gap-1.5 text-sm">
            <span>
              Type <code className="rounded bg-muted px-1">{props.typeToConfirm}</code> to confirm
            </span>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus aria-label="Confirmation" />
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={props.destructive === false ? "default" : "destructive"}
            disabled={blocked || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await props.onConfirm();
                props.onOpenChange(false);
                setTyped("");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Spinner />} {props.confirmLabel ?? "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function JsonViewer({ value, className }: { value: unknown; className?: string }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <div className={cn("relative rounded-md border bg-muted/40", className)}>
      <CopyButton value={text ?? ""} className="absolute top-1 right-1" />
      <pre className="max-h-96 overflow-auto p-3 pr-10 text-xs">{text}</pre>
    </div>
  );
}
