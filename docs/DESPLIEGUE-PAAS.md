# Desplegar Favalio en Neon + Vercel + Render

El otro camino es [DESPLIEGUE-HOSTINGER.md](DESPLIEGUE-HOSTINGER.md), que mete
todo en un VPS. Este documento es el esquema repartido, que es el que sirve para
**probar en línea sin pagar nada**: la base en Neon, los tres frontends en
Vercel, la API en Render y el dominio en Hostinger, que sólo hace de DNS.

> **Para qué sí y para qué no.** Con esto se puede compartir un enlace, entrar
> desde el teléfono, escanear el QR de un catálogo y cargar un pedido de verdad.
> Lo que **no** se puede es operar un comercio: el servicio duerme a los 15
> minutos, el primer pedido después tarda ~50 s, y las fotos subidas se pierden
> en cada deploy (§8). Eso no se arregla configurando mejor: se arregla pagando
> o mudándose al VPS.

---

## 0. El reparto

| Pieza | Dónde corre | Nombre público |
|---|---|---|
| Landing (`apps/landing`) | Vercel | `favalio.com` + `www.favalio.com` |
| Aplicación (`apps/web`) | Vercel | `app.favalio.com` |
| Tienda pública (`apps/tienda`) | Vercel | `tienda.favalio.com` |
| API (`apps/api`) | Render (Docker) | `api.favalio.com` |
| PostgreSQL | Neon | — |
| Correo saliente | Resend | `noreply@favalio.com` |
| DNS | Hostinger | — |

**Lo que Caddy hacía en el VPS, acá lo hacen tres archivos**: `render.yaml`
(la API), `apps/*/vercel.json` (los frontends) y los registros DNS de Hostinger.
No hay un cuarto lugar donde mirar.

### Las tres cosas que Caddy hacía y hay que reponer

Están **ya resueltas en el repositorio**; se documentan porque son las que se
rompen si alguien toca un `vercel.json` sin saber por qué está así.

1. **`/api/publico/*` en el mismo origen que la tienda.** `apps/tienda/src/api.js`
   pide con rutas **relativas**, a propósito: sin CORS no hay preflight que falle
   en silencio. Lo repone el primer `rewrite` de `apps/tienda/vercel.json`.
2. **`/c/:slug` lo sirve la API, no el bundle.** Es la que reemplaza el marcador
   `<!--FAVALIO_META-->` por las etiquetas Open Graph de *ese* catálogo, que es
   lo que WhatsApp lee al compartir el enlace. Lo repone el tercer `rewrite`,
   más la variable `URL_DE_LA_TIENDA` del lado de Render.
3. **`/img/*`.** En el VPS las fotos las sirve Caddy desde un volumen y la API
   ni las mira. Acá las sirve la API detrás de `SERVIR_IMAGENES=true`
   (`server.js`), y los `vercel.json` de **la tienda y la app** las reescriben
   hacia ella. Las dos: el panel dibuja las miniaturas con la misma ruta
   relativa que la tienda, y si sólo estuviera en una, el administrador vería un
   404 en cada foto que el cliente ve perfecta.

---

## 1. Neon — la base

1. [console.neon.tech](https://console.neon.tech) → proyecto (o el que ya
   exista). Región: la más cercana, `aws-us-east-2` sirve.
2. **Connection string**: copiar el **pooled**, el que tiene el host terminado
   en **`-pooler`**. Neon autosuspende a los 5 minutos y el pooler maneja mejor
   la reconexión.

   ```
   postgresql://usuario:clave@ep-algo-123456-pooler.us-east-2.aws.neon.tech/favalio?sslmode=require
   ```

   El `?sslmode=require` va: Neon rechaza toda conexión sin TLS.

3. **No hace falta correr las migraciones a mano.** El `CMD` del Dockerfile
   ejecuta `node scripts/migrar.js` al arrancar el contenedor, con un advisory
   lock de PostgreSQL de por medio. Si una migración falla, el servicio **no
   levanta** — es deliberado, es preferible a arrancar con el schema a medias.

---

## 2. Render — la API

El servicio es Docker y el Dockerfile necesita **la raíz del repositorio como
contexto de build**: el `package-lock.json` es uno solo y vive arriba, junto con
`packages/precios` y `packages/pedido`.

### Si el servicio ya existe (se rompió al pasar a workspaces)

En *Settings* del servicio, esto es lo que hay que corregir:

| Campo | Valor |
|---|---|
| Root Directory | **vacío** (era `apps/api`) |
| Dockerfile Path | `./apps/api/Dockerfile` |
| Docker Build Context Directory | `.` |
| Health Check Path | `/api/health` |

> Con `Root Directory: apps/api` el build muere en la primera línea del
> Dockerfile —`COPY package.json package-lock.json ./`— porque esos archivos no
> están en el contexto. El error que aparece es un `COPY failed`, y no dice nada
> de workspaces.

### Si se crea de cero

*New → Blueprint* apuntando al repositorio: `render.yaml` ya trae todo lo de
arriba, más el `buildFilter` (sólo redespliega si cambió `apps/api/**`,
`packages/**` o el lockfile).

### Variables de entorno

Las carga el dashboard, no el `render.yaml` (van con `sync: false` para que
ningún secreto quede versionado).

| Variable | Valor |
|---|---|
| `DATABASE_URL` | el string **pooled** de Neon, del §1 |
| `AUTH0_DOMAIN` | `tu-tenant.us.auth0.com` |
| `AUTH0_AUDIENCE` | `https://api.favalio.com` |
| `ALLOWED_ORIGINS` | `https://app.favalio.com,https://favalio.com,https://www.favalio.com,https://tienda.favalio.com` |
| `FRONTEND_URL` | `https://app.favalio.com` |
| `LANDING_URL` | `https://favalio.com` |
| `URL_DE_LA_TIENDA` | `https://tienda.favalio.com` |
| `SERVIR_IMAGENES` | `true` (ya viene en el blueprint) |
| `RUTA_DE_IMAGENES` | `/var/favalio/imagenes` (ya viene en el blueprint) |
| `RESEND_API_KEY` | de [resend.com](https://resend.com) |
| `RESEND_FROM_EMAIL` | `noreply@favalio.com` |
| `CRON_SECRET` | `openssl rand -hex 32` — ver §7 |
| `VERCEL_PREVIEW_PATTERN` | opcional: `^https://favalio-.*\.vercel\.app$` |
| `ANTHROPIC_API_KEY` | opcional (extracción de productos por IA) |
| `TIENDANUBE_CLIENT_ID` / `_SECRET` | opcionales |

⚠ **`ALLOWED_ORIGINS` sin espacios y sin barra final.** El origen que manda el
navegador es `https://app.favalio.com`, exacto: una barra de más y el CORS
rechaza en silencio, con la API sana y todas las pantallas en blanco.

⚠ **`tienda.favalio.com` va en `ALLOWED_ORIGINS` aunque la tienda hable por
rutas relativas.** No es para el `fetch` —ése es same-origin—: es para el
`/c/:slug` que la API sirve cuando Vercel se lo reenvía.

### Dominio

*Settings → Custom Domains → Add* → `api.favalio.com`. Render devuelve el
destino del CNAME (algo como `favalio-api.onrender.com`). Anotarlo para el §4.

---

## 3. Vercel — los tres frontends

**Tres proyectos separados, uno por app, todos apuntando al mismo repositorio.**

| Proyecto | Root Directory | Dominio |
|---|---|---|
| `favalio-landing` | `apps/landing` | `favalio.com`, `www.favalio.com` |
| `favalio-web` | `apps/web` | `app.favalio.com` |
| `favalio-tienda` | `apps/tienda` | `tienda.favalio.com` |

### El ajuste que hay que hacer sí o sí en los tres

*Settings → General → Root Directory* → activar
**«Include source files outside of the Root Directory in the Build Step»**.

> Sin eso, Vercel sube sólo `apps/web/` y el build no ve el
> `package-lock.json` de la raíz ni `packages/precios`. El síntoma es
> `Cannot find module '@favalio/precios'` **en el build de Vercel y en ningún
> otro lado**: el CI está verde porque hace `npm ci` desde la raíz.
>
> Es exactamente el cambio que rompió los tres proyectos al pasar el monorepo a
> workspaces. El README todavía dice que el repositorio *no* usa workspaces
> (`README.md:26-29`): eso quedó viejo, `package.json` los declara.

### Los comandos: no tocarlos en el dashboard

`installCommand`, `buildCommand` y `outputDirectory` ya están en cada
`apps/*/vercel.json` y ganan sobre el dashboard. El install es
`cd ../.. && npm ci`: instala el monorepo entero desde la raíz, que es lo mismo
que hace el CI.

Si alguien dejó overrides puestos en *Settings → Build & Development Settings*,
apagarlos: un `npm install` del dashboard corriendo dentro de `apps/web`
reintroduce el problema de arriba.

### Variables de entorno

Las `VITE_*` **se hornean en el bundle durante el build**: cambiar una no tiene
efecto hasta un *Redeploy*, y hay que desmarcar «Use existing Build Cache».

**`favalio-web`:**

| Variable | Valor |
|---|---|
| `VITE_API_URL` | `https://api.favalio.com/api` ← **con `/api` al final** |
| `VITE_API_TIMEOUT` | `60000` — los 60 s son por el cold start de Render, no un capricho |
| `VITE_AUTH0_DOMAIN` | `tu-tenant.us.auth0.com` |
| `VITE_AUTH0_CLIENT_ID` | el del SPA de Auth0 (es público por diseño) |
| `VITE_AUTH0_AUDIENCE` | `https://api.favalio.com` |
| `VITE_TIENDA_URL` | `https://tienda.favalio.com` |
| `VITE_LANDING_URL` | `https://favalio.com` |

**`favalio-landing`:**

| Variable | Valor |
|---|---|
| `VITE_APP_URL` | `https://app.favalio.com` |
| `VITE_CONTACT_EMAIL` | `hola@favalio.com` |

**`favalio-tienda`: ninguna.** No es un olvido —`apps/tienda/src/api.js:27-34`
lo explica—: la tienda no tiene URL de API compilada adentro porque habla
contra su propio origen. Una `VITE_` acá sería justo lo que ese diseño evita.

---

## 4. Hostinger — el DNS

El dominio está **parqueado**: `favalio.com` y `www` resuelven a `2.57.91.91`,
que es la página de «Parked Domain» de Hostinger. No hay nada que preservar ahí.

hPanel → **Dominios → favalio.com → DNS / Nameservers → Registros DNS**.

### Borrar

- El registro **A** de `@` que apunta a `2.57.91.91`.
- El **A** o **CNAME** de `www` que apunte al parking.

### Agregar

| Tipo | Nombre | Apunta a | TTL |
|---|---|---|---|
| A | `@` | el valor que muestra Vercel al agregar el dominio | 300 |
| CNAME | `www` | el valor que muestra Vercel | 300 |
| CNAME | `app` | el valor que muestra Vercel | 300 |
| CNAME | `tienda` | el valor que muestra Vercel | 300 |
| CNAME | `api` | `favalio-api.onrender.com` (el del §2) | 300 |

⚠ **Los valores de Vercel se copian del panel, no de este documento.** Vercel
viene cambiando las IP del ápice y los destinos de CNAME por región
(`76.76.21.21` era el de siempre; los proyectos nuevos reciben otro), y
`cname.vercel-dns.com` convive con destinos regionales más nuevos. El panel
muestra el correcto para *ese* proyecto: es el único valor que no caduca.

⚠ **En el ápice va un A y no un CNAME.** El estándar no admite CNAME en la raíz
de una zona, y Hostinger lo rechaza.

⚠ **No borrar los MX ni los TXT.** Si `hola@favalio.com` es un buzón de
Hostinger, vive en esos registros y no tiene nada que ver con esta migración.
Cambiar el A no afecta al correo; borrar un MX sí.

**TTL en 300** mientras se prueba: si algo quedó mal, se corrige en cinco
minutos en vez de en un día. Subirlo a 3600 cuando esté andando.

Propagación: minutos, no horas, con TTL bajo y el dominio recién saliendo de
parking. Verificar con:

```bash
nslookup app.favalio.com 8.8.8.8
```

Recién cuando eso resuelve, Vercel y Render pueden emitir los certificados: los
dos usan Let's Encrypt y el desafío falla si el nombre todavía no apunta.

---

## 5. Auth0

Aplicación **SPA** del tenant → *Settings*:

| Campo | Valor |
|---|---|
| Allowed Callback URLs | `https://app.favalio.com` |
| Allowed Logout URLs | `https://app.favalio.com` |
| Allowed Web Origins | `https://app.favalio.com` |

Y la **API** del tenant con *Identifier* = `https://api.favalio.com`, que es el
mismo valor que `AUTH0_AUDIENCE` y `VITE_AUTH0_AUDIENCE`. Los tres tienen que
decir exactamente lo mismo: el *audience* es una cadena, no una URL que se
visite, y una diferencia de una barra devuelve 401 en cada request con el login
funcionando.

Si se van a usar los deploy previews de Vercel, agregar también el patrón de
preview a las tres listas, o los previews no van a poder loguear.

---

## 6. El orden, que importa

Hay dos dependencias circulares. Se rompen así:

1. **Neon** — sacar el connection string.
2. **Render** — arreglar el build (§2), cargar las variables **con los nombres
   finales** (`app.favalio.com`, etc.) aunque el DNS todavía no exista. Deploy.
3. **Vercel** — los tres proyectos, con el Root Directory y el toggle del §3.
   Deploy. Quedan andando en `*.vercel.app`.
4. **DNS en Hostinger** (§4). Esperar a que resuelva.
5. **Dominios**: agregarlos en los tres proyectos de Vercel y en Render.
   Esperar los certificados.
6. **Auth0** (§5).
7. **Redeploy de `favalio-web` y `favalio-tienda`**, sin caché de build. Las
   `VITE_*` del paso 3 se hornearon cuando los dominios todavía no existían.

---

## 7. Tareas diarias

El cron de suscripciones corre con `setInterval` dentro del proceso, y en el
plan gratuito el servicio duerme a los 15 minutos: los vencimientos y los avisos
no se procesan. `.github/workflows/tareas-diarias.yml` lo despierta una vez por
día. En *Settings → Secrets and variables → Actions* del repositorio:

| Secreto | Valor |
|---|---|
| `API_URL` | `https://api.favalio.com` — **sin barra final** |
| `CRON_SECRET` | el mismo valor que la variable de Render |

Sin `CRON_SECRET` del lado de la API, `POST /api/tareas/ejecutar` responde 404 a
propósito: no queda una ruta abierta por olvido.

---

## 8. Verificar

```bash
# La API y la base. El primer request después de 15 min tarda ~50 s: es el
# cold start, no un error.
curl -s https://api.favalio.com/api/health

# La landing y la app.
curl -s -o /dev/null -w "%{http_code}\n" https://favalio.com
curl -s -o /dev/null -w "%{http_code}\n" https://app.favalio.com

# La tienda: que /c/<slug> lo conteste la API y traiga las etiquetas Open
# Graph. Si sale el HTML genérico de Vite sin og:title, el rewrite no está
# tomando; si sale «Volvemos en un rato», falta URL_DE_LA_TIENDA en Render.
curl -s https://tienda.favalio.com/c/un-slug-que-exista | grep -o '<meta property="og:[^>]*>'

# CORS, que es lo que más se rompe. Tiene que devolver el origen, no vacío.
curl -s -I -H "Origin: https://app.favalio.com" https://api.favalio.com/api/ping \
  | grep -i access-control-allow-origin
```

---

## 9. Los límites, que son del plan y no de la configuración

- **Render free duerme** a los 15 min sin tráfico; el primer request después
  tarda ~50 s. Por eso `VITE_API_TIMEOUT` está en 60000.
- **Neon free autosuspende** a los 5 min. Sequelize reintenta, pero la primera
  consulta después de la suspensión tarda.
- **Las fotos son efímeras.** `SERVIR_IMAGENES=true` hace que la API sirva
  `/img/*` desde su propio disco, y el disco de Render free se borra en cada
  deploy y en cada reinicio. La base queda apuntando a archivos que ya no
  existen: las miniaturas del panel y las fotos de la tienda pasan a 404 sin que
  cambie ningún dato. **Es aceptable para probar y no lo es para vender.**
- **Un proceso de Node sirviendo archivos estáticos** compite por el mismo event
  loop que las cajas (`utils/imagenes.js`). Con tráfico de prueba no se nota;
  es otro motivo por el que esto no escala.
- **Las migraciones corren al arrancar.** Sirve con una sola instancia. Al
  escalar hay que moverlas a un pre-deploy job.
- **Los logos de empresa** se guardan como data URI en la base justamente por
  esto, y sí sobreviven.

Cuando alguna de estas deje de ser aceptable, el camino es
[DESPLIEGUE-HOSTINGER.md](DESPLIEGUE-HOSTINGER.md): un VPS, un pago, sin servicio
que duerma y con las fotos en un volumen que no se borra.
