import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Badge = ({ className, ...p }: HTMLAttributes<HTMLSpanElement>) => (
  <span className={cn("inline-flex items-center gap-1 rounded-md border bg-surface px-2 py-0.5 text-xs font-medium text-ink", className)} {...p} />
);
