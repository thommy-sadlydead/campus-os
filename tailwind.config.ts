import type { Config } from "tailwindcss";

// Colors, fonts, corner radii and shadows all point at the design tokens in
// src/app/globals.css, which is where the design system is defined.
const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // One geometric sans everywhere (Inter; optical sizing gives large
        // type the Display cut). Timers use its tabular digits, not a mono.
        display: ["var(--font-inter)", "-apple-system", "system-ui", "sans-serif"],
        sans: ["var(--font-inter)", "-apple-system", "system-ui", "sans-serif"],
        mono: ["var(--font-inter)", "-apple-system", "system-ui", "sans-serif"],
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
      // Hairlines instead of shadows; only things that float over the page
      // (the tab bar, sheets, menus) keep a soft shadow.
      boxShadow: {
        sm: "none",
        card: "none",
        pop: "0 18px 40px -16px rgba(var(--shadow-color), 0.28)",
      },
      // One card radius (20px); chips and buttons are full pills.
      borderRadius: {
        lg: "12px",
        xl: "14px",
        xl2: "20px",
        "2xl": "20px",
      },
    },
  },
  plugins: [],
};
export default config;
