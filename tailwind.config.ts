import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        felt: {
          900: "#052e1f",
          800: "#0a3d29",
          700: "#0e4d34",
          600: "#12623f",
        },
        gold: {
          400: "#f2c14e",
          500: "#e0a92e",
          600: "#c88f1a",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      keyframes: {
        deal: {
          "0%": { transform: "translateY(-14px) rotate(-8deg)", opacity: "0" },
          "100%": { transform: "translateY(0) rotate(0deg)", opacity: "1" },
        },
        pop: {
          "0%": { transform: "scale(0.85)", opacity: "0" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        pulseRing: {
          "0%": { boxShadow: "0 0 0 0 rgba(242,193,78,0.55)" },
          "70%": { boxShadow: "0 0 0 12px rgba(242,193,78,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(242,193,78,0)" },
        },
        floatUp: {
          "0%": { transform: "translateY(6px)", opacity: "0" },
          "20%": { transform: "translateY(0)", opacity: "1" },
          "100%": { transform: "translateY(-10px)", opacity: "0.9" },
        },
      },
      animation: {
        deal: "deal 260ms ease-out both",
        pop: "pop 180ms ease-out both",
        ring: "pulseRing 1.6s ease-out infinite",
        floatUp: "floatUp 1200ms ease-out both",
      },
      boxShadow: {
        felt: "inset 0 2px 40px rgba(0,0,0,0.55), inset 0 0 0 8px rgba(0,0,0,0.25)",
        card: "0 2px 6px rgba(0,0,0,0.45)",
      },
    },
  },
  plugins: [],
};

export default config;
