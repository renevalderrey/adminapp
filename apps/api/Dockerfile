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

# Copia de los scripts operativos (migraciones con lock, respaldos,
# administracion de suscripciones).
COPY scripts/ ./scripts/

# Las migraciones corren al arrancar, a traves de scripts/migrar.js, que toma
# un advisory lock de PostgreSQL antes de aplicarlas.
#
# Sin el lock, al escalar a varias instancias todas arrancan a la vez y todas
# migran en paralelo sobre la misma base: dos pueden leer "esta migracion
# falta", ejecutarla ambas, y la segunda fallar con la tabla ya modificada.
#
# Si la migracion falla, el contenedor no levanta. Es el comportamiento
# deseado: es preferible no arrancar a arrancar con el schema a medio migrar.
CMD ["sh", "-c", "node scripts/migrar.js && node src/server.js"]
