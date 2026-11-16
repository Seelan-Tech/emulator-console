import { cn } from "@/lib/utils";

export const Table = ({ className, ...p }: React.ComponentProps<"table">) => (
  <div className="w-full overflow-x-auto rounded-lg border">
    <table className={cn("w-full caption-bottom text-sm", className)} {...p} />
  </div>
);
export const THead = ({ className, ...p }: React.ComponentProps<"thead">) => (
  <thead className={cn("bg-muted/50 [&_tr]:border-b", className)} {...p} />
);
export const TBody = ({ className, ...p }: React.ComponentProps<"tbody">) => (
  <tbody className={cn("[&_tr:last-child]:border-0", className)} {...p} />
);
export const TR = ({ className, ...p }: React.ComponentProps<"tr">) => (
  <tr className={cn("border-b transition-colors hover:bg-muted/40", className)} {...p} />
);
export const TH = ({ className, ...p }: React.ComponentProps<"th">) => (
  <th
    className={cn(
      "h-9 px-3 text-left align-middle text-xs font-medium tracking-wide text-muted-foreground uppercase",
      className,
    )}
    {...p}
  />
);
export const TD = ({ className, ...p }: React.ComponentProps<"td">) => (
  <td className={cn("px-3 py-2 align-middle", className)} {...p} />
);
