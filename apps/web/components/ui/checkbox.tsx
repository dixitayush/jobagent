import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Checkbox({ label, className, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-2 text-sm", className)}>
      <input type="checkbox" className="size-4 rounded border-input accent-primary" {...p} />
      {label}
    </label>
  );
}
