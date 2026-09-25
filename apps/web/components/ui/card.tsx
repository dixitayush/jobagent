import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** A panel: a quiet surface with a hairline border, no drop shadow. */
export const Card = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => <section className={cn("min-w-0 rounded-xl border bg-surface text-ink", className)} {...p} />;
export const CardHeader = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => <div className={cn("flex flex-col gap-1 p-5 pb-3 sm:p-6 sm:pb-4", className)} {...p} />;
export const CardTitle = ({ className, ...p }: HTMLAttributes<HTMLHeadingElement>) => <h2 className={cn("text-base font-semibold leading-tight tracking-tight", className)} {...p} />;
export const CardDescription = ({ className, ...p }: HTMLAttributes<HTMLParagraphElement>) => <p className={cn("text-sm text-graphite", className)} {...p} />;
export const CardContent = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => <div className={cn("p-5 pt-0 sm:p-6 sm:pt-0", className)} {...p} />;
export const CardFooter = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => <div className={cn("flex items-center gap-2 border-t px-5 py-4 sm:px-6", className)} {...p} />;
