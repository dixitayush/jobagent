import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Card = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => <div className={cn("rounded-lg border bg-card text-card-foreground shadow-sm", className)} {...p} />;
export const CardHeader = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => <div className={cn("flex flex-col gap-1.5 p-5 pb-3", className)} {...p} />;
export const CardTitle = ({ className, ...p }: HTMLAttributes<HTMLHeadingElement>) => <h2 className={cn("text-base font-semibold leading-tight", className)} {...p} />;
export const CardDescription = ({ className, ...p }: HTMLAttributes<HTMLParagraphElement>) => <p className={cn("text-sm text-muted-foreground", className)} {...p} />;
export const CardContent = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => <div className={cn("p-5 pt-0", className)} {...p} />;
export const CardFooter = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => <div className={cn("flex items-center gap-2 p-5 pt-0", className)} {...p} />;
