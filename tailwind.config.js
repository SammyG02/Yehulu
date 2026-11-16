/** @type {import('tailwindcss').Config} */

// Colours are CSS variables (see src/index.css) so light and dark themes
// swap in one place instead of needing dark: variants everywhere.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Manrope Variable"', 'Manrope', 'system-ui', 'sans-serif'],
      },
      colors: {
        canvas: token('canvas'),
        surface: token('surface'),
        sunken: token('sunken'),
        line: token('line'),
        ink: token('ink'),
        muted: token('muted'),
        brand: { DEFAULT: token('brand'), strong: token('brand-strong'), ink: token('brand-ink'), soft: token('brand-soft') },
        'on-brand': token('on-brand'),
        neg: { DEFAULT: token('neg'), soft: token('neg-soft') },
        accent: { DEFAULT: token('accent'), soft: token('accent-soft') },
      },
      boxShadow: {
        card: '0 1px 2px rgb(0 0 0 / 0.04), 0 1px 1px rgb(0 0 0 / 0.02)',
        float: '0 12px 32px -8px rgb(0 0 0 / 0.25)',
      },
      keyframes: {
        'sheet-in': { from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0)' } },
        'pop-in': { from: { opacity: '0', transform: 'scale(0.97)' }, to: { opacity: '1', transform: 'scale(1)' } },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'toast-in': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
      },
      animation: {
        'sheet-in': 'sheet-in 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
        'pop-in': 'pop-in 0.18s ease-out',
        'fade-in': 'fade-in 0.15s ease-out',
        'toast-in': 'toast-in 0.2s ease-out',
      },
    },
  },
  plugins: [],
}
