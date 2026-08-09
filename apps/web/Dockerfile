# ── Favalio Web: React + Vite SPA ──
# Solo se usa para Railway/self-host. En Vercel el build es nativo (ver vercel.json).
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# Las VITE_* se hornean en el bundle en tiempo de build, no se leen en runtime.
# Cambiar cualquiera de estas exige rebuildear la imagen.
ARG VITE_API_URL
ARG VITE_AUTH0_DOMAIN
ARG VITE_AUTH0_CLIENT_ID
ARG VITE_AUTH0_AUDIENCE
ARG VITE_LANDING_URL
RUN npm run build

# ── Runtime: nginx estatico ──
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
