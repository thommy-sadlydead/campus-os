import type { Config } from "tailwindcss";

// Colors, fonts, corner radii and shadows all point at the design tokens in
// src/app/globals.css, which is where the design system is defined.
const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-geist)", "system-ui", "sans-serif"],
        sans: ["var(--font-geist)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        ink: "var(--ink)",
        "ink-soft": "var(--ink-soft)",
        "ink-faint": "var(--ink-faint)",
        border: "var(--border)",
        "border-soft": "var(--border-soft)",
        accent: "var(--accent)",
        "accent-ink": "var(--accent-ink)",
        "accent-soft": "var(--accent-soft)",
        danger: "var(--danger)",
        "danger-soft": "var(--danger-soft)",
        ok: "var(--ok)",
        "ok-soft": "var(--ok-soft)",
        warn: "var(--warn)",
        "warn-soft": "var(--warn-soft)",
        course: {
          1: "var(--c-1)",
          2: "var(--c-2)",
          3: "var(--c-3)",
          4: "var(--c-4)",
          5: "var(--c-5)",
          6: "var(--c-6)",
          7: "var(--c-7)",
          8: "var(--c-8)",
        },
      },
      boxShadow: {
        sm: "0 1px 2px rgba(var(--shadow-color), 0.05)",
        card: "0 1px 2px rgba(var(--shadow-color), 0.04), 0 4px 16px -6px rgba(var(--shadow-color), 0.08)",
        pop: "0 16px 40px -12px rgba(var(--shadow-color), 0.22), 0 2px 6px rgba(var(--shadow-color), 0.06)",
      },
      borderRadius: {
        lg: "10px",
        xl: "14px",
        xl2: "18px",
        "2xl": "18px",
      },
    },
  },
  plugins: [],
};
export default config;
