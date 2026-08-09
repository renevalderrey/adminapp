# Configurar `favalio.com` en Hostinger

El dominio está comprado en Hostinger. El código **no** se hospeda ahí: la
landing y la app viven en Vercel y la API en Render. Hostinger, en este
esquema, es únicamente el **registrador y el servidor DNS** — el lugar donde se
dice a qué IP responde cada nombre.

Todo lo de este documento se hace en paneles. No hay nada que desplegar.

---

## 0. Mapa de lo que se va a armar

| Nombre | Apunta a | Sirve |
|---|---|---|
| `favalio.com` | Vercel (proyecto **landing**) | sitio público |
| `www.favalio.com` | Vercel (proyecto **landing**) | redirige al anterior |
| `app.favalio.com` | Vercel (proyecto **web**) | la aplicación |
| `api.favalio.com` | Render (servicio de la API) | el backend |

Orden obligatorio: **primero se declara el dominio en Vercel/Render, después se
cargan los registros en Hostinger.** Cada panel muestra el valor exacto que
espera y además genera un registro de verificación; si se cargan los DNS antes,
hay que volver igual.

---

## 1. Verificar quién maneja el DNS

hPanel → **Dominios** → `favalio.com` → **DNS / Nameservers**.

Si los nameservers son los de Hostinger (`ns1.dns-parking.com`,
`ns2.dns-parking.com`), la zona DNS de Hostinger es la que manda y todo el
trabajo se hace ahí. Es el caso normal de un dominio recién comprado, y es el
que asume este documento.

Si alguna vez se apuntan los nameservers a otro proveedor (Vercel, Cloudflare),
los registros cargados en Hostinger **dejan de tener efecto**. Un solo lugar
para el DNS; conviene que sea Hostinger porque la API no está en Vercel.

---

## 2. Declarar los dominios en Vercel y Render

**Vercel — proyecto de la landing:** *Settings → Domains → Add*.
Agregar `favalio.com` y `www.favalio.com`.

**Vercel — proyecto de la web:** *Settings → Domains → Add*.
Agregar `app.favalio.com`.

**Render — servicio de la API:** *Settings → Custom Domains → Add*.
Agregar `api.favalio.com`. Render devuelve un destino con la forma
`<nombre-del-servicio>.onrender.com`.

Los tres paneles van a quedar en estado *Invalid Configuration* / *Pending*.
Es lo esperado: todavía no existe el DNS.

**Anotar lo que muestra cada panel.** Los valores de la tabla del paso 3 son
los habituales, pero si el panel muestra otro, **gana el panel**.

---

## 3. Cargar los registros en Hostinger

hPanel → **Dominios** → `favalio.com` → **DNS / Nameservers** → *Administrar
registros DNS*.

### 3.1 Borrar lo que estorba

Un dominio nuevo viene con los registros de la página de estacionamiento de
Hostinger. Hay que **eliminarlos**, o van a competir con los de Vercel:

- el registro `A` de `@` que apunta a una IP de Hostinger;
- el `CNAME` de `www` que apunta al parking.

No tocar los `NS` ni el `SOA`.

### 3.2 Agregar

| Tipo | Nombre | Apunta a | TTL |
|---|---|---|---|
| `A` | `@` | `76.76.21.21` | 3600 |
| `CNAME` | `www` | `cname.vercel-dns.com` | 3600 |
| `CNAME` | `app` | `cname.vercel-dns.com` | 3600 |
| `CNAME` | `api` | `<servicio>.onrender.com` | 3600 |

Detalles que hacen fallar esto:

- En Hostinger el campo *Nombre* es **relativo**: se escribe `app`, no
  `app.favalio.com`. Para el dominio raíz, `@`.
- El destino de un `CNAME` **termina en punto** en algunos paneles
  (`cname.vercel-dns.com.`). Hostinger lo agrega solo; no escribirlo dos veces.
- El raíz va por `A` y no por `CNAME`: el DNS no admite un `CNAME` en el
  vértice de la zona conviviendo con `NS` y `SOA`.
- Si Vercel o Render piden además un `TXT` de verificación, cargarlo también y
  **no borrarlo después** — algunos paneles lo revalidan cada tanto.

---

## 4. Esperar y verificar

La propagación con TTL 3600 tarda entre minutos y un par de horas. Desde
PowerShell:

```powershell
Resolve-DnsName favalio.com      -Type A
Resolve-DnsName app.favalio.com  -Type CNAME
Resolve-DnsName api.favalio.com  -Type CNAME
```

Cuando resuelven bien, los paneles de Vercel y Render pasan solos a *Valid* y
emiten el certificado TLS (Let's Encrypt, gratis y con renovación automática).
No hay que comprar SSL en Hostinger: el certificado lo emite quien sirve el
sitio, no quien tiene el dominio.

Si a los 15 minutos un panel sigue en rojo, apretar *Refresh* / *Verify*: casi
siempre está esperando que alguien le pida revisar de nuevo.

---

## 5. Actualizar las variables de entorno

El dominio no sirve de nada si la API sigue rechazando por CORS al origen
nuevo. En **Render → el servicio → Environment**:

| Variable | Valor |
|---|---|
| `ALLOWED_ORIGINS` | `https://app.favalio.com,https://favalio.com,https://www.favalio.com` |
| `FRONTEND_URL` | `https://app.favalio.com` |
| `LANDING_URL` | `https://favalio.com` |

Guardar redeploya el servicio.

En **Vercel → proyecto web → Settings → Environment Variables**:

| Variable | Valor |
|---|---|
| `VITE_API_URL` | `https://api.favalio.com/api` (incluye el sufijo `/api`) |

En **Vercel → proyecto landing**:

| Variable | Valor |
|---|---|
| `VITE_APP_URL` | `https://app.favalio.com` |
| `VITE_CONTACT_EMAIL` | `hola@favalio.com` |

> ⚠ Las `VITE_*` se hornean en el bundle **durante el build**. Cambiarlas en el
> dashboard no tiene ningún efecto hasta **redesplegar** los dos proyectos
> (*Deployments → … → Redeploy*).

---

## 6. Auth0

Dashboard de Auth0 → *Applications* → la aplicación SPA → *Settings*. Agregar
`https://app.favalio.com` a las tres listas:

- **Allowed Callback URLs**
- **Allowed Logout URLs**
- **Allowed Web Origins**

Dejar también las URLs de `localhost` que ya estén: las listas son separadas
por comas y conviven sin problema.

Si el login se hace desde la landing con `?signup=true`, la landing no toca
Auth0 directamente — redirige a la app — así que no hay nada que agregar por
ella.

---

## 7. Correo

Son dos cosas distintas y se resuelven por separado.

### 7.1 Los mails que manda el sistema (`noreply@favalio.com`)

Los emails transaccionales (bienvenida, invitaciones de equipo) salen por
Resend. Para poder mandarlos desde el dominio propio:

1. Resend → *Domains* → *Add Domain* → `favalio.com`.
2. Resend muestra tres registros. Cargarlos en la zona DNS de Hostinger tal
   cual, con el nombre **relativo**:

| Tipo | Nombre | Apunta a |
|---|---|---|
| `MX` | `send` | el host de Amazon SES que muestre Resend, prioridad `10` |
| `TXT` | `send` | `v=spf1 include:amazonses.com ~all` |
| `TXT` | `resend._domainkey` | la clave DKIM que muestre Resend |

3. *Verify* en Resend.
4. Render → `RESEND_FROM_EMAIL` = `noreply@favalio.com`.

El `MX` va en el subdominio `send`, no en el raíz: por eso **no choca** con un
buzón de correo en el dominio principal.

Opcional pero recomendado, un DMARC laxo:

| Tipo | Nombre | Apunta a |
|---|---|---|
| `TXT` | `_dmarc` | `v=DMARC1; p=none; rua=mailto:hola@favalio.com` |

### 7.2 Un buzón real (`hola@favalio.com`)

Es el mail de contacto de la landing (`VITE_CONTACT_EMAIL`). Hace falta un
servicio de correo: el plan de email de Hostinger, o cualquier otro
(Zoho, Google Workspace).

Con Hostinger, hPanel → **Emails** → activar el plan sobre `favalio.com`; el
panel agrega solo sus `MX` y su `SPF`. Con un tercero, cargar los registros que
indique ese proveedor.

> **Una sola línea `SPF` por nombre.** Si el proveedor de buzón agrega un `TXT`
> `v=spf1 …` en `@` y después se agrega otro, el dominio queda con SPF
> inválido y los mails empiezan a caer en spam. Se combinan en uno solo:
> `v=spf1 include:_spf.proveedor.com include:otro.com ~all`.
> El de Resend no cuenta acá: vive en `send`, no en `@`.

---

## 8. Checklist final

- [ ] `https://favalio.com` abre la landing, con candado.
- [ ] `https://www.favalio.com` redirige a la anterior.
- [ ] `https://app.favalio.com` abre la app y el login de Auth0 funciona.
- [ ] `https://api.favalio.com/api/health` responde `200`.
- [ ] Desde la app, una pantalla cualquiera carga datos (si falla acá y la API
      responde sola, es CORS: revisar `ALLOWED_ORIGINS`).
- [ ] Un alta de empresa dispara el mail de bienvenida.
- [ ] Los dos proyectos de Vercel fueron **redesplegados** después de tocar las
      `VITE_*`.

---

## 9. Lo que este cambio NO toca

El renombre a Favalio es de marca. Quedaron con el nombre viejo, a propósito,
tres cosas que renombrar tiene costo y ningún beneficio inmediato:

- **El repositorio de GitHub** (`github.com/renevalderrey/adminapp`). Si se
  renombra, GitHub deja una redirección, pero hay que actualizar el `origin`
  de cada clon: `git remote set-url origin <url nueva>`.
- **El servicio de Render**, que hoy se llama `adminapp-api` y responde en
  `adminapp-api.onrender.com`. `render.yaml` ya dice `favalio-api`, pero eso
  solo aplica a un servicio creado de cero: renombrar el existente se hace en
  *Settings → Name*, y **cambia la URL `.onrender.com`** — hay que actualizar
  el secreto `API_URL` de GitHub Actions (ver `docs/OPERACION.md`) y el destino
  del `CNAME` de `api`. Con el dominio propio andando, el nombre interno deja
  de verse.
- **La base de Neon**, que se llama `adminapp`. Renombrarla implica migrar los
  datos a una base nueva. No se ve desde ningún lado.
