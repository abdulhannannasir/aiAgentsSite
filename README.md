# AgentVerse — AI Agent Platform

42 pre-made AI agents (support, coding, content, sales, legal, business, personal, social, daily life) behind a single Node/Express server with a chat UI.

- **Demo mode** (default): works instantly with no API key. Replies are canned greetings plus simulated tool output.
- **Live mode**: set `OPENAI_API_KEY` and every agent answers with a real model, streamed token by token.

```
agentverse-website/
├── server.js          # Express API + agent registry + SSE chat streaming
├── public/index.html  # Frontend (Tailwind CDN, marked, DOMPurify, Prism, Three.js)
├── package.json
├── .env.example
├── render.yaml        # Render blueprint
├── railway.toml       # Railway config
└── Dockerfile         # Any container host
```

## Run locally

```bash
npm install
npm start
```

Open http://localhost:3000.

For live AI replies, copy `.env.example` to `.env` and fill in `OPENAI_API_KEY` (the server reads `.env` automatically), or:

```bash
OPENAI_API_KEY=sk-... npm start
```

The header badge shows **Demo mode** or **Live AI** so you can tell which one you're in.

## Configuration

| Variable         | Default       | Purpose                                              |
| ---------------- | ------------- | ---------------------------------------------------- |
| `PORT`           | `3000`        | Set automatically by Render / Railway.               |
| `OPENAI_API_KEY` | _(empty)_     | Empty = demo mode. Set = real AI replies.            |
| `OPENAI_MODEL`   | `gpt-4o-mini` | Any chat-completions model your key can use.         |

Built-in limits: 20 chat requests per minute per IP, 4,000 characters per message, sessions expire after 1 hour idle.

## Deploy

Every option below needs the code in a **GitHub repository** first:

```bash
cd agentverse-website
git init
git add .
git commit -m "AgentVerse website"
git branch -M main
git remote add origin https://github.com/<your-username>/agentverse-website.git
git push -u origin main
```

### Option A — Render (free tier)

1. Sign in at [render.com](https://render.com) and connect your GitHub account.
2. **New → Blueprint**, pick the repository. Render reads `render.yaml` and fills in everything.
   (Or **New → Web Service** and use build command `npm install`, start command `npm start`.)
3. Optional: in the service's **Environment** tab, add `OPENAI_API_KEY` for live replies.
4. Click **Apply / Deploy**. In a couple of minutes you get a `https://agentverse-website.onrender.com`-style URL.

### Option B — Railway

1. Sign in at [railway.com](https://railway.com) with GitHub.
2. **New Project → Deploy from GitHub repo**, pick the repository. Railway detects Node and reads `railway.toml`.
3. Optional: in **Variables**, add `OPENAI_API_KEY`.
4. In **Settings → Networking**, click **Generate Domain** to get a public URL.

### Option C — Docker (any host: Fly.io, a VPS, Cloud Run, …)

```bash
docker build -t agentverse .
docker run -p 3000:3000 -e OPENAI_API_KEY=sk-... agentverse
```

Omit `-e OPENAI_API_KEY=...` to run in demo mode.

## Things to know before going public

- **Free tiers sleep.** Render's free web services spin down when idle, so the first visit after a quiet period can take about a minute. Free-tier terms change — check the provider's current pricing page.
- **Sessions live in memory.** Restarting or redeploying clears chat history. Add Redis or a database if you need persistence.
- **Live mode costs money.** Anyone who can reach your site can spend your OpenAI credits. The per-IP rate limit helps; also set a spending cap in your OpenAI account.
- **Tools are simulated.** `web_search`, `ticket_system`, `email_sender`, etc. return mock output. Nothing is searched, created, or sent.
- **Tailwind runs from its CDN** (`cdn.tailwindcss.com`), which is fine for a demo but not recommended for high-traffic production. Swap in a built stylesheet when you need to.
- **Legal / finance / health agents** are chat templates, not professional advice. The legal reviewer's prompt says so; consider adding a visible disclaimer for the others.
