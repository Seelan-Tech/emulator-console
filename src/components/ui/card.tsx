import { cn } from "@/lib/utils";

export const Card = ({ className, ...p }: React.ComponentProps<"div">) => (
  <div className={cn("min-w-0 rounded-lg border bg-card text-card-foreground shadow-xs", className)} {...p} />
);
export const CardHeader = ({ className, ...p }: React.ComponentProps<"div">) => (
  <div className={cn("flex flex-col gap-1 p-4 pb-2", className)} {...p} />
);
export const CardTitle = ({ className, ...p }: React.ComponentProps<"h3">) => (
  // eslint-disable-next-line jsx-a11y/heading-has-content -- the heading text arrives as children through `p`
  <h3 className={cn("text-sm font-semibold", className)} {...p} />
);
export const CardContent = ({ className, ...p }: React.ComponentProps<"div">) => (
  <div className={cn("p-4 pt-2", className)} {...p} />
);
