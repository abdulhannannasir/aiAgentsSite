// Vercel entry point. The whole Express app runs as one function; vercel.json rewrites every /api/* request
// (including nested paths such as /api/v1/agents) to it, and Express routes on the original URL.
// The built React app in public/ is served by Vercel's CDN as static output, not by this function.
export { default } from '../server.js';
