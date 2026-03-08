import { Skeleton } from "@/components/ui/skeleton";

export function SkeletonBook() {
  return (
    <div className="rounded-md px-2 py-1.5 space-y-1.5">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
      <div className="flex gap-1 mt-1">
        <Skeleton className="h-5 w-5 rounded-full" />
        <Skeleton className="h-5 w-5 rounded-full" />
        <Skeleton className="h-5 w-5 rounded-full" />
      </div>
    </div>
  );
}

export function SkeletonConversation() {
  return (
    <div className="flex items-center gap-2 rounded-md px-3 py-2">
      <Skeleton className="h-3.5 w-3.5 rounded" />
      <Skeleton className="h-4 flex-1" />
    </div>
  );
}

export function SkeletonMessage({ isUser = false }: { isUser?: boolean }) {
  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && <Skeleton className="mt-1 h-8 w-8 rounded-full shrink-0" />}
      <div className={`max-w-[75%] space-y-2 ${isUser ? "items-end" : ""}`}>
        <Skeleton className={`h-4 ${isUser ? "w-48" : "w-64"}`} />
        {!isUser && <Skeleton className="h-4 w-52" />}
        {!isUser && <Skeleton className="h-4 w-40" />}
      </div>
    </div>
  );
}
