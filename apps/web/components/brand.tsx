import { cn } from "@/lib/utils";

/**
 * Brand mark: a short list where one line is picked out — the product finds the few jobs worth it.
 * Uses currentColor for the frame so it follows the theme; the picked line is the fit teal.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("shrink-0", className)} aria-hidden>
      <rect x="1.5" y="1.5" width="29" height="29" rx="8" className="fill-ink" />
      <rect x="8" y="9" width="10" height="2.5" rx="1.25" className="fill-paper" opacity="0.45" />
      <rect x="8" y="14.75" width="16" height="2.5" rx="1.25" className="fill-fit" />
      <rect x="8" y="20.5" width="7" height="2.5" rx="1.25" className="fill-paper" opacity="0.45" />
    </svg>
  );
}
