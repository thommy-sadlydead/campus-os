import type { Config } from "tailwindcss";

// Color tokens carried over from the Fall Ledger artifact so the new app
// keeps the same visual identity instead of introducing a new one.
const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-fraunces)", "Georgia", "serif"],
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-plex-mono)", "ui-monospace", "monospace"],
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
        card: "0 1px 2px rgba(27,33,48,.06), 0 8px 24px -12px rgba(27,33,48,.15)",
      },
      borderRadius: {
        xl2: "14px",
      },
    },
  },
  plugins: [],
};
export default config;
