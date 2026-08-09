# ── Favalio Landing: React + TS + Vite (estatica) ──
# Solo se usa para Railway/self-host. En Vercel el build es nativo (ver vercel.json).
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# Las VITE_* se hornean en el bundle en tiempo de build, no se leen en runtime.
ARG VITE_APP_URL
ARG VITE_CONTACT_EMAIL
RUN npm run build

# ── Runtime: nginx estatico ──
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
