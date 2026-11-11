# ---- build the React front end and compile the TypeScript API ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- slim runtime image: compiled API + built front end + production dependencies ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server.js ./
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/public ./public
# Migrations ship with the image; run `npx prisma migrate deploy` (or `npm run release` in the build image) before starting.
COPY prisma ./prisma

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/healthz" || exit 1

CMD ["node", "server.js"]
