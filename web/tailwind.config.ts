import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand accent: signal orange (CTAs, highlights) — from the ValueTrack refs.
        accent: {
          DEFAULT: "#E8833A",
          dark: "#CF6F2A",
          tint: "#F6B27E",
        },
        // Data / interactive cyan (charts, links, active states).
        cyan: {
          DEFAULT: "#36C5D0",
          dark: "#2AA3AD",
          tint: "#7FE0E6",
        },
        // Navy "ink" surface ramp for the dark UI.
        ink: {
          950: "#0a0f18",
          900: "#0d1320",
          850: "#111a2b",
          800: "#162032",
          700: "#1d293f",
          600: "#26344e",
          500: "#36486a",
        },
        // Foreground text on dark.
        fg: {
          DEFAULT: "#e6ebf2",
          muted: "#93a0b4",
          dim: "#5d6b80",
        },
        line: "rgba(148,163,184,0.14)",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Inter Tight", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: {
        DEFAULT: "6px",
        md: "8px",
        lg: "12px",
        xl: "16px",
      },
      boxShadow: {
        elevated: "0 1px 2px rgb(0 0 0 / 0.06)",
        card: "0 8px 30px rgb(0 0 0 / 0.35)",
        glow: "0 0 0 1px rgba(54,197,208,0.25), 0 8px 30px rgba(54,197,208,0.08)",
      },
      transitionDuration: {
        // D15
        DEFAULT: "150ms",
        fee: "200ms",
      },
    },
  },
  plugins: [],
};

export default config;
