"use client";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

type ContentProps = React.ComponentProps<typeof D.Content> & { side?: "center" | "right" };

// side="right" renders the same primitive as a slide-over sheet (item editors, details).
export function DialogContent({ className, children, side = "center", ...props }: ContentProps) {
  return (
    <D.Portal>
      <D.Overlay className="data-[state=open]:animate-in data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50" />
      <D.Content
        className={cn(
          "fixed z-50 grid gap-4 border bg-background p-6 shadow-lg",
          side === "center" &&
            "top-1/2 left-1/2 max-h-[90vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg",
          side === "right" && "inset-y-0 right-0 w-full max-w-xl overflow-y-auto border-l",
          className,
        )}
        {...props}
      >
        {children}
        <D.Close className="absolute top-4 right-4 rounded-sm opacity-70 hover:opacity-100" aria-label="Close">
          <X className="size-4" />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}

export const DialogHeader = ({ className, ...p }: React.ComponentProps<"div">) => (
  <div className={cn("flex flex-col gap-1.5", className)} {...p} />
);
export const DialogFooter = ({ className, ...p }: React.ComponentProps<"div">) => (
  <div className={cn("flex flex-wrap justify-end gap-2", className)} {...p} />
);
export const DialogTitle = ({ className, ...p }: React.ComponentProps<typeof D.Title>) => (
  <D.Title className={cn("text-lg font-semibold", className)} {...p} />
);
export const DialogDescription = ({ className, ...p }: React.ComponentProps<typeof D.Description>) => (
  <D.Description className={cn("text-sm text-muted-foreground", className)} {...p} />
);
