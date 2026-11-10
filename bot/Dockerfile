# PokéCofre WhatsApp worker. Build from the repository root:
#   docker build -f bot/Dockerfile -t pokecofre-bot .
#   docker run -e DATABASE_URL=... pokecofre-bot
# Always-on process: one instance only (two instances on the same number would fight over the session).
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY lib ./lib
COPY bot ./bot
RUN npm run bot:build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/bot/dist ./bot/dist
USER node
CMD ["node", "bot/dist/main.mjs"]
