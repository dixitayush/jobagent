import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const TONES = {
  info: { box: "border-rule bg-surface", icon: Info, iconClass: "text-graphite" },
  error: { box: "border-danger/30 bg-danger/5", icon: AlertCircle, iconClass: "text-danger" },
  warning: { box: "border-caution/30 bg-caution/5", icon: TriangleAlert, iconClass: "text-caution" },
  success: { box: "border-fit/30 bg-fit/5", icon: CheckCircle2, iconClass: "text-fit" },
};

export function Alert({ tone = "info", title, children, className, action }: { tone?: keyof typeof TONES; title?: string; children?: ReactNode; className?: string; action?: ReactNode }) {
  const t = TONES[tone];
  const Icon = t.icon;
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("flex gap-3 rounded-xl border p-4 text-sm", t.box, className)}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", t.iconClass)} aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium text-ink">{title}</p>}
        {children && <div className={cn("text-graphite", title && "mt-1")}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
