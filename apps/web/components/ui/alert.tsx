import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Alert({ tone = "info", title, children, className }: { tone?: "info" | "error" | "warning" | "success"; title?: string; children?: ReactNode; className?: string }) {
  const tones = {
    info: "border-border bg-muted/50",
    error: "border-destructive/40 bg-destructive/10 text-destructive",
    warning: "border-warning/40 bg-warning/10",
    success: "border-success/40 bg-success/10",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("rounded-lg border p-4 text-sm", tones[tone], className)}>
      {title && <p className="font-medium">{title}</p>}
      {children && <div className={cn(title && "mt-1", "text-foreground/80")}>{children}</div>}
    </div>
  );
}
