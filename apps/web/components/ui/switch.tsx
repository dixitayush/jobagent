"use client";
import { cn } from "@/lib/utils";

export function Switch({ checked, onChange, label, id, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string; disabled?: boolean }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50", checked ? "bg-primary" : "bg-input")}
    >
      <span className={cn("inline-block size-5 rounded-full bg-background shadow transition-transform", checked ? "translate-x-5" : "translate-x-0.5")} />
    </button>
  );
}
