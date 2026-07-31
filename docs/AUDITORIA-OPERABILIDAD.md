# Auditoría de operabilidad (Frente 5)

**Fecha:** 31 de julio de 2026
**Método:** 9 agentes sobre 4 áreas (observabilidad, resiliencia, operación,
seguridad operativa), con verificación adversarial. Más verificación manual.
**Resultado:** 54 hallazgos confirmados (4 críticos, 22 altos), 1 refutado.

---

## Respuesta corta

**El contenedor no podía arrancar.** Por dos motivos independientes, cada uno
suficiente por sí solo. Y no había nada —ni un test, ni un CI— que lo
detectara.

Además, si hubiera arrancado, **no habría habido forma de saber qué estaba
pasando**: los logs de producción iban a un archivo que nadie ve.

---

## Lo que impedía arrancar

### 1. Las migraciones se buscaban en un directorio inexistente

El Dockerfile copia `package.json`, `src/` y `scripts/`, pero **nunca
`.sequelizerc`** — que es lo único que le dice a `sequelize-cli` que las
migraciones viven en `src/migrations`.

Sin ese archivo, `sequelize-cli` cae al default `path.resolve(cwd, 'migrations')`
= `/app/migrations`, que la imagen no crea. `umzug` hace `readdir`, ENOENT, y
sale con código 1. Como el `CMD` encadena con `&&`, **`node src/server.js` nunca
se ejecuta**.

Verificado en el código fuente del `sequelize-cli` instalado: el `--help`
confirma que `--migrations-path` tiene default `"migrations"`.

Esto es anterior a los cambios recientes: el `CMD` original tenía el mismo
problema.

**Corregido** pasando `--migrations-path` explícito, que no depende de que un
archivo suelto llegue a la imagen.

### 2. Las migraciones se conectaban a Neon sin SSL

`sequelize-cli.js` decidía el SSL con `parsed.protocol === 'postgres:'`.

Los connection strings de Neon empiezan con **`postgresql://`**, y
`"postgresql:"` no es igual a `"postgres:"`. La condición daba falso, la
conexión iba sin cifrar, y Neon —que exige SSL— la rechazaba.

**Corregido**: el SSL se decide igual que en `src/config/database.js`.

---

## No había observabilidad

### Los logs iban a un archivo que nadie ve

`pino` escribía a `./logs/app.log` cuando `NODE_ENV=production`. En Render eso
significa dos cosas:

- La plataforma captura **stdout**. Un archivo no aparece en el panel, no se
  puede consultar, no se puede filtrar.
- El filesystem es **efímero**: el archivo se pierde en cada deploy, justo
  cuando más falta hace mirarlo.

El efecto neto: **en producción no había logs**.

### Y de los requests, ninguno

`morgan` escribía al nivel `http`, definido con valor **10**. El nivel efectivo
del logger en producción es `info` (**30**): todo lo emitido por debajo se
descartaba en silencio.

Sin log de acceso no se puede reconstruir qué hizo un usuario antes de un error.

### El healthcheck mentía

`render.yaml` apuntaba a `/api/ping`, que devuelve un JSON fijo. **Con Postgres
caído el servicio figuraba SANO**: Render no reiniciaba nada, no alertaba nada,
y cada request de usuario devolvía 500.

**Corregido** con `GET /api/health`, que hace `SELECT 1` y devuelve 503 si falla.
Expone la latencia para distinguir "está lenta" (Neon despertando) de "está
caída".

### El SQL de los errores quedaba expuesto

El serializador de `pino` incluye `err.sql` y `err.parameters` cuando el error
viene de la base. Ese SQL trae los valores del `INSERT` que falló: datos de
clientes, montos, y **en el peor caso la clave privada de AFIP** al guardarla.

Todo eso terminaba visible en el panel de la plataforma. Agregado al `redact`.

---

## Seguridad operativa

### Credenciales reales commiteadas

`legacy/api.php` tenía hardcodeadas la contraseña de base y el token de
aplicación del hosting original, con valores reales.

Se redactaron y pasan a leerse de variables de entorno. **Pero siguen en el
historial de git**: redactarlas ahora no las saca de los commits anteriores.

> **Si este repositorio fue público alguna vez, o si alguien más tuvo acceso,
> esas credenciales hay que rotarlas en el panel del hosting.** Es la única
> corrección real.

### `reset-demo-data.js` se autoejecutaba

El archivo vivía en `src/` —con lo cual viajaba dentro de la imagen de
producción— y llamaba a `resetDemoData()` en el cuerpo del módulo. Un `require`
accidental borraba datos reales.

Movido a `scripts/` y con guarda de `require.main === module`.

### El rate limit cortaba ventas reales

200 requests cada 15 minutos por IP. Un comercio con tres cajas sale a internet
por un único router: las tres comparten IP y consumen el mismo cupo. Y una sola
venta dispara varias llamadas.

Subió a 600. Se evaluó contarlo por usuario, que sería más justo, y **no se
hizo**: el middleware corre antes de la cadena de autenticación, así que
`req.userId` no existe todavía, y tomar el `sub` del token sin validarlo
permitiría evadir el límite inventando tokens.

---

## Resiliencia

### No había handlers de fallos no atrapados

Sin `unhandledRejection` ni `uncaughtException`, una promesa rechazada tumbaba
el proceso sin dejar rastro del motivo. Con los logs yendo a un archivo
efímero, el motivo se perdía del todo.

Ahora se loguea como `fatal` y se sale con código distinto de cero. **No se
intenta seguir operando**: después de una excepción no atrapada el estado del
proceso es desconocido, y una API de facturación en estado desconocido es peor
que una API caída.

### El cierre no era ordenado

`shutdown` cerraba Postgres de una, sin esperar los requests en vuelo: una venta
a medio guardar durante un deploy se cortaba en el medio.

Ahora primero se cierra el servidor HTTP —deja de aceptar conexiones y espera a
las que están en curso— y recién después la base, con un plazo máximo de 10 s.

### El cron no corría

`setInterval` no dispara mientras Render duerme el servicio. **Los trials nunca
vencían y los avisos nunca salían.**

Nuevo `POST /api/tareas/ejecutar` con secreto compartido, para que un cron
externo gratuito lo dispare una vez por día.

### Migraciones sin lock

Con varias instancias, todas arrancan a la vez y todas migran en paralelo.
`SequelizeMeta` no es atómica entre procesos: dos pueden leer "esta migración
falta", ejecutarla ambas, y la segunda fallar con la tabla ya modificada.

Nuevo `scripts/migrar.js` con advisory lock de PostgreSQL.

---

## No había CI

El repo solo tenía una plantilla de pull request. Nada corría los tests, nada
verificaba que las apps buildearan, y **nada comprobaba que la imagen
arrancara**.

Por eso un Dockerfile que no puede levantar el contenedor podía estar en el
repo sin que nadie lo notara.

Nuevo `.github/workflows/ci.yml` con cuatro jobs. El último es el que importa
para este caso: construye la imagen, corre las migraciones contra un Postgres
real y verifica que el servidor responda `/api/health`. **Los tests usan
modelos falsos y no habrían detectado nunca el problema del path.**

---

## Respaldos

No había nada: ni script, ni endpoint, ni mención. Lo único era la retención de
Neon, que en el plan gratuito es corta y no está bajo control del equipo.

Nuevo `scripts/backup.js`: exporta todas las tablas de una empresa a JSON.

**No reemplaza un `pg_dump`** para recuperación ante desastre. Resuelve el caso
frecuente: devolverle los datos a un cliente que se va (son registros fiscales
que está obligado a conservar), o recuperar algo que alguien borró por error.

> Sigue faltando lo importante: **que alguien lo corra periódicamente**, y
> **probar una restauración**. Un respaldo que nunca se restauró no es un
> respaldo.

---

## Lo que queda pendiente

### Requiere acción externa

1. **Rotar las credenciales del hosting legacy.** Están en el historial de git.
2. **Configurar el cron externo** que llame a `/api/tareas/ejecutar`. Sin eso,
   los trials no vencen.
3. **Probar una restauración de backup** desde el panel de Neon.
4. **Contratar tracking de errores** (Sentry tiene plan gratuito). Hoy nadie se
   entera de nada salvo que mire el panel.

### Requiere código

5. **65 bloques `catch` devuelven 500 sin loguear nada**, incluidos crear y
   anular venta. Se corrigieron los de las rutas auditadas; el resto no.
6. **Los errores 500 no llevan identificador.** No hay forma de atar el reporte
   de un usuario ("me dio error a las 3") con una línea del log.
7. **El onboarding hace cuatro `create` sin transacción.** Si falla el último,
   queda una empresa a medio crear.
8. **`sendEmail` devuelve `ok: true` sin `RESEND_API_KEY`.** Las invitaciones se
   pierden en silencio y el usuario cree que se enviaron.
9. **La llamada a Auth0 `/userinfo` no tiene timeout**, y está en el camino de
   todos los requests.

---

## Nota sobre el método

De los 54 hallazgos se corrigieron los 4 críticos y los altos con impacto
directo en seguridad o en la capacidad de operar. **Cada uno se verificó a
mano**: para el del `.sequelizerc` se leyó el código fuente de `sequelize-cli`
y se confirmó el default con `--help`; para el del SSL se comprobó que
`"postgresql:" !== "postgres:"`; para el del `redact` se emitió un error de
Sequelize con una clave privada en los parámetros y se verificó que sale
`[REDACTADO]`.

Los de severidad media y baja no se verificaron uno por uno. El informe crudo
está en `auditoria-frente5-hallazgos.json`.
