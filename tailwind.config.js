/** @type {import('tailwindcss').Config} */
export default {
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
        'on-accent': 'rgb(var(--on-accent) / <alpha-value>)',
        line: 'var(--line)',
        'line-strong': 'var(--line-strong)',
        glass: 'var(--glass)',
        'glass-strong': 'var(--glass-strong)',
        hover: 'var(--hover)',
        neon: {
          cyan: 'rgb(var(--neon-cyan) / <alpha-value>)',
          violet: 'rgb(var(--neon-violet) / <alpha-value>)',
          magenta: 'rgb(var(--neon-magenta) / <alpha-value>)'
        }
      },
      fontFamily: {
        display: ['"Space Grotesk Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      },
      boxShadow: {
        float: 'var(--shadow)',
        // Neo-brutalist hard offset shadows in the accent colours.
        'neo-cyan': '4px 4px 0 0 rgb(var(--neon-cyan) / 0.9)',
        'neo-violet': '4px 4px 0 0 rgb(var(--neon-violet) / 0.9)',
        'glow-cyan': '0 0 32px -6px rgb(var(--neon-cyan) / 0.55)'
      },
      keyframes: {
        'caret-blink': { '0%,100%': { opacity: '1' }, '50%': { opacity: '0' } },
        float: { '0%,100%': { transform: 'translate3d(0,0,0)' }, '50%': { transform: 'translate3d(0,-10px,0)' } },
        // Glow layers breathe via opacity + scale (compositor-only; animating box-shadow repaints every frame).
        'glow-breathe': { '0%,100%': { opacity: '0.55', transform: 'scale(1)' }, '50%': { opacity: '1', transform: 'scale(1.05)' } },
        'glow-slow': { '0%,100%': { opacity: '0.25' }, '50%': { opacity: '0.45' } },
        scan: { '0%': { transform: 'translateY(-120%)' }, '100%': { transform: 'translateY(420%)' } },
        'holo-shift': { '0%': { backgroundPosition: '0% 50%' }, '100%': { backgroundPosition: '200% 50%' } },
        glitch: {
          '0%,92%,100%': { transform: 'translate3d(0,0,0)', opacity: '0' },
          '93%': { transform: 'translate3d(-3px,1px,0)', opacity: '0.9' },
          '95%': { transform: 'translate3d(3px,-1px,0)', opacity: '0.9' },
          '97%': { transform: 'translate3d(-2px,0,0)', opacity: '0.9' }
        },
        grain: {
          '0%,100%': { transform: 'translate3d(0,0,0)' },
          '20%': { transform: 'translate3d(-4%,-6%,0)' },
          '40%': { transform: 'translate3d(5%,3%,0)' },
          '60%': { transform: 'translate3d(-3%,6%,0)' },
          '80%': { transform: 'translate3d(6%,-4%,0)' }
        },
        wave: { '0%,100%': { transform: 'scaleY(0.25)' }, '50%': { transform: 'scaleY(1)' } },
        flow: { to: { strokeDashoffset: '-24' } },
        'dot-bounce': { '0%,80%,100%': { transform: 'translateY(0)', opacity: '0.4' }, '40%': { transform: 'translateY(-4px)', opacity: '1' } },
        'ping-slow': { '0%': { transform: 'scale(1)', opacity: '0.6' }, '80%,100%': { transform: 'scale(2.2)', opacity: '0' } },
        'spin-slow': { to: { transform: 'rotate(360deg)' } },
        marquee: { to: { transform: 'translate3d(-50%,0,0)' } },
        'rise-in': { from: { opacity: '0', transform: 'translate3d(0,14px,0)' }, to: { opacity: '1', transform: 'translate3d(0,0,0)' } }
      },
      animation: {
        'caret-blink': 'caret-blink 1s steps(1) infinite',
        float: 'float 7s ease-in-out infinite',
        'glow-breathe': 'glow-breathe 2.6s ease-in-out infinite',
        'glow-slow': 'glow-slow 7s ease-in-out infinite',
        scan: 'scan 2.8s linear infinite',
        'holo-shift': 'holo-shift 9s linear infinite',
        glitch: 'glitch 7s steps(1) infinite',
        grain: 'grain 1.1s steps(1) infinite',
        wave: 'wave 1s ease-in-out infinite',
        flow: 'flow 1.2s linear infinite',
        'dot-bounce': 'dot-bounce 1.2s ease-in-out infinite',
        'ping-slow': 'ping-slow 2.4s cubic-bezier(0,0,0.2,1) infinite',
        'spin-slow': 'spin-slow 24s linear infinite',
        marquee: 'marquee 42s linear infinite',
        'rise-in': 'rise-in 0.6s cubic-bezier(0.22,1,0.36,1) both'
      }
    }
  },
  plugins: []
};
