// Vercel entry point. The whole Express app runs as one function for every /api/* request.
// The built React app in public/ is served by Vercel's CDN as static output (see vercel.json), not by this function.
export { default } from '../server.js';
