import { Skeleton } from "@/components/ui/skeleton";

export default function TargetLoading() {
  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      <Skeleton className="mb-2 h-6 w-48" />
      <Skeleton className="mb-6 h-4 w-72" />
      <div className="grid gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    </div>
  );
}
