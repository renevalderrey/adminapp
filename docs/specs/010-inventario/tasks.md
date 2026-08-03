# Tasks: Inventario — pasada fina

**Input**: documentos de diseño en `docs/specs/010-inventario/`
(`spec.md`, `plan.md`, `data-model.md`, `contracts/api-endpoints.md`)

Cuarenta y siete tareas en once fases. El orden sale de «Orden de construcción»
del plan y de una restricción que el plan escribió como riesgo 1 y que acá manda
sobre el corte: **la migración de `Stock` y los tres caminos que dejarían de
descontar stock van en la misma fase**. Si la migración entra sin ellos, la venta
se registra, el inventario no baja, y no rompe nada visible.

`[P]` marca las que se pueden hacer en paralelo porque tocan archivos distintos.

---

## Antes de empezar: cuatro cosas que no son tareas

### 1. Cómo se verifica, en tres niveles

El plan lo relevó y sigue siendo cierto desde la funcionalidad 009: **no existe
infraestructura para probar una ruta contra Postgres.** Los dobles de
`apps/api/src/tests/helpers/modelosFalsos.js` no entienden `Op`, ni `include`, ni
`lock`. Un test sobre esos dobles para «verificar» la migración probaría el
doble.

| Nivel | Qué cubre | Dónde |
|---|---|---|
| Test unitario, jest/vitest | Lo que se extrae a `utils/` porque es una función pura: el plan de consolidación, la resolución de sucursal, la regla de stock bajo, el lector de importes, el parser de texto pegado, el armador de la hoja y el de la hoja de impresión | `tests/*.test.js` (api) · `utils/*.test.js` (web) |
| Guardia estática | Que no vuelva a aparecer una escritura de stock sin sucursal, ni un hex, ni un `dark:`, ni un `<table>` | `tests/aislamientoEmpresas.test.js`, `tests/fugasDeEmpresa.test.js` (api) · `tests/guardiasDeDiseno.test.js` (web) |
| Paso manual reproducible | Todo lo que solo aparece contra Postgres real: el informe, la migración, el `down`, la venta sin cabecera, el `.xlsx` abierto en Excel | Sección final de este archivo, para `sdd-verify` |

**Ninguna tarea de acá abajo pide un test de integración**, y ninguna llama
«test» a algo que en realidad se mira a mano.

### 2. Lo que ya está y no lleva tarea

- **`server.js:354` ya monta `app.use('/api/stock', ...authEmpresa,
  require('./routes/stock'))`.** `GET /api/stock/sucursales` cuelga de ese router:
  **no hay router nuevo que montar.** Lo que sí hay que saber está en el punto 4.
- **`navegacion.js:31` ya tiene «Inventario»** apuntando a `/inventario` con
  permiso `stock.ver` y módulo `inventario`. **No hay ítem de menú que agregar.**
- **La lista blanca de `PUT /api/products/:id` ya está** (commit `99f1982`):
  `CAMPOS_EDITABLES` en `routes/products.js:24-30`, `camposEditables()` en `:32` y
  el `update` en `:167`, con la guardia en `tests/fugasDeEmpresa.test.js:27-62`.
  La decisión 16 del plan está cumplida. **Lo que falta de esa misma ruta —el
  historial de costos con autor y empresa— es T1022, no una repetición de esto.**
- **`empresa_id` en las escrituras de `Stock` de `productionService` ya está**
  (mismo commit): las cuatro `Stock.findOrCreate` (`:170-175`, `:187-192`) llevan
  `empresa_id` en el `where` **y** en los `defaults`, y
  `validateStockForProduction` (`:73`) ahora recibe `empresaId` y lo exige con
  `assertEmpresaId`. El hallazgo 5 del plan está cumplido. **Lo que falta de ese
  archivo —la resolución de sucursal por la función compartida y el motivo tipado
  del historial de `:212`— es T1016 y T1024.**
- **`docs/PROXIMOS-PROYECTOS.md` ya tiene «5e · La pantalla de Inventario se trae
  el catálogo entero»** (`:171`). **No hay que volver a anotar el defecto 6.** Lo
  que sí falta anotar es el riesgo 5 (sacar `stock_migracion_sucursal`): es T1047.
- **No van gates de superadmin en ningún lado**: la pantalla es para el cliente
  (supuesto 11) y los permisos vigentes alcanzan (supuesto 3). **No se crea
  ningún permiso.**

### 3. La única regla de despliegue de este cambio

**La fase 3 se despliega entera o no se despliega.** Entre T1007 (la migración
aplica `NOT NULL`) y T1010 (TiendaNube resuelve la sucursal), una venta sin
cabecera `X-Punto-De-Venta-Id` **se registra y no descuenta stock**: la consulta
pasa a ser `WHERE punto_de_venta_id IS NULL`, que después de la migración no
matchea ninguna fila jamás. Lo único que avisa es la advertencia de
`sales.js:421` en el log. Es el riesgo 1 del plan y el motivo por el que esas
tareas no están en una fase posterior.

### 4. Cuatro dependencias que el plan no vio

Están marcadas ⚠ en la tarea donde pegan. Leerlas antes de empezar la fase que
las contiene.

**(a) La guardia de `fugasDeEmpresa.test.js` deja de morder cuando se refactoriza
`productionService`.** La guardia que escribió el commit `99f1982` mira la
**forma** del ternario que hay hoy: sus expresiones son `/(stockWhere|
finishedWhere)\s*=|^\?\s*\{|^:\s*\{/` filtradas por «tiene `product_id` y no
tiene `empresa_id`», más un `expect(bloques.length).toBe(4)` que cuenta las
`Stock.findOrCreate`. Cuando el ternario `puntoDeVentaId ? … : …` desaparezca
—que es exactamente lo que pide la decisión 8—, esas expresiones van a matchear
**cero líneas** y el `expect([]).toEqual([])` va a pasar **vacío**: la guardia
seguiría verde sin verificar nada. Hay que reescribirla en la misma tarea que el
refactor (T1016). Una guardia que pasa por no encontrar nada que mirar es peor
que no tenerla, porque nadie vuelve a mirarla.

**(b) `general.js` va montado en `/api` antes que `/api/stock`.**
`server.js:342` monta `routes/general.js` en `/api` y `server.js:354` monta
`routes/stock.js` en `/api/stock`. Hoy no colisionan —`general.js` declara
`GET /stock` **exacto** (`:16`) y `PUT /stock/:id` (`:42`), y ninguno matchea
`GET /api/stock/sucursales`—, así que la ruta nueva sale por el router de
`stock.js` como dice el contrato. Pero es una coincidencia, no un diseño: el día
que alguien agregue un `GET /stock/:algo` a `general.js`, se come `/sucursales` y
la tabla se queda sin columnas. Queda como verificación explícita de T1026.

**(c) La migración se parte en dos archivos, y el plan pedía uno.** El plan lista
un solo archivo nuevo (`20260804-identidad-de-sucursal-en-stock.js`, la 14) y
`data-model.md` mete ahí también las dos columnas de `product_cost_history`. **Se
separan**: las columnas del historial son aditivas, nulas y reversibles sin
riesgo; el cambio de `stock` es el punto sin retorno. Atarlas al mismo archivo
significa que el cambio inofensivo no puede desplegarse sin el peligroso, y que
el `down` del peligroso se lleva puesto al inofensivo. Quedan como la **14**
(T1007, stock) y la **15** (T1019, historial de costos), y la 15 puede aplicarse
antes, después o sin la 14.

**(d) El string `'principal'` hardcodeado también está en el navegador.** El plan
nombra el del servidor (`import.js:303`, `data.location || defaultLocation`), que
es la mitad del defecto que corrige FR-050. La otra mitad está en
`services/api.js:299` —`importProducts(file, mapping, defaultLocation =
'principal')`— y en `ImportWizard.jsx:162` —`empresaActiva?.puntosDeVenta?.[0]
?.code || 'principal'`—. En una empresa sembrada por `seedPuntosDeVenta`, cuyos
códigos son `general`/`ortiz`/`mayo`, ese `'principal'` **no coincide con nada**:
es literalmente el caso que el plan usa para explicar cómo nace «una pila anotada
dos veces». Se sacan los tres, en T1013, T1029 y T1042.

---

## Phase 1: Las cuatro funciones puras

**Purpose**: existe el código que decide qué sucursal le toca a una fila de
stock, qué es «stock bajo», cómo se lee un importe argentino y **qué filas se
fusionan con qué valores** — todo testeado, sin que nada del sistema haya
cambiado de comportamiento y sin que se haya tocado un solo dato.

Estas cuatro tareas no cambian nada visible. Existen para que la migración y el
informe corran **el mismo código**, que es la decisión 4 del plan.

- [x] **T1001** [P] Crear `apps/api/src/utils/importes.js` moviendo `aNumero`
      desde `services/comparadorService.js:142`, y dejar en `comparadorService`
      un reexport (`:303`) para no tocar a sus consumidores. Test en
      `apps/api/src/tests/importes.test.js`.
      **Verificación**: los casos que ya cubre `comparador.test.js:75-90` siguen
      pasando **sin cambiarlos** —esa es la prueba de que se movió y no se
      reescribió—, y el test nuevo agrega los que la importación va a necesitar:
      `1.234,50` → `1234.5`, `$1.234,50` → `1234.5`, `1234.50` → `1234.5`,
      `1,234.50` → `1234.5`, celda vacía → `null` y **no** `0`. El último es
      FR-099: una celda de costo vacía que se lee como cero pone en cero el costo
      de un producto y el margen que muestra el POS pasa a ser mentira.

- [x] **T1002** [P] Crear `apps/api/src/utils/stockBajo.js` con
      `UMBRAL_POR_DEFECTO = 3` y `esStockBajo(fila, umbral)` —el `min_stock` de la
      fila si está cargado, si no el umbral—, que es la regla que ya usa
      `GET /api/faltantes` con el `3` literal en `general.js:416`. Test en
      `apps/api/src/tests/stockBajo.test.js`.
      **Verificación**: el test cubre `min_stock` cargado y por encima, cargado y
      por debajo, **en 0** (cae al umbral, que es lo que `GET /api/alerts` **no**
      hace y por eso un producto sin mínimo no alerta nunca), negativo, y
      `quantity` en 0. Un test explícito comprueba que la función **no** hardcodea
      el umbral: llamada con `umbral = 10` tiene que contestar distinto que con
      el 3. Sin ese test, portarla al frontend con el número adentro pasa
      inadvertido y FR-017 queda incumplido sin que nada falle.

- [x] **T1003** [P] Crear `apps/api/src/utils/sucursalDeStock.js` con las tres
      funciones de la decisión 2:
      `resolverSucursal({ empresaId, puntoDeVentaId, code, transaction })`,
      `sucursalPorDefecto(empresaId, { transaction })` y `ubicacionDeStock(pv)`.
      `resolverSucursal` prueba en orden el `punto_de_venta_id` recibido
      —validado contra la empresa con `findScoped`—, el `code` recibido, y el por
      defecto. **Un `code` que no resuelve tira `ErrorDeNegocio`**, no cae al por
      defecto. `sucursalPorDefecto` aplica los **tres** escalones: `code =
      'principal'` → el activo de menor `id` → el de menor `id`, activo o no.
      `ubicacionDeStock` devuelve `{ punto_de_venta_id, location }` con
      `location = (pv.code || pv.name).slice(0, 30)`. Test en
      `apps/api/src/tests/sucursalDeStock.test.js`.
      **Verificación**: el test cubre el orden de resolución completo; que un
      `punto_de_venta_id` **de otra empresa** no resuelva (es la diferencia entre
      validar y confiar); que un `code` inexistente tire `ErrorDeNegocio` **con
      los códigos válidos en el mensaje** (riesgo 3 del plan: una planilla que
      «funcionaba» va a informar 300 errores, y el mensaje es lo único que hace
      eso arreglable); el **tercer escalón** con todos los puntos de venta
      inactivos —que es el caso que FR-044 no cubría y donde justamente hay
      mercadería que rescatar—; y el recorte a 30 caracteres del espejo cuando el
      `code` es nulo y el `name` es largo (riesgo 4: `location` es `VARCHAR(30)`
      y `puntos_de_venta.name` es `VARCHAR(100)`; sin el recorte el `INSERT` de
      una fila de stock falla).

- [x] **T1004** Crear `apps/api/src/utils/consolidacionDeStock.js` con
      `planificar({ filas, puntosDeVenta })` → `{ asignaciones, fusiones, avisos }`.
      **No toca la base**: recibe las filas ya leídas y devuelve qué habría que
      hacer. Agrupa por `(empresa_id, product_id, punto_de_venta_id)`; sobrevive
      la de mayor `quantity` y, a igualdad, la de menor `id`; suma `quantity` y
      `available`, toma el máximo de `min_stock`, **el `expiration_date` más
      próximo de los no nulos**, **el `purchase_date` más antiguo de los no
      nulos**, el `current_batch` de la fila con más cantidad y **los descartados
      a la nota**; y marca `revisar` con las cinco señales de `data-model.md`.
      Test en `apps/api/src/tests/consolidacionDeStock.test.js`.
      **Verificación**: el test cubre, uno por uno, los seis campos de la tabla
      del paso 4 de `data-model.md`; **el vencimiento más próximo y no el de la
      fila mayor** —si la fila de 100 vence en enero y la de 5 el mes que viene,
      quedarse con enero saca esas 5 unidades de la alerta de vencimientos de
      `general.js:360-366`, y ese es el cambio que el plan le pide a FR-045—; el
      determinismo del desempate (mismo `quantity` → gana el `id` menor, dos
      corridas dan lo mismo); las cinco señales de `revisar` por separado y que
      **dos lotes distintos y no nulos NO se marcan**; los lotes descartados
      presentes en la nota; y la **idempotencia** (FR-048): el mismo plan sobre
      filas ya consolidadas devuelve `fusiones: []` y no vuelve a sumar. Esta es
      la tarea de la que dependen las otras dos: **si esta función está mal,
      están mal el informe y la migración, y el informe diría que está todo
      bien.**

**Checkpoint**: `npm run test:api` pasa con cuatro archivos de test nuevos. El
sistema se comporta exactamente igual que antes: no cambió ninguna ruta, ningún
modelo y ninguna fila. Nada de esto se ve todavía desde ningún lado.

---

## Phase 2: El informe, que se corre y se mira antes de decidir

**Purpose**: el usuario puede ver **exactamente qué le va a hacer la migración a
sus datos**, en su base, antes de autorizarla — y sabe cómo leer lo que ve.

Esta fase existe porque una migración que fusiona filas de inventario no se corre
a ciegas. El informe usa la misma función que la migración (T1004), así que es
una vista previa de verdad y no una segunda implementación que dice otra cosa.

- [x] **T1005** Crear `apps/api/scripts/informe-stock-sucursal.js`: lee las filas
      de `stock` y los `puntos_de_venta` de todas las empresas, llama a
      `planificar()` de T1004 e **imprime**. Se agrega
      `"informe:stock": "node scripts/informe-stock-sucursal.js"` a los scripts de
      `apps/api/package.json`, al lado de `backup` y `suscripcion`. El informe
      dice, por empresa: cuántas filas tienen `punto_de_venta_id` nulo, cuántas
      mapean por coincidencia de `code` y cuántas caen al por defecto, qué puntos
      de venta habría que crear, y **la lista de fusiones una por una** —producto,
      sucursal destino, las filas que se fusionan con su `location`, su
      `quantity`, su `current_batch` y su `updated_at`, la cantidad resultante, y
      si está marcada «revisar» con el motivo—. Al pie, los totales y **cuántas
      fusiones quedaron marcadas «revisar»**.
      **Verificación**: el script **no escribe nada**. Se comprueba de las dos
      maneras, porque una sola no alcanza: leyendo el archivo, que no aparezca
      ningún `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `.create(`, `.update(`,
      `.destroy(` ni `transaction`; y corriéndolo dos veces seguidas contra la
      base de desarrollo y comprobando que `SELECT count(*), SUM(quantity) FROM
      stock` da lo mismo antes y después. Correrlo tiene que ser seguro incluso
      si alguien lo ejecuta por error en producción: **es la vista previa, no un
      ensayo.** Si la base de desarrollo no tiene ningún duplicado, el informe lo
      dice con esas palabras en vez de imprimir una lista vacía —«no hay nada que
      fusionar» y «el informe no encontró duplicados» son la misma pantalla y hay
      que poder distinguirlas de «el script no llegó a mirar»—.

- [x] **T1006** Documentar el procedimiento en `docs/OPERACION.md`, en una
      sección propia debajo de «Migraciones pendientes de correr» (`:310`).
      Tres cosas, en este orden: **(1) cómo se corre el informe** —`npm --prefix
      apps/api run informe:stock`, que no escribe nada y se puede correr las veces
      que haga falta—; **(2) cómo se lee** —qué significa cada bloque, que la
      suma de `quantity` por producto tiene que ser la misma antes y después y que
      la migración lo verifica sola y aborta si no da, y que las filas fusionadas
      quedan enteras en `stock_migracion_sucursal`—; **(3) qué hacer si aparecen
      fusiones marcadas «revisar»** — que la marca **no** es un error sino la
      única señal que hay para distinguir «dos pilas» de «una pila anotada dos
      veces»; que se resuelve **contando la mercadería**, no leyendo más el
      informe; que si el recuento dice que la suma infló el inventario, la fila
      original está en `stock_migracion_sucursal` y se corrige con un ajuste de
      stock, no revirtiendo la migración; y que si son muchas, la salida es
      corregir los duplicados a mano **antes** de migrar y volver a correr el
      informe. Sumar también las dos migraciones nuevas a la tabla de
      «Migraciones pendientes de correr» con su columna «Ojo con el histórico», y
      la advertencia del `down`: **restaura lo archivado y pisa cualquier
      movimiento de stock posterior**, así que es para volver atrás minutos
      después de un deploy, no semanas después.
      **Verificación**: quien opera puede correr el informe, entender qué está
      mirando y decidir si autoriza, **sin abrir la spec, el plan ni el código**.
      Esta tarea va acá y no en la fase de documentación del final a propósito: el
      documento es lo que se lee **antes** de autorizar la migración, y escrito
      después sería el instructivo de algo que ya pasó.

**Checkpoint**: **el informe corrió contra la base de desarrollo y se miró fila
por fila, y el procedimiento está escrito.** Hasta acá **no se tocó ni un solo
dato**: todo lo hecho son funciones puras, un script de solo lectura y un
documento. Ésta es la última línea que se puede cruzar hacia atrás sin nada que
revertir.

---

## Phase 3: La identidad de sucursal, de punta a punta

**Purpose**: `punto_de_venta_id` pasa a ser la identidad de la sucursal, ninguna
fila de stock puede existir sin ella, y **los diez sitios que escriben `Stock`
resuelven la sucursal por la misma función**.

Es la fase más grande y es a propósito. **No se despliega a medias** (punto 3 de
«Antes de empezar»): entre T1007 y T1010 hay una ventana en la que una venta sin
cabecera de punto de venta se registra y no descuenta stock.

- [x] **T1007** Crear `apps/api/src/migrations/20260804-identidad-de-sucursal-en-stock.js`
      —la migración **14**— con los ocho pasos de `data-model.md`, **todo dentro de
      una sola transacción** y **sin usar los modelos de Sequelize**
      (`queryInterface.sequelize.query`, decisión 3): paso 0 la foto de control en
      una `TEMP TABLE`; paso 1 crear `stock_migracion_sucursal` y el punto de
      venta `principal` de toda empresa con stock y sin ninguno, registrado con
      `motivo = 'pv_creado'`; pasos 2 y 3 el backfill por `code` exacto y la caída
      al por defecto con los tres escalones, archivando
      `punto_de_venta_id_anterior` y `location_anterior` con
      `motivo = 'reasignada'`; paso 4 la consolidación **según el mismo plan que
      T1004**, copiando cada fila que desaparece entera al `JSONB` con
      `motivo = 'fusionada'`, su `stock_id_sobreviviente`, su marca `revisar` y su
      nota; paso 5 el espejo con `LEFT(COALESCE(pv.code, pv.name), 30)`; paso 6 el
      `NOT NULL` **con la guarda previa que aborta diciendo cuántas filas y de qué
      empresas quedaron sin sucursal**; paso 7 `DROP` del único
      `stock_product_id_location`, alta del único
      `(product_id, punto_de_venta_id)` y la FK a `puntos_de_venta` de
      `ON DELETE SET NULL` a `ON DELETE RESTRICT`; paso 8 la verificación de que
      la suma de `quantity` y `available` por `(empresa_id, product_id)` **es
      idéntica a la foto del paso 0** y que ningún `product_id` quedó sin fila,
      abortando la transacción si no da. Más el `down()` completo de los siete
      pasos en orden inverso, con el encabezado del archivo diciendo qué **no**
      puede hacer.
      **Verificación**: son pasos manuales contra Postgres y están escritos al
      final de este archivo (1 a 5). Los cuatro que no pueden faltar:
      `SELECT count(*) FROM stock WHERE punto_de_venta_id IS NULL` da **0**; la
      suma de `quantity` por producto es la misma antes y después —y esto lo
      chequea la migración sola, así que verificarlo es confirmar que el chequeo
      corrió—; **correrla dos veces y que la segunda no haga nada** (FR-048); y el
      `down` sobre una copia dejando la tabla como estaba. El paso 6 sin la guarda
      previa fallaría con el error de Postgres, que no dice qué revisar: **el
      mensaje es parte de la tarea, no un adorno.**

- [x] **T1008** Actualizar `apps/api/src/models/Stock.js`: `punto_de_venta_id`
      pasa a `allowNull: false`, y la lista de `indexes` pasa a decir lo que la
      base **realmente** tiene después de T1007 —único
      `(product_id, punto_de_venta_id)`, y **fuera** el que declaraba un índice
      que nunca existió—.
      **Verificación**: `npm run test:api` con `asociaciones.test.js` en verde. La
      verificación que importa es de lectura: hoy `Stock.js:66` declara un único
      `(product_id, punto_de_venta_id)` que **la base no tiene** —esa lista solo la
      aplica `sync()`, que este proyecto no usa—, y esa mentira es la que hizo que
      la spec diagnosticara mal el problema (FR-042 dice «no separa por los nulos»
      cuando el motivo real es que no existe). Después de esta tarea, el modelo y
      la base dicen lo mismo. **Va separada de T1007 a propósito**: la migración
      cambia los datos, el modelo cambia lo que el código cree de ellos, y
      confundirlas es cómo se llega a un modelo que describe un esquema que nadie
      aplicó.

- [x] **T1009** ⚠ **Riesgo 1.** En `apps/api/src/routes/sales.js`, hacer que
      `POST /` (`:404-412`) y `PUT /:id/void` (`:530-538`) resuelvan la sucursal
      por `utils/sucursalDeStock.js` en vez de buscar la fila con
      `punto_de_venta_id: req.puntoDeVentaId || null`. En `POST /` la resolución
      es **obligatoria y no opcional**: cabecera → por defecto. En `/void`, la
      cadena es `sale.punto_de_venta_id` → `sale.location` → por defecto, porque
      **esa columna está en `null` en todas las ventas anteriores** y esta
      funcionalidad no la migra (está Fuera de alcance).
      **Verificación**: es paso manual (6 al final) y es **el más importante de
      todos**, porque el fallo no rompe nada visible: vender un producto **sin**
      la cabecera `X-Punto-De-Venta-Id` y comprobar que `stock.quantity` **bajó**;
      anular una venta **vieja** (con `punto_de_venta_id` en `null`) y comprobar
      que la mercadería **volvió**. En el log no tiene que aparecer
      `sales: venta sin fila de stock, no se descuenta` (`sales.js:421`), que es
      la única señal que da hoy este defecto. Sin esta tarea, la migración deja
      un sistema que factura bien y descuadra el inventario en silencio.

- [x] **T1010** ⚠ **Riesgo 1.** En `apps/api/src/services/tiendanubeService.js`
      (`:122-128`), resolver la sucursal por defecto cuando el webhook no trae
      punto de venta —un pedido de la tienda **nunca** trae cabecera—, con la misma
      función.
      **Verificación**: paso manual (6 al final): un pedido de TiendaNube
      descuenta stock después de la migración. Va en tarea aparte de T1009 porque
      es otro archivo y otro camino de entrada, pero **en la misma fase**: es el
      tercero de los tres que dejarían de descontar, y es el que menos se mira
      porque nadie está sentado delante cuando entra un pedido.

- [x] **T1011** En `apps/api/src/routes/general.js`, las tres rutas de stock:
      `POST /stock` (`:103-153`) resuelve la sucursal (cuerpo → cabecera → por
      defecto), **valida `quantity < 0` y `available < 0` con exactamente los
      mismos dos mensajes que ya devuelve `PUT /stock/:id` en `:49` y `:52`**,
      hace el `findOrCreate` con el `punto_de_venta_id` real, escribe `location`
      desde el punto de venta y **no** desde el cuerpo, y manda `available` aunque
      el cliente no lo mande; `POST /stock/bulk` (`:156-183`) pierde la rama que
      busca por `location` (`:166-171`) y usa la misma resolución, aceptando e
      **ignorando** el `location` del cuerpo por compatibilidad; `PUT /stock/:id`
      (`:42-100`) saca `location` de su lista blanca (`:65`) y deja todo lo demás
      igual, incluidos el `StockMovement` y la sincronización de `available`.
      **Verificación**: `curl -X POST /api/stock` con `quantity: -5` devuelve 400
      con «El stock no puede ser negativo» **tanto sobre un producto que ya tenía
      stock en esa sucursal como sobre uno que no** —hoy el segundo caso pasa, y
      es el defecto 4: la misma pantalla, con el mismo campo, validaba o no según
      si la fila ya existía—; un `POST` con `location: "cualquier cosa"` y sin
      `punto_de_venta_id` escribe en el punto de venta por defecto y **no** crea
      una fila con ese texto; un `PUT` con `location` en el cuerpo **no** mueve la
      fila de sucursal (mover mercadería es `POST /stock/transfer`, que es
      transaccional y deja registro; hacerlo cambiando un campo no deja ninguno).

- [x] **T1012** En `apps/api/src/routes/stock.js`, `POST /transfer` (`:10-114`):
      acepta `from_punto_de_venta_id` / `to_punto_de_venta_id` y sigue aceptando
      los `code` por compatibilidad, resolviéndolos a id **antes de tocar nada**;
      un `code` que no resuelve es un `400` y **no** una caída a `location` como
      hoy (`:42-46`); un ítem con `quantity <= 0` o sin `product_id` **falla** en
      vez del `continue` silencioso de `:39`; origen y destino iguales **por id**
      se rechazan; el **destino** inactivo se rechaza y el **origen** inactivo se
      permite (FR-115); y la fila de destino, cuando no existe, se crea **siempre**
      con `punto_de_venta_id` (hoy solo si `toPv` resolvió, `:87`).
      **Verificación**: una transferencia con un ítem en cantidad 0 devuelve 400 y
      **no** queda registrada —hoy se saltea el ítem y puede quedar una
      transferencia **sin ningún ítem**, que es un registro que dice que se movió
      mercadería y no se movió nada—; una transferencia con un ítem sin stock
      suficiente sigue fallando entera con el `ErrorDeNegocio` de siempre y
      **ninguna** fila queda movida; sacar mercadería de una sucursal inactiva
      funciona y meterla no.

- [x] **T1013** En `apps/api/src/routes/import.js` (`:300-311`), la columna
      Sucursal se resuelve contra el `code` **de esa empresa**; si no resuelve, la
      fila se informa como error **con su número de línea y con los códigos
      válidos en el mensaje**, y las demás se importan igual; sin columna, va el
      **punto de venta por defecto** de la empresa y **no** el string
      `'principal'`. `defaultLocation` se sigue aceptando, ahora interpretado como
      `code` de sucursal: se resuelve a id y, si no resuelve, la importación
      entera se rechaza con `400` **antes de escribir nada** —es un parámetro que
      aplica a todas las filas, y descubrirlo en la fila 300 sería tarde—. También
      informar `pisados` cuando el archivo trae el mismo producto (mismo SKU, o
      mismo nombre si no hay SKU) más de una vez, quedándose con **la última**.
      **Verificación**: importar un archivo con una columna de sucursal actualiza
      **el stock que la pantalla muestra** —hoy la importación escribe por
      `location`, la pantalla lee por `punto_de_venta_id`, y el usuario importa 300
      productos, ve los stocks viejos y no se entera de nada: es el criterio de
      éxito 7—; una fila con «Deposito Norte» devuelve
      `{ fila: 14, error: 'La sucursal "Deposito Norte" no existe. Códigos
      válidos: principal, deposito.' }` y las otras 299 entran; un archivo con el
      mismo SKU dos veces devuelve `pisados: 1`. ⚠ El `'principal'` del navegador
      (dependencia **d**) se saca en T1029 y T1042; **este cambio solo no
      alcanza.**

- [x] **T1014** En `apps/api/src/routes/products.js`, `POST /bulk` (`:254-267`):
      la sucursal por `utils/sucursalDeStock.js`, **nunca `null`**, y `p.location`
      pasa a ignorarse.
      **Verificación**: se cae la rama `pvId ? {…punto_de_venta_id} :
      {…location}` de `:258-262` entera; una carga masiva sin cabecera y sin
      `punto_de_venta_id` en los ítems escribe en el por defecto y no crea una fila
      con `location: 'general'` que la pantalla no lee. El historial de costos de
      esta misma ruta es T1022, no acá.

- [x] **T1015** En `apps/api/src/services/purchaseService.js` (`:97-118`), se cae
      la rama por `location` y la sucursal se resuelve por la función compartida.
      **Verificación**: recibir una orden de compra sin cabecera de punto de venta
      escribe la fila en el por defecto; leyendo el diff, no queda ninguna rama
      condicional sobre `location`.

- [x] **T1016** ⚠ **Dependencia (a).** En
      `apps/api/src/services/productionService.js`, los **cinco** puntos:
      `validateStockForProduction` (`:85-88`), las dos `findOrCreate` de la
      producción (`:170-180`, `:187-197`) y las dos de la anulación (`:281-285`,
      `:294-301`). Todos pasan por `utils/sucursalDeStock.js` y **conservan el
      `empresa_id` que ya tienen** en el `where` y en los `defaults` — eso ya está
      corregido (commit `99f1982`) y esta tarea **no lo revierte**, lo mantiene
      mientras desaparece el ternario. **En la misma tarea, reescribir la guardia
      de `apps/api/src/tests/fugasDeEmpresa.test.js:64-104`**, que hoy depende de
      la forma del ternario que este cambio elimina.
      **Verificación**: la guardia reescrita **falla si se le saca el `empresa_id`
      a cualquiera de los cinco puntos** —se comprueba sacándoselo a mano a cada
      uno y viendo el test en rojo, uno por uno—, y **también falla si se le saca
      la resolución de sucursal**. La verificación que no puede faltar es la
      inversa: comprobar que la guardia nueva **no pasa por vacío**, es decir que
      sus expresiones siguen encontrando las cinco escrituras después del
      refactor. Hoy `expect(bloques.length).toBe(4)` cuenta las
      `Stock.findOrCreate`; si el refactor cambia ese número y el test se
      «arregla» ajustando el número sin mirar, la guardia queda contando en vez de
      verificando.

- [x] **T1017** Agregar la guardia de FR-052 a
      `apps/api/src/tests/aislamientoEmpresas.test.js`, con la forma del bloque de
      AFIP que ya está ahí: por cada `Stock.create(` o `Stock.findOrCreate(` en
      `routes/` y `services/`, las 6 líneas siguientes tienen que mencionar
      `punto_de_venta_id`, y **no** puede aparecer `punto_de_venta_id: null` ni
      `punto_de_venta_id: … || null`.
      **Verificación**: la guardia **falla** con las diez escrituras a medio
      migrar —o sea, tiene que estar en rojo hasta que T1009 a T1016 estén las
      ocho hechas, que es la idea— y pasa cuando están todas. Se comprueba al
      revés: volviendo una sola escritura a `punto_de_venta_id: req.puntoDeVentaId
      || null`, el test se pone en rojo y **dice cuál**. Va acotada a los bloques
      de escritura de `Stock` y **no** a todo el código: `StockMovement.
      punto_de_venta_id` sigue siendo nullable a propósito y `sales.js:446` y
      `general.js:85` lo escriben así legítimamente — una guardia que empieza con
      seis excepciones no se lee y termina desactivada.

- [x] **T1018** En `apps/api/src/seedPuntosDeVenta.js`: sacar
      `await mapLocationField(Stock, …)` (`:45`) con un comentario que diga que el
      mapeo de `Stock` lo resuelve la migración 14 y por qué el seeder ya no es su
      dueño; **dejar** los de `Sale`, `ProductionOrder` y `StockTransfer`, que
      siguen sin migrar (Fuera de alcance); y hacer que el `catch` de `:74-76`
      **loguee y relance** en vez de tragarse el error.
      **Verificación**: el arranque sigue funcionando —`apps/api/Dockerfile:44` es
      `node scripts/migrar.js && node src/server.js`, así que la migración corre
      **antes** que el seeder en todos los boots y el `mapLocationField` de
      `Stock` no tendría nada que hacer igual: dejarlo sería una consulta por boot
      cuyo único efecto es sugerirle a quien lea el archivo que el seeder sigue
      mandando sobre el stock—. Y la que importa: **con el `catch` relanzando, un
      error del seeder ahora tumba el arranque**, que es lo buscado (hoy su
      alcance son las 70 líneas enteras: un error mapeando `Sale` deja sin mapear
      `ProductionOrder` y `StockTransfer` y el arranque sigue como si nada). Hay
      que probar que el arranque limpio no tira, porque el precio de equivocarse
      acá es que la API no levanta.

**Checkpoint**: `SELECT count(*) FROM stock WHERE punto_de_venta_id IS NULL` da 0;
la suma de `quantity` por producto es la misma que antes de migrar; una venta sin
cabecera descuenta stock; una importación con columna de sucursal actualiza el
stock que la pantalla lee; un stock negativo se rechaza por las dos puertas; y la
guardia estática falla si alguien vuelve a escribir una fila de stock sin
sucursal. **La arquitectura de `Stock` está cerrada.** La pantalla todavía es la
vieja.

---

## Phase 4: El historial de costos dice quién y de qué empresa

**Purpose**: toda escritura que cambie un costo queda registrada con su autor, su
empresa y un motivo que distingue de dónde vino. Es lo que hace que la pantalla
de la historia 6 sirva **en el caso principal**, que es la lista de precios.

⚠ Esta fase no depende de la 3 (dependencia **c**): la migración 15 es aditiva y
puede aplicarse antes, después o sin la 14.

- [x] **T1019** Crear `apps/api/src/migrations/20260805-historial-de-costos-con-autor.js`
      —la migración **15**, aditiva—: `addColumn('product_cost_history',
      'usuario_id', INTEGER null)`, `addColumn(… 'empresa_id', INTEGER null)`, el
      índice `(empresa_id, change_date)`, y el backfill de `empresa_id` desde
      `products` con el `UPDATE … FROM` de `data-model.md:146-152`. `usuario_id`
      **no se backfillea**: ese dato no existe y no se puede inferir (supuesto 16).
      `down` en orden inverso.
      **Verificación**: `npm --prefix apps/api run db:migrate` corre limpio;
      `SELECT count(*) FROM product_cost_history WHERE empresa_id IS NULL` deja
      solo las filas cuyo producto ya no existe —por eso la columna **no** es
      `NOT NULL`: obligarla sería inventar un valor—; `usuario_id` queda en `NULL`
      en todas las filas viejas; el `down` deja la tabla como estaba. Sin
      `addConstraint`, así que la trampa de `{ model, key }` no aplica.

- [x] **T1020** Actualizar `apps/api/src/models/ProductCostHistory.js` con los dos
      campos (`usuario_id` y `empresa_id`, ambos `allowNull: true`) y el índice
      compuesto, **y registrar las dos asociaciones en
      `apps/api/src/models/index.js`**: `ProductCostHistory.belongsTo(Usuario, {
      foreignKey: 'usuario_id', as: 'usuario' })` y
      `ProductCostHistory.belongsTo(Empresa, { foreignKey: 'empresa_id', as:
      'empresa' })`.
      **Verificación**: `asociaciones.test.js` en verde; el modelo declara
      exactamente las columnas que creó T1019 —si el nombre o el tipo no
      coinciden, Sequelize consulta una columna que no existe y el panel tira en
      runtime, no en build—; y el `include` de `usuario` que va a usar T1025
      resuelve. **La asociación es la parte que se olvida siempre**: sin ella la
      columna existe, se escribe bien, y el endpoint no puede contestar «quién».

- [x] **T1021** Crear `apps/api/src/utils/historialDeCostos.js` con
      `registrarCambioDeCosto({ producto, costoAnterior, costoNuevo, motivo,
      usuarioId, transaction })`, que decide si el cambio es significativo
      (`>= 0.01`, el mismo umbral que ya usa `products.js:171`) y escribe con
      `empresa_id` y autor, más las **siete constantes de motivo** de
      `contracts/api-endpoints.md`. Test en
      `apps/api/src/tests/historialDeCostos.test.js`.
      **Verificación**: el test cubre que un cambio de `1200.00` a `1200.004`
      **no** escribe nada; que uno de `1200.00` a `1200.01` sí; que la fila
      escrita lleva `empresa_id` y `usuario_id`; y que **los cuatro textos que ya
      existen en el histórico guardado no cambiaron** —`Edición manual de costo
      base`, los dos de `preciosService` y el de producción—: reescribirlos haría
      que dos filas del mismo origen se lean distinto según cuándo se grabaron, y
      el usuario que abre el panel no tiene forma de saber que son lo mismo.

- [x] **T1022** En `apps/api/src/routes/products.js`, `PUT /:id` (`:171-178`) y
      `POST /bulk` (`:237-252`) pasan por `registrarCambioDeCosto`, con
      `usuarioId: req.usuario.id` (`middleware/auth.js:89`) y los motivos
      `EDICION_MANUAL` y `CARGA_MASIVA`. `POST /bulk` **hoy no escribe nada**
      (`:239`), que es la mitad del defecto 2.
      **Verificación**: editar un costo a mano deja una fila con autor y empresa;
      una carga masiva que cambia diez costos deja diez filas con motivo `Carga
      masiva de productos` — hoy deja cero. La lista blanca de `:24-30` **no se
      toca**: ya está bien (commit `99f1982`). ⚠ Lo único que hay que mirar de esa
      lista es que tiene `tiendanube_variant_id`, un campo que el contrato
      (`contracts/api-endpoints.md`, `PUT /api/products/:id`) **no enumera**: o se
      agrega al contrato con su motivo, o se saca de la lista. Un campo editable
      que ningún documento menciona es exactamente cómo empezó el problema que la
      lista blanca vino a resolver.

- [x] **T1023** En `apps/api/src/routes/import.js`: registrar el historial con
      motivo `IMPORTACION` y `usuario_id` en cada producto cuyo costo cambia
      (`:288-295`, que hoy no escribe nada), y cambiar el `toNum` de `:252` por
      `aNumero` de `utils/importes.js` (T1001).
      **Verificación**: importar una lista de 200 líneas deja **200 filas de
      historial con su autor** — hoy deja cero, y es el criterio de éxito 9 y el
      motivo por el que la pantalla de la historia 6 quedaría inútil justo en el
      caso principal; y una columna con `1.234,50` se guarda como mil doscientos
      treinta y cuatro con cincuenta y no como mil doscientos treinta y cuatro —
      leerlo al revés convierte $1.234 en $1,234 y **no falla nada**. Lo que
      corrige `import.js:254-259` —una celda de costo vacía **no** pone el costo en
      cero— se conserva intacto (FR-099); el test de T1001 ya fija que `aNumero`
      devuelve `null` y no `0` para la celda vacía.

- [x] **T1024** En `apps/api/src/services/preciosService.js` (`:165` y `:291`),
      `productionService.js` (`:212`) y `costService.js` (`:105`), reemplazar el
      `ProductCostHistory.create` directo por `registrarCambioDeCosto`, con
      `empresa_id`, con el autor donde lo haya y con el motivo tipado
      (`ACTUALIZACION_MASIVA`, `DESHACER_MASIVA`, `ORDEN_DE_PRODUCCION`,
      `RECOSTEO_DE_RECETA`).
      **Verificación**: no queda ningún `ProductCostHistory.create` fuera de
      `utils/historialDeCostos.js` —se comprueba con un `grep` en la revisión, y
      son los cinco de `routes/products.js:173`, `costService.js:105`,
      `preciosService.js:165` y `:291` y `productionService.js:212`—; los cuatro
      textos de motivo siguen siendo los mismos que ya están guardados; y un
      recosteo en cascada se distingue de una edición manual, que es lo que un
      hook `afterUpdate` **no** podría hacer: `recalculateCascadingCosts` actualiza
      costos dentro de la misma transacción y un hook los registraría todos como
      ediciones del usuario que tocó el insumo.

- [x] **T1025** En `apps/api/src/routes/products.js`, `GET /:id/cost-history`
      (`:277`): paginar con `limit` (default 10, tope 100) y `offset`, devolver
      `total`, incluir `usuario` con `{ id, nombre, email }` y ordenar por
      `change_date DESC, id DESC`. Sigue resolviendo el producto con `findScoped`
      antes de leer y sigue devolviendo 404 para el id de otra empresa sin
      distinguir «no existe» de «no es tuyo».
      **Verificación**: el `id DESC` como **segundo** criterio no es un adorno:
      dos cambios de la misma actualización masiva comparten `change_date`, y sin
      un tercer criterio determinístico la paginación repite una fila y se saltea
      otra; se comprueba pidiendo la página 1 y la 2 dos veces sobre un producto
      con veinte cambios de la misma masiva. `usuario` viene en `null` en las
      filas viejas y el `include` es `required: false` —si fuera `required: true`,
      **el historial anterior a esta funcionalidad desaparecería entero**—; el id
      de un producto de otra empresa sigue dando 404 y no 403.

**Checkpoint**: cambiar un costo por los cinco caminos —a mano, masivo, deshacer,
importación y recosteo— deja cinco filas distinguibles por motivo, todas con
`empresa_id` y con autor donde lo hay, y `GET /:id/cost-history` las devuelve
paginadas con el nombre de quien las hizo.

---

## Phase 5: Los contratos que la pantalla necesita

**Purpose**: todo lo que la tabla nueva va a pedir ya se puede pedir con `curl`.
La API queda terminada y la pantalla tiene contra qué hablar.

- [x] **T1026** ⚠ **Dependencia (b).** Agregar `GET /sucursales` a
      `apps/api/src/routes/stock.js` con permiso `stock.ver`, devolviendo
      **todos** los puntos de venta de la empresa —activos e inactivos— como
      `{ id, name, code, is_active }`, activas primero y después por `name`.
      **Verificación**: `curl /api/stock/sucursales` devuelve **también las
      inactivas** —que es lo que hoy no llega al navegador por ningún camino:
      `GET /api/empresas/mi-contexto` filtra con `is_active: true`
      (`empresas.js:195`) y el otro endpoint filtra igual **y** pide
      `sucursales.ver`, un permiso que esta pantalla no exige; sin esto FR-066 y
      FR-115 no se pueden construir—; y **no devuelve 404**, que es la
      verificación que importa: `routes/general.js` va montado en `/api`
      (`server.js:342`) **antes** que `/api/stock` (`:354`), y hoy la ruta sale
      bien solo porque `general.js` declara `GET /stock` **exacto** y no un
      `GET /stock/:algo`. Dejarlo escrito en el comentario de la ruta: el día que
      alguien agregue un parámetro ahí, se come `/sucursales` y la tabla se queda
      sin columnas. **No hay router que montar**: `/api/stock` ya está.

- [x] **T1027** En el mismo archivo, `GET /transfers` (`:117`) agrega
      `fromPuntoDeVenta` y `toPuntoDeVenta` con `{ id, name }`, sin cambiar
      `limit`, `offset` ni el scoping.
      **Verificación**: una transferencia **anterior** a esta funcionalidad puede
      tener los dos ids en `null`; ahí la respuesta trae los objetos en `null` y
      la pantalla cae a `from_location` / `to_location`. No se migran (Fuera de
      alcance), así que el caso hay que devolverlo, no evitarlo.

- [x] **T1028** En `apps/api/src/routes/general.js`: `GET /faltantes` (`:409`)
      pasa a usar `utils/stockBajo.js` en vez del `3` literal de `:416`, y
      `GET /settings` (`:277`) suma `umbral_stock_bajo` como campo **derivado y de
      solo lectura** — escribirlo por `PUT /settings/:key` no tiene efecto.
      **Verificación**: `GET /api/faltantes` devuelve **exactamente los mismos
      productos que antes del cambio** —es un refactor, no un cambio de regla, y
      si el número se mueve es que la función quedó distinta del literal que
      reemplaza—; `GET /api/settings` trae `umbral_stock_bajo: 3`. Queda
      **anotado** que esta ruta pide `config.ver` y no `products.ver`
      (`general.js:277`): no agrega una exigencia nueva porque
      `useStore.initialize()` ya la llama en el mismo `Promise.all` que trae los
      productos (`useStore.js:38-45`), así que hoy sin `config.ver` no carga
      **ninguna** pantalla del store. Es anterior a esta funcionalidad y no se
      resuelve acá.

- [x] **T1029** [P] ⚠ **Dependencia (d).** Actualizar
      `apps/web/src/services/api.js`: sumar
      `getSucursalesDeStock = () => api.get('/stock/sucursales')`; `transferStock`
      (`:273`) documenta que manda `from_punto_de_venta_id` /
      `to_punto_de_venta_id`; `getProductCostHistory` (`:219`) acepta `params`
      (`limit`, `offset`); y **`importProducts` (`:299`) deja de tener
      `defaultLocation = 'principal'` como valor por defecto** — pasa a exigirlo o
      a mandarlo vacío para que el servidor use el por defecto de la empresa.
      **Verificación**: `npm run build` pasa. El `'principal'` que se saca es la
      mitad de un defecto real: en una empresa sembrada por `seedPuntosDeVenta`,
      cuyos códigos son `general`/`ortiz`/`mayo`, ese string **no coincide con
      nada**, y es literalmente el caso con el que el plan explica cómo nace «una
      pila anotada dos veces». Dejar escrito en el comentario de `importProducts`
      que `defaultLocation` ahora es un **`code` de sucursal** y que un valor que
      no resuelve rechaza la importación entera con 400 antes de escribir nada.

- [x] **T1030** [P] En `apps/web/src/store/useStore.js`: `actualizarProducto(producto)`
      y `quitarProducto(id)`, que reemplazan la fila en `products` **sin tocar
      `loading`**, y `sucursales`, cargado desde `getSucursalesDeStock`.
      **Verificación**: `initialize()` se sigue usando para importar y para el
      masivo de precios, donde cambió medio catálogo; lo que **no** se hace es
      llamarlo después de cada guardado, que es lo que hace hoy
      `Inventory.jsx:423`: dispara tres requests, pone `loading: true` global —la
      tabla entera parpadea— y devuelve la lista al estado inicial. FR-035 pide
      explícitamente no perder página, búsqueda, orden ni scroll.

**Checkpoint**: con `curl` se listan las sucursales incluidas las inactivas, el
historial de transferencias trae los nombres, `GET /settings` trae el umbral y el
historial de costos se pide paginado. **La API está terminada.** De acá en
adelante es todo pantalla.

---

## Phase 6: La tabla y la comparación de sucursales

**Purpose**: la pantalla se ve como la maqueta, aplica el patrón que fijó la
funcionalidad 009 sin inventar nada, y **el stock de todas las sucursales se lee
en una sola fila**.

- [x] **T1031** ⚠ **Riesgo 8, y por eso va primero.** Crear vacíos
      `apps/web/src/components/PanelProducto.jsx`,
      `components/PanelTransferencia.jsx` y `components/HistorialDeCostos.jsx`
      (un componente que devuelve `null` y un comentario de qué va a ser), y
      **sumar los tres más `pages/Inventory.jsx` a la lista `ARCHIVOS` de
      `apps/web/src/tests/guardiasDeDiseno.test.js:36-40`**, con el
      `expect(ARCHIVOS).toHaveLength(3)` de `:88` pasando a **7** y el
      `toBeGreaterThan(100)` ajustado a lo que un archivo recién creado puede
      cumplir.
      **Verificación**: la guardia corre sobre los cuatro archivos desde el primer
      commit, así que **cada hex y cada `dark:` falla en el momento en que se
      escribe** y no treinta juntos al final. `Inventory.jsx` hoy usa `<Table>` de
      shadcn (`:306`), así que **la guardia va a estar en rojo hasta T1033**: eso
      es lo buscado y hay que dejarlo dicho en la tarea, porque un test rojo sin
      explicación es un test que alguien comenta. Se comprueba al revés agregando
      un `#fff` a mano a cualquiera de los cuatro y viendo el test fallar
      nombrando el archivo y la línea.

- [x] **T1032** [P] Crear `apps/web/src/utils/stockBajo.js` —la misma regla que
      T1002, **con el umbral por parámetro y nunca hardcodeado**— y su test en
      `apps/web/src/utils/stockBajo.test.js`.
      **Verificación**: el test comprueba que la función **no contiene el número
      3** y que llamada con umbrales distintos contesta distinto; el umbral sale
      de `settings.umbral_stock_bajo` (T1028). FR-017 existe para que Inventario y
      Faltantes digan el mismo número sobre qué falta, y **dos literales iguales
      en dos repositorios empiezan iguales y terminan distintos**. Queda dicho en
      un comentario que `GET /api/alerts` y `dashboardService.js:250` **siguen** con
      la regla vieja (`min_stock > 0`) a propósito: es el riesgo 6 del plan, y por
      eso Inventario va a mostrar más productos en stock bajo que el panel de
      control.

- [x] **T1033** Reescribir la tabla de `apps/web/src/pages/Inventory.jsx` sobre
      `TablaGrid`, `Encabezado`, `Fila` y `BotonDeFila`: `COLUMNAS(n)` y
      `ANCHO_MINIMO(n)` como constantes con el string de la decisión 2 del plan
      —**arrancando en `32px` por la columna de selección**, que la maqueta no
      dibuja porque se dibujó antes de que se liberaran los precios masivos—,
      `gap-x-4` del marco y **no** el `gap: 0 14px` de la maqueta; celdas
      `Producto` (nombre arriba, SKU debajo en `.num` y `fg-3`), `Marca`,
      `Categoría` como chip, `Costo` y `Precio` a la derecha en `.num` con el
      precio saliendo de `calcularPrecios` (`utils/precios.js:98`) y **marcando
      `sinCosto`** en vez de mostrar `$0`; el pie «Mostrando N de M productos» con
      **25 por página**; los **dos** estados vacíos distintos; y la selección para
      `PreciosMasivos` preservada entera con su contrato
      `{ open, onOpenChange, productIds, onAplicado }`.
      **Verificación**: no queda ningún `<table>` ni ningún `Table*` de shadcn ni
      el import de `@/components/ui/table` —la guardia de T1031 pasa a verde acá—;
      el `grid-template-columns` es **el mismo string** en el encabezado y en cada
      fila; un producto sin costo y sin precio manual se marca y no muestra `$0`
      como si fuera un precio; un producto sin marca, sin categoría o sin SKU
      muestra «—» y **no rompe la búsqueda** por esos campos; achicando la ventana
      la tabla scrollea dentro de su tarjeta y el body **no**; y —la que se olvida—
      **la selección y el botón «Actualizar precios» siguen funcionando**: es una
      función liberada el 1/8 y no se pierde por seguir un dibujo que es anterior.

- [x] **T1034** En el mismo archivo, la barra de indicadores y la de filtros: los
      cuatro indicadores en mono —Productos activos, Valor del stock, Stock bajo
      en `warn`, Sin stock en `danger`—, **referidos al resultado filtrado y a la
      sucursal elegida**; búsqueda sobre el catálogo completo que ya está en
      memoria, tolerando acentos y mayúsculas; filtro de categoría armado con
      **los valores que existen** (`Product.category` es texto libre); conmutador
      «Stock bajo» usando `utils/stockBajo.js` con el umbral de `settings`; el
      filtro de producto desactivado (FR-078); y **cualquier cambio vuelve a la
      página 1**.
      **Verificación**: «Colágeno» y «colageno» dan lo mismo; estando en la página
      5, aplicar un filtro cuyo resultado tiene 2 páginas deja la pantalla en la
      **1** y no en una página que no existe; el contador del pie y los cuatro
      indicadores corresponden al resultado **filtrado** y no al catálogo entero;
      un producto desactivado se puede encontrar —hoy `useStore.js:38` pide
      `?active=true` y no hay ningún filtro para lo otro, así que desactivar un
      producto lo hace invisible **para siempre desde la interfaz**—; y con 1.000
      productos cargados, acotar responde en menos de 150 ms.

- [x] **T1035** La comparación de sucursales: **una columna de stock por
      sucursal, siempre presentes, lado a lado**, resueltas por
      `punto_de_venta_id` y **no** por el texto `location`; cada celda un badge con
      la cantidad en mono y el color del nivel (`danger` en cero o negativo, `warn`
      por debajo del mínimo, neutro si está bien); el **mínimo y el valorizado en
      un `Tooltip`** (`components/ui/tooltip.jsx`, ya está) y no apilados en la
      celda; hasta **tres** columnas a la vez y, con más de tres, un selector con
      tres elegidas por defecto; las sucursales inactivas **con stock** presentes y
      marcadas «(inactiva)»; y el selector de sucursal del encabezado de la
      aplicación definiendo el **valor inicial** del filtro, con el filtro de la
      pantalla mandando sobre él.
      **Verificación**: un producto con 12 unidades en una sucursal y 0 en otra
      muestra las dos cantidades **en la misma fila**, sin cambiar de solapa —hoy
      hay pestañas (`Inventory.jsx:220-232`) y comparar dos sucursales exige
      memorizar un número, cambiar de solapa y comparar de memoria—; un producto
      **sin fila de stock** en una sucursal muestra `0` y **no** una celda vacía,
      que es la diferencia entre «hay cero» y «no sé» y para transferir hay que
      saber cuál es; elegir «Todas» con una sucursal activa en la cabecera muestra
      **todas** y `X-Punto-De-Venta-Id` no pisa la elección en silencio; una
      sucursal dada de baja con stock adentro **no desaparece con la mercadería
      adentro**; y después de la migración, ninguna cantidad quedó fuera de una
      sucursal.

**Checkpoint**: la pantalla se ve como el bloque `isInv` de la maqueta
(`AdminApp-Rediseno.dc.html:558-627`), el stock de todas las sucursales se lee en
una fila, los filtros y la paginación andan, y la guardia de diseño está en
verde. Todavía no hay panel, ni transferencia nueva, ni importar pegando, ni
export.

---

## Phase 7: El panel del producto

**Purpose**: se edita un producto mirando la lista, no tapándola — que es la
mitad «diseño» del pedido y la casa de casi todo lo demás.

- [x] **T1036** Crear `apps/web/src/components/PanelProducto.jsx` sobre
      `Sheet` / `SheetContent`, con `w-[520px] max-w-[92vw] shadow-nivel-3
      anim-panel` (el ancho va en `style` por lo que explica
      `PanelVenta.jsx:114-120`), y engancharlo al clic de la fila. Kicker
      «Producto», el nombre como título, `marca · categoría · SKU` de subtítulo;
      **todos** los campos que hoy edita `ProductForm.jsx`, sin perder ninguno; el
      precio resultante calculado **en vivo** con `calcularPrecios` mientras se
      escribe el costo o el margen; una sección de stock con **una fila por
      sucursal**, incluidas aquellas donde el producto no tiene fila; los **dos**
      números cuando `available` difiere de `quantity`, con la diferencia
      explicada; el aviso antes de descartar cambios sin guardar; los campos
      **deshabilitados y no ausentes** sin `products.editar`; y la reactivación de
      un producto desactivado.
      **Verificación**: guardar actualiza la fila y los indicadores con la
      respuesta del `PUT`, **sin recargar y sin perder página, búsqueda, orden ni
      scroll** (usa `actualizarProducto` de T1030); un botón de acción de la fila
      ejecuta su acción y **no** abre el panel además; `Esc` sin cambios cierra sin
      preguntar y con cambios avisa; una cantidad **negativa** se rechaza con
      mensaje **tanto si la fila de stock ya existía como si no** —que es el
      defecto 4 visto desde la pantalla, y funciona porque T1011 lo cerró en las
      dos rutas—; un producto sin ninguna fila de stock muestra las sucursales en
      cero y **deja cargarlas** en vez de aparecer vacío; y
      `prefers-reduced-motion` desactiva `anim-panel`.

- [x] **T1037** ⚠ **Riesgo 9.** Eliminar `apps/web/src/components/ProductForm.jsx`
      (solo lo usa `Inventory.jsx:419`) y mover el **alta** de producto al panel.
      **Verificación**: la que importa es que el alta cambia de comportamiento y
      no solo de forma: hoy `ProductForm.jsx:194` **no crea ninguna fila de
      stock** —`stockEntries` está vacío al crear—, y el panel sí va a poder,
      así que el alta pasa a escribir en `Stock` por un camino que antes no
      existía. Se verifica creando un producto con cantidad en **dos** sucursales
      y comprobando que quedan **dos** filas, las dos con `punto_de_venta_id`. Es
      lo que pide el escenario 10 de la historia 2, y es la clase de cosa que se
      descubre en producción si nadie la prueba al crear.

- [x] **T1038** Crear `apps/web/src/components/HistorialDeCostos.jsx` como sección
      del panel (historia 6): una fila por cambio con fecha, costo anterior, costo
      nuevo, variación en %, motivo y **autor**, del más reciente al más viejo,
      importes en mono, suba y baja distinguidas por color **y por signo** con los
      tokens de `danger` y `ok`, los últimos diez con «ver más» que pagina contra
      `GET /:id/cost-history` (T1025).
      **Verificación**: la variación en % se calcula con `Number()` y **nunca
      restando strings** —`old_cost` y `new_cost` son `DECIMAL(12,2)` y el driver
      de Postgres los devuelve como string, así que `"1380.00" - "1200.00"`
      funciona por coerción pero `"1380.00" + …` no, y el bug aparece el día que
      alguien sume—; un producto sin ningún cambio **lo dice** en vez de mostrar
      una tabla vacía; un cambio anterior a esta funcionalidad muestra el autor
      **vacío y entendible como dato viejo, no como error**; y los cuatro orígenes
      se distinguen entre sí en el motivo.

**Checkpoint**: se hace clic en un producto, se corrige un costo y un mínimo
mirando el resto de la lista, se ve quién movió el costo y desde cuándo, y al
guardar la fila se actualiza sola.

---

## Phase 8: Transferir stock con una pantalla de verdad

**Purpose**: mover diez productos de una sucursal a otra es **una** operación, no
diez.

- [x] **T1039** Crear `apps/web/src/components/PanelTransferencia.jsx`: panel —no
      modal— con origen, destino y **una lista de productos con cantidad**; el
      stock **en el origen** al lado de cada nombre; una sola llamada a
      `POST /api/stock/transfer` con todos los ítems; el destino **sin** sucursales
      inactivas y el origen **con** ellas; rechazo en pantalla de cantidad cero o
      negativa y de origen igual a destino; y la apertura desde la fila de la
      comparación con **origen, destino y producto precargados**.
      **Verificación**: mover tres productos deja **una** transferencia con tres
      ítems y no tres transferencias —hoy el formulario del `Dialog`
      (`Inventory.jsx:434-482`) mueve un producto por vez—; un ítem sin stock
      suficiente falla la operación **entera** con el mensaje de negocio que ya
      devuelve la API y **ninguna** fila queda movida; al confirmar, las columnas
      de las **dos** sucursales muestran las cantidades nuevas sin recargar; se
      puede sacar mercadería de un local cerrado y no meterla; y sin
      `stock.transferir` no se ve el botón **y la API lo rechaza igual** — la
      pantalla es la cortesía, no la barrera.

- [x] **T1040** El historial de transferencias con el patrón de tabla —fecha,
      origen, destino e ítems— y no como tarjetas dentro de un modal, usando los
      nombres que devuelve T1027.
      **Verificación**: una transferencia **anterior** a esta funcionalidad, con
      los dos `punto_de_venta_id` en `null`, muestra el nombre a partir de
      `from_location` / `to_location` y **no** una fila con dos huecos: no se
      migran, así que el caso hay que mostrarlo.

**Checkpoint**: desde la comparación se ve que a una sucursal le falta lo que a
otra le sobra, se toca transferir, se cargan tres productos y se confirma una
sola operación.

---

## Phase 9: Importar pegando texto

**Purpose**: se pega la lista de precios que llegó por mail o por WhatsApp y se
actualizan los costos sin armar un Excel antes.

- [x] **T1041** Extraer a una función pura el parser del texto pegado, con su
      test: separa filas por salto de línea y columnas por **tabulación, `;` o dos
      o más espacios seguidos**; detecta si la primera fila es un encabezado
      reconocible con los alias que ya usa `ImportWizard.jsx:53-76` o sintetiza
      `Columna 1`, `Columna 2`…; propone `1 = Nombre`, `2 = Costo`, `3 = Stock` y
      **no deduce nada de la magnitud de los valores**; descarta líneas vacías
      **guardando la correspondencia fila-de-matriz → línea original**; y aplica el
      tope de **2.000** antes de armar nada.
      **Verificación**: el test cubre los tres separadores y el separador que
      cambia entre líneas; el encabezado detectado y el no detectado; los importes
      argentinos vía `aNumero`; el mismo producto repetido; el tope de 2.000; y
      —el que da nombre a la tarea— **una lista de productos de menos de $9.999
      importa los costos como costos**: el sistema viejo decidía que la columna 2
      era stock si el máximo era ≤ 9999 y costo si no (`legacy:4738-4746`), así
      que con una lista barata leía **los costos como stock** y dejaba los costos
      en cero sin avisar de nada. Y la traducción del número de línea: el servidor
      informa `fila: i + 2` contando desde el archivo que recibió, y sin la
      correspondencia «error en la línea 14» apunta a otra línea.

- [x] **T1042** ⚠ **Dependencia (d).** En
      `apps/web/src/components/ImportWizard.jsx`, el paso 1 gana un **segundo
      origen**: pegar texto. La matriz resultante se serializa como un **CSV
      canónico** y se sube por `POST /api/import/products` tal como se sube un
      archivo — los pasos 2 y 3 no se enteran y el endpoint no cambia. Además,
      sacar el `|| 'principal'` de `:162` y ofrecer las sucursales reales de la
      empresa; bloquear el botón mientras hay una importación en curso; y
      refrescar el listado al terminar.
      **Verificación**: pegar diez líneas separadas por tabulaciones, mapear y
      confirmar actualiza los diez costos **y deja los diez cambios en el
      historial** (T1023); el paso 2 muestra las columnas sintéticas **con filas
      de ejemplo al lado**; la vista previa dice cuántos se van a **crear** y
      cuántos a **actualizar** y marca cada fila; el resultado dice cuántos se
      crearon, actualizaron, **pisaron** y fallaron; un error de fila apunta a la
      **línea que el usuario pegó** y no a la fila de la matriz; confirmar dos
      veces no dispara dos importaciones; pegar, cerrar sin confirmar y volver a
      abrir **no deja nada del intento anterior**; y sin `products.crear` no se ve
      el botón y la API lo rechaza igual. **No se construye un camino paralelo**:
      el sistema viejo tenía `bulkParseTxt` y `parsePaste` en el mismo archivo,
      con separadores distintos y resultados distintos, y es el error que FR-090
      viene a evitar.

**Checkpoint**: se pega una lista de precios real de 200 líneas, se mapea y se
confirma; los 200 costos quedan actualizados y los 200 cambios aparecen en el
historial con su autor.

---

## Phase 10: Exportar e imprimir

**Purpose**: el listado que se está viendo se baja en `.xlsx` o se imprime, **sin
agregar ninguna dependencia al `package.json`**.

- [x] **T1043** [P] Crear `apps/web/src/utils/exportarInventario.js` con el molde
      de `exportarVentas.js`: `COLUMNAS`, `celda()` con `t`/`z` forzados,
      `armarHoja` y `nombreDelArchivo` con fecha y sucursal. Columnas `Producto ·
      SKU · Marca · Categoría · Costo · Precio · <una por sucursal> · Stock total
      · Valorizado`. Test en `apps/web/src/utils/exportarInventario.test.js`.
      **Verificación**: el test comprueba que el **SKU va como texto** (`t: 's'`,
      `z: '@'`) y que un `0012345` conserva los ceros; que costo, precio,
      cantidades y valorizado van como **número** y no como el texto `1.234,50`;
      y que un producto **sin costo** exporta la celda de precio **vacía y no en
      cero** —cero es un precio y vacío es «no hay»—. **No** se usa
      `XLSX.utils.json_to_sheet` con inferencia, que es lo que hacen
      `Comparador.jsx:114` y `Faltantes.jsx:137`: la inferencia convierte el SKU en
      notación científica y deja la columna de importes sin sumar, y **el archivo
      abre, se ve bien y está mal**.

- [x] **T1044** [P] Crear `apps/web/src/utils/impresionInventario.js`: arma el
      HTML del listado filtrado —encabezado con fecha, sucursal y cantidad de
      productos; totales al pie: productos, sin stock y stock bajo—, lo abre con
      `window.open` y llama a `print()`. Lleva `print-color-adjust: exact` y
      `break-inside: avoid` en cada fila. **Si `window.open` devuelve `null`, la
      función lo devuelve** para que la pantalla pueda avisar. Test en
      `apps/web/src/utils/impresionInventario.test.js`.
      **Verificación**: el test comprueba `print-color-adjust: exact`, los totales
      del pie y —el que importa— **el caso de la ventana bloqueada**:
      `printInvoice.js:94` hace `if (!printWindow) return;`, así que con el
      bloqueador de emergentes activo el usuario aprieta Imprimir y **no pasa
      nada**. Es lo que FR-135 prohíbe y está a punto de copiarse por inercia.
      Este archivo es **el único con hexadecimales permitidos** y por eso vive en
      `utils/` y **fuera** de la lista de `guardiasDeDiseno.test.js`: imprime sobre
      papel blanco, donde los tokens de pantalla no existen.

- [x] **T1045** Enganchar el botón «Exportar» del encabezado de `Inventory.jsx`,
      con Excel e Imprimir adentro, sobre **el resultado filtrado completo** y no
      las 25 filas visibles. Los dos avisos van **antes** de armar nada: cero
      resultados → avisar y **no** descargar un archivo vacío; más de **5.000**
      productos → avisar y pedir acotar. Requiere `products.ver`.
      **Verificación**: la suma de la columna Valorizado del `.xlsx` **coincide
      con el indicador «Valor del stock»** de la pantalla; dos exportaciones con
      filtros distintos no se pisan en la carpeta de descargas; la vista de
      impresión dice lo mismo que la pantalla. Queda **anotado** que el tope de
      5.000 es un límite del archivo y que el techo real es cuántos productos
      entraron en la carga inicial, porque la pantalla se sigue trayendo el
      catálogo entero (riesgo 7, Fuera de alcance, ya anotado en
      `PROXIMOS-PROYECTOS.md:171`).

**Checkpoint**: se filtra por una marca y una sucursal, se exporta, y el `.xlsx`
coincide fila por fila con la pantalla; se imprime y la hoja dice lo mismo, con
sus colores y sin filas cortadas. **La funcionalidad está completa.**

---

## Phase 11: Documentación de cierre

**Purpose**: la próxima pantalla del rediseño encuentra escrito lo que ésta fijó,
y la tabla que quedó de la migración tiene fecha de salida.

- [x] **T1046** [P] Actualizar `docs/REGLAS-DISENO.md`: Inventario como **segunda
      pantalla que aplica el patrón**, con lo que agregó y que las otras cuatro
      van a necesitar —la columna de selección al principio del string, la columna
      variable por sucursal (`COLUMNAS(n)`), el badge de nivel y el `Tooltip` para
      lo que no entra en la celda—.
      **Verificación**: quien vaya a rediseñar POS u Órdenes de compra lee «Tabla»
      y encuentra dos ejemplos, no uno: uno con columnas fijas
      (`InvoicesList.jsx`) y otro con columnas que dependen de los datos
      (`Inventory.jsx`). Sin esto, la tercera pantalla resuelve el ancho variable
      a mano y queda distinta, y **nada lo detectaría porque no hay test visual**.

- [x] **T1047** [P] Anotar en `docs/PROXIMOS-PROYECTOS.md` la salida de
      `stock_migracion_sucursal` (riesgo 5 del plan): se saca en una migración
      posterior de una línea, **cuando el inventario de Comprafit esté cargado y
      verificado**, y hasta entonces es la única salida del riesgo 2 —una fusión
      que infló el inventario—. **No** hay que volver a anotar el defecto 6: ya
      está como «5e · La pantalla de Inventario se trae el catálogo entero»
      (`:171`).
      **Verificación**: la anotación dice **cuándo** se saca y **qué se pierde al
      sacarla**, no solo que hay que sacarla. Una tabla de clutter sin condición de
      salida se queda para siempre; una con condición se puede cerrar.

**Checkpoint**: `npm run test:api`, `npm run test:web` y `npm run build` pasan;
las guardias de aislamiento, de fugas, de observabilidad y de diseño siguen
limpias **sin excepciones nuevas**; y lo que cambió para quien opera está escrito
donde lo va a buscar.

---

## Lo que NO se verifica acá: los pasos manuales de `sdd-verify`

**Esto no son tareas.** Son las verificaciones que solo existen contra Postgres
real y contra Excel real, escritas como pasos reproducibles justamente para no
disfrazarlas de test.

1. **El informe, antes de aplicar.** `npm --prefix apps/api run informe:stock`
   sobre la base de desarrollo, leído fila por fila, con atención a las fusiones
   marcadas «revisar». Es la vista previa de T1005 y **la única oportunidad de
   ver el plan antes de que se ejecute**.
2. **`SELECT count(*) FROM stock WHERE punto_de_venta_id IS NULL` = 0** después
   de la migración (criterio de éxito 5).
3. **`SUM(quantity)` y `SUM(available)` agrupados por `(empresa_id, product_id)`
   antes y después: idénticos.** La migración lo chequea sola y aborta la
   transacción si no da, así que esto es **confirmar que el chequeo corrió**, no
   reemplazarlo.
4. **Correr la migración dos veces** (FR-048) y comprobar que la segunda no hace
   nada y no vuelve a sumar.
5. **El `down` completo sobre una copia**, y que la tabla quede como estaba.
   Recrear el único `(product_id, location)` **falla a propósito** si en el medio
   se crearon duplicados: elegir cuál sobrevive es una decisión de negocio.
6. **Una venta sin cabecera `X-Punto-De-Venta-Id` sigue descontando stock**, y
   un pedido de TiendaNube también (riesgo 1). Es el más importante de todos
   porque **el fallo no rompe nada visible**: la venta se registra igual.
7. **Anular una venta vieja** (con `sale.punto_de_venta_id` en `null`) devuelve
   la mercadería.
8. **El `.xlsx` abierto en Excel**: SKU con los ceros de adelante, sin notación
   científica, y columna Valorizado que **suma** y coincide con el indicador
   «Valor del stock». El test unitario verifica el objeto de hoja que produce
   `xlsx`, no lo que Excel hace con él.
9. **La vista de impresión con el bloqueador de emergentes activo**: avisa qué
   hacer en vez de no pasar nada.
10. **Un recuento físico** de los productos que el informe marcó «revisar», si
    los hubo (riesgo 2). Es lo único que distingue de verdad «dos pilas» de «una
    pila anotada dos veces».

---

## Resumen

| Fase | Tareas | Qué queda funcionando |
|---|---|---|
| 1 · Las cuatro funciones puras | T1001–T1004 (4) | El plan de consolidación, la resolución de sucursal, la regla de stock bajo y el lector de importes, testeados. Nada cambió todavía |
| 2 · El informe | T1005–T1006 (2) | Se ve qué le va a hacer la migración a los datos, y está escrito cómo leerlo. **Sin tocar un dato** |
| 3 · La identidad de sucursal | T1007–T1018 (12) | `punto_de_venta_id` es la identidad, ninguna fila puede existir sin ella, y los diez escritores pasan por la misma función |
| 4 · El historial de costos | T1019–T1025 (7) | Todo cambio de costo dice quién, de qué empresa y de dónde vino |
| 5 · Los contratos de la pantalla | T1026–T1030 (5) | Sucursales inactivas incluidas, transferencias con nombres, umbral expuesto. La API está terminada |
| 6 · La tabla y la comparación | T1031–T1035 (5) | El patrón de 009 aplicado, y el stock de todas las sucursales en una sola fila |
| 7 · El panel del producto | T1036–T1038 (3) | Se edita mirando la lista, con el stock por sucursal y el historial de costos adentro |
| 8 · Transferencias | T1039–T1040 (2) | Diez productos son una transferencia, no diez |
| 9 · Importar pegando texto | T1041–T1042 (2) | La lista de precios que llegó por WhatsApp entra sin armar un Excel |
| 10 · Exportar e imprimir | T1043–T1045 (3) | El listado filtrado en `.xlsx` y en papel, sin agregar ninguna dependencia |
| 11 · Documentación de cierre | T1046–T1047 (2) | La próxima pantalla encuentra el patrón escrito; la tabla de archivo tiene fecha de salida |

**Total: 47 tareas.**

**La primera es T1001**: mover `aNumero` a `utils/importes.js` con su test. Es la
más chica de las cuatro funciones puras y no bloquea a nadie, así que se puede
hacer en paralelo con T1002 y T1003 — pero **T1004 no se puede empezar antes que
las tres**, y el informe no se puede empezar antes que T1004.

**La última tarea segura es T1006**, el procedimiento en `docs/OPERACION.md`.
Hasta ahí todo lo hecho son funciones puras, un script de solo lectura y un
documento: no se tocó ni una fila de ninguna tabla y no hay nada que revertir.
**T1007 es el punto sin retorno**: es donde la migración crea puntos de venta,
reasigna filas, fusiona duplicados y aplica `NOT NULL`. El informe de T1005 se
mira **entre esas dos tareas**, y esa lectura es lo que autoriza a seguir.
