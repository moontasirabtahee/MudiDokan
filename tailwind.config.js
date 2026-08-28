/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Tokens resolve to CSS custom properties declared in src/index.css.
        brand: {
          DEFAULT: 'var(--brand)',
          deep: 'var(--brand-deep)',
          soft: 'var(--brand-soft)',
        },
        ink: {
          DEFAULT: 'var(--ink)',
          soft: 'var(--ink-soft)',
          faint: 'var(--ink-faint)',
        },
        paper: 'var(--paper)',
        surface: 'var(--surface)',
        rule: 'var(--rule)',
        danger: { DEFAULT: 'var(--danger)', soft: 'var(--danger-soft)' },
        warn: { DEFAULT: 'var(--warn)', soft: 'var(--warn-soft)' },
        ok: { DEFAULT: 'var(--ok)', soft: 'var(--ok-soft)' },
      },
      fontFamily: {
        sans: ['"Noto Sans Bengali"', '"Hind Siliguri"', 'system-ui', '-apple-system', 'sans-serif'],
      },
      fontSize: {
        // Body never drops below 15px: the phone is held at arm's length.
        xs: ['0.8125rem', { lineHeight: '1.15rem' }],
        sm: ['0.9375rem', { lineHeight: '1.35rem' }],
        base: ['1rem', { lineHeight: '1.55rem' }],
        lg: ['1.125rem', { lineHeight: '1.6rem' }],
        xl: ['1.3125rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.5rem', { lineHeight: '1.9rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
        '4xl': ['2.375rem', { lineHeight: '2.6rem' }],
      },
      spacing: {
        // Ergonomic floors from the design system.
        tap: '3.5rem',    // 56px minimum tap target
        tapxl: '4rem',    // 64px primary action
        nav: '4.5rem',    // bottom nav height
      },
      borderRadius: {
        card: '0.875rem',
        pill: '999px',
      },
      boxShadow: {
        // Hairlines only. No decorative elevation.
        card: '0 1px 2px 0 rgb(27 36 48 / 0.06), 0 0 0 1px rgb(27 36 48 / 0.05)',
        lift: '0 6px 20px -6px rgb(27 36 48 / 0.18), 0 0 0 1px rgb(27 36 48 / 0.05)',
        sheet: '0 -8px 32px -12px rgb(27 36 48 / 0.24)',
      },
      backgroundImage: {
        // The signature element: real ruled-notebook paper for the khata screens.
        ledger:
          'repeating-linear-gradient(to bottom, transparent 0, transparent 2.4375rem, var(--rule) 2.4375rem, var(--rule) 2.5rem)',
      },
      keyframes: {
        'sheet-up': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'pop-in': {
          from: { opacity: '0', transform: 'scale(.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(-0.5rem)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'sheet-up': 'sheet-up .22s cubic-bezier(.32,.72,0,1)',
        'fade-in': 'fade-in .15s ease-out',
        'pop-in': 'pop-in .15s ease-out',
        'toast-in': 'toast-in .18s ease-out',
      },
    },
  },
  plugins: [],
};
