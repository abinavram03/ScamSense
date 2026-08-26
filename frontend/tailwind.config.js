/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        brand: {
          50: '#f0f0ff',
          100: '#e0deff',
          200: '#c4bfff',
          300: '#a094ff',
          400: '#7c65ff',
          500: '#6c3ff5',
          600: '#5b2de0',
          700: '#4a22b8',
          800: '#3a1a90',
          900: '#2c1370',
        },
        coral: { 400: '#ff7a6b', 500: '#ff5c4a', 600: '#e84835' },
        amber: { 400: '#ffb020', 500: '#ff9500', 600: '#e08200' },
        emerald: { 400: '#34d399', 500: '#10b981', 600: '#059669' },
        sky: { 400: '#38bdf8', 500: '#0ea5e9', 600: '#0284c7' },
        violet: { 400: '#a78bfa', 500: '#8b5cf6', 600: '#7c3aed' },
        rose: { 400: '#fb7185', 500: '#f43f5e', 600: '#e11d48' },
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        'soft': '0 1px 3px 0 rgb(0 0 0 / 0.04), 0 1px 2px -1px rgb(0 0 0 / 0.04)',
        'card': '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 2px 8px -2px rgb(0 0 0 / 0.06)',
        'elevated': '0 4px 12px 0 rgb(0 0 0 / 0.08), 0 2px 6px -2px rgb(0 0 0 / 0.04)',
        'glow-brand': '0 0 20px -4px rgb(108 63 245 / 0.3)',
        'glow-coral': '0 0 20px -4px rgb(255 92 74 / 0.3)',
        'glow-emerald': '0 0 20px -4px rgb(16 185 129 / 0.3)',
        'glow-amber': '0 0 20px -4px rgb(255 149 0 / 0.3)',
        'glow-rose': '0 0 20px -4px rgb(244 63 94 / 0.3)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' }
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' }
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0px) scale(1)' },
          '50%': { transform: 'translateY(-20px) scale(1.02)' },
        },
        'pulse-slow': {
          '0%, 100%': { opacity: '0.5', transform: 'scale(1)' },
          '50%': { opacity: '0.8', transform: 'scale(1.05)' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-in': 'fade-in 0.4s ease-out forwards',
        'slide-up': 'slide-up 0.5s ease-out forwards',
        'float': 'float 6s ease-in-out infinite',
        'pulse-slow': 'pulse-slow 4s ease-in-out infinite',
        'shimmer': 'shimmer 3s ease-in-out infinite',
      }
    }
  },
  plugins: [require("tailwindcss-animate")],
};
