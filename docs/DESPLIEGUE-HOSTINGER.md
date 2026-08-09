# Desplegar Favalio entero en un VPS

Escrito sobre Hostinger, que es donde está el dominio, pero **sirve para
cualquier VPS con Docker**: sólo la sección 1 (contratar la máquina) es propia
del proveedor. El resto —DNS, Caddy, migraciones, respaldos— es igual en todos.

## Antes de empezar: qué tipo de plan sirve

**Un VPS sí; el hosting compartido no.** La diferencia no es de proveedor sino
de tipo de plan:

- **Hosting compartido** (Hostinger Premium/Business/Cloud, y el equivalente de
  cualquier otro): corre PHP y archivos estáticos. **No corre Node.js ni
  PostgreSQL.** Sólo entraría la landing, y quedaría la mitad del sistema sin
  lugar donde correr.
- **VPS** (Hostinger KVM, DonWeb Cloud Server, cualquiera con acceso root y
  Docker): entra todo, y es lo que asume este documento.

Con un VPS entra la pila completa:

| Pieza | Dónde corre | Nombre público |
|---|---|---|
| Landing (`apps/landing`) | contenedor nginx en el VPS | `favalio.com` |
| Aplicación (`apps/web`) | contenedor nginx en el VPS | `app.favalio.com` |
| API (`apps/api`) | contenedor Node en el VPS | `api.favalio.com` |
| PostgreSQL | contenedor en el VPS, disco propio | — (no sale a internet) |
| TLS y ruteo | Caddy, en el VPS | — |
| Correo saliente | Resend (externo) | `noreply@favalio.com` |
| Buzón | plan de email de Hostinger | `hola@favalio.com` |

Todo eso está descripto en `docker-compose.produccion.yml` y en
`deploy/Caddyfile`. El servidor no se configura a mano: se clona el repo, se
completa un `.env` y se levanta la pila.

**Lo que se gana y lo que se pierde** frente al esquema anterior (Render +
Vercel + Neon): un solo lugar, un solo pago, sin servicio que duerma a los 15
minutos y sin cold start de 50 segundos. A cambio, los respaldos, las
actualizaciones del sistema operativo y el monitoreo pasan a ser tuyos, y un
solo servidor es un único punto de falla. La sección 10 cubre eso.

---

## 1. Contratar el VPS

**Es la única sección atada al proveedor.** Lo que hace falta, mire donde se
mire:

| Requisito | Mínimo | Cómodo |
|---|---|---|
| RAM | 4 GB (con 2 GB de swap, paso 3.5) | 8 GB |
| vCPU | 1 | 2 |
| Disco | 50 GB NVMe | 100 GB |
| Acceso | root por SSH | ídem |
| Sistema | Ubuntu 24.04, Docker instalable | plantilla con Docker |
| IP | IPv4 dedicada | ídem |

Con 4 GB, construir el bundle de la web es lento y necesita el swap; con 8 GB
no hace falta pensarlo.

### Precios al 9/8/2026, facturados en pesos

Cambian seguido: verificar antes de pagar.

| Proveedor | Config | Precio | Detalle |
|---|---|---|---|
| Hostinger KVM 1 | 1 vCPU / 4 GB / 50 GB | AR$ 12.099/mes | contrato 2 años; **renueva a AR$ 24.199** |
| Hostinger KVM 2 | 2 vCPU / 8 GB / 100 GB | AR$ 17.299/mes | contrato 2 años; renueva ~2× |
| DonWeb Cloud Server | configurable | desde AR$ 4.621/mes | ese piso es 1 vCPU / 1 GB: no alcanza |

El precio bueno de Hostinger es con **dos años prepagos** y la renovación es al
doble. Presupuestar con el número de renovación.

DonWeb tiene datacenter en Argentina y factura argentina con IVA discriminado
—crédito fiscal, si sos responsable inscripto—. El argumento técnico a favor es
la latencia contra AFIP: las llamadas SOAP son sincrónicas durante una venta.
Son decenas de milisegundos; existe, no se nota.

### En el panel

- **Ubicación:** la más cercana a los clientes. Con Hostinger, para Argentina,
  el datacenter de Brasil (São Paulo) es el que menos latencia da.
- **Sistema operativo:** la plantilla **Ubuntu 24.04 con Docker**. Si no
  aparece, Ubuntu 24.04 limpio y se instala Docker en el paso 3.4.
- **Acceso:** cargar una clave SSH pública si ya tenés una; si no, el proveedor
  da una contraseña de root y la clave se configura después.

Al terminar, anotar la **IP del VPS**. Todo el paso 2 depende de ella.

---

## 2. Apuntar el dominio al VPS

El dominio está en Hostinger y ahí se queda, esté donde esté el servidor: lo
único que se carga son registros que apuntan a una IP.

hPanel → **Dominios** → `favalio.com` → **DNS / Nameservers** → *Administrar
registros DNS*.

### 2.1 Borrar lo que estorba

Un dominio recién comprado trae los registros de la página de estacionamiento.
**Eliminar**:

- el `A` de `@` que apunta a una IP de Hostinger;
- el `CNAME` de `www` que apunta al parking.

No tocar los `NS` ni el `SOA`.

### 2.2 Agregar

Los cuatro nombres apuntan a la **misma IP**: es Caddy, dentro del VPS, el que
mira el nombre pedido y decide a qué contenedor mandarlo.

| Tipo | Nombre | Apunta a | TTL |
|---|---|---|---|
| `A` | `@` | la IP del VPS | 3600 |
| `A` | `www` | la IP del VPS | 3600 |
| `A` | `app` | la IP del VPS | 3600 |
| `A` | `api` | la IP del VPS | 3600 |

Si el VPS trae IPv6, se puede agregar el `AAAA` equivalente para cada nombre.
No es obligatorio.

> En Hostinger el campo *Nombre* es **relativo**: se escribe `app`, no
> `app.favalio.com`. Para el dominio raíz, `@`.

### 2.3 Verificar

La propagación tarda entre minutos y un par de horas. Desde PowerShell:

```powershell
Resolve-DnsName favalio.com     -Type A
Resolve-DnsName app.favalio.com -Type A
Resolve-DnsName api.favalio.com -Type A
```

Los cuatro tienen que devolver la IP del VPS **antes** del paso 6: Caddy pide
los certificados TLS al arrancar, y Let's Encrypt sólo los emite si el dominio
ya resuelve al servidor que los pide.

---

## 3. Preparar el servidor

Desde tu máquina:

```bash
ssh root@<IP-del-VPS>
```

### 3.1 Actualizar y crear un usuario que no sea root

```bash
apt update && apt upgrade -y

adduser favalio                 # pide una contraseña
usermod -aG sudo,docker favalio # sudo para administrar, docker para el compose
```

Copiar tu clave SSH a ese usuario (desde **tu** máquina, en otra terminal):

```bash
ssh-copy-id favalio@<IP-del-VPS>
```

Probar que entra (`ssh favalio@<IP>`) **antes** del paso siguiente.

### 3.2 Cerrar el acceso por contraseña

```bash
sudo nano /etc/ssh/sshd_config
```

Dejar:

```
PermitRootLogin no
PasswordAuthentication no
```

```bash
sudo systemctl restart ssh
```

> ⚠ Si la clave SSH no funciona todavía, este paso te deja afuera del servidor.
> Verificá que `ssh favalio@<IP>` entra sin pedir contraseña antes de reiniciar
> el servicio. Hostinger igual da acceso por consola desde hPanel si pasa.

### 3.3 Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

Sólo esos tres puertos. Postgres **no** se abre: el compose lo publica
únicamente en `127.0.0.1`.

### 3.4 Docker (sólo si la plantilla no lo traía)

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker favalio
# cerrar sesión y volver a entrar para que tome el grupo
docker compose version
```

### 3.5 Memoria de intercambio (recomendado en el plan de 4 GB)

Construir el bundle de la web puede quedarse sin RAM y morir con un error poco
claro. 2 GB de swap lo evitan:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 4. Traer el código

```bash
sudo mkdir -p /opt/favalio
sudo chown favalio:favalio /opt/favalio
git clone https://github.com/renevalderrey/favalio.git /opt/favalio
cd /opt/favalio
```

> El repositorio se llamaba `adminapp` y se renombró a `favalio`. GitHub deja
> una redirección, así que un clon viejo sigue funcionando, pero conviene
> actualizarlo en cada máquina donde exista uno:
>
> ```bash
> git remote set-url origin https://github.com/renevalderrey/favalio.git
> ```

Si el repositorio es privado, la forma limpia de que el VPS pueda hacer `git
pull` sin credenciales personales es una **deploy key**: generar la clave en el
servidor (`ssh-keygen -t ed25519 -C favalio-vps`), pegar la pública en GitHub →
*Settings → Deploy keys* (sólo lectura) y clonar por SSH.

---

## 5. Completar el `.env`

```bash
cp .env.produccion.example .env
nano .env
chmod 600 .env
```

Lo mínimo para que arranque:

| Variable | Valor |
|---|---|
| `DOMINIO` | `favalio.com` (sin `https://`, sin barra) |
| `EMAIL_TLS` | tu mail, para los avisos de Let's Encrypt |
| `POSTGRES_PASSWORD` | generada, no inventada: `openssl rand -base64 32` |
| `AUTH0_DOMAIN` / `AUTH0_AUDIENCE` | los del tenant de Auth0 |
| `VITE_AUTH0_DOMAIN` / `VITE_AUTH0_CLIENT_ID` / `VITE_AUTH0_AUDIENCE` | ídem, para el navegador |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | si querés los mails de bienvenida e invitación |

`AUTH0_AUDIENCE` y `VITE_AUTH0_AUDIENCE` tienen que ser **exactamente** la
misma cadena, o Auth0 emite un token que la API rechaza.

Las URLs (`ALLOWED_ORIGINS`, `FRONTEND_URL`, `VITE_API_URL`…) no se escriben:
el compose las arma solo a partir de `DOMINIO`.

---

## 6. Levantar la pila

```bash
cd /opt/favalio
docker compose -f docker-compose.produccion.yml up -d --build
```

La primera vez tarda: construye tres imágenes (dos builds de Vite y la de
Node). Entre 5 y 15 minutos según el plan.

Qué pasa en orden: Postgres arranca y queda *healthy* → la API espera a que lo
esté, corre las migraciones con un advisory lock y recién ahí levanta el
servidor → Caddy pide los certificados a Let's Encrypt.

Verificar:

```bash
docker compose -f docker-compose.produccion.yml ps        # los 5 arriba
docker compose -f docker-compose.produccion.yml logs -f api
curl https://api.favalio.com/api/health
```

`/api/health` consulta la base de verdad: si responde `200`, la cadena entera
—Caddy, API, Postgres— está sana.

Si el navegador muestra un error de certificado, mirar `logs caddy`: casi
siempre es DNS que todavía no resolvía cuando Caddy pidió el certificado.
Reintenta solo, con espera creciente; `docker compose restart caddy` lo apura.

---

## 7. Auth0

Dashboard de Auth0 → *Applications* → la aplicación SPA → *Settings*. Agregar
`https://app.favalio.com` a las tres listas:

- **Allowed Callback URLs**
- **Allowed Logout URLs**
- **Allowed Web Origins**

Dejar también las de `localhost`: conviven separadas por comas.

---

## 8. Correo

Son dos cosas distintas.

### 8.1 Los mails que manda el sistema (`noreply@favalio.com`)

Salen por Resend. Para poder mandarlos desde el dominio propio:

1. Resend → *Domains* → *Add Domain* → `favalio.com`.
2. Cargar en la zona DNS de Hostinger los tres registros que muestra, con el
   nombre **relativo**:

| Tipo | Nombre | Apunta a |
|---|---|---|
| `MX` | `send` | el host de Amazon SES que indique Resend, prioridad `10` |
| `TXT` | `send` | `v=spf1 include:amazonses.com ~all` |
| `TXT` | `resend._domainkey` | la clave DKIM que indique Resend |

3. *Verify* en Resend.

El `MX` va en el subdominio `send`, no en el raíz: por eso no choca con el
buzón del dominio principal.

Recomendado, un DMARC laxo:

| Tipo | Nombre | Apunta a |
|---|---|---|
| `TXT` | `_dmarc` | `v=DMARC1; p=none; rua=mailto:hola@favalio.com` |

### 8.2 El buzón (`hola@favalio.com`)

hPanel → **Emails** → activar el plan de correo sobre `favalio.com`. El panel
agrega solo sus `MX` y su `SPF` en el raíz.

> **Una sola línea `SPF` por nombre.** Si ya hay un `TXT` `v=spf1 …` en `@` y
> se agrega otro, el dominio queda con SPF inválido y los mails empiezan a caer
> en spam. Se combinan en uno: `v=spf1 include:_spf.proveedor.com include:otro
> ~all`. El de Resend no cuenta acá: vive en `send`.

---

## 9. Primer ingreso

Entrar a `https://app.favalio.com` y registrarse con Auth0. Eso crea el usuario,
pero no lo hace operador de la plataforma: seis pantallas siguen redirigiendo a
`/pos` hasta que lo sea.

```bash
docker compose -f docker-compose.produccion.yml exec api \
  node scripts/superadmin.js activar tu@mail.com
```

Después, un `Ctrl+Shift+R` en el navegador.

---

## 10. Operación

Todos los comandos se corren desde `/opt/favalio`. Para no repetir la bandera:

```bash
alias fv='docker compose -f /opt/favalio/docker-compose.produccion.yml'
```

### Actualizar a la última versión

```bash
cd /opt/favalio
git pull
docker compose -f docker-compose.produccion.yml up -d --build
```

Reconstruye sólo lo que cambió y reemplaza los contenedores afectados. Las
migraciones corren solas en el arranque de la API. Hay unos segundos de corte
en la API mientras se reemplaza el contenedor.

### Ver qué está pasando

```bash
fv ps                    # estado de los cinco servicios
fv logs -f api           # log de la API en vivo
fv logs --tail=100 caddy # certificados, ruteo
docker stats             # memoria y CPU
```

### Respaldos

**Esto ya no lo hace nadie por vos.** Con Neon había copias automáticas; con la
base en tu VPS, si no configurás el cron no hay respaldo.

```bash
sudo mkdir -p /var/respaldos/favalio
chmod +x /opt/favalio/deploy/respaldo.sh
sudo crontab -e
```

Agregar:

```
15 3 * * * /opt/favalio/deploy/respaldo.sh >> /var/log/favalio-respaldo.log 2>&1
```

El script vuelca la base con `pg_dump`, comprime y borra lo de más de 14 días.
Falta lo importante: **sacar las copias del VPS**. Un respaldo en el mismo
disco que la base no cubre el caso en que se pierde el disco. Sirve `rclone` a
cualquier nube, o un `scp` desde tu máquina.

Y probar una restauración antes de necesitarla:

```bash
gunzip -c /var/respaldos/favalio/favalio-2026-08-09-0315.sql.gz | \
  fv exec -T postgres psql -U favalio -d favalio_prueba
```

Existe además el respaldo por empresa de la aplicación, que exporta en JSON y
sirve para otra cosa (llevarse los datos de un cliente):

```bash
fv exec api npm run backup -- --todas
```

### Conectar un cliente gráfico a la base

Postgres está publicado sólo en `127.0.0.1` del VPS. Desde tu máquina:

```bash
ssh -L 5433:127.0.0.1:5432 favalio@<IP-del-VPS>
```

Y el cliente apunta a `localhost:5433`. Nada de esto abre un puerto a internet.

### Suscripciones y tareas diarias

En el VPS el proceso no duerme, así que el cron interno de vencimientos y
avisos **sí dispara**. El workflow `.github/workflows/tareas-diarias.yml` queda
como red de seguridad: si se usa, el secreto `API_URL` del repositorio pasa a
ser `https://api.favalio.com` y `CRON_SECRET` tiene que coincidir con el del
`.env`.

### Mantenimiento del sistema

```bash
sudo apt update && sudo apt upgrade -y   # una vez por mes, y reiniciar si pide
docker image prune -a                    # limpiar imágenes viejas de builds
```

---

## 11. Checklist

- [ ] Los cuatro `A` resuelven a la IP del VPS.
- [ ] `ssh favalio@<IP>` entra con clave, y root por contraseña ya no.
- [ ] `ufw status` muestra sólo 22, 80 y 443.
- [ ] `fv ps` muestra los cinco servicios arriba y la API *healthy*.
- [ ] `https://favalio.com` abre la landing con candado.
- [ ] `https://www.favalio.com` redirige a la raíz.
- [ ] `https://app.favalio.com` abre la app y el login de Auth0 funciona.
- [ ] `https://api.favalio.com/api/health` responde `200`.
- [ ] Una pantalla cualquiera de la app carga datos (si falla acá y la API
      responde sola, es CORS: revisar `DOMINIO` en el `.env`).
- [ ] Un alta de empresa dispara el mail de bienvenida.
- [ ] El cron de respaldo corrió al menos una vez y el `.sql.gz` no está vacío.
- [ ] Una restauración de prueba salió bien.

---

## 12. Lo que queda del esquema anterior

`render.yaml` y los `vercel.json` siguen en el repo: son la alternativa PaaS,
sirven si algún día conviene volver a separar las piezas, y no molestan.
`docs/OPERACION.md` menciona a Render en algunos runbooks; lo que dice sobre la
aplicación vale igual, cambia dónde se ejecutan los comandos.

Dos cosas conservan el nombre viejo, porque renombrarlas rompe URLs en uso y no
aporta nada mientras sigan en pie:

- el servicio de Render, `adminapp-api.onrender.com`, si se lo deja creado;
- la base de Neon, `adminapp`, si se la deja.

El repositorio de GitHub sí se renombró a `renevalderrey/favalio`.

Cuando la base del VPS tenga los datos buenos y el respaldo esté probado,
Render, Vercel y Neon se pueden dar de baja.
