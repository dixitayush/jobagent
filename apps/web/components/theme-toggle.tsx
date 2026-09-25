"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/utils";

type Theme = "light" | "dark" | "system";

function apply(theme: Theme, animate = false) {
  if (animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    // Crossfade colors for a moment instead of snapping between themes.
    document.documentElement.classList.add("theme-changing");
    window.setTimeout(() => document.documentElement.classList.remove("theme-changing"), 320);
  }
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    try {
      setTheme((localStorage.getItem("theme") as Theme | null) ?? "system");
    } catch {
      /* storage unavailable */
    }
  }, []);
  useEffect(() => {
    apply(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);
  const update = (t: Theme) => {
    apply(t, true);
    setTheme(t);
    try {
      localStorage.setItem("theme", t);
    } catch {
      /* storage unavailable */
    }
  };
  return { theme, setTheme: update };
}

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Match system", icon: Monitor },
];

/** Three-way segmented control: light, dark, or follow the system setting. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const id = useId();
  return (
    <div role="radiogroup" aria-label="Color theme" className={cn("inline-flex rounded-lg border bg-surface p-0.5", className)}>
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          title={label}
          onClick={() => setTheme(value)}
          className={cn("relative grid size-8 place-items-center rounded-md text-graphite transition-colors hover:text-ink", theme === value && "text-ink")}
        >
          {theme === value && <motion.span layoutId={`theme-${id}`} className="absolute inset-0 rounded-md bg-accent" transition={{ type: "spring", stiffness: 500, damping: 35 }} aria-hidden />}
          <Icon className="relative size-4" aria-hidden />
          <span className="sr-only">{label}</span>
        </button>
      ))}
    </div>
  );
}
