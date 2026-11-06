// Vercel entry point. The whole Express app (server.js) runs as one function for every /api/* request.
// The built React app in public/ is served by Vercel's CDN as static output (see vercel.json), not by this function.
module.exports = require('../server.js');
