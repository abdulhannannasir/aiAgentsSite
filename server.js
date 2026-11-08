// Entry point for `npm start` (local, Docker, Render, Railway). The API lives in server/src (TypeScript) and is
// compiled to server/dist by `npm run build`. Importing this file (Vercel's function does) gives the Express app
// without listening.
import { fileURLToPath } from 'node:url';
import { app, start } from './server/dist/main.js';

export default app;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) start();
