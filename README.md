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
│   └── landing/    Landing pública · React 19 + TypeScript + Vite + Tailwind 4
├── docs/           Documentación y especificaciones (spec-kit)
├── legacy/         Código PHP original, previo a la migración. Solo referencia.
├── render.yaml     Blueprint de Render para la API
└── .env.example    Referencia única de variables de entorno
```

Es un **monorepo aislado**: cada app mantiene su propio `package.json` y su
propio lockfile. No usa npm workspaces, porque las plataformas de deploy
construyen cada servicio con un *Root Directory* distinto y desde ahí no verían
un lockfile ubicado en la raíz.

---

## Arquitectura de deploy

| App | Plataforma | Dominio previsto |
|---|---|---|
| `apps/landing` | Vercel | `favalio.com` |
| `apps/web` | Vercel | `app.favalio.com` |
| `apps/api` | Render | `api.favalio.com` |
| PostgreSQL | Neon | — |

La landing y la app se despliegan por separado. La landing enlaza a la app vía
`VITE_APP_URL`; el CTA de prueba gratis apunta a `<app>/?signup=true`, que la
app traduce a `screen_hint=signup` de Auth0.

---

## Desarrollo local

Requiere **Node 22+** y una base PostgreSQL (local o Neon).

```bash
# 1. Dependencias de las tres apps
npm run install:all

# 2. Configurar entorno
cp .env.example apps/api/.env       # completar bloque API
cp .env.example apps/web/.env       # completar bloque WEB
cp .env.example apps/landing/.env   # completar bloque LANDING

# 3. Migraciones
npm run migrate

# 4. Levantar todo (api :5000, web :5173, landing :5174)
npm install          # instala concurrently en la raíz
npm run dev
```

Cada app se puede levantar sola con `npm run dev:api`, `dev:web` o `dev:landing`.

### Otros comandos

```bash
npm run build     # buildea web + landing
npm test          # tests de la API (jest)
npm run lint      # eslint en web + landing
```

---

## Deploy

### PostgreSQL — Neon

1. Crear un proyecto en [neon.tech](https://neon.tech).
2. Copiar el connection string **pooled** (el host termina en `-pooler`).
   Neon free autosuspende la base a los 5 min de inactividad y el pooler
   maneja mejor la reconexión.
3. Ese string va en `DATABASE_URL` de la API.

### API — Render

Vía Blueprint (recomendado): *New → Blueprint* apuntando a este repo. Render
lee `render.yaml` y crea el servicio con `rootDir: apps/api` ya configurado.

Manualmente: *New → Web Service*, runtime **Docker**, y **Root Directory** en
`apps/api`.

Después cargar en el dashboard las variables marcadas `sync: false` en
`render.yaml`. Sin `AUTH0_DOMAIN` y `AUTH0_AUDIENCE` el servidor no arranca.

Las migraciones corren solas en el arranque del contenedor.

### Web y Landing — Vercel

Un proyecto de Vercel por app:

| | Root Directory | Variables |
|---|---|---|
| web | `apps/web` | `VITE_API_URL`, `VITE_AUTH0_*`, `VITE_API_TIMEOUT` |
| landing | `apps/landing` | `VITE_APP_URL`, `VITE_CONTACT_EMAIL` |

Vercel autodetecta Vite y lee el `vercel.json` de cada app.

> Las `VITE_*` se hornean en el bundle **durante el build**. Cambiar una en el
> dashboard no tiene efecto hasta redesplegar.

### Después de desplegar

Actualizar en la API `ALLOWED_ORIGINS` con los dominios reales de web y landing
(lista separada por comas), y `FRONTEND_URL` con el de la app.

En Auth0, agregar el dominio de la app a *Allowed Callback URLs*, *Allowed Logout
URLs* y *Allowed Web Origins*.

### Dominio propio

`favalio.com` está registrado en Hostinger, que actúa solo como DNS: la landing
y la app siguen en Vercel y la API en Render. El paso a paso —registros DNS,
variables a actualizar y verificación— está en
[docs/DOMINIO-HOSTINGER.md](docs/DOMINIO-HOSTINGER.md).

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
  se procesan los vencimientos de suscripción. Requiere plan pago o un cron
  externo.
- **Neon free autosuspende** a los 5 min. Sequelize reintenta la conexión, pero
  la primera query tras la suspensión puede tardar.
- **Sin disco persistente.** Por eso los logos de empresa se guardan como data
  URI en la base y no en el filesystem, que es efímero en las tres plataformas.
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
