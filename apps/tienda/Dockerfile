# ── Favalio Tienda: React + Vite (estatica) ──
#
# La tienda pública: lo que se abre escaneando el QR del mostrador. No comparte
# imagen con `apps/web` — ni sistema de diseño, ni Auth0, ni cliente HTTP.
#
# ⚠ El contexto de build es **la raíz del repositorio**, no `apps/tienda`:
# el `package-lock.json` del monorepo vive arriba.
#
#   docker build -f apps/tienda/Dockerfile -t favalio-tienda .
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/tienda/package.json ./apps/tienda/
RUN npm ci --workspace apps/tienda --include-workspace-root

COPY apps/tienda/ ./apps/tienda/

# Sin ARG VITE_*: la tienda no tiene ninguna variable que hornear. Habla contra
# su propio origen con rutas relativas (`/api/publico/...`), así que no hay URL
# de API que configurar por entorno — y no habiendo ninguna, tampoco hay una que
# quede mal apuntada en producción.

WORKDIR /app/apps/tienda
RUN npm run build

# ── Runtime: nginx estatico ──
FROM nginx:alpine

COPY --from=build /app/apps/tienda/dist /usr/share/nginx/html
COPY apps/tienda/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
