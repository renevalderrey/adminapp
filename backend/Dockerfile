# ── Backend: Node.js + Express + PostgreSQL ──
FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy source
COPY src/ ./src/

# Create uploads directory
RUN mkdir -p uploads

EXPOSE 5000

ENV NODE_ENV=production

CMD ["sh", "-c", "npm run migrate --prefix /app && node src/server.js"]
