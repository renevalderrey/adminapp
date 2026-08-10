# ── Favalio Web: React + Vite SPA ──
#
# Es la imagen que levanta el VPS (docker-compose.produccion.yml). En Vercel,
# que queda como alternativa, el build es nativo (ver vercel.json).
#
# ⚠ El contexto de build es **la raíz del repositorio**, no `apps/web`:
# el `package-lock.json` del monorepo vive arriba.
#
#   docker build -f apps/web/Dockerfile -t favalio-web .
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/

# ⚠ El manifiesto del paquete va ANTES del `npm ci`, igual que en la imagen de
# la API: npm crea el enlace del workspace durante la instalación, y si el
# directorio todavía no existe el enlace queda colgado.
#
# Acá el síntoma es distinto y peor de encontrar: `apps/web` importa
# `@favalio/precios` desde `store/useStore.js`, así que sin esto **el `vite
# build` falla dentro del contenedor** —no en runtime— con un «failed to
# resolve import». Y no lo veía ningún job del CI, que construye la imagen de la
# API y no ésta.
COPY packages/precios/package.json ./packages/precios/

RUN npm ci --workspace apps/web --include-workspace-root

# El código del paquete, ya con el enlace creado por el `npm ci` de arriba.
COPY packages/precios/ ./packages/precios/

COPY apps/web/ ./apps/web/

# Las VITE_* se hornean en el bundle en tiempo de build, no se leen en runtime.
# Cambiar cualquiera de estas exige rebuildear la imagen.
ARG VITE_API_URL
ARG VITE_API_TIMEOUT
ARG VITE_AUTH0_DOMAIN
ARG VITE_AUTH0_CLIENT_ID
ARG VITE_AUTH0_AUDIENCE
ARG VITE_LANDING_URL

WORKDIR /app/apps/web
RUN npm run build

# ── Runtime: nginx estatico ──
FROM nginx:alpine

COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
