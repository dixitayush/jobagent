import { cn } from "@/lib/utils";

/** Loading placeholder with a soft shimmer sweep. */
export const Skeleton = ({ className }: { className?: string }) => <div className={cn("shimmer rounded-lg bg-muted", className)} aria-hidden />;
