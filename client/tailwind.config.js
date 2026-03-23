/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      keyframes: {
        lobbyRingAmber: {
          '0%, 100%': {
            boxShadow: '0 0 0 2px rgb(251 191 36), 0 0 14px rgb(251 191 36 / 0.5)',
          },
          '50%': {
            boxShadow: '0 0 0 2px rgb(251 191 36 / 0.35), 0 0 22px rgb(251 191 36 / 0.12)',
          },
        },
        lobbyRingRed: {
          '0%, 100%': {
            boxShadow: '0 0 0 2px rgb(239 68 68), 0 0 14px rgb(239 68 68 / 0.55)',
          },
          '50%': {
            boxShadow: '0 0 0 2px rgb(239 68 68 / 0.3), 0 0 22px rgb(239 68 68 / 0.15)',
          },
        },
      },
      animation: {
        'lobby-ring-amber': 'lobbyRingAmber 1.25s ease-in-out infinite',
        'lobby-ring-red': 'lobbyRingRed 1.25s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
