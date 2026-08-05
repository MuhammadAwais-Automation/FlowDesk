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
        'accent-border': 'var(--accent-border)',
        success: 'var(--success)',
        'success-m': 'var(--success-muted)',
        danger: 'var(--danger)',
        'danger-m': 'var(--danger-muted)',
        warning: 'var(--warning)',
        'warning-m': 'var(--warning-muted)',
        inverse: 'var(--text-inverse)',
      },
      fontFamily: {
        sans: ['DM Sans Variable', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Outfit Variable', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono Variable', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        xs: 'var(--radius-xs)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
        full: 'var(--radius-full)',
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
      transitionDuration: {
        fast: '120ms',
        base: '180ms',
        slow: '260ms',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.2s ease-out',
        'message-in': 'messageIn 220ms cubic-bezier(0.16,1,0.3,1) both',
        'typing-bounce': 'typingBounce 1.1s ease-in-out infinite',
        shimmer: 'shimmer 1.6s linear infinite',
        'pulse-dot': 'pulseDot 1.2s ease-in-out infinite',
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
        messageIn: {
          '0%': { opacity: '0', transform: 'translateY(8px) scale(0.98)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        typingBounce: {
          '0%, 80%, 100%': { transform: 'translateY(0)', opacity: '0.4' },
          '40%': { transform: 'translateY(-4px)', opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        pulseDot: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
      },
    }
  },
  plugins: []
}
