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
        // Locked design token D10: football pitch green
        accent: {
          DEFAULT: "#2C8C5F",
          dark: "#226F4B",
          tint: "#E8F3EC",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Inter Tight", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      // D12 spacing scale (Tailwind defaults already cover 4/8/12/16/24/32/48/64 via 1-16)
      borderRadius: {
        // D13: 4px controls, 8px cards. No bubbly large radius.
        DEFAULT: "4px",
        md: "4px",
        lg: "8px",
      },
      boxShadow: {
        // D14: single subtle elevation shadow only
        elevated: "0 1px 2px rgb(0 0 0 / 0.06)",
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
