import * as React from "react";

import { cn } from "@/lib/utils";

const field =
  "w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs transition-colors placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cn(field, "h-9 py-1", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(field, "min-h-20 py-2 font-mono", className)} {...props} />;
}

// Native <select>: accessible, mobile-friendly and testable, with the same look as the other fields.
export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return <select className={cn(field, "h-9 py-1 pr-8", className)} {...props} />;
}

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  // eslint-disable-next-line jsx-a11y/label-has-associated-control -- a wrapper: callers supply htmlFor or nest a control
  return <label className={cn("text-sm leading-none font-medium", className)} {...props} />;
}
