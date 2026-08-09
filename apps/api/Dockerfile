# ── Favalio API: Node.js + Express + PostgreSQL ──
#
# ⚠ El contexto de build es **la raíz del repositorio**, no `apps/api`.
# Desde que el monorepo usa workspaces, el `package-lock.json` es uno solo y
# vive arriba: sin él en el contexto, `npm ci` no tiene qué respetar y la
# imagen podría quedar con versiones distintas de las que se probaron.
#
#   docker build -f apps/api/Dockerfile -t favalio-api .
#
# El .dockerignore que aplica es el de la raíz.
FROM node:22-alpine

WORKDIR /app

# Dependencias primero, para aprovechar la cache de capas de Docker.
# El manifiesto de la raíz declara los workspaces; el de la app, sus
# dependencias. Se copian los dos y nada más: así un cambio en el código
# no invalida la capa de `npm ci`.
#
# sequelize-cli esta en dependencies (no devDependencies) porque se usa en
# runtime para correr las migraciones al arrancar.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/

# El manifiesto del paquete va ANTES del `npm ci`, y el código después.
#
# npm crea el enlace del workspace durante la instalación. Si el directorio no
# existe todavía, el enlace queda colgado y el `require('@favalio/precios')`
# falla **al arrancar en producción**, no en el build: la imagen se construye
# entera, se sube, y el contenedor no levanta.
COPY packages/precios/package.json ./packages/precios/

# `--include-workspace-root` hace falta: sin eso npm no instala lo que declara
# el manifiesto de arriba y el árbol queda incompleto.
#
# ⚠ Si una versión de npm de la imagen base diera problemas con `--workspace`,
# el respaldo es `npm ci --omit=dev` a secas: es **correcto** —instala todos
# los workspaces— y solo más gordo. Eso se nota en el tamaño de la imagen, no
# en un error raro en runtime.
RUN npm ci --omit=dev --workspace apps/api --include-workspace-root

# El código del paquete, ya con el enlace creado por el `npm ci` de arriba.
COPY packages/precios/ ./packages/precios/

# Codigo fuente
COPY apps/api/src/ ./apps/api/src/

# .sequelizerc le dice a sequelize-cli donde viven las migraciones. El script
# de arranque ya pasa --migrations-path explicito, asi que no depende de este
# archivo, pero se copia igual para que un `npx sequelize-cli` corrido a mano
# dentro del contenedor encuentre todo en su lugar.
COPY apps/api/.sequelizerc ./apps/api/

# Copia de los scripts operativos (migraciones con lock, respaldos,
# administracion de suscripciones).
COPY apps/api/scripts/ ./apps/api/scripts/

# Directorio temporal para los uploads de importacion (xlsx/csv).
# Es efimero: se pierde en cada deploy y no debe guardar nada persistente.
RUN mkdir -p apps/api/uploads

ENV NODE_ENV=production

# El PaaS inyecta PORT; 5000 es solo el default local.
EXPOSE 5000

# El WORKDIR final es el de la app, no el de la raíz: los comandos operativos
# documentados (`node scripts/migrar.js`, `node scripts/backup.js`) son
# relativos a la app, y el CI los corre así dentro del contenedor.
# Node resuelve las dependencias subiendo hasta /app/node_modules.
WORKDIR /app/apps/api

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
