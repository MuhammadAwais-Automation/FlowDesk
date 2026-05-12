/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/**/*.{js,ts,jsx,tsx}',
    './index.html'
  ],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        's2': 'var(--surface-2)',
        's3': 'var(--surface-3)',
        border: 'var(--border)',
        'border-soft': 'var(--border-soft)',
        tx: 'var(--text)',
        't2': 'var(--text-2)',
        't3': 'var(--text-3)',
        accent: 'var(--accent)',
        'accent-h': 'var(--accent-hover)',
        'accent-m': 'var(--accent-muted)',
        success: 'var(--success)',
        danger: 'var(--danger)',
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        display: ['Outfit', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.2s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    }
  },
  plugins: []
}
