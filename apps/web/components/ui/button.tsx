import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-150 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97] [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-ink text-primary-foreground shadow-[0_1px_2px_hsl(var(--ink)/0.2)] hover:bg-ink/90 hover:shadow-[0_6px_16px_-6px_hsl(var(--ink)/0.45)]",
        fit: "bg-fit text-white hover:bg-fit/90 dark:text-paper",
        secondary: "bg-secondary text-ink hover:bg-secondary/70",
        outline: "border border-input bg-surface text-ink hover:bg-accent",
        ghost: "text-graphite hover:bg-accent hover:text-ink",
        destructive: "bg-danger text-white hover:bg-danger/90 dark:text-paper",
        link: "h-auto px-0 text-ink underline-offset-4 hover:underline",
      },
      size: { default: "h-10 px-4", sm: "h-9 px-3", lg: "h-11 px-5 text-base", icon: "size-10", "icon-sm": "size-9" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, loading, disabled, children, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
    {loading && <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
    {children}
  </button>
));
Button.displayName = "Button";
