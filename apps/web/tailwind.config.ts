import type { Config } from "tailwindcss";

const hsl = (v: string) => `hsl(var(--${v}) / <alpha-value>)`;

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1rem" },
    extend: {
      colors: {
        // Semantic palette (see app/globals.css)
        paper: hsl("paper"),
        surface: hsl("surface"),
        ink: hsl("ink"),
        graphite: hsl("graphite"),
        rule: hsl("rule"),
        fit: { DEFAULT: hsl("fit"), soft: hsl("fit-soft") },
        marker: hsl("marker"),
        caution: hsl("caution"),
        danger: hsl("danger"),
        // shadcn/ui aliases
        border: hsl("border"),
        input: hsl("input"),
        ring: hsl("ring"),
        background: hsl("background"),
        foreground: hsl("foreground"),
        primary: { DEFAULT: hsl("primary"), foreground: hsl("primary-foreground") },
        secondary: { DEFAULT: hsl("secondary"), foreground: hsl("secondary-foreground") },
        muted: { DEFAULT: hsl("muted"), foreground: hsl("muted-foreground") },
        accent: { DEFAULT: hsl("accent"), foreground: hsl("accent-foreground") },
        destructive: { DEFAULT: hsl("destructive"), foreground: hsl("destructive-foreground") },
        card: { DEFAULT: hsl("card"), foreground: hsl("card-foreground") },
        success: hsl("success"),
        warning: hsl("warning"),
      },
      borderRadius: { xl: "var(--radius)", lg: "calc(var(--radius) - 2px)", md: "calc(var(--radius) - 4px)", sm: "calc(var(--radius) - 6px)" },
      fontFamily: {
        sans: ['"Schibsted Grotesk Variable"', "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      // Type scale 13 / 15 / 17 / 21 / 28 / 40
      fontSize: {
        xs: ["0.8125rem", { lineHeight: "1.25rem" }],
        sm: ["0.9375rem", { lineHeight: "1.4rem" }],
        base: ["1.0625rem", { lineHeight: "1.6rem" }],
        lg: ["1.3125rem", { lineHeight: "1.8rem" }],
        xl: ["1.75rem", { lineHeight: "2.15rem", letterSpacing: "-0.01em" }],
        "2xl": ["2.5rem", { lineHeight: "2.85rem", letterSpacing: "-0.02em" }],
      },
    },
  },
  plugins: [],
};
export default config;
