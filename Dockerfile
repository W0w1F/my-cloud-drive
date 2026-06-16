FROM node:20-alpine

WORKDIR /app

COPY backend/api/package.json backend/api/package-lock.json ./

RUN npm ci --omit=dev

COPY backend/api/ ./
COPY frontend/src/ ../frontend/src/
COPY backend/sql/ ../backend/sql/

RUN mkdir -p /app/uploads /app/storage/blocks

EXPOSE 8081

ENV NODE_ENV=production

CMD ["node", "server.js"]
