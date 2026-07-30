# ── AdminApp API: Node.js + Express + PostgreSQL ──
# Build context: apps/api (Root Directory del servicio en Render/Railway)
FROM node:22-alpine

WORKDIR /app

# Dependencias primero, para aprovechar la cache de capas de Docker.
# sequelize-cli esta en dependencies (no devDependencies) porque se usa en
# runtime para correr las migraciones al arrancar.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Codigo fuente
COPY src/ ./src/

# Directorio temporal para los uploads de importacion (xlsx/csv).
# Es efimero: se pierde en cada deploy y no debe guardar nada persistente.
RUN mkdir -p uploads

ENV NODE_ENV=production

# El PaaS inyecta PORT; 5000 es solo el default local.
EXPOSE 5000

# Las migraciones corren al arrancar. Son idempotentes (sequelize lleva el
# registro en la tabla SequelizeMeta) y si fallan el contenedor no levanta,
# que es el comportamiento deseado.
# OJO: con mas de una replica esto corre N veces en paralelo. Al escalar,
# mover las migraciones a un pre-deploy job.
CMD ["sh", "-c", "npx sequelize-cli db:migrate --config src/config/sequelize-cli.js && node src/server.js"]
