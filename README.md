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
| `OPENAI_BASE_URL`| `https://api.openai.com/v1` | Point at any OpenAI-compatible API.    |

Built-in limits: 20 chat requests per minute per IP (best-effort, see below), 4,000 characters per new message, and the last 20 earlier messages (8,000 characters each) sent as context.

## How chat works (stateless)

The server keeps **no per-user state**. The browser holds the conversation and sends the recent history with every message, so any server instance can answer any request. That is what makes it safe on serverless hosts like Vercel, and it means restarts and redeploys never lose a conversation that is open in the browser.

```
POST /api/chat   { "agentId": "coding-assistant",
                   "message": "What is my name?",
                   "history": [ { "role": "user", "content": "My name is Ada" },
                                { "role": "assistant", "content": "Nice to meet you, Ada!" } ] }
```

The reply streams back as server-sent events (`stream` chunks, then `done`). `history` is optional, only `user` / `assistant` roles are accepted, and refreshing the page starts a new conversation.

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

### Option D — Vercel (free Hobby plan, no card)

1. Sign in at [vercel.com](https://vercel.com) with GitHub.
2. **Add New → Project**, import the repository. Vercel detects Express and runs `server.js` as a serverless function, serving `public/` from its CDN. No build settings needed.
3. Deploy. Every push to `main` redeploys automatically.

`server.js` exports the Express app for this (it only calls `listen()` when run directly), so the same code still works locally, in Docker, and on Render/Railway.

**To turn on real AI:** in the Vercel project go to **Settings → Environment Variables**, add `OPENAI_API_KEY` (tick **Sensitive**), then **redeploy** — variables only apply to new deployments. Chat is stateless (see above), so multi-turn conversations work across serverless instances.

**Rate limiting on serverless:** the built-in per-IP limiter keeps its counters in each instance's memory, so on Vercel it is only a speed bump. For a hard limit, add a rate-limit rule for `/api/chat` under **Firewall** in the Vercel dashboard, and set a monthly spending cap in your OpenAI account.

## Things to know before going public

- **Free tiers sleep.** Render's free web services spin down when idle, so the first visit after a quiet period can take about a minute. Free-tier terms change — check the provider's current pricing page.
- **Conversations live in the browser tab.** Refreshing or closing the page ends them. Add a database if you need saved history across visits.
- **Live mode costs money.** Anyone who can reach your site can spend your OpenAI credits. The per-IP limiter is best-effort (per instance); use a hard limit at your host and set a spending cap in your OpenAI account.
- **Tools are simulated.** `web_search`, `ticket_system`, `email_sender`, etc. return mock output. Nothing is searched, created, or sent.
- **Tailwind runs from its CDN** (`cdn.tailwindcss.com`), which is fine for a demo but not recommended for high-traffic production. Swap in a built stylesheet when you need to.
- **Legal / finance / health agents** are chat templates, not professional advice. The legal reviewer's prompt says so; consider adding a visible disclaimer for the others.
