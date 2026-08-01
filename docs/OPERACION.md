# Operación

Qué hacer cuando algo pasa. Está escrito para el que atiende el problema, no
para el que escribió el código.

---

## Antes del primer cliente real

Una lista corta, en orden. Todo lo que sigue asume que estos puntos están
hechos.

| | Qué | Dónde |
|---|---|---|
| ⬜ | **Rotar las credenciales del hosting legacy** | Panel de Hostinger · [ver abajo](#rotar-las-credenciales-del-hosting-legacy) |
| ⬜ | **Correr las migraciones pendientes** | Ver abajo |
| ⬜ | **Configurar `CRON_SECRET`** y los dos secretos del workflow | Render + GitHub · [ver abajo](#tareas-programadas) |
| ⬜ | **Configurar `SENTRY_DSN`** | sentry.io + Render · [ver abajo](#alertas-de-error) |
| ⬜ | **Probar el circuito AFIP en homologación** de punta a punta | — |
| ⬜ | **Probar una restauración de respaldo** | [Ver abajo](#probar-una-restauración) |
| ⬜ | **Verificar que los logs se ven** en el panel de Render | — |

Un respaldo que nunca se restauró no es un respaldo. Es un archivo.

---

## Rotar las credenciales del hosting legacy

**Esto es lo único de la lista que no se puede resolver con código.**

`legacy/api.php` tenía hardcodeadas la contraseña de la base MySQL y el token
de aplicación del hosting original. Se redactaron del archivo, pero **siguen en
el historial de git**: cualquiera que clone el repositorio y haga
`git log -p legacy/api.php` las lee.

Redactarlas no las revoca. Hay que cambiarlas en el origen:

1. **Panel de Hostinger → Bases de datos MySQL.** Cambiar la contraseña del
   usuario de la base de Comprafit.
2. **El token de aplicación** (`APP_TOKEN` en `api.php`): elegir uno nuevo y
   ponerlo como variable de entorno `LEGACY_APP_TOKEN` en el hosting.
3. Si el sistema legacy sigue en uso, actualizar los dos valores donde los
   consuma.

**Hacerlo ANTES de migrar los datos**, no después: el script de migración se
conecta a esa API y necesita el token nuevo (`PHP_API_TOKEN`).

Reescribir el historial de git (`git filter-repo`) es una alternativa, pero no
reemplaza a rotar: si el repo ya se clonó una vez, la credencial vieja ya
salió. Rotar sí las invalida.

---

## Diagnóstico rápido

### ¿Está vivo el sistema?

```
GET https://<api>/api/health
```

| Respuesta | Significa |
|---|---|
| `200` con `base_de_datos: "ok"` | Todo bien |
| `200` con `latencia_ms` alta (> 3000) | Neon estaba suspendida y despertó. Normal en el free tier |
| `503` con `base_de_datos: "error"` | La API responde pero no llega a Postgres |
| No responde | El servicio está dormido (free tier) o caído |

`/api/ping` responde aunque la base esté caída: sirve para saber si el proceso
vive, no si el sistema funciona.

### Los logs

Van a **stdout** y se ven en el panel de Render, en JSON. Los campos útiles:

- `level: 50` (error) o `60` (fatal)
- `empresaId` — casi todos los errores lo llevan
- `msg` — el prefijo dice de dónde viene (`sales:`, `afip:`, `tiendanube:`)

> Antes iban a `./logs/app.log`, un archivo en disco efímero que nadie veía y
> que desaparecía en cada deploy. Si alguien vuelve a poner un transport de
> archivo, se pierden los logs de producción otra vez.

---

## Situaciones

### "No puedo facturar" / AFIP rechaza

Por orden de probabilidad:

1. **¿Está configurado el entorno?** Si `afip_environment` no está definido, el
   sistema usa **homologación** y los comprobantes **no tienen validez fiscal**.
   Queda un `warn` en el log diciéndolo.
2. **¿Se venció el certificado?** Duran 2 años y **no hay ningún aviso**. Ver
   `GET /api/afip/cert-info` → `validTo`.
3. **¿El CUIT del certificado coincide con el configurado?** No se valida. Si
   difieren, AFIP rechaza todo con un mensaje críptico.
4. **¿Se guardó bien la configuración?** Ver más abajo, hubo un caso grave.

El mensaje de AFIP se devuelve tal cual al usuario y queda en el log con
`msg: "afip:invoice"`.

### Una venta quedó sin comprobante

Pasa cuando la venta se guardó pero AFIP falló. **Es el caso previsto**: la
venta existe y se puede reintentar.

**Lo resuelve el usuario, sin llamar a nadie.** En **Historial de ventas** la
venta aparece como **Rechazada**; abriendo la fila, el panel muestra el mensaje
con el que AFIP la rechazó, la fecha del intento y un botón **Reintentar
facturación**. Si lo que falta es el CUIT del comprador, el mismo panel lo pide
y reintenta ahí.

El error queda guardado en la venta (`afip_ultimo_error`, `afip_ultimo_intento`),
así que **sobrevive a cerrar la pestaña**: antes solo se veía en la respuesta
HTTP del momento y después la venta quedaba indistinguible de una venta interna
hecha a propósito.

Como salida de emergencia —sin sesión, o para automatizar— el endpoint sigue
estando:

```
POST /api/sales/<id>/facturar
```

Con el body vacío alcanza: el servidor resuelve el tipo de comprobante desde la
condición fiscal de la empresa, el CUIT desde la ficha del cliente de la venta y
el punto de venta desde la venta o desde `settings.afip_pv`.

Es idempotente: si ya tiene CAE, devuelve el que tiene. Y toma la venta **con
lock**, así que dos reintentos simultáneos dejan un solo CAE, y un reintento que
corre contra una anulación no puede emitir un comprobante sobre una venta
anulada.

> El flujo está en este orden a propósito. Antes se pedía el CAE **antes** de
> guardar, y si el guardado fallaba quedaba un comprobante fiscal emitido sin
> ningún registro en el sistema — imposible de detectar.

### Se anuló una venta que ya tenía CAE

**De acá en adelante no puede pasar: la API lo rechaza.**
`PUT /api/sales/<id>/void` sobre una venta con `afip_cae` devuelve 400 con el
motivo en castellano, y no toca el stock. El bloqueo está en la API y no solo en
la pantalla: un `curl` tampoco puede. En el Historial de ventas el botón
**Anular venta** aparece deshabilitado con la explicación, no ausente.

**Las que hay son histórico**, de cuando se permitía. Se muestran con etiqueta y
color propios —«Anulada · vigente ante ARCA», en ámbar— porque no son una
anulada común: **anular en la app no da de baja el comprobante ante ARCA**. Para
eso hace falta una nota de crédito, que el sistema todavía no emite.

Para saber cuántas hay pendientes, la forma sigue siendo la misma:

```
GET /api/taxes/monotributo → anuladas_con_cae_sin_nc
```

Ese monto **sigue contando** como facturación ante ARCA. Hay que emitir las
notas de crédito por fuera hasta que el sistema las soporte.

### Alguien borró datos por error

1. **Ver si hay un respaldo reciente**: `node scripts/backup.js <empresaId>`
   genera uno *ahora*, pero para recuperar hace falta uno *anterior*.
2. **Neon tiene restauración por punto en el tiempo**, con retención limitada
   en el plan gratuito. Es la vía real de recuperación. Se hace desde el panel
   de Neon.

> Por eso el respaldo periódico importa. `scripts/backup.js --todas` exporta
> todas las empresas a JSON; conviene correrlo con alguna frecuencia y guardar
> el resultado **fuera** de la plataforma.

### Un cliente pide sus datos

```
node scripts/backup.js <empresaId> --salida ./entrega
```

Genera un JSON con todas sus tablas. Es información que está obligado a
conservar: no hay motivo para negarla, incluso si se va.

El certificado y la clave de AFIP **no** se incluyen — son material sensible y
un archivo así suele terminar en un drive compartido.

### Un cliente pagó / hay que activarlo

```
node scripts/suscripcion.js listar
node scripts/suscripcion.js activar <empresaId> --plan pro --meses 1
```

Si ya tenía período pagado, los meses se suman a partir de ahí; no se le comen
días.

**No hay pasarela de pago.** Esto es el mecanismo manual, para cobrar por
transferencia.

### "La app dejó de funcionar" de golpe

Si todo devuelve `402`, es la suscripción. Ver `scripts/suscripcion.js ver <id>`.

El usuario ve una pantalla que lo explica, no un error genérico.

### Todo va lento la primera vez y después bien

Es el free tier funcionando como está documentado:

- **Render** duerme el servicio a los 15 min sin tráfico. El primer request
  tarda ~50 s. Por eso el timeout del frontend está en 60 s.
- **Neon** suspende la base a los 5 min. La primera consulta tarda unos
  segundos; Sequelize reintenta.

Ninguna de las dos cosas es un bug. Se resuelven con plan pago.

---

## Tareas programadas

El cron de suscripciones corre con `setInterval` **dentro del proceso**. En el
free tier, con el servicio dormido, **no dispara**.

Por eso existe:

```
POST /api/tareas/ejecutar
Header: X-Cron-Secret: <CRON_SECRET>
```

Sin `CRON_SECRET` configurado, el endpoint responde 404: no queda una ruta
abierta por olvido.

**Si esto no está configurado, los trials no vencen y los avisos no salen.**

### Cómo se configura (una sola vez)

Ya existe el workflow `.github/workflows/tareas-diarias.yml`. Corre todos los
días a las 06:00 de Argentina y se puede disparar a mano desde la pestaña
Actions. Se eligió GitHub Actions y no un servicio externo por dos razones: ya
está pago con el repositorio, y el secreto queda en el mismo lugar que el resto
en vez de en el panel de un tercero.

Faltan tres pasos, todos de panel:

1. **Elegir un secreto.** Cualquier cadena larga y aleatoria:
   ```
   openssl rand -hex 32
   ```
2. **Render → el servicio → Environment.** Agregar `CRON_SECRET` con ese valor.
   Guardar (redeploya).
3. **GitHub → Settings → Secrets and variables → Actions.** Agregar:
   - `API_URL` — la URL de la API, sin barra final. Ej:
     `https://adminapp-api.onrender.com`
   - `CRON_SECRET` — **el mismo valor** del paso 2.

Para probarlo sin esperar al día siguiente: pestaña **Actions → Tareas diarias
→ Run workflow**. Si los secretos faltan o no coinciden, el workflow falla con
el motivo escrito.

### Cuando `db:migrate` falla con «ya existe»

Pasa **solo en desarrollo**, y la causa es `sequelize.sync({ alter: true })`:
`server.js` lo corre al arrancar en desarrollo y arma el esquema a partir de
los modelos, sin registrar nada en `SequelizeMeta`. La base queda adelantada
y la cadena de migraciones, atrás.

**Por qué importa aunque sea solo en desarrollo.** En producción `sync` está
salteado, así que allá las migraciones son el único camino. Si la cadena nunca
se ejercita localmente, **un error de migración recién se ve en producción** —
que es el peor lugar para verlo.

Cómo se repara, sin borrar nada:

1. Comparar `SequelizeMeta` contra `src/migrations/`.
2. Por cada migración no registrada, **verificar en el esquema si su efecto ya
   está** (la tabla, la columna, la restricción). `sync` crea tablas y
   columnas, pero **no** claves primarias compuestas, índices con condición ni
   cambios de restricciones.
3. Las que ya están: registrarlas con un `INSERT` en `SequelizeMeta`.
4. Las que faltan de verdad: dejar que `db:migrate` las corra.
5. Correr `db:migrate` una segunda vez y confirmar que dice «No migrations
   were executed».

> El 1/8/2026 se reparó así una base de desarrollo con 12 migraciones sin
> registrar. Diez ya estaban aplicadas por `sync`; dos faltaban de verdad, y
> una de ellas era la clave primaria compuesta de `settings` — la corrección
> que impide que una empresa facture con el certificado de AFIP de otra. En esa
> base, esa protección **no estaba**.

**Recomendación**: sacar `sync({ alter: true })` del arranque en desarrollo y
usar migraciones también ahí. Es lo que evita que la deriva vuelva, y hace que
un error de migración se vea en la máquina de quien lo escribió.

---

## Deploy

### Migraciones

Corren solas al arrancar el contenedor, vía `scripts/migrar.js`, que toma un
advisory lock de PostgreSQL. Si falla, **el contenedor no levanta** — es
preferible a levantar con el schema a medias.

Manualmente:

```
npm --prefix apps/api run db:migrate
```

### Migraciones pendientes de correr

Cuatro, de las auditorías recientes. Tres dejan el histórico en su valor por
defecto y puede hacer falta completarlo a mano:

| Migración | Qué agrega | Ojo con el histórico |
|---|---|---|
| `20260730-settings-pk-por-empresa` | PK compuesta en `settings` | La config de AFIP existente queda asignada a la empresa 1 |
| `20260731-ventas-a-cuenta-corriente` | `sales.is_credit` | Las ventas viejas quedan como **contado**. Si hay cuentas corrientes en uso, hay que marcar las impagas |
| `20260731-guardar-punto-de-venta-afip` | `sales.afip_pv` | Queda NULL. Para los comprobantes ya emitidos, completar con el punto de venta que se usaba |
| `20260803-intentos-de-facturacion` | `sales.afip_ultimo_error`, `sales.afip_ultimo_intento` y el índice `(empresa_id, date)` | **Sin `UPDATE`.** Las dos columnas quedan en NULL y toda venta activa sin CAE anterior a la migración se muestra como **Registrada**, nunca como Rechazada |

El `UPDATE` de cada caso está en el comentario de la migración.

La última no lleva ninguno a propósito: no hay forma de saber cuáles de las
ventas viejas sin CAE fallaron y cuáles se registraron así queriendo, y adivinar
sobre una obligación fiscal es peor que no saber. Es aditiva y sobre columnas
nulas, así que es segura mientras la versión anterior de la aplicación sigue
corriendo.

### Rollback

Las migraciones tienen `down()`. Revertir la de `settings` **falla a propósito**
si dos empresas cargaron la misma clave: elegir cuál sobrevive es una decisión
de negocio, no de la migración.

### Al escalar a más de una instancia

Tres cosas dejan de funcionar bien:

1. **El serializador de numeración AFIP** vive en memoria del proceso. Con
   varias instancias, dos podrían pedir el mismo número de comprobante.
2. **El cron** correría N veces. Con el disparador externo, una sola.
3. **La caché del ticket WSAA** es por proceso: cada instancia pediría el suyo.
   AFIP no permite pedir uno nuevo antes de que venza el anterior.

Ninguna impide escalar, pero las tres hay que resolverlas antes.

---

## Alertas de error

Cada 500 y cada caída del proceso se reportan a Sentry, **si está configurado**.
Sin `SENTRY_DSN` no se inicializa nada y el sistema funciona igual: la
aplicación no depende de un servicio externo para arrancar.

Configurarlo:

1. Crear una cuenta en sentry.io y un proyecto **Node.js**. El plan gratuito
   (5.000 eventos/mes) sobra para un cliente.
2. Copiar el DSN (`https://...@....ingest.sentry.io/...`).
3. Render → Environment → `SENTRY_DSN`.
4. En Sentry, Alerts → activar el aviso por mail para errores nuevos.

Lo que llega en cada evento: el `requestId`, la ruta, el método y el
`empresaId`. Con el `requestId` se encuentra la línea exacta en los logs de
Render.

Lo que **no** sale del sistema: certificados y claves de AFIP, tokens de
TiendaNube, contraseñas y cabeceras de autorización. Hay un filtro explícito en
`src/config/sentry.js` — un secreto en el panel de un tercero es una fuga igual
que en cualquier otro lado.

---

## Probar una restauración

Un respaldo que nunca se restauró no es un respaldo.

**Lo que cubre Neon (recuperación ante desastre).** Neon guarda un historial
que permite volver la base a un momento anterior. Cómo probarlo sin tocar
producción:

1. Panel de Neon → el proyecto → **Branches** → *Create branch*.
2. Elegir **"From a point in time"** y una fecha de ayer.
3. Neon crea una rama con su propio connection string.
4. Conectarse a esa rama y verificar que los datos están:
   ```sql
   SELECT COUNT(*) FROM sales;
   SELECT MAX(date) FROM sales;
   SELECT COUNT(*) FROM empresas;
   ```
5. Borrar la rama.

Esto no interrumpe nada: la rama es una copia. **Anotar la fecha en que se
probó** — es lo único que convierte el respaldo en respaldo.

**Lo que cubre `scripts/backup.js`** (exportar los datos de una empresa a JSON)
es otro caso: devolverle los datos a un cliente que se va, o recuperar algo que
alguien borró por error. No reemplaza lo anterior.

```
npm --prefix apps/api run backup -- --empresa=<id>
```

---

## Migrar un cliente desde el sistema legacy

El sistema viejo de Comprafit (PHP + MySQL) guardaba todo como JSON en una
tabla clave-valor. El script traduce eso al esquema actual.

```
# 1. Simulación: no escribe nada, dice qué haría
npm --prefix apps/api run migrar:legacy -- --empresa=<id>

# 2. Si el resumen cierra, aplicar
npm --prefix apps/api run migrar:legacy -- --empresa=<id> --confirmar
```

Antes de correrlo:

- La empresa destino tiene que **existir** y tener **al menos un punto de
  venta**. El script no los crea.
- Para traer los datos **actuales** hacen falta `PHP_API_URL` y `PHP_API_TOKEN`
  (el token nuevo, después de rotarlo). Sin eso, el script cae al HTML del
  repo, que tiene los datos **semilla** — no los de hoy.
- Migra: marcas, productos, stock por sucursal, gastos fijos, ventas con sus
  ítems, y proveedores con movimientos, pedidos y documentos.
- **No** migra los permisos del legacy: el modelo cambió por completo. Se
  cargan de nuevo desde Equipo.
- Los gastos variables quedan guardados como referencia en `settings`, porque
  todavía no hay pantalla para ellos.

Es idempotente: correrlo dos veces no duplica. Y va en una transacción — si
falla a la mitad, no queda nada a medio migrar.

---

## Lo que todavía no existe

Para que nadie lo busque:

- **Notas de crédito.**
- **Pasarela de pago.**
- **Panel del dueño del SaaS.** Todo se hace con los scripts o contra la base.
- **Cifrado de la clave privada de AFIP.** Está en texto plano en la base.
- **Respaldo automático.** El script existe; correrlo periódicamente, no.

---

## Operadores de la plataforma (superadmin)

Un superadmin puede entrar a la empresa de cualquier cliente y ve los módulos
que todavía no se liberaron. Es el nivel de quien desarrolla y da soporte, no
un rol dentro de una empresa.

```
npm --prefix apps/api run superadmin -- listar
npm --prefix apps/api run superadmin -- activar <email>
npm --prefix apps/api run superadmin -- quitar <email>
```

El usuario tiene que haber entrado al menos una vez para existir en la base.

### Por qué es un script y no un botón

Un endpoint que otorga superadmin es una escalada de privilegios esperando a
que alguien encuentre el IDOR: quien lo llame se vuelve operador de **toda** la
plataforma, no de una empresa. Un script que corre con las credenciales de la
base no tiene esa superficie. Hay un test que falla si algún día aparece código
que escriba `es_superadmin` desde una ruta.

### Qué habilita y qué no

**Habilita** elegir cualquier empresa desde el selector del encabezado, sin
membresía, y ver los módulos no liberados.

**No habilita** ver datos de dos empresas a la vez. Se opera sobre **una
empresa por vez** —la seleccionada— y cada consulta sigue filtrando por
`empresa_id` igual que para cualquier usuario. Lo único que se ensanchó es
*qué* empresa se puede elegir.

### Rastro

Cada request de un superadmin sobre una empresa donde no es miembro se registra
con `superadmin: true` y el `empresaId`. Con el `requestId` se reconstruye todo
lo que tocó en esa sesión:

```
# En los logs de la plataforma
superadmin:true empresaId:12
```

El encabezado además muestra un aviso **«Empresa de cliente»** en ámbar mientras
estás en una empresa ajena. Sin eso es cuestión de tiempo hasta que alguien
cargue una venta en la empresa equivocada.

### Invisibilidad

El superadmin no aparece en la pantalla de Equipo del cliente: esa pantalla
lista membresías, y un superadmin no tiene ninguna en las empresas ajenas.

### Módulos no liberados

Clientes, recetas, producción, caja, impuestos y reportes existen solo para
superadmin. El gate está en tres lugares y hacen falta los tres:

| Dónde | Qué pasa sin él |
|---|---|
| Barra lateral | El ítem se ve y lleva a una pantalla que no carga |
| `RouteGuard` | Entrar por URL a mano funciona |
| **API (`requireSuperadmin`)** | **El menú es cosmética: los datos siguen accesibles** |

La API responde **404**, no 403: un 403 le confirma a quien está probando rutas
que el módulo existe y solo está oculto.

Para liberar uno: sacarlo del grupo «Nuevas funcionalidades» en
`components/navegacion.js`, quitarle `soloSuperadmin` a su ruta en `App.jsx`, y
sacar `requireSuperadmin` de su montaje en `server.js`. El test
`superadmin.test.js` va a fallar hasta que se lo saque también de la lista —
eso es a propósito: liberar un módulo tiene que ser una decisión, no un
descuido.
