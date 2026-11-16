"use client";
import * as M from "@radix-ui/react-dropdown-menu";

import { cn } from "@/lib/utils";

export const DropdownMenu = M.Root;
export const DropdownMenuTrigger = M.Trigger;
export const DropdownMenuContent = ({ className, ...p }: React.ComponentProps<typeof M.Content>) => (
  <M.Portal>
    <M.Content
      align="end"
      sideOffset={6}
      className={cn("z-50 min-w-40 rounded-md border bg-card p-1 text-card-foreground shadow-md", className)}
      {...p}
    />
  </M.Portal>
);
export const DropdownMenuItem = ({ className, ...p }: React.ComponentProps<typeof M.Item>) => (
  <M.Item
    className={cn(
      "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent [&_svg]:size-4",
      className,
    )}
    {...p}
  />
);
export const DropdownMenuLabel = ({ className, ...p }: React.ComponentProps<typeof M.Label>) => (
  <M.Label className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)} {...p} />
);
export const DropdownMenuSeparator = () => <M.Separator className="my-1 h-px bg-border" />;
