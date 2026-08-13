FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional
COPY lib ./lib
COPY services ./services

ENV NODE_ENV=production
EXPOSE 10000
CMD ["node", "--expose-gc", "--import", "tsx", "services/ais-ingest.ts"]
