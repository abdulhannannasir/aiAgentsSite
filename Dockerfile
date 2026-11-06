FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# Install dependencies first so Docker can cache this layer
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/healthz" || exit 1

CMD ["node", "server.js"]
