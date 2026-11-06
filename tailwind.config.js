/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./client/index.html', './client/src/**/*.{ts,tsx}'],
  darkMode: 'class',
  // Agent gradients arrive from the API at runtime ("from-blue-500 to-indigo-600"), so Tailwind can't see
  // them in the source. Safelist every colour/shade the agent registry uses.
  safelist: [{ pattern: /^(from|to)-(slate|gray|blue|indigo|emerald|teal|violet|purple|rose|red|amber|orange|pink|cyan|green|fuchsia)-(400|500|600|700|800|900)$/ }],
  theme: {
    extend: {
      colors: {
        app: 'var(--app)',
        fg: 'rgb(var(--fg) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        line: 'var(--line)',
        glass: 'var(--glass)',
        'glass-strong': 'var(--glass-strong)',
        hover: 'var(--hover)'
      },
      boxShadow: { float: 'var(--shadow)' },
      keyframes: {
        'caret-blink': { '0%,100%': { opacity: '1' }, '50%': { opacity: '0' } }
      },
      animation: { 'caret-blink': 'caret-blink 1s steps(1) infinite' }
    }
  },
  plugins: []
};
