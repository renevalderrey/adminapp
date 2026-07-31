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

> **CERRADO** (31/07/2026). Los cinco puntos de esta sección están corregidos.
> El detalle está más abajo, en «Cierre de los pendientes de código».

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

---

## Cierre de los pendientes de código

**Fecha:** 31 de julio de 2026. Los cinco puntos que quedaban abiertos, más tres
fugas entre empresas cliente que aparecieron mientras se los corregía.

### 79 catch devolvían 500 sin loguear, y con el mensaje del error adentro

El relevamiento decía 65; el conteo final fue **79 apariciones literales** de:

```js
} catch (err) {
  res.status(500).json({ ok: false, error: err.message });
}
```

Dos problemas en dos líneas. El error no se registraba en ningún lado —incluía
crear y anular venta, las dos operaciones más críticas del sistema— y
`err.message` viajaba al cliente: un error de Sequelize trae nombres de tabla,
de columna y de constraint.

Nuevo `utils/errores.js` con `fallo(req, res, err, mensaje)`, que loguea con el
contexto completo y responde un mensaje en castellano. Los 79 sitios migrados,
más los 22 que ya logueaban pero no llevaban identificador.

Para los errores que **sí** son para el usuario —«Stock insuficiente en
"Depósito" para "Harina" (disponible: 2, requerido: 5)»— se agregó
`ErrorDeNegocio`: `fallo` respeta su mensaje y su status, y lo registra como
aviso en vez de como error. Sin esa distinción, taparlos con un genérico dejaba
al usuario sin saber qué corregir.

### Los 500 no tenían identificador

Nuevo `middleware/requestId.js`. Cada request lleva un id que aparece en tres
lugares a la vez: la cabecera `X-Request-Id`, el cuerpo del error, y **cada
línea de log de ese request**.

El id que llega de afuera se reusa —para poder seguir un request entre saltos—
solo si es inofensivo: sin saltos de línea, que permitirían inyectar entradas
falsas en el log.

El frontend lo muestra: el interceptor de axios agrega `(código: a1b2c3d4)` al
mensaje de cualquier 5xx. Se hizo en el interceptor y no pantalla por pantalla
porque las 18 páginas ya muestran `err.response.data.error`.

De paso, el log de acceso en producción pasó de la cadena estilo Apache de
`combined` a campos estructurados: ahora se puede filtrar por `requestId`, por
`status` o por `url` sin escribir una expresión regular. Y un 401 por token
vencido dejó de loguearse como error con stack completo — tapaba los errores
reales.

### El onboarding creaba cuatro filas sin transacción

Si fallaba la tercera, quedaba una empresa y un punto de venta creados, sin
membresía y sin suscripción: el usuario no podía entrar (no hay
`UsuarioEmpresa`) ni volver a registrarse (la empresa ya existe). Una cuenta
zombi que solo se arregla a mano en la base.

Las cuatro creaciones van ahora en una transacción. El email queda **fuera** a
propósito: mandarlo no es reversible, y que el proveedor de correo esté caído no
es razón para deshacer una empresa que se creó bien.

### `sendEmail` decía `ok: true` sin `RESEND_API_KEY`

Devolvía `{ ok: true, mock: true }`. Quien invitaba a alguien veía «Invitación
enviada» mientras el destinatario no recibía nada, y no había forma de darse
cuenta.

Ahora devuelve `ok: false`, avisa una vez al arrancar si falta la clave, y los
que llaman lo manejan:

- **Invitar** responde 201 con `email_enviado: false` y le dice al usuario que
  pase el enlace a mano. La invitación es válida igual.
- **Re-enviar** responde 502: enviar era la única acción pedida.
- **El cron** solo cuenta los avisos que salieron de verdad. Antes el log decía
  «5 avisos enviados» con el correo sin configurar.

### La llamada a Auth0 `/userinfo` no tenía timeout

Está en el camino de todos los requests que llegan con un token sin `name` o sin
`email`, y `fetch()` no tiene timeout por defecto. Si Auth0 se ponía lento, cada
request se colgaba —no fallaba, se colgaba— hasta el timeout del cliente: un
problema de Auth0 se convertía en una caída total de AdminApp.

Timeout de 3 s con `AbortSignal.timeout`. El perfil es opcional: si no llega, se
sigue con lo que traiga el token. El `catch` además dejó de estar vacío.

---

## Tres fugas entre empresas cliente que seguían abiertas

No son del Frente 5. Aparecieron leyendo los `catch` de cada ruta, y son de la
misma clase que las del Frente 1: **el Frente 1 no las había encontrado.**

| Endpoint | Qué permitía |
|---|---|
| `GET /api/products/:id/cost-history` | Leer la evolución de costos de un producto de otra empresa |
| `GET /api/products/:id/recipe` | Leer la fórmula: qué insumos lleva y en qué proporción |
| `DELETE /api/products/:id/recipe` | **Borrar** la receta de otra empresa cliente |

Las tres consultaban `where: { product_id: req.params.id }` sin resolver antes
el producto con scoping. `POST /:id/recipe` sí tenía el chequeo: se corrigió una
de las cuatro.

Y cinco rutas más, en `empresas.js`, que toman el id de la **URL** en vez del
contexto:

| Endpoint | Qué permitía |
|---|---|
| `GET /:empresaId/puntos-de-venta` | Listar las sucursales de otra empresa |
| `POST /:empresaId/puntos-de-venta` | Crearle una sucursal |
| `GET /:empresaId/invitaciones` | Ver a quién invitó, con los emails |
| `GET /:empresaId/usuarios` | Listar su equipo, con nombres y emails |
| `POST /:empresaId/usuarios` | **Agregar un usuario —incluido uno mismo— a su equipo, con el rol que se pida** |

`checkPermission` verifica el permiso en la empresa **activa** del usuario, no
en la de la URL. `requireEmpresaPropia` existía y estaba puesto en dos rutas;
faltaba en estas cinco. Alcanzaba con cambiar el número de la URL.

### Cómo se evita que vuelvan

Tres guardias estáticas nuevas en `src/tests/observabilidad.test.js`, del mismo
estilo que las del Frente 1: leen el fuente y fallan si el patrón reaparece.

1. Toda ruta con `:empresaId` tiene que llevar `requireEmpresaPropia`.
2. Nada de `where: { algo_id: req.params.x }` sin `empresa_id` (con una lista de
   excepciones legítimas, cada una con su motivo).
3. Ningún `catch` responde 500 con `err.message`.

Se verificó que las tres **fallan** contra la versión anterior del código: 5
hallazgos de la primera, 7 de la segunda, 79 de la tercera. Una guardia que
nunca falla no sirve de nada.

### Otros dos arreglos del camino

- **Transacciones que quedaban abiertas.** `DELETE /api/suppliers/:id` y
  `POST /api/stock/transfer` hacían `return` en un 404 o en una validación sin
  hacer rollback: cada uno se llevaba una conexión del pool hasta el timeout.
- **La importación entera fallaba al reportar una fila mala.** En
  `routes/import.js` el `catch` del bucle usaba `data`, declarado dentro del
  `try`: tiraba `ReferenceError` justo cuando había un error que explicar, y la
  importación devolvía 500 en vez de reportar la fila y seguir.

**Suite:** 252 → **308 tests**.

---

## El CI estaba en rojo, y lo que encontró

El CI se agregó en este mismo frente, pero **nunca había pasado en verde**. Dos
fallas independientes, las dos invisibles en la máquina de quien desarrolla:

1. **Una base nueva no se podía crear.** La migración de `tiendanube_mappings`
   usaba `references: { table, key }` en `addConstraint`, donde sequelize espera
   `{ table, field }` — la forma `{ model, key }` es la de `addColumn`. Fallaba
   con *"references object with table and field must be specified"* y cortaba la
   cadena de migraciones. La base existente ya tenía las tablas, así que el
   problema solo aparecía desde cero: exactamente el caso de un deploy nuevo o
   de una restauración de backup.

2. **`server.test.js` fallaba sin `.env`.** `BYPASS_AUTH` evita que el servidor
   use `checkJwt`, pero `middleware/auth.js` igual construye `auth({...})` al
   importarse, y eso exige `AUTH0_AUDIENCE`. En local lo tapaba el `.env`.

Es el argumento a favor del job que arranca la imagen de verdad: **los tests
usan modelos falsos y jamás habrían encontrado el primero.** Con los dos
corregidos, los cuatro jobs pasan.
