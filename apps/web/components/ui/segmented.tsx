"use client";
import { cn } from "@/lib/utils";

/** Single-choice segmented control (radio group) for small, frequently-changed choices. */
export function Segmented<T extends string>({ value, onChange, options, label, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex max-w-full overflow-x-auto rounded-lg border bg-surface p-0.5 scrollbar-none", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("h-8 shrink-0 rounded-md px-3 text-sm text-graphite transition-colors hover:text-ink", value === o.value && "bg-ink text-primary-foreground hover:text-primary-foreground")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
