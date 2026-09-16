import type { Config } from "tailwindcss";
import formsPlugin from "@tailwindcss/forms";
import containerQueriesPlugin from "@tailwindcss/container-queries";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: 'class', // Enable dark mode using the 'class' strategy
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f7ff',
          100: '#e0effe',
          200: '#bae0fd',
          500: '#2563eb',
          600: '#1d4ed8',
          700: '#1e40af',
          900: '#0f2766'
        },
        clinical: {
          rose: '#f43f5e',
          amber: '#f59e0b',
          emerald: '#10b981',
          slate: '#0f172a'
        },
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      boxShadow: {
        'glow-blue': '0 0 24px -4px rgba(37, 99, 235, 0.25)',
        'glow-red': '0 0 20px -2px rgba(239, 68, 68, 0.3)',
        'subtle': '0 1px 2px 0 rgba(0, 0, 0, 0.03), 0 4px 12px -2px rgba(15, 23, 42, 0.05)',
        'card': '0 10px 30px -5px rgba(15, 23, 42, 0.04), 0 2px 6px -1px rgba(15, 23, 42, 0.02)',
        'glass': '0 8px 32px 0 rgba(15, 23, 42, 0.06)'
      },
      animation: {
        'aura': 'pulse-subtle 2.8s ease-in-out infinite',
      },
      keyframes: {
        'pulse-subtle': {
          '0%, 100%': { opacity: '0.9', transform: 'scale(1)' },
          '50%': { opacity: '0.4', transform: 'scale(1.08)' },
        }
      }
    }
  },
  plugins: [
    formsPlugin,
    containerQueriesPlugin
  ],
};
export default config;