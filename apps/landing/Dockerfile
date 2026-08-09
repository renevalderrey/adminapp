# ── Favalio Landing: React + TS + Vite (estatica) ──
#
# Es la imagen que levanta el VPS (docker-compose.produccion.yml). En Vercel,
# que queda como alternativa, el build es nativo (ver vercel.json).
#
# ⚠ El contexto de build es **la raíz del repositorio**, no `apps/landing`:
# el `package-lock.json` del monorepo vive arriba.
#
#   docker build -f apps/landing/Dockerfile -t favalio-landing .
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/landing/package.json ./apps/landing/
RUN npm ci --workspace apps/landing --include-workspace-root

COPY apps/landing/ ./apps/landing/

# Las VITE_* se hornean en el bundle en tiempo de build, no se leen en runtime.
ARG VITE_APP_URL
ARG VITE_CONTACT_EMAIL

WORKDIR /app/apps/landing
RUN npm run build

# ── Runtime: nginx estatico ──
FROM nginx:alpine

COPY --from=build /app/apps/landing/dist /usr/share/nginx/html
COPY apps/landing/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
