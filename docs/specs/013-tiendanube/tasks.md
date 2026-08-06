# Tasks: TiendaNube — pantalla nueva completa

**Input**: documentos de diseño en `docs/specs/013-tiendanube/`
(`spec.md`, `plan.md`, `data-model.md`, `contracts/api-endpoints.md`).

Cuarenta y ocho tareas en quince fases. El orden sale de «Orden de fases» del
plan, **con una permuta declarada**: el corte del IDOR pasa de segundo a
**primero** y las dos migraciones bajan a la fase 2. El motivo está en el punto 3
de «Antes de empezar» y no es preferencia de estilo.

`[P]` marca las que se pueden hacer en paralelo porque tocan archivos distintos.

⚠ **Dos advertencias de nombre, para que nadie las confunda al buscar**: hay un
`utils/tiendanube.js` en `apps/web/src/` y **no** hay uno en `apps/api/src/` —los
del servidor son `tiendanubeCatalogo.js` y `tiendanubeCola.js`—; y hay dos
archivos de integración que empiezan igual, `tiendanubeWebhook…` y
`tiendanubeAislamiento…`, escritos por fases distintas.

---

## Antes de empezar: nueve cosas que no son tareas

### 1. Cómo se verifica, en cuatro niveles

| Nivel | Qué cubre acá | Dónde |
|---|---|---|
| Función pura | El backoff, la clasificación de un error de axios, la normalización del catálogo, la sugerencia por SKU, los cuatro estados de la conexión, el tono de un badge, el resumen de una corrida, el filtro de variantes | `apps/api/src/tests/*.test.js` · `apps/web/src/utils/*.test.js` |
| Test de API con `modelosFalsos` | Qué status responde cada endpoint, qué **no** devuelve, qué motivo trae una redirección | `apps/api/src/tests/tiendanubeRutas.test.js` |
| **Integración contra Postgres** | La idempotencia con dos entregas a la vez, el `state` de un solo uso, el índice único de la tienda, el aislamiento **ejecutado**, el arriendo, el hook de `Stock`, el agrupado | `apps/api/src/tests/integracion/*.integracion.test.js` |
| Test de render (jsdom) | Qué badge lleva qué fila, qué queda deshabilitado con su explicación, qué avisa la pantalla, cuántas llamadas manda un doble clic | `apps/web/src/tests/renderDeTiendanube.test.jsx` |
| Guardia estática | Que el montaje no se vuelva a mover, que ninguna llamada quede sin `timeout`, que no vuelva un `console.error`, que `controllers/` no reaparezca, que no haya hexadecimales | `observabilidad.test.js` · `aislamientoEmpresas.test.js` · `guardiasDeDiseno.test.js` |
| Paso manual | Lo que **no se puede** verificar sin la cuenta real de TiendaNube, y dos acciones de operación | Sección «Los cuatro pasos manuales», al final |

**El cuarto nivel no es opcional en esta funcionalidad.** Los dobles de
`tests/helpers/modelosFalsos.js` no entienden transacciones, `lock`, `group` ni
restricciones únicas —lo dice su propio encabezado—, y la mitad de lo que este
hito garantiza son restricciones únicas.

Comandos:

```
npm run test:api                              # NO levanta los de integración
npm --prefix apps/api run test:db:levantar    # una vez: contenedor + migraciones
npm --prefix apps/api run test:integracion
npm run test:web
npm run build
node apps/api/scripts/verificar-reversibilidad.js --desde 20260809
```

### 2. ⚠ La guardia que la spec y el plan dan por hecha HOY NO VE `createMapping`

Es el hallazgo más caro de este documento y cambia una tarea entera.

El plan (hallazgo 2) dice que `analizarCreates` «reconoce EXACTAMENTE esa forma»
y que «habría nombrado `createMapping` con archivo y línea». **Se comprobó
ejecutando el detector contra el texto real y es falso, por dos motivos
independientes:**

**(a) El código usa la forma corta de ES6 y el detector exige dos puntos.**
`controllers/tiendanube.js:157-164` escribe:

```js
const { product_id, tiendanube_variant_id, tiendanube_product_id } = req.body;
const mapping = await TiendanubeMapping.create({
  empresa_id: req.empresaId,
  product_id,              // ← sin `:` — el detector no lo ve
  tiendanube_variant_id,
  tiendanube_product_id,
});
```

El extractor de claves de `aislamientoEmpresas.test.js:379` es
`/(\w+_id)\s*:\s*([^,\n}]+)/g`. Contra ese objeto devuelve **cero** claves después
de descartar `empresa_id`, así que `claves.length === 0` y el bucle hace
`continue` (`:381`) **antes de mirar nada**. Verificado con el objeto literal del
archivo.

**(b) `routes/tiendanube.js` no tiene un solo `router.<verbo>(`.** Los ámbitos de
handler se detectan con `/router\.(get|post|put|delete|patch)\s*\(/` (`:324`), y
este archivo declara **dos routers llamados `publico` y `privado`** —el supuesto 5
de la spec dice que esa separación se conserva—. Verificado: cero coincidencias
de `router.<verbo>`, y lo que hay es `publico.get`, `publico.post`, `privado.get`
y `privado.post`.

Consecuencia de (b), y es la que muerde al revés: sin ámbito,
`antes = ''` (`:417`) y **ningún `findScoped` que se escriba en este archivo
cuenta como validación previa**. O sea que un `create` con `product_id:
req.body.product_id` se reportaría como `sinValidar` **aunque tenga el
`findScoped` tres líneas arriba**. La forma del contrato —`product_id:
producto.id`— esquiva el falso positivo por casualidad, no por diseño.

**Por eso T1301 existe y va PRIMERA**, antes de mover el archivo. Mover el
archivo y ver la guardia en verde es exactamente el modo de falla que este
repositorio viene juntando: una guardia que pasa **sin haber mirado nada**.

### 3. Por qué el IDOR va primero y las migraciones segundas

El plan pone las migraciones en la fase 1 con este motivo: «es la única con
migraciones, y una de las dos mueve datos… mezclarla con el corte que estrena el
`state` haría que un fallo del `down` se lea como un fallo del OAuth». **Ese
motivo sigue valiendo entero y por eso las migraciones siguen en un corte propio
y siguen antes que el OAuth.** Lo único que cambia es que el corte del IDOR pasa
adelante, y se puede porque:

- **No depende de ninguna tabla nueva.** Disolver `controllers/`, ponerle
  `findScoped` a `createMapping` y validar los tres ids no toca el modelo de
  datos. Verificado leyendo los siete handlers.
- **Es daño real hoy.** `POST /api/tiendanube/mapping` con el `product_id` de
  otra empresa responde **201** y deja la fila. Es la regla que este proyecto ya
  rompió veintiocho veces.
- **Es el criterio de los dos hitos anteriores**, y las dos veces apareció un
  defecto que había que cerrar antes de seguir.

**La idempotencia no puede ir primero y hay que decirlo**: vive en
`tiendanube_pedidos`, que es una tabla de la fase 2, y necesita la sucursal
designada, que es una fila de la fase 3. Va en la fase 4, que es la más grande y
la más importante del hito.

### 4. Lo que ya está y no lleva tarea

- **La firma HMAC no se toca** (`controllers/tiendanube.js:69-84`, supuesto 7):
  SHA-256 sobre el cuerpo crudo, `timingSafeEqual` y chequeo de longitud previo.
  Está bien escrita. Lo único que falta es que le llegue el cuerpo.
- **Solo se procesa `order/paid`** (supuesto 6). No se agrega `order/created`:
  descontaba el stock dos veces por la misma venta.
- **El `Math.max(0, …)` del stock que se publica se conserva**
  (`tiendanubeService.js:79`): TiendaNube no acepta negativos.
- **El 500 con mensaje claro cuando falta `TIENDANUBE_CLIENT_ID` se conserva**
  (`:12-14`). Es el cuarto estado de FR-006 y ya estaba bien.
- **La separación en dos routers se conserva** (supuesto 5). Lo único que cambia
  es el **orden del montaje** del `publico` (T1315).
- **No se crea ningún permiso** ([PENDIENTE N1] por defecto): `config.ver` y
  `config.editar` existen (`seedPermissions.js:59-60`).
- **No va `soloSuperadmin`** (FR-069): la pantalla es para el cliente y no está
  en la lista de `CONVENCIONES.md`.
- **`permisosDeRutas.test.js` no cambia de población**: sus diecinueve archivos
  de `routes/` ya incluyen `tiendanube.js` (`:546`). Se le agregan rutas al
  archivo que ya está, no un archivo nuevo. Su excepción documentada
  (`:81-85`) sigue diciendo lo mismo.
- **`analizarIncludes` sigue en `toBe(4)`** (`aislamientoEmpresas.test.js:740`):
  ninguna consulta de este hito usa `include`, y por eso los cinco modelos nuevos
  **no declaran ninguna asociación**.
- **El token no cambia de lugar.** Sigue en `settings.tiendanube_access_token`, en
  texto plano. FR-077, [PENDIENTE N6] y el proyecto 6 de `PROXIMOS-PROYECTOS.md`.
- **Borrar las tres rutas viejas no rompe la web**: `services/api.js` no tiene un
  solo helper de TiendaNube y `Settings.jsx` solo llama a `/status` (`:76`) y a
  `/auth` (`:83`). Verificado con `grep`.

### 5. ⚠ El índice único de FR-026 NO se crea, y eso hay que leerlo antes de escribir la fase 2

FR-026 pide `UNIQUE (empresa_id, referencia_id)` sobre `stock_movements`.
`referencia_id` **no es único por diseño en ninguno de sus tres usos**:
`routes/sales.js:557` escribe **una fila por línea** de la venta con el mismo
`sale.id`; `routes/sales.js:726` escribe la anulación **encima** de esos mismos
valores; y `tiendanubeService.js:154` escribe **una fila por ítem** del pedido.

Con ese índice, **el primer ticket de dos productos del día siguiente al deploy
revierte la transacción entera y `POST /api/sales` responde error.** No es un
riesgo teórico.

La idempotencia va a `tiendanube_pedidos` con `UNIQUE (empresa_id,
tiendanube_order_id)`, una fila por pedido, insertada **primero y dentro** de la
transacción que descuenta. Es la decisión 6 del plan y el riesgo 1.

**Si alguien lo propone igual**: mostrarle `routes/sales.js:557` y contar las
filas que escribe una venta de dos productos.

### 6. Las cuatro decisiones del usuario que mandan sobre el planteo largo de la spec

De la tabla «Lo que faltaba decidir · **resuelto**». Se repiten porque debajo de
esa tabla la spec enumera las opciones descartadas y alguien las puede leer como
abiertas:

1. **`state` = token opaco de un solo uso**, guardado del lado del servidor. Se
   consume con un `UPDATE … RETURNING`, no con un `findOne` + `update`.
2. **Se publica `available`**, no `quantity`.
3. **Una sucursal designada**, de donde sale lo que se publica **y** donde se
   descuenta el pedido. `NOT NULL`, sin rama de omisión.
4. **Se sincroniza ante cada movimiento de stock**, con su red: cola con
   reintento y espera creciente, agrupado por la unicidad de la fila, y
   reconciliación diaria de respaldo.

### 7. ⚠ La decisión 2 se implementa igual, y hoy no cambia ningún número

«Un producto con 10 en depósito y 3 comprometidos publica 7» describe un estado
que **AdminApp no puede producir**: no hay concepto de comprometido. Los ocho
caminos que escriben `stock` mueven `quantity` y `available` con el mismo delta,
y **cuatro le asignan directamente `available = quantity`**
(`productionService.js:378` y `:508`, `import.js:438`, `products.js:329`),
borrando cualquier diferencia. El único que las puede separar es el ajuste manual
de `general.js:86-91`, y la siguiente producción o importación lo pisa.

**Publicar `available` es correcto y no cuesta nada hoy**, y es lo que se hace.
Lo que **no** se puede afirmar es que proteja de una sobreventa que hoy no puede
ocurrir. Queda anotado en `PROXIMOS-PROYECTOS.md` (T1348), con los tres
escritores que borrarían la reserva el día que exista.

### 8. Las guardias existentes que este trabajo mueve, y las que NO se mueven

| Guardia | Hoy | Queda | Tarea |
|---|---|---|---|
| `analizarCreates` / `ambitos` en `aislamientoEmpresas.test.js:365`, `:321` | Ciego a la forma corta y a los routers nombrados | Ve las dos cosas, con sus dos muestras sintéticas | **T1301** |
| `guardiasDeDiseno.test.js:220` | `toHaveLength(16)` | `toHaveLength(19)` | **T1337** |
| `marcoDeLasPantallas.navegador.js:40` | 17 rutas | 18 rutas | **T1338** |
| `analizarIncludes` `:740` | `toBe(4)` | **`toBe(4)` — no se mueve** | ninguna |
| `descuentoDeStock.test.js:227-233` | `bloques.length === 1` sobre `services/tiendanubeService.js` | **igual — el ancla no se mueve** | ninguna |
| `permisosDeRutas.test.js:540-547` | 19 archivos de `routes/` | **igual** | ninguna |

⚠ **`descuentoDeStock.test.js` lee archivos por nombre, no el directorio**
(`:227`). Verificado. Por eso `services/tiendanubeSincronizacion.js` —que también
lee `Stock`— es invisible para ese ancla, y por eso `processOrderCreated`
**no se muda de archivo** (decisión 15 del plan). Mudarlo dejaría el ancla
mirando un archivo sin ninguna búsqueda de stock: **en verde sin haber mirado
nada**.

### 9. ⚠ Lo que el plan dice que la mudanza de `controllers/` arregla, y lo que de verdad arregla

El plan dice que al mover el archivo «entran cinco guardias». Se revisó una por
una contra el código y **entra una sola, y sólo después de T1301**:

| Guardia | Qué lee | Qué pasa al mover el archivo |
|---|---|---|
| `aislamientoEmpresas.analizarCreates` | `routes/` + `services/` | **Nada, hoy.** Punto 2 de esta sección. Con T1301, nombra `createMapping` |
| `observabilidad` · el `err.message` en un 500 | **solo** `routes/` | **Nada.** Los cinco `res.status(...).json(...)` del controlador usan mensajes fijos, **ninguno trae `err.message`**. Verificado con `grep` |
| `observabilidad` · las rutas con `:empresaId` | **solo** `routes/` | **Nada**: no hay ninguna ruta con `:empresaId` |
| `permisosDeRutas` | **solo** `routes/` | **Nada**: ya leía `routes/tiendanube.js` |
| `aislamientoEmpresas` · `findByPk`, `|| 1`, `empresa_id: null`, stock sin sucursal | `routes/` + `services/` (+ `utils/`) | **Nada**: ninguno de los cuatro patrones aparece en el controlador |

Y el `console.error` de `tiendanubeService.js:35` **no lo atrapa la mudanza**:
está en `services/`, que ya se lee, y ninguna guardia de hoy busca ese patrón. Es
una guardia **nueva** y es T1303.

**El directorio se borra igual**, y por dos motivos que siguen en pie: un solo
archivo con una convención que el resto del repositorio no usa, y cada guardia
futura vuelve a nacer sin ese directorio en su lista.

---

## Phase 1: El IDOR del mapeo, y el punto ciego que lo dejó pasar

**Purpose**: la empresa B que manda un `product_id` de la A recibe **404** y no
queda ninguna fila; el choque de índice único llega como mensaje legible y no
como 500; `src/controllers/` deja de existir; y la guardia que tendría que haber
visto esto **de verdad lo ve**.

**Es API pura, no depende de ninguna tabla nueva y no bloquea nada.** Se mergea y
se despliega sola. Es el criterio de éxito 6 y US4 escenario 1.

- [ ] **T1301** [P] ⚠ **Va primera y no se puede saltear.** En
      `apps/api/src/tests/aislamientoEmpresas.test.js`, enseñarle al detector las
      dos formas que hoy no ve (punto 2 de «Antes de empezar»):
      **(a)** en `analizarCreates` (`:379`), el extractor de claves pasa a
      reconocer también la **forma corta** de ES6 —`product_id,` sin dos
      puntos—, cuyo valor es el nombre de la clave: algo de la forma
      `/(\w+_id)\s*(?::\s*([^,\n}]+)|(?=\s*[,}]))/g`, con el valor cayendo al
      propio identificador cuando no hay `:`. La clasificación de `sospechosas`
      (`:396-407`) no cambia: un identificador suelto entra por la rama de
      `parametros.includes(base)`, que es la que existe para esto.
      **(b)** en `ambitos` (`:324`), el ámbito de handler deja de exigir el
      literal `router.` y pasa a reconocer **cualquier identificador** seguido de
      un verbo HTTP —`/\b(\w+)\.(get|post|put|delete|patch)\s*\(/`—, que es lo que
      `routes/tiendanube.js` necesita: declara `publico` y `privado`, no `router`.
      **Por qué (b) importa aunque parezca cosmético**: sin ámbito, `antes = ''`
      (`:417`) y **ningún `findScoped` de ese archivo cuenta como validación
      previa**. La guardia quedaría reportando como `sinValidar` un `create` que
      sí validó — un falso positivo que se cierra agregando una excepción, y una
      excepción es cómo una guardia deja de servir.
      **Verificación**: `npm --prefix apps/api test -- aislamientoEmpresas` pasa,
      y el ancla de `analizarIncludes` **sigue en `toBe(4)`** (`:740`): esta tarea
      no toca el detector 2.
      **El test**: dos muestras sintéticas nuevas al lado de
      `MUESTRA_CREATE_MALA` (`:538`), y **las dos con su `it`**:
      `it('ve el create que cuelga de un product_id escrito en forma corta')`
      —una muestra que desestructura `req.body` y pasa `product_id,` a secas,
      dentro de un `privado.post(...)`; `sinValidar` tiene que nombrarla—, y
      `it('acepta el findScoped que está adentro de un handler de un router que
      no se llama router')` —la misma muestra con `findScoped` delante y
      `product_id: producto.id`; `sinValidar` tiene que quedar vacío—.
      **Cómo se comprueba que el test sirve**: se vuelve el extractor de claves a
      `/(\w+_id)\s*:\s*([^,\n}]+)/g` y el primero se pone en rojo con
      `sinValidar` vacío; se vuelve `ambitos` a exigir `router.` y el segundo se
      pone en rojo reportando un create que sí estaba validado.
      ⚠ **Correr la suite entera después de esta tarea, no solo este archivo.**
      Ensanchar los dos detectores cambia la población que miran: cualquier
      `create` con forma corta o dentro de un router con otro nombre que hoy
      estuviera pasando desapercibido **aparece acá**. Si aparece alguno, es un
      hallazgo propio y va con su tarea, **no** con una excepción.

- [ ] **T1302** ⚠ **El corazón de este corte.** `apps/api/src/controllers/` se
      disuelve y el directorio se borra. Los siete handlers de
      `controllers/tiendanube.js` bajan a `apps/api/src/routes/tiendanube.js`, y
      en el mismo commit `createMapping` se corrige:
      **(a)** los tres ids se validan enteros → `400` con `ErrorDeNegocio`
      (FR-031);
      **(b)** `const producto = await findScoped(Product, product_id,
      req.empresaId)` → `404` si no resuelve (FR-030). **Es la mitad que hoy no
      existe**;
      **(c)** el `create` va con **`product_id: producto.id`**, nunca con
      `req.body.product_id` ni con la forma corta. Es la forma que `dfd7009` dejó
      en `routes/suppliers.js` y la que `analizarCreates` da por validada;
      **(d)** el `catch` distingue `SequelizeUniqueConstraintError` y responde
      **409** nombrando **con qué choca** —relee el mapeo existente— en vez del
      500 genérico de `:169` (FR-032, US3 escenarios 8 y 9);
      **(e)** los cinco `res.status(...).json({ok:false,error:...})` escritos a
      mano pasan a `fallo(req, res, err, 'mensaje en castellano')` y a
      `ErrorDeNegocio` (FR-061, FR-063). El 500 de `TIENDANUBE_CLIENT_ID`
      ausente **se conserva con su texto**: es el cuarto estado de FR-006.
      **Lo que NO cambia en este corte**: la ruta sigue siendo
      `POST /api/tiendanube/mapping` —el renombre a `/mapeos` es T1324, con la
      pantalla que lo llama—, la separación en dos routers, y el orden del
      montaje en `server.js`.
      **Y una guardia**: en `apps/api/src/tests/observabilidad.test.js`,
      `it('src/controllers/ no existe: es el directorio que ninguna guardia
      miraba')`, con `fs.existsSync`. Sin ella alguien lo vuelve a crear y las
      cinco guardias vuelven a no mirar.
      **Verificación**: `npm run test:api` pasa —incluida `aislamientoEmpresas`
      con los detectores de T1301, que ahora **sí** miran este archivo— y
      `permisosDeRutas` sigue con sus diecinueve archivos y su excepción de
      `routes/tiendanube.js publico` intacta.
      **El test**: `apps/api/src/tests/tiendanubeRutas.test.js`, nuevo, con
      `modelosFalsos`:
      `it('POST /mapping con un product_id de otra empresa responde 404 y NO crea
      ninguna fila')` —es el criterio 6 y **es verificable contra hoy, donde
      responde 201**—;
      `it('un product_id que no es entero responde 400 y no 500')`;
      `it('el segundo mapeo del mismo producto responde 409 nombrando la variante
      con la que choca')`;
      `it('el segundo mapeo de la misma variante responde 409 nombrando el
      producto con el que choca')`;
      `it('ninguna respuesta de ningún endpoint contiene la cadena del token')`
      —FR-075, criterio 20—.
      **Cómo se comprueba que el test sirve**: se saca el `findScoped` y se
      vuelve a `product_id` de `req.body` y el primero se pone en rojo con **201**
      y la fila creada; se saca la rama del `SequelizeUniqueConstraintError` y el
      tercero y el cuarto se ponen en rojo con **500 «Error al crear el mapeo de
      producto»**, que es literalmente lo que el usuario ve hoy.
      ⚠ **Que la fila de la empresa A siga ahí después del intento no lo contesta
      este nivel.** Una guardia estática ve que se llamó a `findScoped`; que la
      fila ajena haya quedado como estaba lo contesta el cuarto nivel, y es
      **T1325**.

- [ ] **T1303** [P] FR-060 y la única línea de esta integración por la que un
      secreto podía llegar a un log. En
      `apps/api/src/services/tiendanubeService.js:35`, el `console.error` con
      `error.response?.data` se reemplaza por `logger.error({ err, empresaId },
      'tiendanube: canje del code')`. Y en
      `apps/api/src/tests/observabilidad.test.js` entra la guardia que lo vigila
      para **todo** `routes/`, `services/` y `utils/` —no solo TiendaNube: la
      regla es del repositorio—.
      **Por qué importa la línea concreta**: la redacción de secretos existe y es
      explícita —`utils/logger.js:63-67` cubre `access_token`,
      `*.access_token` y `tiendanube_access_token`, y `config/sentry.js:55` los
      tapa antes de salir a un tercero— pero **`console.error` no pasa por
      ninguna de las dos**. El único lugar donde el material sensible de esta
      integración podía llegar a un log es justamente el que esquiva el filtro.
      ⚠ **`observabilidad.test.js` hoy solo lee `routes/`** (`:152`, `leerRutas`).
      La guardia nueva necesita su propio lector de los tres directorios: **no es
      una línea**, es un helper de cinco. Y tiene que saltear comentarios, con el
      mismo filtro que ya usan las otras (`!texto.startsWith('//') &&
      !texto.startsWith('*')`): `routes/suppliers.js:56` menciona `console.error`
      **adentro de un JSDoc** y sin el filtro la guardia nace en rojo por una
      explicación.
      **Verificación**: `npm --prefix apps/api test -- observabilidad` pasa. Hoy
      hay **exactamente una** ocurrencia real en los tres directorios, verificado
      con `grep`; después de esta tarea hay cero.
      **El test**: `it.each` sobre los tres directorios, más
      `it('la guardia distingue un console.error de una línea que lo menciona en
      un comentario')`, con dos muestras sintéticas.
      **Cómo se comprueba que el test sirve**: se vuelve a poner el
      `console.error` en `tiendanubeService.js` y la guardia lo nombra con
      archivo y línea; se saca el filtro de comentarios y la guardia nombra el
      JSDoc de `suppliers.js`, que es un falso positivo y por eso está el segundo
      caso.

**Checkpoint**: `npm run test:api` pasa; `POST /api/tiendanube/mapping` con el
producto de otra empresa responde **404** donde hoy responde 201;
`src/controllers/` no existe; no queda un `console.error` en `routes/`,
`services/` ni `utils/`; y la guardia de `create` **ve** la forma corta y los
routers nombrados. **Este corte se mergea, se despliega y se olvida**: no hay
tabla nueva adentro y la pantalla vieja de Ajustes sigue funcionando igual.

---

## Phase 2: Las dos migraciones, los cinco modelos y la semilla que las hace verificables

**Purpose**: las cinco tablas existen, los cinco modelos están registrados, y
`verificar-reversibilidad.js` **ejecuta de verdad** la rama de datos de la
migración que mueve `settings`. Sin una línea de comportamiento.

Es aditivo puro y se despliega solo. Va antes que el OAuth y **sola**, por el
motivo del plan: un fallo del `down` de una migración que mueve datos no se puede
leer como un fallo del OAuth.

- [ ] **T1304** [P] Crear
      `apps/api/src/migrations/20260810-tiendanube-vinculacion-y-estado.js`,
      siguiendo el molde de `20260808-indices-de-empresa-en-proveedores.js`:
      **SQL crudo, una sola transacción, `IF NOT EXISTS` en el `up` e `IF EXISTS`
      en el `down`**. Las cinco cosas del `up`, en orden (data-model.md,
      «`20260810`»):
      **(1)** `tiendanube_tiendas` con `empresa_id` como **PK**, FK a `empresas`
      `ON DELETE CASCADE`, `tiendanube_user_id BIGINT UNIQUE`,
      `punto_de_venta_id INTEGER NOT NULL` con FK **`ON DELETE RESTRICT`**, y las
      ocho fechas/banderas de estado;
      **(2)** `tiendanube_estados_oauth` con `token VARCHAR(64)` como PK y su
      índice `idx_tn_estados_expira` sobre `(expira_en)`;
      **(3)** el `INSERT … SELECT` desde `settings` con `key =
      'tiendanube_user_id'`, resolviendo la sucursal con el `COALESCE` de tres
      escalones de `data-model.md` —`code = 'principal'`, después activa, después
      la de menor id— **en ese orden**, `WHERE … IS NOT NULL` y `ON CONFLICT DO
      NOTHING`. Una empresa **sin ninguna sucursal** no se muda y la migración lo
      dice por `console.log` —no falla: una empresa sin sucursales no puede tener
      stock, así que tampoco una tienda que sincronizar—;
      **(4)** `DELETE FROM settings WHERE key = 'tiendanube_user_id'` **solo de
      las que entraron**. `tiendanube_access_token` **no se toca**;
      **(5)** `ALTER TABLE tiendanube_mappings ALTER COLUMN
      tiendanube_variant_id TYPE BIGINT` y lo mismo con `tiendanube_product_id`.
      El `down`, exactamente al revés: las dos columnas vuelven a `INTEGER`
      —**no puede fallar por datos**: ningún valor guardado bajo `int4` puede
      exceder `int4`, y eso es lo que hace que el script la pueda probar—, el
      `INSERT INTO settings … to_jsonb(tiendanube_user_id)` con `ON CONFLICT (key,
      empresa_id) DO NOTHING` **que es el paso que devuelve el dato**, y los dos
      `DROP TABLE`.
      ⚠ **`FR-026` NO se implementa acá**: esta migración **no crea** ningún
      índice único sobre `stock_movements`. Punto 5 de «Antes de empezar» y riesgo
      1 del plan. El comentario del archivo lo dice con el número de línea de
      `routes/sales.js:557`.
      ⚠ **El ensanchado a `BIGINT` es una desviación declarada del supuesto 4 de
      la spec** («el modelo `TiendanubeMapping` y su migración se conservan tal
      cual»). Lo que el supuesto protege queda intacto: los dos índices únicos,
      las dos FK con `ON DELETE CASCADE` y el bug documentado de `addConstraint`
      con `key` en vez de `field`. **Lo único que cambia es el ancho de dos
      columnas**, y va escrito en el encabezado del archivo para que `sdd-verify`
      no lo lea como un olvido.
      **Verificación**: `npm --prefix apps/api test -- reversibilidadDeMigraciones`
      pasa —la guardia que exige que toda migración exporte un `down`—, y
      `node apps/api/scripts/verificar-reversibilidad.js --desde 20260809` sale
      con código 0 **después de T1307**, que es la que le da datos que mover.
      Antes de T1307 pasa sin haber ejecutado su rama de datos, y eso **no
      cuenta**.
      **El test**: `reversibilidadDeMigraciones.test.js` la levanta sola por
      estar en el directorio. Además, en
      `apps/api/src/tests/tiposEnumDelEsquema.test.js` o en un caso propio,
      `it('los ids de TiendaNube son BIGINT en el modelo y en la migración')`:
      lee los dos archivos como texto y compara. Es grosero y es lo que hace
      falta —el desajuste no lo ve ningún test de comportamiento y aparece el día
      del desbordamiento, como un 500 al insertar un mapeo sin ningún mensaje que
      diga qué pasó—.
      **Cómo se comprueba que el test sirve**: se deja `INTEGER` en la migración y
      `BIGINT` en el modelo, y el caso lo nombra.

- [ ] **T1305** [P] Crear
      `apps/api/src/migrations/20260811-tiendanube-catalogo-pedidos-y-corridas.js`
      con las tres tablas de `data-model.md` y sus seis índices:
      **`tiendanube_variantes`** con `uq_tn_variante (empresa_id,
      tiendanube_variant_id)` **único** —es lo que agrupa los empujones—,
      `idx_tn_variantes_cola (empresa_id, proximo_intento_en)` **parcial** `WHERE
      pendiente_desde IS NOT NULL`, e `idx_tn_variantes_producto`;
      **`tiendanube_pedidos`** con `uq_tn_pedido (empresa_id,
      tiendanube_order_id)` **único** —**es lo único que sostiene la
      idempotencia**— e `idx_tn_pedidos_pendientes` parcial `WHERE
      items_sin_descontar > 0`;
      **`tiendanube_corridas`** con `disparador VARCHAR(20)` **con `CHECK`, no
      `ENUM`** e `idx_tn_corridas_empresa (empresa_id, empezada_en DESC)`.
      **Por qué `VARCHAR` con `CHECK` y no `ENUM`**: el proyecto 0 de
      `PROXIMOS-PROYECTOS.md` dejó ocho columnas declaradas `ENUM` en el modelo y
      creadas `VARCHAR` por las migraciones, y ese desajuste sigue abierto.
      Agregar un `ENUM` nuevo es agregarle una novena columna a ese problema.
      El `down`: tres `DROP TABLE IF EXISTS` en orden inverso. **Reversible sin
      condiciones**, salvo una que va escrita en el propio `down`: perder
      `tiendanube_pedidos` significa que **un webhook viejo reintentado volvería a
      descontar**. Por eso esas filas no se borran nunca (riesgo 9).
      **Verificación**: `npm --prefix apps/api test -- reversibilidadDeMigraciones`
      pasa, y `node apps/api/scripts/verificar-reversibilidad.js --desde 20260809`
      compara las tres fotos sin diferencias.
      **El test**: la guardia de reversibilidad, más
      `it('los seis índices del modelo tienen el MISMO nombre que los de la
      migración')` en el mismo archivo que T1304, por el motivo escrito en
      `20260808`: Sequelize los nombraría `<tabla>_<col>_<col>` y un
      `sync({ alter: true })` en desarrollo crearía un **segundo** índice sobre
      las mismas columnas.
      **Cómo se comprueba que el test sirve**: se le saca el `name` a una entrada
      del modelo y el caso lo nombra.

- [ ] **T1306** Los cinco modelos —`models/TiendanubeTienda.js`,
      `TiendanubeEstadoOauth.js`, `TiendanubeVariante.js`, `TiendanubePedido.js`,
      `TiendanubeCorrida.js`— y su registro en `apps/api/src/models/index.js`. Y
      en `apps/api/src/models/TiendanubeMapping.js:8-9`, los dos ids pasan a
      `DataTypes.BIGINT`.
      **Los cinco van SIN una sola asociación declarada**, y es deliberado:
      declarar `Product.hasOne(TiendanubeVariante)` o
      `hasMany(TiendanubeMapping)` haría que `analizarIncludes`
      (`aislamientoEmpresas.test.js:490`) clasificara cualquier `include` de esas
      tablas como «hijo con `empresa_id`» y **subiría el ancla de `toBe(4)`**.
      Como ninguna consulta de este hito usa `include` —se traen filas planas y se
      unen en JS, igual que la decisión 4 del plan de la 012— la asociación no
      aporta nada.
      **Por qué se registran igual en `index.js`**: `verificar-esquema.js` hace un
      `findOne` **por modelo de `src/models`** (`:288`). Las cinco tablas entran a
      ese chequeo **solo si los modelos están registrados**. Es el único motivo, y
      alcanza.
      **Y los índices del modelo llevan `name` explícito idéntico al de la
      migración**, por lo mismo que T1305.
      **Verificación**: `npm --prefix apps/api run verificar:esquema` contra una
      base migrada pasa con las cinco tablas nuevas, y
      `npm --prefix apps/api test -- asociaciones aislamientoEmpresas` pasa con
      `analizarIncludes` **todavía en `toBe(4)`**.
      **El test**: en `apps/api/src/tests/asociaciones.test.js`,
      `it('los cinco modelos de TiendaNube están registrados en index.js')` —sin
      esto `verificar:esquema` no los mira y una columna que la migración se
      olvide pasa desapercibida— y `it('ninguno declara asociaciones: el ancla de
      includes no se mueve')`, que afirma sobre `Modelo.associations`.
      **Cómo se comprueba que el test sirve**: se saca uno del `index.js` y el
      primero lo nombra; se agrega `Product.hasOne(TiendanubeVariante)` y el
      segundo se pone en rojo **y además** `analizarIncludes` sube a 5, que es la
      consecuencia real.

- [ ] **T1307** ⚠ **Sin esta tarea, la única migración con datos de este hito
      pasa en verde sin ejecutar su rama.** En
      `apps/api/scripts/verificar-reversibilidad.js`, `sembrar()` (`:425-470`)
      hoy inserta en once tablas y **no inserta en `settings`, ni en
      `puntos_de_venta`, ni en `stock`, ni en `tiendanube_mappings`**. Verificado
      leyendo el SQL. Sobre esa semilla, el `down` de `20260810` no restaura
      ninguna fila, el script compara dos esquemas idénticos y sale con código 0.
      Es exactamente lo que el encabezado del propio script advierte: «sobre una
      base vacía casi todo `down` pasa».
      Lo que hay que sembrar, **y el motivo de cada cosa va escrito al lado, en el
      SQL**:
      **(1)** dos `puntos_de_venta` de la empresa 1: uno con `code = 'principal'`
      y otro **activo y de id menor**. Con una sola sucursal los tres escalones
      del `COALESCE` dan lo mismo y el orden no se prueba;
      **(2)** una **empresa sin ninguna sucursal**, con su fila de `settings`. Es
      la rama del `console.log` que deja la fila sin mudar, y sin ella esa rama no
      se ejecuta nunca;
      **(3)** dos filas de `settings` —`tiendanube_user_id` y
      `tiendanube_access_token`— **de empresas distintas**, para que el `up` mueva
      una y **no toque** la otra, y el `down` restaure una sola;
      **(4)** una fila de `tiendanube_mappings` con un `tiendanube_variant_id`
      grande pero dentro de `int4`, para que el `ALTER TYPE` de ida y de vuelta
      tenga una fila que convertir;
      **(5)** una fila de `stock` de la empresa 1 en la sucursal `principal`, para
      que la FK `ON DELETE RESTRICT` de `tiendanube_tiendas` tenga contra qué.
      **Verificación**: `node apps/api/scripts/verificar-reversibilidad.js --desde
      20260809` sale con **código 0** y su salida nombra `20260810` y `20260811`
      como probadas. **Y el chequeo que de verdad importa**: correrlo con la
      semilla **vieja** y con la **nueva** tiene que dar salidas distintas — con
      la vieja, el `down` de `20260810` restaura **cero** filas de `settings`.
      **El test**: en `apps/api/src/tests/reversibilidadDeMigraciones.test.js`,
      `it('la semilla toca las cuatro tablas que la migración de datos necesita')`
      —guardia estática sobre el SQL de `sembrar()`: tiene que contener `INSERT
      INTO settings`, `INSERT INTO puntos_de_venta`, `INSERT INTO stock` e
      `INSERT INTO tiendanube_mappings`—. Es grosera a propósito: el defecto no lo
      ve ningún test de comportamiento porque **el script sale en verde
      igual**.
      **Cómo se comprueba que el test sirve**: se saca el `INSERT INTO settings`
      de la semilla y el caso lo nombra; con el script, se saca el paso (2) del
      `down` de `20260810` —el que reinserta en `settings`— y el script pasa a
      reportar la diferencia **solo con la semilla nueva**.
      ⚠ **Y una precaución sobre lo que este script NO puede decir**: en
      producción esta migración de datos es un **no-op comprobable**. `getAuthUrl`
      nunca puso `state` en la URL y `handleCallback` rechaza el callback sin
      `state`, así que `getAccessToken` —el único que escribe esas dos filas
      (`tiendanubeService.js:22-31`)— **nunca se ejecutó**. No hay ni una fila que
      migrar. Eso no la hace inofensiva: la hace **fácil de dar por buena**, y si
      el `down` estuviera mal nadie se enteraría hasta el día que haya que
      revertir un deploy con datos reales. Riesgo 11 del plan.

**Checkpoint**: las cinco tablas existen, `verificar:esquema` las mira porque los
modelos están registrados, `verificar-reversibilidad.js` ejecuta la rama de datos
**y la compara**, y nadie lee ninguna de las cinco todavía. Aditivo puro: se
despliega solo.

---

## Phase 3: El OAuth que nunca se pudo completar

**Purpose**: se puede vincular una tienda de punta a punta y el token queda bajo
la empresa correcta; el `state` es de un solo uso **de verdad**; dos empresas no
pueden vincular la misma tienda y eso lo garantiza la base; y `GET /status`
contesta los cuatro estados en vez de un booleano.

Es US1 entera del lado del servidor, US4 escenario 4, y los criterios 1 y 7.
Verificable contra hoy, donde el circuito termina **siempre** en
`?tiendanube=error&motivo=sin_empresa`.

- [ ] **T1308** [P] Ampliar `apps/api/src/tests/integracion/fixtures.js` con lo
      que los dos archivos de integración de este hito necesitan. Hoy
      `sembrarDosEmpresas` ya siembra **dos sucursales en A** (`centro` y
      `norte`) y una en B, y eso alcanza para lo que sigue; lo que falta es:
      **(1)** una fila de `tiendanube_tiendas` por empresa, con
      `tiendanube_user_id` **distinto**, y la sucursal designada de A siendo
      **`norte`** —o sea, **NO la de menor id y NO la que devolvería
      `sucursalPorDefecto`**. Sin eso, «se descontó de la designada» y «se
      descontó de la por defecto» dan el mismo número y el test pasa con y sin el
      defecto;
      **(2)** tres mapeos en A y uno en B;
      **(3)** un producto de A **mapeado y sin fila de stock** en la sucursal
      designada — es FR-046 y US5 escenario 7;
      **(4)** un producto de A con **`available` distinto de `quantity`** — es la
      decisión 2, y sin él publicar uno u otro da el mismo número;
      **(5)** algunas filas de `tiendanube_variantes` de A, con **una que ya no
      esté en el catálogo** (`vista_en` anterior a `catalogo_refrescado_en`).
      **Cada cosa con su comentario de por qué**, como el resto del archivo: su
      encabezado explica caso por caso por qué cada dato es como es, y es la
      disciplina que evitó que la mitad de las afirmaciones pasaran con y sin el
      defecto.
      ⚠ **Es un archivo compartido con siete suites de integración.** Todo lo que
      se agrega es **aditivo** —filas de tablas nuevas más dos productos—, pero
      hay que correr la suite entera: cualquier test existente que cuente
      productos de A se mueve.
      **Verificación**: `npm --prefix apps/api run test:integracion` pasa entero,
      **incluidas las siete suites que ya existían**.
      **El test**: en el propio `fixtures.js`, la aserción que ya tiene el archivo
      para la empresa A se amplía: `it` no aplica —es una fixture—, pero la
      función **tira con un mensaje que lo dice** si la sucursal designada de A
      resultara ser la que `sucursalPorDefecto` elegiría. Sin esa guarda, el día
      que alguien renombre `centro` a `principal` la fixture deja de poder
      distinguir el defecto **y nada avisa**.

- [ ] **T1309** [P] `GET /api/tiendanube/auth` pasa a exigir **`config.editar`**
      en vez de `config.ver`. Una línea en `apps/api/src/routes/tiendanube.js`.
      **Por qué es su propio corte**: ese endpoint **escribe** —a partir de T1310
      inserta una fila de `tiendanube_estados_oauth`— y arranca el flujo que
      termina guardando un token. Un usuario de solo lectura no puede iniciar una
      vinculación. La spec no lo pide: pide la mitad de la pantalla (US1 escenario
      11, el botón deshabilitado), y ésta es la mitad del servidor.
      **Y va sola porque es un cambio de acceso**: es la misma disciplina de la
      fase 8 del plan de la 012 —una línea que puede dejar a alguien afuera,
      mezclada con setecientas de otra cosa, es una línea que nadie sabe cuál
      rompió—. Un revert.
      **Verificación**: `npm --prefix apps/api test -- permisosDeRutas` pasa y
      declara `config.editar` para esa ruta.
      **El test**: en `tiendanubeRutas.test.js`,
      `it('GET /auth exige config.editar: iniciar una vinculación es escribir')`.
      **Cómo se comprueba que el test sirve**: se vuelve a `config.ver` y el caso
      se pone en rojo.

- [ ] **T1310** `GET /api/tiendanube/auth` crea el `state`. En
      `apps/api/src/routes/tiendanube.js`, el handler:
      **(1)** conserva el **500 con su texto** si falta `TIENDANUBE_CLIENT_ID`
      (FR-006, cuarto estado);
      **(2)** responde **409** con `ErrorDeNegocio` si la empresa **ya tiene una
      tienda vinculada**: «Ya tenés una tienda vinculada. Desvinculala antes de
      conectar otra.» **Es nuevo y es deliberado**: hoy `Setting.upsert` pisa el
      token en silencio (`tiendanubeService.js:22-31`), que es el primer caso de
      borde de la spec;
      **(3)** inserta una fila de `tiendanube_estados_oauth` con **32 bytes de
      `crypto.randomBytes` en hexadecimal**, la empresa y el usuario de la sesión
      y `expira_en` a 15 minutos;
      **(4)** devuelve la URL **con `state=<token>`**.
      **Verificación**: `npm --prefix apps/api test -- tiendanubeRutas`.
      **El test**: `it('sin TIENDANUBE_CLIENT_ID responde 500 con su mensaje')`;
      `it('la URL de autorización lleva un state y ese state NO es el empresaId')`
      —el caso que cierra la opción (c) de [PENDIENTE 1]: un `state` en claro deja
      que cualquiera complete un OAuth con `state=1` y le cuelgue **su** tienda a
      la empresa 1, que en producción es un cliente real—;
      `it('dos llamadas seguidas producen dos states distintos')` —dos pestañas
      iniciando el OAuth a la vez es un caso de borde explícito de la spec—;
      `it('con una tienda ya vinculada responde 409 y no crea ningún state')`.
      **Cómo se comprueba que el test sirve**: se devuelve `state=${req.empresaId}`
      y el segundo se pone en rojo; se saca el chequeo de tienda vinculada y el
      cuarto.

- [ ] **T1311** ⚠ **Acá está la mitad que sostiene «de un solo uso».**
      `GET /api/tiendanube/callback`, en `apps/api/src/routes/tiendanube.js`:
      **(1)** el `state` se consume con un **`UPDATE … RETURNING`**, y no con un
      `findOne` seguido de un `update`:

      ```sql
      UPDATE tiendanube_estados_oauth
         SET consumido_en = NOW()
       WHERE token = $1 AND consumido_en IS NULL AND expira_en > NOW()
      RETURNING empresa_id, usuario_id;
      ```

      **Cero filas = no sirve**, sin distinguir si no existe, si venció o si ya se
      usó — igual que `findScoped` responde 404 sin distinguir «no existe» de «no
      es tuyo», y por el mismo motivo: distinguirlos le dice a quien prueba tokens
      cuál de las tres acertó. **En el log sí se distingue cuál de las tres fue**;
      **(2)** los seis caminos del contrato, con **motivos distinguibles**:
      `sin_codigo`, `state_invalido`, `tienda_ocupada`, `tiendanube`,
      `sin_sucursal` y `estado=ok`;
      **(3)** el destino pasa de `/settings` a **`/tiendanube`**;
      **(4)** al canjear el `code` se crea la fila de `tiendanube_tiendas` con
      `punto_de_venta_id` resuelto por `sucursalPorDefecto(empresaId)` —que nunca
      devuelve null y tira `ErrorDeNegocio` si la empresa no tiene ninguna
      sucursal, que es el motivo `sin_sucursal`—, y el **token sigue yendo a
      `settings.tiendanube_access_token`** (FR-077: no se agrega ningún lugar
      nuevo donde quede en claro);
      **(5)** el choque del `UNIQUE` de `tiendanube_user_id` se traduce a
      `tienda_ocupada`. **Es FR-036 llegando desde la base**, no desde una
      comprobación en el handler.
      **El token no aparece en la redirección de ninguna forma** —ni entero, ni
      truncado, ni en un fragmento— (FR-075).
      **Verificación**: `npm --prefix apps/api test -- tiendanubeRutas`, y **el
      caso que de verdad importa es de integración y es T1314**: un `findOne`
      seguido de un `update` pasa todos los tests secuenciales.
      **El test**: `it('el callback sin code y el callback con state desconocido
      redirigen con motivos DISTINTOS')` —FR-003, US1 escenarios 4 y 5: hoy el
      usuario ve «Error al vincular TiendaNube» y nada más
      (`Settings.jsx:69`)—; `it('un state vencido no guarda ningún token')`;
      `it('un state ya consumido no guarda ningún token')`;
      `it('el callback redirige a /tiendanube y no a /settings')`;
      `it('ninguna redirección contiene la cadena del token')`.
      **Cómo se comprueba que el test sirve**: se le saca la condición
      `consumido_en IS NULL` al `UPDATE` y el tercero se pone en rojo; se unifican
      los motivos en uno solo y el primero.

- [ ] **T1312** `GET /api/tiendanube/status` deja de devolver un booleano y pasa
      al contrato de `contracts/api-endpoints.md`: `estado` —uno de
      `sin_configurar`, `no_vinculada`, `vinculada`, `vinculada_con_error`—, el
      objeto `tienda` con su sucursal designada, sus tres fechas y
      `reconciliada_en`, y los dos conteos: `variantes` —total, mapeadas,
      pendientes, con error— y `pedidos_con_items_sin_descontar`.
      **Los conteos salen de `count` con `where` sobre índices, no de traer
      filas.** Es el hallazgo 7 del plan de la 012 con otro nombre.
      **Un fallo de este endpoint NO es «no vinculada»** (FR-006, US1 escenario
      10): es un 500 con `fallo()`, y la pantalla lo dibuja como «no pudimos
      comprobar el estado», que es un quinto estado **de la pantalla** y no del
      contrato. Hoy `Settings.jsx:78` hace `console.error` y la tarjeta dice «no
      vinculada» aunque lo esté.
      **`reconciliada_en` no es decorativo**: es la señal visible del riesgo 4 —el
      cron que hoy falla todos los días—, y la pantalla lo muestra en vez de dar
      por hecho que la red existe.
      **Verificación**: `npm --prefix apps/api test -- tiendanubeRutas`.
      **El test**: `it('sin TIENDANUBE_CLIENT_ID el estado es sin_configurar y NO
      no_vinculada')`; `it('sin fila de tienda el estado es no_vinculada y tienda
      es null')`; `it('con ultima_comunicacion_ok en false el estado es
      vinculada_con_error')`; `it('la respuesta NO contiene el token de ninguna
      forma, ni truncado')` —FR-075, US1 escenario 7—.
      **Cómo se comprueba que el test sirve**: se colapsan los cuatro estados a un
      booleano y los tres primeros se ponen en rojo; se agrega
      `token: token.slice(-4)` a la respuesta y el cuarto.

- [ ] **T1313** Las dos rutas que cierran US1: `PUT /api/tiendanube/sucursal` y
      `DELETE /api/tiendanube/vinculacion`, en
      `apps/api/src/routes/tiendanube.js`.
      **`PUT /sucursal`**: resuelve el punto de venta con `findScoped(PuntoDeVenta,
      …, req.empresaId)` —404 si es de otra empresa—, lo escribe en
      `tiendanube_tiendas`, **y encola todas las variantes mapeadas** para volver
      a empujar. Devuelve `{ ok, punto_de_venta, encoladas }`.
      ⚠ **`encoladas` no es informativo, es el contrato.** Cambiar la sucursal
      mueve **todos** los números publicados; si el `PUT` no encolara, la tienda
      seguiría publicando el stock de la sucursal vieja hasta el próximo
      movimiento de cada producto — el defecto de hoy con una demora encima. La
      pantalla usa ese número en el `ConfirmDialog`, **antes** de confirmar
      (T1340, riesgo 8).
      **`DELETE /vinculacion`**: borra la fila de `tiendanube_tiendas`, la fila de
      `settings` del token y la instantánea `tiendanube_variantes` —es una copia
      de un catálogo al que ya no tenemos acceso—. **Los mapeos NO se borran**
      ([PENDIENTE N9]) y la respuesta devuelve `mapeos_conservados` para que la
      pantalla lo pueda repetir en la confirmación.
      **Verificación**: `npm --prefix apps/api test -- tiendanubeRutas
      aislamientoEmpresas`.
      **El test**: `it('PUT /sucursal con un punto de venta de otra empresa
      responde 404 y no cambia nada')`; `it('PUT /sucursal devuelve cuántas
      variantes quedaron encoladas')`; `it('DELETE /vinculacion borra el token y
      NO borra los mapeos')`; `it('DELETE /vinculacion sin tienda vinculada
      responde 404')`.
      **Cómo se comprueba que el test sirve**: se cambia `findScoped` por
      `findByPk` y el primero se pone en rojo; se saca el encolado y el segundo
      devuelve cero; se agrega el borrado de mapeos y el tercero.

- [ ] **T1314** ⚠ **El primero de los dos archivos de integración, y la mitad que
      ningún test secuencial toca.** Crear
      `apps/api/src/tests/integracion/tiendanubeAislamiento.integracion.test.js`,
      con `baseDePruebas` **primero de todo** —antes que `supertest` y que
      cualquier modelo: `config/database.js` construye la conexión al importarse—,
      `beforeAll(conectarOFallar)`, `limpiarLaBase()` + `sembrarDosEmpresas()` en
      el `beforeEach` y `cerrar()` en el `afterAll`. En este corte cubre:
      `it('un state consumido dos veces resuelve UNA sola vez')` —dos callbacks
      con el mismo `state`, que es el usuario recargando la pestaña de vuelta: el
      `UPDATE … RETURNING` devuelve cero filas la segunda y el `code` **no se
      canjea dos veces**—;
      `it('dos entregas del mismo state EN PARALELO canjean una sola vez')` —es la
      lección del CAE y la de `POST /api/sales`: un `findOne` seguido de un
      `update` los pasa los dos—;
      `it('dos empresas no pueden vincular el mismo tiendanube_user_id')` —la
      segunda choca contra el **índice único**, no contra una comprobación del
      handler (FR-036, US4 escenario 4, criterio 7)—;
      `it('la empresa B no ve el estado de la tienda de la A')`.
      **Verificación**: `npm --prefix apps/api run test:integracion` pasa. **Si no
      hay Postgres, falla — no se saltea**: un test que se saltea en silencio es
      un test que deja de correr y nadie se entera.
      **Cómo se comprueba que el test sirve**: se reemplaza el `UPDATE …
      RETURNING` por `findOne` + `update` y **el segundo se pone en rojo mientras
      el primero sigue en verde** — ésa es exactamente la diferencia entre los dos
      casos y por eso están los dos; se saca el `UNIQUE` de `tiendanube_user_id`
      de la migración y el tercero.

**Checkpoint**: se vincula una tienda de punta a punta contra un doble de la API
de TiendaNube, el token queda bajo la empresa correcta, el `state` no se puede
reusar ni en paralelo, y dos empresas no pueden vincular la misma tienda. **Lo
que este checkpoint NO dice** es que el contrato real del tercero funcione: eso
es el paso manual **P1** y no lo verifica ningún test.

---

## Phase 4: El webhook vivo, atómico e idempotente

**Purpose**: un `order/paid` firmado descuenta stock **una sola vez y entero**, de
la sucursal designada; un pedido que falla a la mitad no queda marcado como
procesado; y un ítem que no descontó **se puede ver**.

**Es la fase más grande y la más importante del hito**, y necesita la 3: la
empresa y la sucursal de un pedido salen de la fila que crea el OAuth. Es US2
entera y los criterios 2, 3, 4 y 5. Verificable contra hoy, donde **todo webhook
responde 401 y no descuenta nada**.

- [ ] **T1315** ⚠ **Una línea de `server.js` que revive la integración entera, y
      su guardia.** En `apps/api/src/server.js`,
      `app.use('/api/tiendanube', require('./routes/tiendanube').publico)` sube de
      `:345` a **antes** de `app.use(express.json({ limit: '10mb' }))` (`:149`).
      **Por qué**: el router público ya trae su propio `express.json({ type,
      verify })` (`routes/tiendanube.js:37-39`), que **sí** se ejecuta cuando
      nadie parseó antes. Hoy body-parser ve el cuerpo ya parseado y sale sin
      ejecutar el `verify`, `req.rawBody` queda `undefined`, `firmaValida` corta
      en `!req.rawBody` (`controllers/tiendanube.js:73`) y **todo webhook responde
      401** — que además apaga la integración del otro lado, porque TiendaNube
      deshabilita el webhook ante errores repetidos, y el propio comentario del
      archivo lo dice (`:104-105`).
      **El mismo movimiento resuelve FR-029**: el rate limiter se monta en `:260`,
      o sea después, así que el webhook deja de contar contra los 600 requests por
      IP cada 15 minutos pensados para un navegador. Un 429 al webhook es un
      pedido que no descuenta, y las IP de TiendaNube no son las de nadie sentado
      en una caja.
      **El montaje del `privado` NO se mueve**: sigue detrás de `...authEmpresa`,
      y como el público solo declara `/callback` y `/webhook`, el resto cae al
      privado por orden de declaración.
      ⚠ **Y el comentario va en los DOS archivos**, porque es contraintuitivo:
      cualquier ruta que alguien agregue al router `publico` a partir de mañana
      **nace sin `express.json` y sin rate limit**, y si necesita cuerpo JSON no
      lo va a tener. Es el riesgo 5.
      **La guardia (FR-021)**, en `apps/api/src/tests/observabilidad.test.js`: lee
      `server.js` y afirma que
      `indexOf("require('./routes/tiendanube').publico")` es **menor** que
      `indexOf('app.use(express.json(')`. Con **sus dos muestras sintéticas**, con
      y sin el defecto: una guardia sin muestra es una guardia que nadie sabe si
      mira algo.
      **Verificación**: `npm --prefix apps/api test -- observabilidad server`
      pasa, y el caso de integración de T1319 —que es el que prueba que el cuerpo
      crudo **llega**, no que el orden esté escrito—.
      **El test**: la guardia de arriba, más
      `it('la guardia se pone en rojo con el montaje en el orden de hoy')` sobre
      la muestra sintética mala.
      **Cómo se comprueba que el test sirve**: se devuelve el montaje a su lugar
      de hoy y la guardia lo nombra; la muestra sintética buena sigue en verde.
      ⚠ **Por qué NO se le pone `verify` al `express.json()` global**: guardaría
      el `rawBody` de **todas** las peticiones, con un límite de 10 MB. Una
      importación de catálogo pasaría a ocupar el doble de memoria por request y
      el buffer quedaría colgado del `req` hasta que el handler termine. Es pagar
      en todos lados por un endpoint. Las otras dos alternativas y su motivo están
      en la decisión 5 del plan.

- [ ] **T1316** Dos cosas del webhook que no son el descuento, en
      `apps/api/src/routes/tiendanube.js`:
      **(a)** `empresaDeLaTienda` deja de ser
      `Setting.findAll({ where: { key: 'tiendanube_user_id' } })` **sobre todas
      las empresas** quedándose con el primer match (`controllers/tiendanube.js:92-101`)
      y pasa a `TiendanubeTienda.findOne({ where: { tiendanube_user_id } })`
      **sobre la columna con índice único**. La respuesta es **una sola empresa o
      ninguna**, siempre, y no la primera fila que devuelva Postgres en un orden
      que nadie definió (FR-037, US4 escenario 5);
      **(b)** el rechazo por firma pasa a loguear **cuál de las tres cosas
      faltó** —el secreto del servidor, la cabecera, o el cuerpo crudo—.
      **Por qué (b) no es cosmético**: `firmaValida` devuelve `false` si falta
      `TIENDANUBE_CLIENT_SECRET` (`:73`), así que hoy **un despliegue mal
      configurado y un intento de suplantación producen exactamente el mismo 401 y
      el mismo `logger.warn`**. Es el riesgo 10 y es un caso de borde explícito de
      la spec.
      Y al arrancar, si hay filas en `tiendanube_tiendas` y no hay secreto,
      `server.js` deja un `logger.error` que lo dice con todas las letras.
      **No se corta el arranque**: una empresa sin TiendaNube no tiene por qué
      quedarse sin API por una variable de una integración opcional.
      **`firmaValida` no se toca** (supuesto 7): HMAC-SHA256 sobre el cuerpo
      crudo, `timingSafeEqual` y chequeo de longitud previo. Está bien escrita.
      **Verificación**: `npm --prefix apps/api test -- tiendanubeRutas`.
      **El test**: `it('el webhook con firma inválida responde 401 y loguea el
      evento y el origen')` —FR-022—;
      `it('sin TIENDANUBE_CLIENT_SECRET el log dice que falta el secreto, no que
      la firma no valida')`;
      `it('un evento que no es order/paid responde 200 sin procesar')` —FR-024,
      US2 escenario 11—;
      `it('un pedido de una tienda no vinculada responde 200 y loguea')` —US2
      escenario 9: 200 para que TiendaNube no reintente—.
      **Cómo se comprueba que el test sirve**: se unifican los tres motivos del
      rechazo en un solo `logger.warn` y el segundo se pone en rojo; se responde
      500 en el camino de tienda no vinculada y el cuarto.

- [ ] **T1317** ⚠ **La idempotencia, y va en `tiendanube_pedidos` — NO en un
      índice único sobre `stock_movements`** (punto 5 de «Antes de empezar»). En
      `apps/api/src/services/tiendanubeService.js`, `processOrderCreated`
      (`:102-173`) se reescribe **en el mismo archivo** (decisión 15: el ancla de
      `descuentoDeStock.test.js:227` no se mueve):

      ```js
      const t = await sequelize.transaction();
      // 1. El INSERT va PRIMERO. Si choca, este pedido ya se procesó y no se
      //    toca nada. Es la misma forma que POST /api/sales, y es la mitad que
      //    un test secuencial no toca nunca.
      const pedido = await TiendanubePedido.create({ empresa_id, tiendanube_order_id, … }, { transaction: t });
      // 2. La sucursal DESIGNADA, no la por defecto.
      const sucursal = await resolverSucursal({ empresaId, puntoDeVentaId: tienda.punto_de_venta_id });
      // 3. Por ítem: Stock.findOne con lock, update de quantity Y available, StockMovement.
      // 4. commit
      ```

      y el `catch` de `SequelizeUniqueConstraintError` responde «ya procesado» sin
      descontar.
      **(a) FR-025, atómico de verdad**: la transacción envuelve el `INSERT` del
      pedido, los `UPDATE` de stock y los `StockMovement.create`. Si el tercer
      ítem falla, **no queda ni la fila del pedido** y el reintento de TiendaNube
      vuelve a entrar por el camino normal. Hoy quedan dos ítems descontados para
      siempre y el reintento contesta «pedido ya procesado» (`:110`).
      **(b) FR-027, lo que no descontó**: cada ítem que no se pudo descontar queda
      en `pedido.items` (JSONB) con su motivo —`sin_mapeo`,
      `sin_stock_en_sucursal`, `sin_variante`, `cantidad_cero`— y suma a
      `items_sin_descontar`. Hoy son tres `continue`
      (`tiendanubeService.js:129`, `:134`, `:144`) y lo único que queda es que el
      inventario está mal. Es el modo de falla que `descuentoDeStock.test.js`
      existe para evitar, y su encabezado lo dice: «lo grave no es que falle: es
      que **no falla**».
      **(c) La sucursal**: `resolverSucursal({ empresaId, puntoDeVentaId:
      tienda.punto_de_venta_id })`, y **no** `puntoDeVentaId: null`, que caía al
      escalón por defecto. `resolverSucursal` sigue siendo la única función que
      contesta la pregunta, así que `descuentoDeStock.test.js:248` sigue en verde.
      **(d)** El descuento sigue bajando `quantity` **y** `available` (FR-028), y
      `usuario_id: 'tiendanube'` sigue siendo el literal de hoy: está anotado en
      `ProductCostHistory.js:33` y **no se arregla acá**.
      ⚠⚠ **El `Stock.findOne` lleva `lock: t.LOCK.UPDATE` y NO lleva `include`, y
      no se le agrega ninguno.** Si alguna vez hiciera falta, la forma es
      **`lock: { level: t.LOCK.UPDATE, of: Stock }`**: con `lock` a secas
      Sequelize lo traduce a un `LEFT OUTER JOIN` y Postgres responde `0A000: FOR
      UPDATE cannot be applied to the nullable side of an outer join`. Es el 500
      —**en toda** recepción, no solo en las simultáneas— que produciría la
      «mitigación de una línea» anotada para el defecto de concurrencia del hito 6
      (`PROXIMOS-PROYECTOS.md` 10d). Va escrito en el código, al lado del `lock`.
      **Verificación**: `npm --prefix apps/api test -- descuentoDeStock` sigue en
      verde con `bloques.length === 1`, y **lo que de verdad verifica esta tarea
      es T1319**: los dobles de `modelosFalsos.js` no entienden transacciones,
      `lock` ni restricciones únicas, y lo dicen en su encabezado.
      **El test**: acá van los que un doble sí puede contestar, en
      `tiendanubeRutas.test.js`: `it('un ítem sin variant_id queda anotado con
      motivo sin_variante y no se saltea en silencio')` y `it('un ítem de cantidad
      cero queda anotado con motivo cantidad_cero')`. **Los cinco que importan son
      de integración.**
      **Cómo se comprueba que el test sirve**: se vuelven los `continue` y los dos
      se ponen en rojo con `items` vacío.

- [ ] **T1318** `GET /api/tiendanube/pedidos`, en
      `apps/api/src/routes/tiendanube.js`, con `solo_con_problemas`, `page` y
      `limit`. Devuelve el pedido con sus `items_descontados`,
      `items_sin_descontar` y el JSONB de `items` con los cuatro motivos.
      `solo_con_problemas=true` usa el índice parcial
      `idx_tn_pedidos_pendientes`: es la única lectura frecuente de esa tabla.
      **Es el criterio 5 del lado del servidor**: «un ítem que no descontó se
      puede ver desde la pantalla». Hoy no hay dónde leerlo.
      **Verificación**: `npm --prefix apps/api test -- tiendanubeRutas`.
      **El test**: `it('solo_con_problemas devuelve únicamente los pedidos con
      items_sin_descontar > 0')`; `it('la empresa B no ve los pedidos de la A')`;
      `it('el listado NO devuelve el token ni ningún dato de la vinculación')`.
      **Cómo se comprueba que el test sirve**: se saca el filtro y el primero se
      pone en rojo con los pedidos completos adentro; se saca el `empresa_id` del
      `where` y el segundo.

- [ ] **T1319** ⚠ **El archivo que contesta lo que ningún otro nivel puede.**
      Crear `apps/api/src/tests/integracion/tiendanubeWebhook.integracion.test.js`,
      con el arnés armado como T1314 y la API de TiendaNube **doblada** (supuesto
      11: no hay entorno de pruebas del tercero). Los seis casos:
      `it('un order/paid FIRMADO entra por la app real y descuenta: req.rawBody
      llegó')` —FR-020, criterio 2. **Es la prueba de que el movimiento de T1315
      funciona**, y es verificable contra hoy, donde responde 401—;
      `it('el mismo pedido entregado SEIS VECES EN PARALELO descuenta UNA vez')`
      —FR-026, criterio 3. Y afirma **por qué**: espiando el `logger.info` que
      deja la rama del `SequelizeUniqueConstraintError`, como hace
      `idempotenciaDeVentas.integracion.test.js:140`. Sin esa aserción, el caso
      pasaría también si las seis se hubieran serializado por casualidad—;
      `it('el mismo pedido dos veces SEGUIDAS tampoco descuenta dos veces')`
      —US2 escenario 4—;
      `it('un pedido de cinco ítems donde el tercero falla NO deja ninguna fila de
      tiendanube_pedidos, y el stock de los dos primeros queda como estaba')`
      —FR-025, criterio 4—;
      `it('un ítem sin mapeo y un ítem mapeado sin fila de stock quedan escritos
      en pedido.items con su motivo')` —FR-027, criterio 5—;
      `it('el descuento baja quantity Y available, y sale de la sucursal
      DESIGNADA')` —FR-028 y la decisión 4. La fixture tiene la designada **no**
      siendo la de menor id (T1308): sin eso este caso pasa con y sin el
      defecto—.
      **Verificación**: `npm --prefix apps/api run test:integracion`.
      **Cómo se comprueba que el test sirve**: se devuelve el montaje del router
      a su lugar de hoy y **el primero se pone en rojo con 401** —el resto también,
      y eso está bien: sin cuerpo crudo no hay webhook—; se cambia el `INSERT`
      primero por un `findOne` previo y **el segundo se pone en rojo descontando
      seis veces mientras el tercero sigue en verde**, que es exactamente la mitad
      que un test secuencial no toca; se saca la transacción y el cuarto; se
      vuelven los tres `continue` y el quinto; se pasa `puntoDeVentaId: null` y el
      sexto.

**Checkpoint**: contra Postgres, un `order/paid` firmado descuenta de la sucursal
designada; seis entregas en paralelo descuentan una vez y lo garantiza el índice
único; un pedido que falla a la mitad no deja rastro; y lo que no descontó se
puede leer por API. **Lo que este checkpoint NO dice**: que TiendaNube firme con
el algoritmo y la cabecera que este código espera. Eso es **P2**.

---

## Phase 5: El catálogo, la instantánea y el mapeo

**Purpose**: el catálogo de la tienda entra entero —todas las páginas— a una
instantánea local; se puede buscar, filtrar y paginar sobre ella; los mapeos se
listan y se borran; y ninguna llamada saliente queda sin `timeout`.

US3 del lado del servidor, criterios 8 y 9. Es donde vive el ajuste 2 del plan:
**FR-057, FR-058 y FR-059 no pueden convivir con un pasamanos de la API**.

- [ ] **T1320** [P] Crear `apps/api/src/utils/tiendanubeCatalogo.js` con dos
      funciones **puras**: `normalizarCatalogo(paginas)` → filas de variante
      —producto, variante, SKU, stock— y `sugerirPorSku(variantes, productos)` →
      la sugerencia con **cuántos coincidieron**.
      **`sugerirPorSku` devuelve cuántos, no cuál** ([PENDIENTE N3]): dos
      productos del sistema con el mismo SKU no son imposibles en este catálogo, y
      mapear solo por SKU es exactamente cómo se mapea el producto equivocado sin
      que nadie lo mire. La pantalla dice «hay dos» y **hay que confirmar**.
      ⚠ **El test va en `apps/api/src/tests/`, NUNCA en `utils/*.test.js`**: el
      `testMatch` de `jest.config.js` solo levanta `src/tests/**` y `__tests__/**`,
      así que un `src/utils/algo.test.js` **jest no lo corre nunca** —no falla, no
      avisa, simplemente no existe para la suite—. Lo protege
      `todosLosTestsCorren.test.js`.
      **Verificación**: `npm --prefix apps/api test -- tiendanubeCatalogo`.
      **El test**: `apps/api/src/tests/tiendanubeCatalogo.test.js`, con la fixture
      que la spec exige y que es la mitad del valor de esta tarea: **dos
      páginas**, un producto con **tres variantes**, una variante con **SKU
      vacío**, un producto **sin variantes**, y una respuesta con `variants:
      null`. Los casos:
      `it('trae las variantes de las DOS páginas')` —una fixture de una sola
      página es la trampa que `CONVENCIONES.md` nombra y acá está del lado del
      código—;
      `it('un producto con tres variantes produce TRES filas, no una')` —FR-052:
      la variante es la unidad que tiene stock—;
      `it('una variante con SKU vacío no rompe y no sugiere nada')`;
      `it('SKU repetido en DOS productos del sistema no sugiere: dice que hay
      dos')`;
      `it('el SKU se compara sin distinguir capitalización ni espacios')`;
      `it('variants null no tira')`.
      **Cómo se comprueba que el test sirve**: se devuelve solo la primera página
      y el primero se pone en rojo; se agrupa por producto en vez de por variante
      y el segundo; se hace que la coincidencia múltiple devuelva el primero y el
      cuarto se pone en rojo **mapeando el producto equivocado**, que es el daño
      concreto.

- [ ] **T1321** [P] Crear `apps/api/src/utils/tiendanubeCola.js` con tres
      funciones **puras**: `proximoIntento(intentos, retryAfter)` —el backoff
      `NOW() + min(2^intentos, 60)` minutos, respetando `Retry-After` si viene—,
      `clasificarError(err)` —`ECONNABORTED`, 401, 429, 5xx, y «cualquier otra
      cosa»— y `hayQueEmpujar(fila, disponible)`.
      **A los 8 intentos la fila deja de reintentarse sola**: `ultimo_error` queda
      escrito, la pantalla la muestra en rojo, y solo la mueve una corrida manual
      o la reconciliación. Una fila que reintenta para siempre contra un token
      revocado es un ataque a la cuota de la tienda.
      **Verificación**: `npm --prefix apps/api test -- tiendanubeCola`.
      **El test**: `apps/api/src/tests/tiendanubeCola.test.js`:
      `it('el backoff del intento 0, del 3 y del 8')`;
      `it('respeta Retry-After en segundos')`; `it('respeta Retry-After como
      fecha HTTP')`; `it('sin cabecera cae al backoff calculado')`;
      `it('a los 8 intentos deja de reintentar sola')`;
      `it('clasifica ECONNABORTED, 401, 429, 500, 400 y un error sin response')`
      —los seis, y el último es el que más se olvida: un error de red sin
      `response` no puede terminar leyendo `err.response.status`—;
      `it('hayQueEmpujar es false cuando NO hay fila de stock: no se publica cero
      por omisión')` —FR-046, US5 escenario 7. **Publicar cero agota una variante
      que sí tiene mercadería**—;
      `it('hayQueEmpujar es false cuando el disponible es igual al publicado')`
      —es lo que hace barata la reconciliación—.
      **Cómo se comprueba que el test sirve**: se saca el tope de 60 minutos y el
      primero se pone en rojo con una espera de días; se hace que la falta de fila
      de stock publique `0` y el séptimo; se lee `err.response.status` sin
      guardia y el sexto tira.

- [ ] **T1322** En `apps/api/src/services/tiendanubeService.js`, tres cosas que
      van juntas porque las tres son «hablar con TiendaNube»:
      **(a) `timeout: 15000` en las tres llamadas `axios`** (`:13`, `:60`, `:77`),
      con el precedente escrito y comentado en `afipService.js:86-89`. **Hoy no
      hay ninguno**: una llamada colgada deja el request de la aplicación
      esperando para siempre y ocupa una conexión del pool;
      **(b) `errorDeTiendanube(err)`**, que clasifica con `clasificarError` de
      T1321 y devuelve un `ErrorDeNegocio` con el texto que corresponde —la tabla
      de la decisión 11 del plan—, de forma que **un fallo de TiendaNube y un
      fallo de AdminApp no se vean iguales** (FR-062);
      **(c) `getProducts` recorre todas las páginas** —`?page=N&per_page=200`
      hasta que una vuelva vacía o corta— con reintento ante 429 (FR-048).
      **Y la guardia (FR-047)**, en `apps/api/src/tests/observabilidad.test.js`:
      ninguna llamada de `axios` de `services/tiendanubeService.js` ni de
      `services/tiendanubeSincronizacion.js` queda sin `timeout`.
      **Verificación**: `npm --prefix apps/api test -- observabilidad
      tiendanubeRutas` pasa, y el criterio 13.
      **El test**: la guardia de arriba con **su muestra sintética sin `timeout`**,
      más en `tiendanubeRutas.test.js`:
      `it('un 401 de TiendaNube se traduce a «hay que volver a vincular» y no a un
      fallo genérico')` —FR-049, US6 escenario 3—;
      `it('un 5xx se distingue de un error de AdminApp en el texto')`;
      `it('un timeout se distingue de los dos')`;
      `it('getProducts pide todas las páginas hasta que una vuelve corta')`.
      **Cómo se comprueba que el test sirve**: se saca el `timeout` de una de las
      tres llamadas y la guardia la nombra con archivo y línea; se colapsan los
      tres textos en «No se pudo sincronizar el stock con TiendaNube» —que es el
      de hoy— y los tres primeros se ponen en rojo.

- [ ] **T1323** `POST /api/tiendanube/variantes/refrescar` y
      `GET /api/tiendanube/variantes`, con el refresco en
      `apps/api/src/services/tiendanubeSincronizacion.js` (archivo nuevo).
      **El refresco** recorre todas las páginas, escribe cada variante con
      `upsert` sobre `(empresa_id, tiendanube_variant_id)` y `vista_en = NOW()`, y
      actualiza `tienda.catalogo_refrescado_en`. **Las que no se vieron no se
      borran**: quedan con `vista_en` viejo y salen con `en_la_tienda: false`.
      Borrarlas se llevaría el registro de lo que se publicó y dejaría al mapeo
      apuntando a la nada sin explicación.
      **`GET /variantes`** lee **la instantánea**, con `q` —nombre o SKU, sin
      distinguir mayúsculas ni acentos—, `sin_mapear`, `page` 1-indexado y `limit`
      1-200 **recortado, no rechazado**. Devuelve `total`, `refrescado_en` y las
      filas del contrato.
      ⚠ **`refrescado_en` va en la respuesta, no solo en `/status`**: una
      instantánea sin fecha a la vista es una mentira con horario.
      ⚠ **Ninguna consulta usa `include`**: se traen las variantes de la página,
      después los mapeos de esas variantes, después los productos de esos mapeos,
      y se unen en JS. Es el mismo corte que la decisión 4 del plan de la 012, y
      es lo que deja el ancla de `analizarIncludes` en `toBe(4)`. **No agregar
      `Product.hasOne(TiendanubeMapping)`.**
      ⚠ **Orden de declaración**: `POST /variantes/refrescar` va **antes** de
      cualquier `/variantes/:algo` que se agregue algún día. Es la trampa
      documentada en `routes/sales.js:226-230`.
      **Verificación**: `npm --prefix apps/api test -- tiendanubeRutas
      aislamientoEmpresas` pasa con `analizarIncludes` en `toBe(4)`.
      **El test**: `it('el refresco de una tienda de tres páginas deja las
      variantes de las TRES')` —criterio 9, verificable contra hoy, donde
      `GET /products` trae la primera y **nada avisa**—;
      `it('una variante que ya no está en el catálogo queda con en_la_tienda
      false y NO se borra')`;
      `it('sin_mapear=true no devuelve las mapeadas')`;
      `it('q busca por nombre y por SKU sin distinguir acentos')`;
      `it('limit=999999 se recorta a 200 y no rechaza')`;
      `it('sin tienda vinculada responde 409')`.
      **Cómo se comprueba que el test sirve**: se pide una sola página y el
      primero se pone en rojo; se borran las no vistas y el segundo; se filtra
      sobre la página que llegó en vez de sobre la instantánea y el tercero se
      pone en rojo con las de las otras páginas afuera —que es el defecto que
      FR-057 viene a cerrar, con otro nombre—.

- [ ] **T1324** `GET /api/tiendanube/mapeos` y `DELETE
      /api/tiendanube/mapeos/:id`, y el renombre de la ruta de creación a
      `POST /api/tiendanube/mapeos`. Las tres rutas viejas —`/products`,
      `/mapping`, `/sync-stock`— se borran.
      **Borrarlas no rompe la web**: `services/api.js` no tiene un solo helper de
      TiendaNube y `Settings.jsx` solo llama a `/status` y a `/auth`. Verificado
      con `grep` (punto 4 de «Antes de empezar»).
      `GET /mapeos` acotado a `empresa_id` **siempre**, con `scoped()`.
      `DELETE /mapeos/:id` se resuelve con
      `findScoped(TiendanubeMapping, req.params.id, req.empresaId)` → **404** si
      es de otra empresa, y la variante **sale de la cola**.
      **Verificación**: `npm --prefix apps/api test -- tiendanubeRutas
      permisosDeRutas` pasa, y `permisosDeRutas` sigue con sus diecinueve archivos
      —se agregan rutas al que ya está, no un archivo nuevo— y **cada ruta nueva
      declara su permiso** (FR-067).
      **El test**: `it('DELETE de un mapeo de otra empresa responde 404')`;
      `it('el listado de la empresa B no trae ninguno de la A')`;
      `it('borrar un mapeo saca la variante de la cola')`;
      `it('las tres rutas viejas ya no existen')`.
      **Cómo se comprueba que el test sirve**: se cambia `findScoped` por
      `findByPk` y el primero se pone en rojo; se saca el `empresa_id` del `where`
      y el segundo.
      ⚠ **Que la fila de la empresa A siga ahí después del intento lo contesta
      T1325, no éste**: una guardia estática y un doble ven que se llamó a
      `findScoped`; que la fila ajena haya quedado como estaba lo contesta el
      cuarto nivel.

- [ ] **T1325** Ampliar
      `apps/api/src/tests/integracion/tiendanubeAislamiento.integracion.test.js`
      (creado en T1314) con el aislamiento del mapeo **ejecutado**:
      `it('la empresa B no lista, no crea y no borra mapeos de la A, y la fila de
      A SIGUE AHÍ después del intento')` —FR-033, FR-034, FR-038, US4 escenarios 2
      y 3—;
      `it('borrar un producto borra su mapeo por ON DELETE CASCADE y la variante
      vuelve a «sin mapear»')` —US3 escenario 11: la pantalla **no puede mostrar
      una fila rota**, y la razón es la FK, no una limpieza del código—;
      `it('el segundo mapeo del mismo producto choca contra uq_tn_mapping_product
      y llega como 409, no como 500')`;
      `it('el segundo mapeo de la misma variante choca contra
      uq_tn_mapping_variant')`.
      **Verificación**: `npm --prefix apps/api run test:integracion`.
      **Cómo se comprueba que el test sirve**: se saca el `findScoped` del
      `DELETE` y el primero se pone en rojo **con la fila de A borrada**, que es el
      daño concreto; se cambia la FK a `ON DELETE SET NULL` en la migración y el
      segundo.

**Checkpoint**: una tienda de más de una página muestra **todos** sus productos;
se listan, crean y borran mapeos; un mapeo repetido se explica nombrando con qué
choca; y ninguna llamada saliente queda sin `timeout`. Criterios 8, 9 y 13.

---

## Phase 6: La sincronización explícita y el registro de la corrida

**Purpose**: cada variante mapeada recibe **exactamente un** PUT por corrida con
el `available` de la sucursal designada; una que falla no corta las demás; y el
resultado **sobrevive un reinicio del servidor**.

US5 escenarios 1 a 10 y los criterios 10, 11 y 12. Va **antes** de la cola a
propósito: la corrida explícita es el mismo motor y hay que poder culparla sola
si falla.

- [ ] **T1326** En `apps/api/src/services/tiendanubeSincronizacion.js`, la
      función `sincronizar(empresaId, { disparador, usuarioId })`:
      **(1) el arriendo** (FR-044), con un `UPDATE` condicional sobre
      `tiendanube_tiendas.sincronizando_desde` y una ventana de **10 minutos**.
      Cero filas = hay una corriendo. **Por qué un arriendo y no una bandera en
      memoria**: una bandera no sobrevive un reinicio, y una fila sin vencimiento
      quedaría puesta para siempre después de una corrida que se cortó por la
      mitad (US5 escenario 6). Los diez minutos son lo que hace que una caída no
      bloquee la sincronización hasta que alguien entre a la base;
      **(2)** una fila de `tiendanube_corridas` con su `disparador` y su
      `usuario_id`;
      **(3) exactamente un PUT por mapeo** (FR-040), con
      `stock.available` de la **sucursal designada**. Hoy `syncStock`
      (`controllers/tiendanube.js:183-192`) recorre **todas** las filas de `Stock`
      de la empresa y manda un PUT por cada una: con tres sucursales son tres PUT
      a la misma variante con tres números distintos y **gana el último**, en el
      orden que devuelva la consulta. Comprafit tiene tres sucursales;
      **(4)** sin fila de stock → **no se manda**, se anota
      `motivo_no_publicado` (FR-046);
      **(5)** el PUT que falla → se anota en `fallas` y **se sigue** (FR-041). Hoy
      el `catch` responde 502 (`:197`) y el `synced` que se venía contando **se
      pierde**: el usuario no sabe cuántas entraron ni cuáles faltan;
      **(6)** 429 → se espera y se reintenta con `proximoIntento`, sin perder el
      resto; 401 → se corta y la tienda queda en `vinculada_con_error`;
      **(7)** al terminar: `terminada_en`, `mandadas`, `fallidas`, `fallas`, y se
      suelta el arriendo.
      **Un producto mapeado inactivo se publica igual** ([PENDIENTE N10]) y se
      marca: publicar cero por estar inactivo agota una variante que la tienda
      podría estar vendiendo.
      **Verificación**: `npm --prefix apps/api test -- tiendanubeRutas
      descuentoDeStock` pasa —y `descuentoDeStock` sigue con `bloques.length === 1`
      sobre `tiendanubeService.js`: **este archivo también lee `Stock` y por eso
      está separado**, decisión 15 del plan—.
      **El test**: `it('cada variante mapeada recibe EXACTAMENTE UN PUT, con dos
      sucursales sembradas')` —criterio 10, verificable contra hoy—;
      `it('manda available y NO quantity')` —decisión 2; el producto de la fixture
      con `available ≠ quantity` es lo que lo hace distinguible—;
      `it('una variante que falla NO corta la corrida y el resultado dice cuál
      entró')` —criterio 11—;
      `it('un producto sin fila de stock en la sucursal designada NO se publica
      como cero')`;
      `it('sin ningún mapeo no manda ninguna llamada y lo dice')` —US5 escenario
      9—.
      **Cómo se comprueba que el test sirve**: se vuelve a recorrer `Stock` en vez
      de los mapeos y el primero se pone en rojo con dos PUT por variante; se manda
      `quantity` y el segundo; se pone un `throw` en el primer fallo y el tercero;
      se publica `0` cuando no hay fila y el cuarto.

- [ ] **T1327** `POST /api/tiendanube/sincronizar` y
      `GET /api/tiendanube/corridas/ultima`, en
      `apps/api/src/routes/tiendanube.js`.
      **El 200 con fallas es el contrato, no un descuido**: `{ ok, corrida_id,
      mandadas, fallidas }`. El 409 es «hay una corriendo» o «no hay tienda
      vinculada»; el 400 es «no hay ningún mapeo» o el 401 de TiendaNube.
      `GET /corridas/ultima` devuelve la corrida —con `fallas` **solo de las que
      fallaron** ([PENDIENTE N2]: con un catálogo grande las que salieron bien son
      cientos de filas que nadie lee)— **y** el bloque `cola` con `pendientes`,
      `con_error` y `mas_vieja`.
      ⚠ **`cola` es la otra mitad y es la que contesta el disparador de la
      decisión 4** (ajuste 4 del plan): el empujón por movimiento **no escribe
      corridas** —serían cientos de filas diarias que crecen sin tope— y su estado
      vive en la fila de la variante. `cola` lo resume, y es **más útil** que un
      registro de lotes: dice qué está desfasado **ahora**.
      `corrida: null` si nunca corrió ninguna, y la pantalla lo distingue de
      «corrió y no mandó nada».
      **Verificación**: `npm --prefix apps/api test -- tiendanubeRutas`.
      **El test**: `it('la última corrida sigue estando después de reiniciar: es
      una fila, no memoria')` —criterio 12, FR-043; se afirma releyendo por API
      con el módulo del servicio recargado—;
      `it('corrida null se distingue de una corrida que mandó cero')`;
      `it('fallas trae solo las que fallaron')`;
      `it('cola dice cuántas están pendientes y cuál es la más vieja')`.
      **Cómo se comprueba que el test sirve**: se guarda el resultado en una
      variable de módulo y el primero se pone en rojo; se devuelve `{}` en vez de
      `null` y el segundo.

- [ ] **T1328** Ampliar
      `apps/api/src/tests/integracion/tiendanubeAislamiento.integracion.test.js`
      con el arriendo:
      `it('dos POST /sincronizar EN PARALELO: uno arranca y el otro recibe «hay
      una corriendo»')` —FR-044, US5 escenario 5. **Es el único nivel que puede
      contestarlo**: dos requests a la vez no se pueden simular con un doble,
      porque no hay dos transacciones que puedan chocar—;
      `it('un arriendo de hace once minutos se puede volver a tomar')` —la corrida
      que se cortó por la mitad no bloquea para siempre. Se escribe
      `sincronizando_desde` once minutos en el pasado: el reloj de Postgres no lo
      mueven los timers de jest, y eso hay que saberlo antes de intentarlo—.
      **Verificación**: `npm --prefix apps/api run test:integracion`.
      **Cómo se comprueba que el test sirve**: se reemplaza el `UPDATE`
      condicional por un `findOne` + `update` y el primero se pone en rojo con dos
      corridas; se saca la ventana de 10 minutos y el segundo se pone en rojo
      bloqueado para siempre.

**Checkpoint**: se aprieta «Sincronizar» y cada variante recibe un PUT con el
`available` de la sucursal designada; una que falla no se lleva el conteo; el
resultado sobrevive un reinicio; y dos corridas no se pisan. Criterios 10, 11 y
12.

---

## Phase 7: La red de la decisión 4 — cola, agrupado y reconciliación

**Purpose**: cada movimiento de stock deja la variante pendiente; cien
movimientos del mismo producto producen **un** PUT; un empujón que falla se
reintenta con espera creciente; y una vez por día algo compara y corrige lo que
quedó desfasado.

**Las cuatro tareas afirman cosas distintas y se verifican de a una.** «La cola
reintenta» y «el agrupado no manda cien llamadas» no son lo mismo, y una tarea
que las junte no puede decir cuál de las dos se rompió.

- [ ] **T1329** **(a) El encolado.** En `apps/api/src/models/Stock.js`, los hooks
      `afterCreate` y `afterUpdate`, dentro de la transacción del que escribió
      (`options.transaction`), marcando la variante mapeada de ese producto como
      pendiente con el `UPDATE` de la decisión 8a del plan.
      **Por qué un hook y no una llamada en cada uno de los ocho lugares que
      escriben stock**: el encabezado de `utils/sucursalDeStock.js` ya dejó escrito
      qué pasa cuando una regla vive en ocho lugares —«hoy hay diez lugares que
      escriben en `stock` y cada uno decide la sucursal a su manera»— y el
      resultado fueron filas sin sucursal. **El noveno escritor de stock no se va
      a acordar de encolar**, y el síntoma sería una variante desfasada en
      silencio, que es justamente lo que la decisión 4 vino a evitar. Los ocho
      escritores usan `instancia.update()` o `Modelo.create()`; ninguno usa
      `Stock.update()` de clase, así que los dos hooks los alcanzan a todos.
      ⚠ **El hook no puede tumbar una venta.** Va en `try/catch` con
      `logger.error` y **no revierte la transacción del que llamó**. Una tabla de
      cola con un problema no tiene por qué impedir cobrar. Lo que hace aceptable
      ese `catch` —y sin lo cual sería un `sendEmail` devolviendo `ok: true`— es
      la reconciliación de T1332: **la red es lo que permite que el encolado sea
      best-effort**. Va escrito al lado del `catch`.
      **Verificación**: `npm run test:api` pasa entero. ⚠ **Correr la suite
      entera y no solo un archivo**: este hook corre dentro de la transacción de
      **toda venta, toda recepción y toda producción**. Es el riesgo 3 y toca el
      camino más caliente del sistema.
      **El test**: en integración, ampliando
      `tiendanubeAislamiento.integracion.test.js`:
      `it('una venta deja la variante mapeada de ese producto pendiente, en la
      MISMA transacción')`;
      `it('el UPDATE del encolado toca UNA fila y no barre la tabla')` —lo que el
      riesgo 3 pide mirar antes de dar por buena la fase—;
      `it('un fallo del encolado NO revierte la venta')` —se fuerza el error del
      `UPDATE` y la venta tiene que quedar cometida igual—.
      **Cómo se comprueba que el test sirve**: se saca `options.transaction` y el
      primero se pone en rojo con la fila encolada fuera de la transacción; se
      saca el `WHERE` del `UPDATE` y el segundo; se saca el `try/catch` y el
      tercero se pone en rojo **con la venta revertida**, que es el daño concreto.
      ⚠ **Lo que este nivel NO puede afirmar**: que el hook no degrade el tiempo
      de una venta. Un umbral de milisegundos no se puede elegir —la misma venta
      tarda distinto en cada máquina— y sin umbral no puede ponerse en rojo. Lo
      que sí se puede contar es **cuántas consultas** agrega, y eso es lo que
      afirma el segundo caso.

- [ ] **T1330** **(b) El agrupado, que es lo que hace viable la decisión 4.**
      No hay código propio: el agrupado **sale del índice único**
      `uq_tn_variante (empresa_id, tiendanube_variant_id)`. Cien movimientos del
      mismo producto en diez segundos actualizan **cien veces la misma fila** y
      producen **un** PUT.
      **Lo que sí hay que escribir es la afirmación**, porque sin ella el día que
      alguien cambie el `upsert` por un `INSERT` en una tabla de eventos, la
      integración pasa a mandar cien llamadas a una API con cuota y nada avisa.
      En `tiendanubeAislamiento.integracion.test.js`:
      `it('cien movimientos del mismo producto dejan UNA fila pendiente')`;
      `it('drenar después de cien movimientos manda UN solo PUT')` —contando
      contra el doble de la API—.
      ⚠ **Por qué NO se agrupa con un temporizador en memoria** (`setTimeout` de 5
      segundos por producto, como un *debounce*): muere con el proceso. En el free
      tier el servicio se reinicia y se duerme, y lo que estaba esperando en un
      `setTimeout` **no lo reintenta nadie**. El agrupado por la unicidad de la
      fila sale gratis y es durable.
      **Verificación**: `npm --prefix apps/api run test:integracion`.
      **Cómo se comprueba que el test sirve**: se cambia el `upsert` por un
      `create` en una tabla de eventos y el primero se pone en rojo con cien
      filas; se manda un PUT por movimiento y el segundo se pone en rojo con cien
      llamadas — que es el número que la API del tercero rechaza.

- [ ] **T1331** **(c) El drenaje, con su reintento.** En
      `apps/api/src/services/tiendanubeSincronizacion.js`, `drenarCola(empresaId)`
      toma las filas con `pendiente_desde IS NOT NULL AND proximo_intento_en <=
      NOW()` —por el índice parcial `idx_tn_variantes_cola`—, manda un PUT por
      fila y actualiza. Se dispara con
      `setImmediate(() => drenarCola(empresaId).catch(…))` **después de
      responder**, con un `Map<empresaId, Promise>` de **un solo drenaje
      simultáneo por empresa**.
      **Por qué no `setInterval`**: `server.js:198-204` lo explica —en el free tier
      de Render el servicio duerme a los 15 minutos sin tráfico y `setInterval` no
      dispara mientras duerme—. Un temporizador que no corre de noche es peor que
      no tenerlo, **porque parece que está**.
      **Por qué el disparo por petición alcanza para el caso normal**: un
      movimiento de stock **es** una petición —alguien cobró, recibió mercadería o
      ajustó el inventario, o entró un pedido por el webhook—. Si el proceso está
      dormido, no hay movimiento que encolar.
      **Verificación**: `npm --prefix apps/api run test:integracion`.
      **El test**: `it('un empujón que falla con 429 deja la fila con
      proximo_intento_en en el futuro y NO la pierde')`;
      `it('el siguiente drenaje la reintenta y la fila sale de la cola')`;
      `it('a los 8 intentos deja de reintentar sola y queda con ultimo_error')`;
      `it('dos drenajes de la misma empresa a la vez: solo uno corre')`.
      **Cómo se comprueba que el test sirve**: se borra la fila en vez de
      reencolarla ante el 429 y el primero se pone en rojo **con la variante
      desfasada en silencio y para siempre**, que es exactamente el modo de falla
      que la red existe para cerrar; se saca el `Map` y el cuarto.
      ⚠ **Lo que NO se puede verificar acá, y hay que decirlo**: que el
      `setImmediate` se dispare **después** de que la respuesta salió. En un test
      se llama a `drenarCola` directamente, así que lo que queda afirmado es el
      drenaje, no el momento. Lo que sí se puede afirmar —y va con su caso— es que
      el handler **no** espera el drenaje: la respuesta llega con la fila todavía
      pendiente.

- [ ] **T1332** **(d) La reconciliación y los dos barridos**, colgados de
      `POST /api/tareas/ejecutar` (`apps/api/src/server.js:211-236`), que ya existe
      y ya se protege con `x-cron-secret`. **No cambia nada de eso.** Gana tres
      tareas, para cada tienda vinculada:
      **(1) la reconciliación**: refresca la instantánea y compara
      `stock.available` de la sucursal designada contra `stock_publicado` **y**
      contra el `stock_en_tienda` que acaba de traer TiendaNube, y **encola solo
      lo que difiere**. Deja su fila en `tiendanube_corridas` con `disparador:
      'reconciliacion'` y actualiza `tienda.reconciliada_en`;
      **(2)** `DELETE FROM tiendanube_estados_oauth WHERE expira_en < NOW() -
      INTERVAL '1 day'`. Una tabla de tokens sin barrido crece para siempre;
      **(3)** borrar las `tiendanube_corridas` de más de 90 días. ⚠ **No toca
      `tiendanube_pedidos`**: un pedido borrado es un pedido que se puede volver a
      descontar si TiendaNube reintenta un webhook viejo. Riesgo 9, y **lo que hay
      que mirar es que nadie copie la consulta**.
      **Comparar contra los tres números no cuesta llamadas extra** —el refresco
      hay que hacerlo igual (FR-057)— y atrapa dos fallas distintas: **el empujón
      que se perdió**, y **el número que alguien cambió a mano en el panel de
      TiendaNube**.
      ⚠⚠ **Este cron hoy falla todos los días.**
      `.github/workflows/tareas-diarias.yml:50-51` corta si faltan `API_URL` o
      `CRON_SECRET`, y `docs/OPERACION.md:17` los tiene marcados **sin hacer**;
      además, sin `CRON_SECRET` del lado de Render el endpoint responde 404 aunque
      se llame (`server.js:222-224`). O sea que `POST /api/tareas/ejecutar`
      **no se llama nunca**. Por eso **el caso normal no depende de él** (T1331,
      in-process) y por eso `GET /status` devuelve `reconciliada_en` y la pantalla
      lo muestra con su tono: **la ausencia de la red tiene que verse, no
      suponerse**. Es el riesgo 4 y el paso manual **P3**.
      *Lo que no se hace*: subir la frecuencia del cron para compensar. Cada
      corrida despierta el servicio, que es lo que el free tier cobra.
      **Verificación**: `npm --prefix apps/api test -- subscriptionCron server` y
      `npm --prefix apps/api run test:integracion`.
      **El test**: en integración, `it('la reconciliación encola SOLO lo que
      difiere')` —con tres variantes: una al día, una con el empujón perdido y una
      que alguien cambió a mano en el panel de TiendaNube; encola dos—;
      `it('deja su fila de corrida con disparador reconciliacion y actualiza
      reconciliada_en')`;
      `it('el barrido borra los estados vencidos y NO los vivos')`;
      `it('el barrido de corridas NO toca tiendanube_pedidos')` —el caso que el
      riesgo 9 pide, y el que muere si alguien copia la consulta—.
      **Cómo se comprueba que el test sirve**: se encola todo en vez de lo que
      difiere y el primero se pone en rojo con tres; se le agrega
      `tiendanube_pedidos` al barrido y el cuarto se pone en rojo **con la
      idempotencia borrada**.

**Checkpoint**: una venta deja la variante pendiente y el número nuevo sale hacia
la tienda en el mismo proceso; cien movimientos producen un PUT; un 429 se
reintenta con espera creciente; y la reconciliación corrige lo que se perdió
—cuando el cron corra, que es **P3**—. Criterio 14.

---

## Phase 8: `checkSubscription` deja de eximir las once rutas privadas

**Purpose**: una empresa con la suscripción vencida no puede sincronizar su
tienda. Es el criterio 17 y US8 escenario 4.

**Cuatro líneas y un revert.** Va sola porque es un cambio de acceso que puede
dejar a alguien afuera de golpe.

- [ ] **T1333** En `apps/api/src/middleware/checkSubscription.js:4-8`,
      `'/api/tiendanube'` se parte en los dos caminos exactos:
      `'/api/tiendanube/callback'` y `'/api/tiendanube/webhook'`. `isExempt` ya
      compara con `startsWith` sobre `req.originalUrl`, así que el callback con
      `?code=…&state=…` sigue entrando.
      **Las once rutas privadas pasan a estar detrás de `checkSubscription` como
      cualquier otra.** Hoy `/api/tiendanube` está **entero** en la lista y una
      empresa con la suscripción vencida sigue sincronizando: es la misma forma
      del paywall eludible que `CONVENCIONES.md` cita entre los tres errores más
      caros del proyecto.
      ⚠⚠ **US8 escenario 5 se cumple, pero NO por donde la spec supone, y por eso
      hay un test que NO se escribe.** «El webhook y el callback siguen exentos»
      es cierto — y lo cierto es que **nunca llegan a este middleware**: viven en
      el router `publico`, que `server.js` monta **sin** la cadena `authEmpresa`
      (verificado: `:345` no tiene `...authEmpresa` y `:346` sí), y Express
      atiende con el primer montaje que matchee. Dejarlos en `EXEMPT_PREFIXES` es
      defensivo y gratis, pero **un test que afirme «el webhook funciona con la
      suscripción vencida» pasaría igual con la lista vacía**: no prueba lo que
      dice probar. **Lo que sí hay que verificar es lo contrario.**
      **Verificación**: `npm --prefix apps/api test -- tiendanubeRutas` pasa.
      **El test**: `it('las once rutas privadas responden 402 con la suscripción
      vencida')` —una por una, con `it.each`: un ancla global «alguna corta»
      seguiría en verde si diez de las once se escaparan—; y
      `it('el prefijo de exención dice los dos caminos exactos y no el prefijo
      entero')`, guardia estática sobre `EXEMPT_PREFIXES`.
      **Cómo se comprueba que el test sirve**: se vuelve `'/api/tiendanube'` a la
      lista y las once se ponen en rojo.
      ⚠ **Riesgo 6, y hay que mirarlo antes de mergear**: `checkSubscription.js:34`
      trata «sin fila de suscripción» como bloqueo. Una empresa cliente sin fila
      pierde la pantalla entera con un 402. Es un dato inconsistente que ese
      middleware ya bloquea en todo el resto de la API, pero **hay que confirmar
      que ninguna empresa cliente esté en ese estado** antes de desplegar.

**Checkpoint**: una empresa con la suscripción vencida recibe 402 en las once
rutas privadas y el webhook sigue entrando. Un revert de cuatro líneas.

---

## Phase 9: La columna muerta deja de ser escribible

**Purpose**: `products.tiendanube_variant_id` no se puede escribir por un camino
que no produce ningún efecto. US9 y criterio 19.

- [ ] **T1334** `'tiendanube_variant_id'` sale de `CAMPOS_EDITABLES` en
      `apps/api/src/routes/products.js:44`. **La columna NO se borra y el modelo
      no cambia** (FR-072): sacarlo de la lista blanca es reversible; el `DROP
      COLUMN` no.
      **Qué pasa hoy**: la columna existe desde `20260603`, está en el modelo
      (`Product.js:86`) y está en `CAMPOS_EDITABLES`, así que cualquiera con
      `products.editar` la puede escribir desde el panel de producto. **No la lee
      nadie**: el único mapeo que usan el webhook y la sincronización es
      `tiendanube_mappings`. Una persona que complete ese campo esperando que el
      stock se sincronice va a esperar para siempre, y **el sistema le va a decir
      que guardó bien**. Es la misma familia de error que `sendEmail` devolviendo
      `ok: true` sin enviar nada.
      **Qué pasa con los datos ya cargados** (FR-071): **se ignoran,
      explícitamente y por escrito**, en tres lugares —el comentario del modelo
      (`apps/api/src/models/Product.js:86`), el plan y `PROXIMOS-PROYECTOS.md`
      (T1348)—. **No se migran** a `tiendanube_mappings` porque un valor que
      alguien escribió esperando que hiciera algo **no dice contra qué producto de
      TiendaNube estaba pensado**: la tabla de mapeos necesita también el
      `tiendanube_product_id`, que esa columna no tiene, y adivinarlo del catálogo
      crearía mapeos que nadie confirmó. Es el mismo criterio que [PENDIENTE N3].
      **Verificación**: `npm --prefix apps/api test -- rutasDeStock products` —o
      el archivo que cubra `PUT /api/products/:id`— pasa.
      **El test**: en el archivo de rutas de productos,
      `it('PUT /products/:id ignora tiendanube_variant_id')` —se manda el campo y
      la fila **no** cambia—, y `it('el valor que ya estaba cargado sigue estando
      y se puede leer')`, porque un dato que desaparece sin que nadie diga que
      desapareció es el peor de los dos.
      **Cómo se comprueba que el test sirve**: se vuelve a poner el campo en la
      lista y el primero se pone en rojo con el valor escrito.
      **La pantalla de producto lo muestra en solo lectura** con la leyenda «Este
      campo no se usa: el mapeo se hace desde TiendaNube» y su enlace — eso va con
      la pantalla, en T1342.

**Checkpoint**: el campo no se puede escribir por un camino que no hace nada, y
lo que ya está cargado sigue visible. Una línea, un corte, un revert.

---

## Phase 10: Web · las funciones puras, antes que cualquier componente

**Purpose**: los estados, los tonos, el resumen de una corrida y el filtro de
variantes son funciones puras con su test, y ningún componente calcula nada.

**No queda nada visible.** Es lo que hace verificables las fases 12 y 13: un test
de render que verifica una regla es diez veces más lento y se pone en rojo cuando
alguien mueve un `<div>`.

- [ ] **T1335** Crear `apps/web/src/utils/tiendanube.js` con los cuatro estados y
      sus tonos: `estadoDeLaConexion(status)` —los cuatro de FR-006 más el quinto
      **de la pantalla**, «no se pudo comprobar»—, `tonoDeConexion`,
      `estadoDeMapeo(variante)` y `tonoDeMapeo`.
      **Los tonos devuelven las TRES clases juntas** —`border-…-line`,
      `bg-…-soft` y `text-…`— en un solo string, y **nunca devuelven
      `undefined`**. El molde es `tonoDeStock` (`apps/web/src/utils/inventario.js:221`):
      se copia la forma, no la función.
      **Verificación**: `npm run test:web -- tiendanube`.
      **El test**: `apps/web/src/utils/tiendanube.test.js`:
      `it('«sin configurar en el servidor» NO es lo mismo que «no vinculada»')`
      —US1 escenario 9—;
      `it('un fallo de /status NO se muestra como «no vinculada»')` —US1 escenario
      10: es lo que hace hoy `Settings.jsx:78`—;
      `it('«vinculada con error» se distingue de «vinculada»')`;
      `it('una variante mapeada a un producto que ya no existe no puede pasar por
      acá: el mapeo desapareció por CASCADE')` —US3 escenario 11—;
      `it('una variante que ya no está en la tienda tiene su propio estado')`;
      `it('ningún estado devuelve undefined, para ninguna entrada, ni null, ni
      {}')` —el caso que evita el `className={undefined}` que borra el badge—.
      **Cómo se comprueba que el test sirve**: se colapsan `sin_configurar` y
      `no_vinculada` en uno y el primero se pone en rojo; se le saca el `default`
      al `switch` de los tonos y el sexto.

- [ ] **T1336** En el mismo `apps/web/src/utils/tiendanube.js`, las dos
      restantes: `resumenDeCorrida(corrida, cola)` —el texto legible de FR-042: qué
      pasó, hace cuánto, cuántas entraron y cuántas fallaron— y
      `filtrarVariantes(variantes, { q, soloSinMapear })`.
      **`fechaCorta` de `apps/web/src/utils/formato.js` se reusa** para «hace
      cuánto». No se escribe una segunda.
      **Verificación**: `npm run test:web -- tiendanube`.
      **El test**: `it('cero fallas, una falla y todas fallaron dicen cosas
      distintas')`; `it('una corrida sin terminada_en dice que quedó a medias')`
      —US5 escenario 6—; `it('sin ninguna corrida se distingue de una corrida que
      mandó cero')`; `it('«solo sin mapear» con todo mapeado devuelve vacío, y eso
      NO es «no hay productos»')` —US3 escenario 13, y es lo que separa dos de los
      cuatro estados vacíos—; `it('la búsqueda encuentra por nombre, por SKU y sin
      acentos')`.
      **Cómo se comprueba que el test sirve**: se devuelve el mismo texto para
      cero y para una falla y el primero se pone en rojo; se saca la
      normalización de acentos y el quinto.

**Checkpoint**: `npm run test:web` pasa con un archivo nuevo de funciones puras y
sus once casos. Nada visible cambió.

---

## Phase 11: Las guardias entran **antes** de escribir las pantallas

**Purpose**: cada hexadecimal, cada `dark:`, cada clase de la paleta y cada
`Table*` falla **en el momento**, y no treinta al final cuando ya nadie sabe cuál
vino de dónde.

Es el riesgo 8 del plan de la 010 y la decisión 11 del de la 011, textual.
**Queda en rojo a propósito hasta la fase 12.**

- [ ] **T1337** [P] En `apps/web/src/tests/guardiasDeDiseno.test.js`, agregar los
      **tres** archivos nuevos a `NOMBRES` (`:103`) —`pages/Tiendanube.jsx`,
      `components/PanelDeMapeo.jsx`, `components/EstadoDeTiendanube.jsx`— y mover
      el ancla de `toHaveLength(16)` (`:220`) a **`toHaveLength(19)`**, con la
      cuenta escrita en el comentario.
      **Los tres todavía no existen, y eso es exactamente lo buscado**: `leer()`
      (`:137`) marca el archivo que falta como `existe: false` y la guardia da un
      hallazgo propio —«el archivo NO existe: la guardia no miró nada»— que se lee
      **distinto** de «L353: border-green-500/30». El comentario de ese bloque
      (`:122-136`) explica por qué, y confundir los dos rojos es cómo se archiva
      el segundo creyendo que era el primero.
      **Verificación**: `npm run test:web -- guardiasDeDiseno` queda **en rojo**,
      con **tres** hallazgos y los tres del tipo «no existe». Cualquier otro
      hallazgo en este punto es un defecto de esta tarea.
      **El test**: los que ya existen, ampliados a diecinueve archivos.
      **Cómo se comprueba que el test sirve**: al escribirse cada pantalla, el
      hallazgo correspondiente desaparece; **si alguien mete un hex, aparece uno
      distinto y se lee distinto**.

- [ ] **T1338** [P] En `apps/web/pruebas-de-navegador/marcoDeLasPantallas.navegador.js:40`,
      `/tiendanube` entra a `CON_MARCO`: **de diecisiete rutas a dieciocho**, y
      los tres comentarios que dicen «las diecisiete» se actualizan.
      ⚠ **`apps/web/src/tests/marcoDePantalla.test.js` NO se toca, y hay que
      decirlo**: ese archivo **deriva** las rutas de `App.jsx` (a diferencia de la
      lista del navegador, que está escrita a mano justamente porque una lista
      derivada del código que se verifica pasa igual cuando el código se
      equivoca). O sea que **no puede ponerse en rojo antes de que la ruta
      exista**: va a exigir el `MarcoDePantalla` y el `requiredModule` **sola**, en
      cuanto T1339 agregue la ruta. Y `/tiendanube` **no** va en la lista
      `SIN_GUARD_TODAVIA` (`:180`), porque nace con su guard.
      **Verificación**: `npm --prefix apps/web run test:navegador` queda **en
      rojo** en los casos de `/tiendanube` y solo en ésos —la ruta todavía no
      existe—; `npm run test:web` sigue **en verde**, porque los archivos
      `.navegador.js` no los levanta vitest.
      **El test**: los tres bloques que ya existen, con dieciocho rutas.
      **Cómo se comprueba que el test sirve**: cuando la ruta exista y quede fuera
      del marco, los casos de `/tiendanube` siguen en rojo por el motivo correcto
      —desborde o contenedor ausente— y no por 404.

**Checkpoint**: la suite de la web está en rojo **en un solo archivo y por tres
hallazgos que dicen «no existe»**, y las pruebas de navegador en rojo en una ruta.
Es el mecanismo, no un efecto colateral.

---

## Phase 12: Web · la pantalla

**Purpose**: `/tiendanube` existe, está gateada en los tres lados, muestra los
cuatro estados de la conexión, la tabla de variantes en `TablaGrid` y los cuatro
estados vacíos; y **no promete nada que el sistema no haga**.

US1, US3, US7 y US8 del lado de la pantalla. Criterios 16, 18 y 21.

⚠ **Va después del paso manual P4.** `RouteGuard` con un módulo que ninguna
empresa tiene deja la pantalla **invisible para todas**: `App.jsx:58-62` redirige
a `/pos`. Es el riesgo 2.

- [ ] **T1339** El gateo en los tres lados y los helpers de la API, en un commit:
      **(1)** en `apps/web/src/services/api.js`, los helpers de los catorce
      endpoints, con el estilo de los que ya están (`:139-145`);
      **(2)** en `apps/web/src/App.jsx`, la ruta
      `<Route path="/tiendanube" element={<MarcoDePantalla><RouteGuard
      requiredModule="tiendanube"><Tiendanube/></RouteGuard></MarcoDePantalla>} />`.
      **No lleva `soloSuperadmin`** (FR-069): la pantalla es para el cliente;
      **(3)** en `apps/web/src/components/navegacion.js`, el ítem en el grupo
      «Configuración»: `{ to: '/tiendanube', modulo: 'tiendanube', permission:
      'config.ver' }`. **El mismo módulo y el mismo permiso que la ruta y que la
      API**, o el gateo no sirve.
      **Verificación**: `npm run test:web -- marcoDePantalla` pasa **sola**, sin
      haber tocado ese archivo (T1338), y `npm run build` pasa.
      **El test**: `marcoDePantalla.test.js` ya exige que toda ruta que no sea
      `/pos` esté envuelta y que declare el módulo que el menú declara. Más, en
      `apps/web/src/tests/renderDeTiendanube.test.jsx`, `it('el ítem del menú
      declara el mismo módulo que la ruta')`.
      **Cómo se comprueba que el test sirve**: se saca el `MarcoDePantalla` y
      `marcoDePantalla.test.js` lo nombra; se le pone otro módulo al ítem y el
      caso nuevo.

- [ ] **T1340** Crear `apps/web/src/components/EstadoDeTiendanube.jsx`: el bloque
      de conexión con los **cuatro estados** de FR-006 más el quinto de la
      pantalla, el nombre y el id de la tienda, desde cuándo, la sucursal
      designada, **cuándo fue la última reconciliación**, «Conectar» /
      «Desvincular» y el cambio de sucursal.
      **Nunca muestra el token**, ni truncado, ni «los últimos cuatro» ([PENDIENTE
      N7]: mostrar los últimos cuatro de un secreto es una costumbre de tarjetas
      de crédito que acá no aporta nada y filtra).
      **`reconciliada_en` va a la vista con su tono**, porque el cron hoy falla
      todos los días y **la ausencia de la red tiene que verse** (riesgo 4).
      «Desvincular» y «Cambiar sucursal» van con `useConfirmDialog`
      (`components/ConfirmDialog.jsx:12`). La de desvincular **dice que los mapeos
      no se borran**; la de la sucursal dice **cuántas variantes se van a volver a
      empujar y de qué sucursal a cuál**, antes de confirmar (riesgo 8).
      **El componente recibe props explícitos y no lee el store por su cuenta**,
      igual que los tres de `components/pos/`. La regla va en su encabezado.
      **Verificación**: `npm run test:web -- renderDeTiendanube guardiasDeDiseno`
      —y `guardiasDeDiseno` baja de tres hallazgos a dos—.
      **El test**: en `renderDeTiendanube.test.jsx`:
      `it('el bloque NO contiene el token de ninguna forma, ni truncado')` —US1
      escenario 7—;
      `it('sin config.editar, «Conectar» y «Desvincular» están DESHABILITADOS con
      su explicación en el documento, no ausentes')` —US1 escenario 11—;
      `it('«Desvincular» abre confirmación y la confirmación dice que los mapeos
      no se borran')`;
      `it('cambiar la sucursal dice cuántas variantes se vuelven a empujar antes
      de confirmar')`;
      `it('muestra cuándo fue la última reconciliación, y dice algo distinto si
      nunca corrió')`.
      **Cómo se comprueba que el test sirve**: se agrega `token.slice(-4)` y el
      primero se pone en rojo; se oculta el botón en vez de deshabilitarlo y el
      segundo; se saca `encoladas` del `ConfirmDialog` y el cuarto.

- [ ] **T1341** Crear `apps/web/src/components/PanelDeMapeo.jsx`: el panel lateral
      de mapeo, con `Sheet`/`SheetContent` de `apps/web/src/components/ui/sheet.jsx`
      y `style={{ width: '520px', maxWidth: '92vw' }}` **en estilo, no en clases**.
      **Panel y no modal** (FR-053): se elige el producto del sistema **mirando**
      la lista, no tapándola. Es la misma decisión que tomó Inventario en el hito
      4.
      Adentro: búsqueda por nombre y por SKU, la **sugerencia** por SKU coincidente
      —marcada como sugerencia y **hay que confirmarla**— y el aviso de «hay dos
      productos con ese SKU» cuando `sugerirPorSku` devuelve más de uno.
      **Verificación**: `npm run test:web -- renderDeTiendanube guardiasDeDiseno`
      —que baja a un hallazgo—.
      **El test**: `it('la sugerencia aparece marcada como sugerencia y NO se
      aplica sola')` —US3 escenario 6—;
      `it('con dos productos del mismo SKU dice que hay dos y no elige')`;
      `it('un 429 y un 502 muestran avisos DISTINTOS, no cierran el panel y no
      pierden lo escrito')` —US6 escenarios 2 y 4, FR-062—;
      `it('el 409 de mapeo repetido llega como mensaje legible que nombra la otra
      variante')` —US3 escenario 8—.
      **Cómo se comprueba que el test sirve**: se aplica la sugerencia sola y el
      primero se pone en rojo; se cierra el panel ante el error y el tercero se
      pone en rojo con lo escrito perdido.

- [ ] **T1342** Crear `apps/web/src/pages/Tiendanube.jsx`: `PageHeader` con la
      acción principal —«Sincronizar stock» con tienda vinculada, «Conectar con
      TiendaNube» sin ella—, el bloque de estado, la tabla de variantes y los
      cuatro estados vacíos.
      **La tabla va con `TablaGrid` / `Encabezado` / `Fila` / `BotonDeFila`**
      (`components/TablaGrid.jsx:47`, `:63`, `:86`, `:114`) y **no** con los
      `Table*` de shadcn. **Una fila por VARIANTE** (FR-052), no por producto de
      TiendaNube: la variante es la unidad que tiene stock. El
      `grid-template-columns` es **el mismo string** en el encabezado y en las
      filas, escrito una vez. Los números van en `.num`, las etiquetas del
      encabezado en `.eyebrow`, y la paginación con `Pagination.jsx`
      —1-indexado, `{ page, totalPages, onPageChange }`—.
      **Los cuatro estados vacíos dicen cosas distintas** (FR-055): sin tienda
      vinculada; tienda vinculada y sin productos; con productos y sin ningún
      mapeo; y el filtro que no devolvió nada. **No pueden compartir el mismo
      texto.**
      **Y los avisos de US7**, que son la mitad del valor de esta pantalla:
      **(a)** un pedido de la tienda **baja inventario y no registra una venta**,
      así que no aparece en facturación, ni en caja, ni en reportes (FR-073);
      **(b)** **no dice «bidireccional»** sin aclarar qué va en cada sentido:
      stock hacia la tienda, pedidos hacia AdminApp (FR-074);
      **(c)** dice **de qué sucursal** sale el stock que se publica y **qué
      número** publica —`available`, «lo que se puede vender»— (US7 escenario 3);
      **(d)** dice que un pedido cancelado o devuelto **no repone el stock solo**
      ([PENDIENTE N5]).
      Y en `apps/web/src/pages/` donde vive el panel de producto, el campo
      `tiendanube_variant_id` pasa a **solo lectura** con la leyenda «Este campo no
      se usa: el mapeo se hace desde TiendaNube» y su enlace (T1334).
      **Verificación**: `npm run test:web` pasa y `guardiasDeDiseno` vuelve a
      **verde** con `toHaveLength(19)` y **cero** hallazgos. `npm run build` pasa.
      **El test**: `it('el encabezado y las filas comparten el MISMO string de
      grid-template-columns')` —FR-051, criterio 21—;
      `it('el badge «Sin mapear» está en la fila de la variante que corresponde')`
      —con una lista donde la **segunda y la cuarta** están mapeadas: con una sola
      mapeada el caso pasa con y sin el defecto—;
      `it('los cuatro estados vacíos dicen cosas distintas')`;
      `it('la pantalla dice que un pedido baja inventario y NO registra una
      venta')` —FR-073, criterio 16—;
      `it('la pantalla NO dice «bidireccional» sin aclarar qué va en cada
      sentido')`;
      `it('dice de qué sucursal y qué número publica')`;
      `it('sin config.editar la tabla se ve y no se puede cambiar, con la
      explicación a la vista')` —US3 escenario 14—.
      **Cómo se comprueba que el test sirve**: se escribe el
      `grid-template-columns` dos veces con una columna distinta y el primero se
      pone en rojo; se le pone el badge a la primera fila y el segundo; se copia el
      texto de un estado vacío en otro y el tercero; se pega el texto de hoy
      —«sincronización bidireccional», `Settings.jsx:395`— y el quinto.

**Checkpoint**: `/tiendanube` se ve, está gateada en los tres lados, muestra los
cuatro estados y la tabla de variantes, y **todo lo que afirma es cierto contra el
comportamiento real**. `guardiasDeDiseno` en verde con diecinueve archivos.

---

## Phase 13: Web · sincronizar, la última corrida y lo que no descontó

**Purpose**: se aprieta «Sincronizar», se ve el resultado de la última corrida
—cuántas, cuáles fallaron y por qué— y se ve **lo que un pedido no descontó**.

US5 y US6 del lado de la pantalla, criterios 11 y 12.

- [ ] **T1343** En `apps/web/src/pages/Tiendanube.jsx` y
      `components/EstadoDeTiendanube.jsx`, el botón de sincronizar y el bloque de
      la última corrida: cuándo empezó, cuánto tardó, quién la disparó, cuántas se
      mandaron, cuántas fallaron y **cuáles**, con su motivo; más el bloque `cola`
      —pendientes, con error, la más vieja—.
      **El bloque pide datos al montar**, así que su render va envuelto en
      `await act(async () => …)` en el test (`CONVENCIONES.md`, punto 5). Sin eso
      React llena la salida de «An update … was not wrapped in act(...)», y **una
      suite que imprime ruido en verde es una que nadie lee cuando se pone en
      rojo**. El molde es `components/HistorialDeCostos.jsx`.
      **Verificación**: `npm run test:web -- renderDeTiendanube`, **con la salida
      limpia**: ningún aviso de `act(...)`.
      **El test**: `it('apretar «Sincronizar» dos veces manda UNA sola llamada')`
      —espiando la instancia de axios con `vi.spyOn(api, 'post')`, no mockeando
      `@/services/api` entero: el grafo de imports arrastra decenas de
      exportaciones y la lista se desactualiza sola—;
      `it('sin config.editar el botón está deshabilitado con su explicación')`
      —US5 escenario 10—;
      `it('una corrida con una falla dice «N actualizadas, 1 con error» y la
      NOMBRA')` —criterio 11—;
      `it('una corrida sin terminada_en dice que quedó a medias')`;
      `it('sin ningún mapeo, apretar «Sincronizar» lo dice y no manda ninguna
      llamada')` —US5 escenario 9—;
      `it('la cola dice cuántas están pendientes y hace cuánto')`.
      **Cómo se comprueba que el test sirve**: se saca la bandera de «ocupado» y
      el primero se pone en rojo con dos llamadas; se muestra solo el conteo sin
      nombrar la variante y el tercero.

- [ ] **T1344** El bloque de **pedidos con ítems sin descontar**, en
      `apps/web/src/pages/Tiendanube.jsx`, sobre `GET /api/tiendanube/pedidos`.
      Una fila por pedido, con su número, cuándo entró, cuántos ítems descontaron
      y cuántos no, y el detalle con los **cuatro motivos**: `sin_mapeo`,
      `sin_stock_en_sucursal`, `sin_variante`, `cantidad_cero`.
      **Es el criterio 5 del lado de la pantalla**: «un ítem que no descontó se
      puede ver». Hoy se saltea en silencio y lo único que queda es que el
      inventario está mal, y eso aparece en un recuento físico tres meses después,
      cuando ya no se puede reconstruir qué pasó.
      **Verificación**: `npm run test:web -- renderDeTiendanube`.
      **El test**: `it('un pedido con un ítem sin mapear se ve, con la variante y
      el motivo')`; `it('los cuatro motivos se leen en castellano y no como el
      código de la base')`; `it('sin pedidos con problemas el bloque dice eso y
      no queda vacío')`.
      **Cómo se comprueba que el test sirve**: se muestran los códigos crudos y el
      segundo se pone en rojo.

**Checkpoint**: se sincroniza desde la pantalla, se ve qué falló y por qué, y se
ve qué no descontó un pedido. Criterios 5, 11 y 12.

---

## Phase 14: La tarjeta de `/facturacion` se va y queda un enlace

**Purpose**: no quedan **dos** lugares que digan el estado de lo mismo. US7
escenario 5, [PENDIENTE N11].

Va última porque toca una pantalla que este hito **no** rediseña —eso es el hito
8—.

- [ ] **T1345** En `apps/web/src/pages/Settings.jsx`, la tarjeta de TiendaNube
      (`:372-403`) se saca y en su lugar queda un enlace a `/tiendanube`. Se van
      con ella `tiendanubeLinked` (`:25`), `checkTiendaNubeStatus` (`:74-79`),
      `handleConnectTiendaNube` (`:81-90`) y la lectura de
      `?tiendanube=success|error` (`:65-71`) —el callback ahora vuelve a
      `/tiendanube?estado=…` (T1311)—.
      **Por qué se saca y no se deja**: dos lugares que muestran el estado de lo
      mismo se separan y **nada avisa**; ya pasó con las listas de estados de orden
      que la funcionalidad 012 encontró duplicadas. Y las dos frases de esa tarjeta
      son falsas: «El stock se sincroniza automáticamente mediante webhooks»
      (`:389`) y «sincronización bidireccional» (`:395`).
      **Verificación**: `npm run test:web` pasa y `npm run build` pasa.
      **El test**: en `apps/web/src/tests/` —el archivo que cubra `Settings.jsx`,
      o `renderDeTiendanube.test.jsx`—, `it('/facturacion ya no dice el estado de
      TiendaNube: solo enlaza')`, guardia de render sobre la pantalla de Ajustes;
      y `it('Settings.jsx ya no llama a /tiendanube/status')`, guardia estática.
      **Cómo se comprueba que el test sirve**: se vuelve a poner la tarjeta y los
      dos se ponen en rojo.

**Checkpoint**: hay **un** lugar que dice el estado de la conexión.

---

## Phase 15: El navegador y los dos documentos

**Purpose**: lo que solo un motor de maquetado puede contestar, contestado; y lo
que cambió, escrito para quien opera.

- [ ] **T1346** [P] Las **tres** medidas que bajan al navegador, en
      `apps/web/pruebas-de-navegador/`. Solo tres, porque el listón de
      `CONVENCIONES.md` es alto y acá se respeta:
      **(1)** `/tiendanube` está adentro del contenedor de 1320px y el `<body>`
      **no desborda** a 1140px ni a 1920px —criterio 22; es la ruta dieciocho de
      `marcoDeLasPantallas.navegador.js`, que T1338 ya declaró—;
      **(2)** un nombre de variante largo **no se mete en la columna de acciones**
      de la tabla;
      **(3)** el panel de mapeo mide **520px de verdad**, después de que opinen el
      `max-w-[92vw]` y el `sm:max-w-sm` que el propio `sheet.jsx` trae.
      ⚠ **Lo que NO baja, aunque se pueda escribir**: el tono de un badge, qué
      variantes entran en el filtro, el texto del resumen de la corrida y el
      cálculo del backoff. Los cuatro los contesta una función pura de las fases 5
      y 10, y repetirlos en un navegador cuesta cincuenta veces más por caso.
      ⚠ **Y la mutación vale igual y muerde más**: tres de las primeras once
      pruebas de geometría de este repositorio **no se pusieron en rojo** con su
      mutación. Cada una de estas tres se verifica revirtiendo la clase o la
      medida que dice cubrir.
      **Verificación**: `npm --prefix apps/web run test:navegador` pasa entero
      —dieciocho rutas—, con el procedimiento de la sección «Los cuatro pasos
      manuales» para levantar la base y la API.
      **Cómo se comprueba que el test sirve**: se le saca el `max-w` a la columna
      de nombre y la (2) se pone en rojo con la caja invadiendo la de acciones; se
      cambia el ancho del panel a 640px y la (3).

- [ ] **T1347** [P] `docs/OPERACION.md`: **(a)** cómo habilitar el módulo
      `tiendanube` por empresa —`PUT /api/empresas/:id` con el `settings`
      **entero** (`routes/empresas.js:503-511`), armado con cuidado para no pisar
      el resto del JSON—; **(b)** las tres variables de entorno de TiendaNube y
      qué pasa si falta cada una —en particular que sin
      `TIENDANUBE_CLIENT_SECRET` **todo webhook se rechaza y se ve idéntico a un
      ataque**—; **(c)** qué mirar si la reconciliación no corre: `API_URL` y
      `CRON_SECRET`, que `OPERACION.md:17` tiene marcados **sin hacer**, y que sin
      el segundo el endpoint responde 404 aunque se llame.
      **Verificación**: se lee y se sigue. Es documentación y no tiene test; lo
      que sí tiene test es todo lo que describe.

- [ ] **T1348** [P] `docs/PROXIMOS-PROYECTOS.md`, cinco entradas con su primer
      paso escrito:
      **(1)** **no hay reservas de stock**, y tres escritores
      —`productionService.js:378` y `:508`, `import.js:438`, `products.js:329`—
      **borran la diferencia entre `available` y `quantity`** asignando `available
      = quantity`. Publicar `available` es correcto y hoy no cambia ningún número;
      el día que exista una reserva de verdad, tres caminos la borran sin que nada
      avise;
      **(2)** el **permiso propio** de TiendaNube, para el día que el encargado de
      depósito tenga que sincronizar sin ver el CUIT ([PENDIENTE N1]);
      **(3)** **registrar la venta** del pedido de la tienda online —tipo de
      comprobante, punto de venta de AFIP, cliente, medio de pago y numeración—.
      Es el hallazgo 7 de la spec y ahora **la pantalla lo hace visible**, así que
      alguien va a preguntar (riesgo 12);
      **(4)** **`order/cancelled`** y las devoluciones ([PENDIENTE N5]): hace falta
      su propia guarda de idempotencia —reponer dos veces es tan malo como
      descontar dos veces— y esa guarda no se improvisa;
      **(5)** el **entorno de pruebas de TiendaNube**: las tres URL están literales
      en el servicio y no hay variable para moverlas. Es lo que hace que **el
      contrato real del tercero no lo verifique ni un solo test**.
      Y una línea que corrige el registro: **`products.tiendanube_variant_id` deja
      de ser escribible y sus valores se ignoran explícitamente** (FR-071).
      **Verificación**: idem T1347.

**Checkpoint**: `npm run test:api`, `npm run test:web`,
`npm --prefix apps/api run test:integracion`, `npm --prefix apps/web run
test:navegador` y `npm run build` pasan; y las guardias de aislamiento,
observabilidad, permisos de rutas, descuento de stock y diseño siguen limpias.
Criterio 24.

---

## Los cuatro pasos manuales

**Esto no son tareas.** Son las verificaciones y las acciones que **no se pueden
escribir como test**, escritas como pasos reproducibles justamente para no
disfrazarlas de test.

⚠ **El plan proponía cinco y quedan cuatro.** El que se cae es el de
reversibilidad: **`node apps/api/scripts/verificar-reversibilidad.js --desde
20260809` es un comando con código de salida**, no una inspección con ojos, y ya
es la verificación de T1304, T1305 y T1307. Levanta y borra su propio Postgres,
igual que el arnés de integración levanta el suyo, y ninguno de los dos figura
como paso manual en el hito anterior. Dejarlo en esta lista sería contar como
«mirado a mano» algo que devuelve `0` o `1`.

⚠ **Y la lista del hito anterior arrancó con doce y se corrió uno.** Eso no fue
indisciplina: doce pasos a mano antes de cada release es una lista que nadie hace
entera, y una lista que nadie hace entera es **peor que una corta**, porque figura
al lado de cuarenta y ocho casillas marcadas y se lee como «verificado» cuando lo
único que dice es «escrito».

### Lo que ningún test de este hito verifica, dicho sin adornos

**No hay entorno de pruebas de TiendaNube** (supuesto 11). Las tres URL están
literales en `services/tiendanubeService.js` y ponerle una variable está **Fuera
de alcance**. Todo lo de arriba dobla la API del tercero. Consecuencia:

- **El nombre de la cabecera de la firma** (`x-linkedstore-hmac-sha256`) no lo
  verifica nada. El test de la firma prueba que AdminApp verifica lo que AdminApp
  firmó: **el circuito, no el algoritmo del otro lado.**
- **El formato de la paginación** —si es `page`/`per_page`, si el fin de las
  páginas se detecta por una respuesta vacía o por una cabecera— tampoco.
- **La forma del cuerpo del webhook** —`store_id`, `id`, `products` vs `items`,
  `product_variant_id` vs `variant_id`— tampoco. El código de hoy contempla las
  dos formas de cada par (`tiendanubeService.js:113`, `:127`) **sin que nadie haya
  visto un cuerpo real**.
- **Que `PUT /v1/{user_id}/products/variants/{id}` acepte `{ stock }`** tampoco.
- **Que TiendaNube mande `Retry-After` en un 429**, y en qué formato, tampoco. La
  función pura contempla los tres casos; cuál ocurre, no lo sabemos.

Eso es lo que P1 y P2 existen para contestar, y **son los únicos dos pasos de esta
lista que de verdad piden una cuenta real**.

### P1 · Vincular una tienda real de punta a punta

**Qué hacer**: desde `/tiendanube`, con `TIENDANUBE_CLIENT_ID`,
`TIENDANUBE_CLIENT_SECRET` y `TIENDANUBE_CONTACT_EMAIL` configuradas, apretar
«Conectar con TiendaNube» y completar el OAuth con una tienda real.

**Qué tiene que verse**: la URL de autorización lleva `state`; al volver, la
pantalla queda mostrando la tienda vinculada **sin recargar**; y en la base, la
fila de `tiendanube_tiendas` tiene el `tiendanube_user_id` y el `nombre`
correctos, con su `punto_de_venta_id` **no nulo**.

**Por qué no hay test**: es el único que valida el contrato del tercero —la URL de
autorización, el canje del `code` y la forma de la respuesta—.

**Y lo que hay que mirar además**: que `settings` tenga la fila del token **y que
la respuesta de `GET /status` no lo traiga**.

### P2 · Comprar algo en esa tienda

**Qué hacer**: hacer una compra real en la tienda vinculada y pagarla.

**Qué tiene que verse**: llega el `order/paid`, la firma **valida**, el stock baja
en la **sucursal designada**, y queda una fila de `tiendanube_pedidos` con su
`tiendanube_order_id` y sus `items`.

**Por qué no hay test**: idem P1. Y es lo único que comprueba que el movimiento
del montaje (T1315) funciona **en Render**, con el `helmet`, el `morgan` y el
`cors` reales delante, y no solo dentro de un `supertest`.

**Y lo que hay que mirar además**: que la respuesta sea **200** —si fuera 401,
TiendaNube empieza a contar errores y **deshabilita el webhook**— y que el log
diga cuál de las tres cosas faltó si la firma no validara.

### P3 · Configurar `API_URL` y `CRON_SECRET`

**Qué hacer**: ponerlas en el repositorio (GitHub Actions) y en Render.
`.github/workflows/tareas-diarias.yml:50-51` corta si faltan, y
`docs/OPERACION.md:17` las tiene marcadas **sin hacer**.

**Qué tiene que verse**: al día siguiente, una fila de `tiendanube_corridas` con
`disparador: 'reconciliacion'` y `tienda.reconciliada_en` actualizado; y en la
pantalla, el bloque de reconciliación deja de decir que nunca corrió.

**Por qué no hay test**: es una acción de operación sobre dos servicios externos.
**Lo que sí está testeado es toda la lógica**: T1332 ejercita la reconciliación y
los dos barridos llamando a la función directamente.

⚠ **Hasta que esto se haga, la red de la decisión 4 no atrapa nada.** El caso
normal no depende de este cron (el drenaje es in-process), pero un empujón perdido
queda perdido. Por eso la pantalla muestra `reconciliada_en`: la ausencia de la
red se **ve**, en vez de suponerse. Riesgo 4.

### P4 · Mirar qué empresas van a recibir `tiendanube` en `enabled_modules`

**Qué hacer**, **antes** de la fase 12: mirar en producción qué empresas tienen
que ver la pantalla y agregarles `'tiendanube'` a `settings.enabled_modules` con
`PUT /api/empresas/:id`.

**Qué tiene que verse**: el ítem aparece en la barra lateral y `/tiendanube` no
redirige a `/pos`.

**Por qué no hay test**: son datos de producción.

⚠ **`App.jsx:58-62`: si `enabled_modules` es un arreglo y no contiene el módulo,
`RouteGuard` redirige a `/pos`.** Ninguna empresa tiene `tiendanube` hoy, así que
**sin este paso la pantalla nueva es invisible para todas**. Riesgo 2, y es la
misma precaución que `marcoDePantalla.test.js:166-171` deja escrita para las ocho
rutas que todavía no tienen guard.

⚠⚠ **El `PUT` manda el `settings` ENTERO** (`routes/empresas.js:503-511`). Hay que
leer el JSON actual, agregarle la clave y mandarlo completo: armarlo de memoria
**pisa el resto de la configuración de la empresa**.

*Lo que no se hace*: dejar la ruta sin `RouteGuard` para que se vea. Eso es el
gate que solo está en el menú, y el plan dice que va en los tres lados o no sirve.

### El procedimiento para levantar lo que estos pasos necesitan

Es el mismo del hito anterior y sigue valiendo entero: base descartable en el
55432, `BYPASS_AUTH=true`, `ALLOWED_ORIGINS=http://localhost:5199` **que no es
opcional** —sin ella el navegador recibe la respuesta sin cabecera de CORS y las
dieciocho pruebas fallan diciendo que no encuentran `<main>`—, y el usuario de
pruebas como **superadmin**. Está escrito en
`docs/specs/012-proveedores-y-ordenes-de-compra/tasks.md`, sección «P0».

⚠ **El puerto 55432 es el mismo que usa el contenedor del arnés de integración**
(`adminapp-pg-integracion`). Los dos no pueden estar arriba a la vez.

---

## Resumen

| Fase | Tareas | Qué queda funcionando |
|---|---|---|
| 1 · El IDOR y el punto ciego | T1301–T1303 (3) | La empresa B recibe **404** donde hoy recibe 201; `controllers/` no existe; la guardia **de verdad ve** la forma corta y los routers nombrados |
| 2 · Migraciones, modelos y semilla | T1304–T1307 (4) | Las cinco tablas, los cinco modelos registrados, y el `down` de la migración de datos **ejecutado y comparado** |
| 3 · El OAuth | T1308–T1314 (7) | Se vincula una tienda; el `state` es de un solo uso **también en paralelo**; dos empresas no pueden vincular la misma tienda |
| 4 · El webhook | T1315–T1319 (5) | Un `order/paid` firmado descuenta **una vez y entero**, de la sucursal designada; lo que no descontó se puede ver |
| 5 · Catálogo y mapeo | T1320–T1325 (6) | Todas las páginas del catálogo; buscar, filtrar y paginar; listar y borrar mapeos; ninguna llamada sin `timeout` |
| 6 · La sincronización explícita | T1326–T1328 (3) | Un PUT por variante con `available` de la sucursal designada; el resultado sobrevive un reinicio |
| 7 · La red de la decisión 4 | T1329–T1332 (4) | El encolado, el agrupado, el reintento con espera creciente y la reconciliación — **cuatro afirmaciones, cuatro tareas** |
| 8 · `checkSubscription` | T1333 (1) | La suscripción vencida corta las once privadas. Cuatro líneas, un revert |
| 9 · La columna muerta | T1334 (1) | No se puede escribir un campo que no hace nada. Una línea |
| 10 · Web · funciones puras | T1335–T1336 (2) | Los cuatro estados, los tonos, el resumen y el filtro, testeados |
| 11 · Web · las guardias | T1337–T1338 (2) | Cada hex y cada `Table*` falla en el momento. **En rojo a propósito hasta la 12** |
| 12 · Web · la pantalla | T1339–T1342 (4) | `/tiendanube` gateada en los tres lados, con su tabla y **sin prometer lo que el sistema no hace** |
| 13 · Web · corrida y pedidos | T1343–T1344 (2) | Se sincroniza, se ve qué falló y por qué, y qué no descontó un pedido |
| 14 · La tarjeta de Ajustes | T1345 (1) | **Un** lugar que dice el estado de la conexión |
| 15 · Navegador y documentos | T1346–T1348 (3) | Las tres medidas, y lo que cambió escrito para quien opera |

**Total: 48 tareas y 4 pasos manuales.**

### Los cortes que se pueden mergear y desplegar solos

**Todos menos la 11**, que va con la 12 por construcción. Y tres merecen decirse:

- **La fase 1 es un corte cerrado y no depende de nada.** Cierra un IDOR vivo y
  arregla la guardia que tendría que haberlo visto. Se puede desplegar hoy.
- **La fase 2 es aditivo puro**: cinco tablas que nadie lee.
- **Las fases 8 y 9 son una línea cada una** y van solas por eso mismo: mezcladas
  con setecientas líneas de otra cosa, nadie sabría cuál de las dos rompió qué.

### Lo que puede ir en paralelo

`[P]`: **T1301** y **T1303**; **T1304** y **T1305**; **T1308** y **T1309**;
**T1320** y **T1321**; **T1337** y **T1338**; **T1346**, **T1347** y **T1348**.

⚠ **T1302 no es `[P]` con nada de su fase**, aunque parezca: toca
`routes/tiendanube.js` **y** `tests/observabilidad.test.js`, y T1303 también toca
el segundo. Se hacen en orden.

### La primera es T1301

No es la más visible, y **es la única que hace que el resto de la fase 1
signifique algo**. Sin ella, alguien mueve `controllers/tiendanube.js` a
`routes/`, corre `aislamientoEmpresas` y lo ve **en verde** — y concluye que el
`create` sin validar era el único y que ya está cerrado. La guardia no lo vio: la
forma corta de ES6 no tiene dos puntos y el extractor de claves los exige.

Es exactamente el modo de falla que este repositorio viene juntando, y es el
motivo por el que existe la sección 2 de «Antes de empezar».

### Lo que estas 48 casillas NO dicen

Las casillas cubren lo que se puede afirmar con un test. **Los cuatro pasos
manuales son otra lista, y las dos se leen juntas o no se leen.** Y hay tres
afirmaciones que ninguna de las dos listas alcanza, escritas acá para que nadie
las dé por cubiertas:

1. **El contrato real de TiendaNube** —la cabecera de la firma, el formato de la
   paginación, la forma del cuerpo del webhook, el cuerpo del `PUT` de stock—. Lo
   contestan P1 y P2, una vez, con una cuenta real.
2. **Que el `setImmediate` del drenaje corra después de que la respuesta salió**
   (T1331). Lo que queda afirmado es el drenaje y que el handler **no** lo espera;
   el momento exacto, no.
3. **Que el hook de `Stock` no degrade el tiempo de una venta** (T1329). Un umbral
   de milisegundos no se puede elegir y sin umbral no puede ponerse en rojo. Lo
   que sí se afirma es **cuántas consultas** agrega, que es igual en cualquier
   máquina.
