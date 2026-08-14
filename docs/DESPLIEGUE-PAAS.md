# Poner Favalio en línea — Neon + Vercel + Render

Guía para **copiar y pegar**. Asume que las cuentas ya existen y que el
repositorio ya está asociado: acá sólo se edita configuración.

El otro camino, todo en un VPS, es [DESPLIEGUE-HOSTINGER.md](DESPLIEGUE-HOSTINGER.md).

> **Para qué sirve esto y para qué no.** Alcanza para compartir un enlace,
> entrar desde el teléfono, escanear el QR de un catálogo y cargar un pedido de
> verdad. **No** alcanza para operar un comercio: el servicio duerme a los 15
> minutos, el primer pedido después tarda ~50 s, y las fotos subidas se pierden
> en cada deploy (§9). Eso no se arregla configurando mejor.

---

## Los cinco valores que salen de otro lado

Todo lo demás en esta guía está listo para pegar tal cual. Estos cinco los
tenés que traer vos. Anotalos acá antes de empezar y después seguí de corrido:

| Marcador | De dónde sale |
|---|---|
| `PEGAR_DATABASE_URL` | Neon, §1 |
| `PEGAR_AUTH0_DOMAIN` | Auth0 → Applications → tu SPA → *Domain*. Sin `https://` |
| `PEGAR_AUTH0_CLIENT_ID` | Auth0 → Applications → tu SPA → *Client ID* |
| `PEGAR_RESEND_API_KEY` | [resend.com](https://resend.com) → API Keys |
| `PEGAR_CRON_SECRET` | lo generás vos, §8 |

⚠ **Este archivo está versionado: no pegar los valores reales acá.** Los
marcadores se reemplazan al pegar en cada panel, no en el documento.

---

## Checklist

- [ ] §1 Neon — copiar el connection string *pooled*, y limpiar el esquema si la
      base viene de antes de las migraciones
- [ ] §2 Render — corregir el build (es lo que rompió el servicio)
- [ ] §3 Render — pegar las variables
- [ ] §4 Vercel — los tres proyectos, con el toggle del monorepo
- [ ] §5 Vercel — pegar las variables de cada uno
- [ ] §6 Hostinger — los cinco registros DNS
- [ ] §7 Auth0 — las tres listas de URLs
- [ ] §8 GitHub — dos secretos
- [ ] §9 Verificar

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

Lo que en el VPS hace Caddy, acá lo hacen tres archivos ya versionados:
`render.yaml`, `apps/*/vercel.json` y los registros DNS. No hay un cuarto lugar
donde mirar.

---

## 1. Neon

[console.neon.tech](https://console.neon.tech) → tu proyecto → **Connection
string**.

Copiar el **pooled**: el host termina en **`-pooler`**. Neon autosuspende a los
5 minutos y el pooler maneja mejor la reconexión.

Tiene que verse así:

```
postgresql://usuario:clave@ep-algo-123456-pooler.us-east-2.aws.neon.tech/favalio?sslmode=require
```

- Si el host **no** dice `-pooler`, estás copiando el directo. Cambiar el
  selector a *Pooled connection*.
- El `?sslmode=require` va incluido. Neon rechaza toda conexión sin TLS.

**Las migraciones no se corren a mano**: el `startCommand` las aplica al
arrancar, con un advisory lock de PostgreSQL. Si una falla, el servicio no
levanta — es deliberado, es preferible a arrancar con el schema a medias.

### Si el deploy muere con «constraint … already exists»

```
== 20260531-initial-schema: migrating =======
ERROR: constraint "brands_empresa_id_empresas_fk" for relation "brands" already exists
```

**La base tiene el esquema pero `SequelizeMeta` está vacía.** Pasa cuando esa
base se creó con `sequelize.sync()`, antes de que existieran las migraciones —
es la historia de la base vieja, y está contada en el encabezado de
`20260806-esquema-de-permisos.js`.

Por qué falla justo ahí y no antes: `createTable` de Sequelize emite
`CREATE TABLE IF NOT EXISTS`, así que las 30 primeras líneas de la migración no
hacen nada y no se quejan. `addConstraint` es un `ALTER TABLE` a secas, sin
`IF NOT EXISTS`: es la primera línea que se encuentra con la realidad.

El reintento infinito que se ve en el log es Render relanzando el proceso.

**La salida es empezar con el esquema limpio.** Neon Console → SQL Editor:

```sql
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO PUBLIC;
```

> ⚠ **Eso borra todas las tablas y todos los datos de esa base, y no se puede
> deshacer.** Antes de correrlo, mirar qué hay:
>
> ```sql
> SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1;
> ```
>
> Si hay algo que interese, la alternativa es crear una base nueva en el mismo
> proyecto de Neon y apuntar `DATABASE_URL` ahí: la vieja queda intacta.

Después, en Render: *Manual Deploy → Deploy latest commit*. Las 30 migraciones
corren de cero y la base queda con la misma forma que la del CI y la del VPS.

Verificar que quedó bien:

```sql
SELECT count(*) FROM "SequelizeMeta";
```

Tiene que devolver **30**.

---

## 2. Render — el build

> **El servicio corre el runtime nativo de Node, no Docker.** El Dockerfile de
> `apps/api` existe y funciona —lo construye el CI, es lo que corre en el VPS—
> pero el servicio de Render está creado como Node, y Render **no deja cambiarle
> el runtime a un servicio existente**: habría que crear otro, migrarle las
> variables y el dominio, y borrar el viejo. Por eso `render.yaml` dice
> `runtime: node`. Si en el panel no ves campos de Docker, es esto y está bien.

Dashboard → servicio **favalio-api** → **Settings**. Cuatro campos:

| Campo | Valor |
|---|---|
| Root Directory | `apps/api` |
| Build Command | `cd ../.. && npm ci --omit=dev --workspace apps/api --include-workspace-root` |
| Start Command | `npm run migrate && node src/server.js` |
| Health Check Path | `/api/health` |

Para pegar:

```
apps/api
```

```
cd ../.. && npm ci --omit=dev --workspace apps/api --include-workspace-root
```

```
npm run migrate && node src/server.js
```

```
/api/health
```

⚠ **El install sale de `apps/api` antes de correr, y no es un rodeo.** Desde que
el monorepo usa workspaces el `package-lock.json` es uno solo y vive en la raíz:
un `npm ci` lanzado dentro de `apps/api` falla, porque npm exige que corra en la
raíz del workspace. `npm install` a secas parece funcionar —npm sube solo hasta
la raíz— pero ignora el lockfile, que es justo lo que un deploy no debería hacer.

*Save Changes*. Todavía no hace falta desplegar: falta el §3.

---

## 3. Render — las variables

**Environment → Environment Variables → Add from .env**, y pegar este bloque
entero de una sola vez (reemplazando los cinco marcadores del principio):

```dotenv
NODE_VERSION=22
DATABASE_URL=PEGAR_DATABASE_URL
AUTH0_DOMAIN=PEGAR_AUTH0_DOMAIN
AUTH0_AUDIENCE=https://api.favalio.com
ALLOWED_ORIGINS=https://app.favalio.com,https://favalio.com,https://www.favalio.com,https://tienda.favalio.com
FRONTEND_URL=https://app.favalio.com
LANDING_URL=https://favalio.com
URL_DE_LA_TIENDA=https://tienda.favalio.com
SERVIR_IMAGENES=true
RUTA_DE_IMAGENES=/opt/render/project/src/imagenes
RESEND_API_KEY=PEGAR_RESEND_API_KEY
RESEND_FROM_EMAIL=noreply@favalio.com
CRON_SECRET=PEGAR_CRON_SECRET
VERCEL_PREVIEW_PATTERN=^https://favalio-.*\.vercel\.app$
LOG_LEVEL=info
```

Opcionales, sólo si las vas a usar:

```dotenv
ANTHROPIC_API_KEY=
TIENDANUBE_CLIENT_ID=
TIENDANUBE_CLIENT_SECRET=
SENTRY_DSN=
```

Cinco cosas que se rompen seguido:

- ⚠ **`NODE_VERSION=22`.** Los `package.json` declaran `"node": ">=22"`, y Render
  lo lee como «la última que haya»: el primer deploy de este servicio arrancó en
  **Node 26.7.0**, un major que no probó nadie. El CI corre en 22 y el Dockerfile
  es `node:22-alpine`. Render mira esta variable antes que `engines`.
- ⚠ **`RUTA_DE_IMAGENES` NO es `/var/favalio/imagenes`**, que es la ruta del
  volumen del VPS. En el runtime nativo el proceso no es root y `/var` no se
  puede escribir: la primera foto que suba alguien falla con `EACCES`, y el error
  aparece recién ahí, no al desplegar.
- ⚠ **`ALLOWED_ORIGINS` sin espacios y sin barra final.** El origen que manda el
  navegador es `https://app.favalio.com`, exacto. Una barra de más y el CORS
  rechaza en silencio: la API sana, todas las pantallas en blanco.
- ⚠ **`AUTH0_DOMAIN` sin `https://`** y sin barra. Es `tenant.us.auth0.com`.
- ⚠ **`tienda.favalio.com` va igual en `ALLOWED_ORIGINS`**, aunque la tienda
  hable por rutas relativas. No es para su `fetch` —ése es same-origin—: es para
  el `/c/:slug` que la API sirve cuando Vercel se lo reenvía.

**Dominio**: *Settings → Custom Domains → Add* → pegar:

```
api.favalio.com
```

Render devuelve el destino del CNAME. **No es `favalio-api.onrender.com`**: el
servicio conserva el nombre de antes del rebrand, así que el destino real es
`adminapp-c558.onrender.com`. Copiar el que muestra el panel.
**Anotarlo, va en el §6.**

Ahora sí: *Manual Deploy → Deploy latest commit*.

---

## 4. Vercel — los tres proyectos

Tres proyectos separados, uno por app, los tres sobre el mismo repositorio.
El de la **tienda probablemente no exista todavía**: `apps/tienda` es posterior
a la última vez que esto funcionó.

| Proyecto | Root Directory | Dominio |
|---|---|---|
| `favalio-landing` | `apps/landing` | `favalio.com`, `www.favalio.com` |
| `favalio-web` | `apps/web` | `app.favalio.com` |
| `favalio-tienda` | `apps/tienda` | `tienda.favalio.com` |

Los Root Directory, para pegar:

```
apps/landing
```

```
apps/web
```

```
apps/tienda
```

### El toggle sin el cual ninguno buildea

*Settings → General → Root Directory* → activar:

> ☑ **Include source files outside of the Root Directory in the Build Step**

**En los tres.** Sin eso Vercel sube sólo la carpeta de la app y el build no ve
el `package-lock.json` de la raíz ni `packages/precios`. El síntoma es
`Cannot find module '@favalio/precios'` **en Vercel y en ningún otro lado**: el
CI está verde porque hace `npm ci` desde arriba.

### Lo que NO hay que tocar

*Settings → Build & Development Settings*: **todos los overrides apagados**.
`installCommand`, `buildCommand` y `outputDirectory` ya están en cada
`apps/*/vercel.json` y le ganan al dashboard. El install es `cd ../.. && npm ci`,
que es exactamente lo que hace el CI.

Un `npm install` puesto a mano en el dashboard corre dentro de `apps/web` y
reintroduce el problema de arriba.

### Node

*Settings → General → Node.js Version* → **22.x**. El repositorio declara
`"node": ">=22"` en los cuatro `package.json`.

### Dominios

*Settings → Domains → Add*, uno por proyecto:

```
favalio.com
```

```
www.favalio.com
```

```
app.favalio.com
```

```
tienda.favalio.com
```

Vercel va a mostrar el registro DNS que espera para cada uno. **Anotar esos
valores: son los del §6.**

---

## 5. Vercel — las variables

*Settings → Environment Variables*. Vercel acepta pegar formato `.env` completo
en el campo *Key* (detecta el bloque y lo separa solo).

Marcar los tres entornos: **Production, Preview, Development**.

### favalio-web

```dotenv
VITE_API_URL=https://api.favalio.com/api
VITE_API_TIMEOUT=60000
VITE_AUTH0_DOMAIN=PEGAR_AUTH0_DOMAIN
VITE_AUTH0_CLIENT_ID=PEGAR_AUTH0_CLIENT_ID
VITE_AUTH0_AUDIENCE=https://api.favalio.com
VITE_TIENDA_URL=https://tienda.favalio.com
```

Son seis y son todas: el `Dockerfile` de `apps/web` declara además un
`VITE_LANDING_URL` que ningún archivo de `src/` lee. No hace falta cargarlo.

- ⚠ **`VITE_API_URL` termina en `/api`.** Sin eso, cada llamada pega una ruta
  arriba y devuelve 404.
- ⚠ **`VITE_API_TIMEOUT=60000`** son los 60 s del cold start de Render, no un
  número al azar. Bajarlo hace que el primer request del día falle solo.
- `VITE_AUTH0_CLIENT_ID` es público por diseño: viaja adentro del bundle. El
  *client secret* no se usa en ningún lado, el flujo es PKCE.

### favalio-landing

```dotenv
VITE_APP_URL=https://app.favalio.com
VITE_CONTACT_EMAIL=hola@favalio.com
```

### favalio-tienda

**Ninguna.** No es un olvido: `apps/tienda/src/api.js` habla contra su propio
origen con rutas relativas, sin CORS y sin URL de API compilada adentro. Una
`VITE_` acá sería justo lo que ese diseño evita.

> Las `VITE_*` **se hornean en el bundle durante el build**. Cambiar una no tiene
> efecto hasta un *Redeploy* con **«Use existing Build Cache» desmarcado**.

---

## 6. Hostinger — el DNS

El dominio está **parqueado**: `favalio.com` y `www` resuelven a `2.57.91.91`,
que es la página de «Parked Domain». No hay nada que preservar ahí.

hPanel → **Dominios → favalio.com → DNS / Nameservers → Registros DNS**.

### Borrar

- El registro **A** de `@` que apunta a `2.57.91.91`
- El **A** o **CNAME** de `www` que apunte al parking

⚠ **No tocar los MX ni los TXT.** Si `hola@favalio.com` es un buzón de
Hostinger, vive ahí y no tiene nada que ver con esto. Cambiar el A no afecta al
correo; borrar un MX sí.

### Agregar

| Tipo | Nombre | Apunta a | TTL |
|---|---|---|---|
| A | `@` | `216.198.79.1` | 300 |
| CNAME | `www` | `cname.vercel-dns.com` | 300 |
| CNAME | `app` | `cname.vercel-dns.com` | 300 |
| CNAME | `tienda` | `cname.vercel-dns.com` | 300 |
| CNAME | `api` | `adminapp-c558.onrender.com` | 300 |

⚠ **Los valores de Vercel se copian del panel si difieren de estos.** Vercel
viene cambiando la IP del ápice y los destinos de CNAME por región: `76.76.21.21`
era el de siempre, `216.198.79.1` es el de los proyectos nuevos, y algunos
reciben un destino regional en vez de `cname.vercel-dns.com`. Lo que muestra el
panel al agregar el dominio manda sobre esta tabla.

⚠ **En el ápice va un A y no un CNAME.** El estándar no admite CNAME en la raíz
de una zona y Hostinger lo rechaza.

**TTL en 300** mientras probás: un error se corrige en cinco minutos en vez de en
un día. Subirlo a 3600 cuando esté andando.

Verificar antes de seguir:

```bash
nslookup app.favalio.com 8.8.8.8
nslookup api.favalio.com 8.8.8.8
nslookup tienda.favalio.com 8.8.8.8
```

Recién cuando eso resuelve, Vercel y Render pueden emitir los certificados: los
dos usan Let's Encrypt y el desafío falla si el nombre todavía no apunta.

---

## 7. Auth0

**Applications → tu SPA → Settings.** Tres campos, pegar tal cual:

*Allowed Callback URLs*

```
https://app.favalio.com
```

*Allowed Logout URLs*

```
https://app.favalio.com
```

*Allowed Web Origins*

```
https://app.favalio.com
```

**Sin barra final en ninguno.** La app usa `window.location.origin`, que no la
lleva, y Auth0 compara la cadena exacta.

Si querés que los deploy previews de Vercel también puedan loguear, agregá a las
tres listas —separado por coma— el dominio del preview.

### La API del tenant

**APIs → tu API → Settings.** El *Identifier* tiene que ser exactamente:

```
https://api.favalio.com
```

Ese valor aparece **tres veces** y las tres tienen que decir lo mismo:
`AUTH0_AUDIENCE` en Render (§3), `VITE_AUTH0_AUDIENCE` en Vercel (§5) y el
Identifier acá. Es una cadena, no una URL que se visite: una barra de
diferencia devuelve 401 en cada request con el login andando perfecto.

---

## 8. GitHub — las tareas diarias

El cron de suscripciones corre con `setInterval` dentro del proceso, y en el
plan gratuito el servicio duerme a los 15 minutos: los vencimientos no se
procesan y los avisos no salen. `.github/workflows/tareas-diarias.yml` lo
despierta una vez por día, y **hoy está en rojo porque le faltan estos dos
secretos**.

Generar el secreto:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Repositorio → **Settings → Secrets and variables → Actions → New repository
secret**:

| Name | Secret |
|---|---|
| `API_URL` | `https://api.favalio.com` |
| `CRON_SECRET` | el que generaste, **el mismo** que pusiste en Render (§3) |

```
https://api.favalio.com
```

⚠ **Sin barra final** en `API_URL`.

Sin `CRON_SECRET` del lado de la API, `POST /api/tareas/ejecutar` responde 404 a
propósito: no queda una ruta abierta por olvido.

Probar sin esperar al día siguiente: pestaña **Actions → Tareas diarias → Run
workflow**.

---

## 9. Verificar

En este orden. Cada comando prueba algo distinto y el que falla dice dónde
mirar.

```bash
# 1 · La API y la base. El primer request después de 15 min tarda ~50 s: es el
#     cold start, no un error. Tiene que decir "ok".
curl -s https://api.favalio.com/api/health
```

```bash
# 2 · La landing y la app. Los dos, 200.
curl -s -o /dev/null -w "landing %{http_code}\n" https://favalio.com
curl -s -o /dev/null -w "app     %{http_code}\n" https://app.favalio.com
```

```bash
# 3 · CORS, que es lo que más se rompe. Tiene que devolver el origen, no vacío.
curl -s -I -H "Origin: https://app.favalio.com" https://api.favalio.com/api/ping \
  | grep -i access-control-allow-origin
```

```bash
# 4 · La tienda. Reemplazar el slug por uno que exista.
curl -s https://tienda.favalio.com/c/un-slug-real | grep -o '<meta property="og:[^>]*>'
```

Qué significa cada resultado del paso 4:

| Lo que sale | Qué falta |
|---|---|
| Las etiquetas `og:title`, `og:url`, `og:image` | Anda |
| HTML de Vite sin ningún `og:` | El rewrite de `/c/*` no está tomando — revisar §4 |
| «Volvemos en un rato» | Falta `URL_DE_LA_TIENDA` en Render — §3 |
| 404 | El slug no existe, o el catálogo está en borrador |

---

## 10. Los límites, que son del plan y no de la configuración

- **Render free duerme** a los 15 min sin tráfico; el primer request después
  tarda ~50 s. Por eso `VITE_API_TIMEOUT` está en 60000.
- **Neon free autosuspende** a los 5 min. Sequelize reintenta, pero la primera
  consulta después tarda.
- **Las fotos de productos son efímeras.** `SERVIR_IMAGENES=true` hace que la API
  sirva `/img/*` desde `/opt/render/project/src/imagenes`, que es el directorio
  del proyecto y se borra en cada deploy. La base queda apuntando a archivos que
  ya no existen: las miniaturas del panel y las fotos de la tienda pasan a 404
  sin que cambie ningún dato. **Alcanza para probar, no para vender.**
- **El runtime no es el que prueba el CI.** El CI construye y arranca el
  contenedor de `apps/api`; Render corre el runtime nativo de Node. Con
  `NODE_VERSION=22` las dos usan el mismo major, pero no es la misma imagen.
- **Los logos de empresa** se guardan como data URI en la base justamente por
  esto, y sí sobreviven.
- **Un proceso de Node sirviendo archivos estáticos** compite por el mismo event
  loop que las cajas (`utils/imagenes.js`). Con tráfico de prueba no se nota.
- **Las migraciones corren al arrancar.** Sirve con una sola instancia. Al
  escalar hay que moverlas a un pre-deploy job.

Cuando alguna de estas deje de ser aceptable, el camino es
[DESPLIEGUE-HOSTINGER.md](DESPLIEGUE-HOSTINGER.md): un VPS, un pago, sin servicio
que duerma y con las fotos en un volumen que no se borra.
