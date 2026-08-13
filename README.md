# Favalio

SaaS multi-tenant de gestión comercial: punto de venta, stock multi-sucursal,
proveedores, producción, cuentas corrientes, flujo de caja, impuestos y
facturación electrónica AFIP.

> **Nota sobre la marca.** Comprafit es un **cliente** del producto — de ahí
> salió la base del proyecto — no el producto en sí. La marca es Favalio.

---

## Estructura

```
favalio/
├── apps/
│   ├── api/        API REST · Node + Express 5 + Sequelize + PostgreSQL + Auth0
│   ├── web/        SPA de la aplicación · React 19 + Vite + Tailwind 4
│   ├── tienda/     Tienda pública del catálogo · React 19 + Vite
│   └── landing/    Landing pública · React 19 + TypeScript + Vite + Tailwind 4
├── packages/
│   ├── precios/    Cálculo de precios, compartido entre api y web
│   └── pedido/     Totales y estados de pedido, compartidos
├── docs/           Documentación y especificaciones (spec-kit)
├── legacy/         Código PHP original, previo a la migración. Solo referencia.
├── render.yaml     Blueprint de Render para la API
└── .env.example    Referencia única de variables de entorno
```

Es un monorepo con **npm workspaces**: un solo `package-lock.json`, en la raíz,
y las dependencias instaladas de una sola vez con `npm ci` desde ahí.

> Antes cada app tenía su propio lockfile, para que las plataformas de deploy
> pudieran construir cada servicio con un *Root Directory* distinto. Los
> paquetes de `packages/` no se pueden compartir así, y el cambio tiene un
> precio: el build de cada plataforma necesita ver la raíz. Cómo se configura
> eso está en [docs/DESPLIEGUE-PAAS.md](docs/DESPLIEGUE-PAAS.md) §2 y §3.

---

## Arquitectura de deploy

| App | Dónde corre | Dominio |
|---|---|---|
| `apps/landing` | contenedor nginx en el VPS | `favalio.com` |
| `apps/web` | contenedor nginx en el VPS | `app.favalio.com` |
| `apps/tienda` | contenedor nginx en el VPS | `tienda.favalio.com` |
| `apps/api` | contenedor Node en el VPS | `api.favalio.com` |
| PostgreSQL | contenedor en el VPS, disco propio | — |
| TLS y ruteo | Caddy, en el VPS | — |

Todo vive en un VPS de Hostinger, descripto en `docker-compose.produccion.yml`
y `deploy/Caddyfile`. El paso a paso está en
[docs/DESPLIEGUE-HOSTINGER.md](docs/DESPLIEGUE-HOSTINGER.md).

La landing y la app se despliegan por separado. La landing enlaza a la app vía
`VITE_APP_URL`; el CTA de prueba gratis apunta a `<app>/?signup=true`, que la
app traduce a `screen_hint=signup` de Auth0.

---

## Desarrollo local

Requiere **Node 22+** y una base PostgreSQL (local o Neon).

```bash
# 1. Dependencias de todo el monorepo, de una sola vez
npm ci

# 2. Configurar entorno
cp .env.example apps/api/.env       # completar bloque API
cp .env.example apps/web/.env       # completar bloque WEB
cp .env.example apps/landing/.env   # completar bloque LANDING

# 3. Migraciones
npm run migrate

# 4. Levantar todo (api :5000, web :5173, landing :5174)
npm run dev
```

> El monorepo usa **workspaces de npm**: hay un solo `package-lock.json`, en la
> raíz, y un solo `node_modules` (con lo que entre en conflicto anidado adentro
> de la app que lo pida). **No corras `npm install` adentro de `apps/`**: crea
> un árbol paralelo que después el `npm ci` de la raíz borra, y el síntoma es un
> build que deja de andar sin que nada haya cambiado.

Cada app se puede levantar sola con `npm run dev:api`, `dev:web` o `dev:landing`.

### Otros comandos

```bash
npm run build     # buildea web + landing
npm test          # tests de la API (jest)
npm run lint      # eslint en web + landing
```

---

## Deploy

### Hostinger — la pila completa en un VPS

Las cinco piezas (landing, web, API, PostgreSQL y Caddy) corren en un VPS,
descriptas en `docker-compose.produccion.yml`. En el servidor:

```bash
git clone <este repo> /opt/favalio && cd /opt/favalio
cp .env.produccion.example .env && nano .env    # dominio, Auth0, Resend, clave de la base
docker compose -f docker-compose.produccion.yml up -d --build
```

Caddy emite y renueva los certificados TLS solo; la API corre las migraciones
al arrancar; PostgreSQL queda publicado únicamente en `127.0.0.1`.

El paso a paso completo —qué plan contratar, registros DNS, endurecimiento del
servidor, Auth0, correo, respaldos y actualizaciones— está en
[docs/DESPLIEGUE-HOSTINGER.md](docs/DESPLIEGUE-HOSTINGER.md).

> Hace falta un **VPS** —Hostinger KVM, DonWeb, o cualquiera con Docker—. El
> hosting *compartido* no sirve: no corre Node.js ni PostgreSQL. La diferencia
> es el tipo de plan, no el proveedor.

> Las `VITE_*` se hornean en el bundle **durante el build**: cambiar una en el
> `.env` no tiene efecto hasta un `up -d --build`.

### Alternativa PaaS — Neon + Vercel + Render

Paso a paso en [docs/DESPLIEGUE-PAAS.md](docs/DESPLIEGUE-PAAS.md). Base en Neon,
los tres frontends en Vercel (un proyecto por app), API en Render con Docker, y
el dominio en Hostinger haciendo sólo de DNS.

Es el esquema para **probar en línea sin pagar**. Lo que en el VPS resuelve Caddy
—el mismo origen para la tienda y la API pública, el `/c/:slug` que sirve la API,
las fotos— acá se reparte entre `render.yaml` y los `vercel.json`. Y las
variables que el compose arma solas a partir de `DOMINIO` (`ALLOWED_ORIGINS`,
`FRONTEND_URL`, `LANDING_URL`, `URL_DE_LA_TIENDA`) se cargan a mano en Render.

⚠ Las fotos de productos quedan **efímeras**: el disco de Render free se borra en
cada deploy. Alcanza para probar, no para vender.

### En cualquiera de los dos

En Auth0, agregar el dominio de la app a *Allowed Callback URLs*, *Allowed Logout
URLs* y *Allowed Web Origins*.

---

## Operación

Runbook completo en [docs/OPERACION.md](docs/OPERACION.md): qué mirar cuando
algo falla, cómo respaldar y restaurar, cómo activar una suscripción, y la
lista de lo que hay que hacer antes del primer cliente real.

```bash
npm --prefix apps/api run db:migrate              # migraciones (con lock)
npm --prefix apps/api run backup -- --todas       # respaldo de todas las empresas
npm --prefix apps/api run suscripcion -- listar   # estado de las suscripciones
```

Health check: `GET /api/health` verifica que se pueda consultar la base.
`GET /api/ping` solo dice que el proceso responde.

---

## Limitaciones conocidas de los planes gratuitos

Aplican durante la fase de desarrollo; desaparecen al pasar a planes pagos.

- **Render free duerme el servicio** tras 15 min sin tráfico. El primer request
  posterior tarda ~50 s. Por eso el timeout de axios está en 60 s
  (`VITE_API_TIMEOUT`).
- **`subscriptionCron` no corre de forma confiable**: con el servicio dormido no
  se procesan los vencimientos de suscripción. Lo cubre
  `.github/workflows/tareas-diarias.yml`, que despierta el servicio una vez por
  día; hace falta cargar `API_URL` y `CRON_SECRET` como secretos del repositorio.
- **Neon free autosuspende** a los 5 min. Sequelize reintenta la conexión, pero
  la primera query tras la suspensión puede tardar.
- **Sin disco persistente.** Por eso los logos de empresa se guardan como data
  URI en la base y no en el filesystem, que es efímero en las tres plataformas.
  Las **fotos de productos** sí van al filesystem —son grandes y se sirven por
  URL—, así que en el esquema PaaS se pierden en cada deploy. En el VPS viven en
  un volumen y no.
- **Migraciones al arrancar.** Funciona con una sola instancia. Al escalar a
  varias réplicas hay que moverlas a un pre-deploy job, o correrían en paralelo.

---

## Migración futura a Railway

Los `Dockerfile` de las tres apps ya sirven para Railway sin cambios. Al migrar:
un proyecto con cuatro servicios (`api`, `web`, `landing` y PostgreSQL),
apuntando el *Root Directory* de cada uno a su carpeta en `apps/`.

Las referencias entre servicios conviene resolverlas con las variables de
Railway (`${{Postgres.DATABASE_URL}}`, `${{api.RAILWAY_PUBLIC_DOMAIN}}`) en vez
de hardcodear URLs.
