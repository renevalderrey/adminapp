# Tasks: Proveedores y Órdenes de compra — pasada fina

**Input**: documentos de diseño en `docs/specs/012-proveedores-y-ordenes-de-compra/`
(`spec.md`, `plan.md`, `data-model.md`, `contracts/api-endpoints.md`).

Cincuenta y cuatro tareas en quince fases. El orden sale de «Orden de
construcción» del plan —los quince cortes, uno por fase— y de una restricción que
manda sobre el corte: **las fases 1 a 3 son daño irreversible y van primero**, en
cortes propios, commiteables y desplegables **sin nada del rediseño**.

Cada día que dura la reescritura de las dos pantallas, la recepción se aplica a
la orden equivocada con los precios de la orden equivocada. Eso **no se repara
después**: hay que deshacer a mano el stock, el movimiento de deuda y el estado
de dos órdenes, contra un registro que dice que todo salió bien. Y el rediseño
**multiplica el defecto**: la tabla nueva pone «Recibir» en cada fila (FR-007)
donde hoy hay que expandir un acordeón. Entregar el acelerador antes que el
freno no es una preferencia de orden.

`[P]` marca las que se pueden hacer en paralelo porque tocan archivos distintos.

⚠ **Dos pares de `[P]` comparten el archivo de test, no el de código**: T1213 y
T1224 escriben los dos en un archivo llamado `cuentaDeProveedor.test.js` —uno en
`apps/api/src/utils/`, el otro en `apps/web/src/utils/`— y son archivos
distintos, así que no hay conflicto; se dice acá porque el nombre repetido
confunde al buscar. Y T1251/T1252/T1253 tocan tres documentos distintos de
`docs/`.

---

## Antes de empezar: siete cosas que no son tareas

### 1. Cómo se verifica, en cuatro niveles

| Nivel | Qué cubre | Dónde |
|---|---|---|
| Función pura | El saldo, el pendiente de recibir, el saldo acumulado, las filas del archivo, la recepción por línea, los estados de orden y de proveedor, el formato de importes y fechas, la nube de un enlace, el mensaje de un error | `apps/api/src/utils/*.test.js` · `apps/web/src/utils/*.test.js` |
| Test de API con `modelosFalsos` | El comportamiento del endpoint: qué orden se marca, qué status responde, qué **no** devuelve | `apps/api/src/tests/*.test.js` |
| Test de render (jsdom) | El dibujo y el efecto: qué fila lleva qué badge, qué abre un botón, qué llamada sale y con qué cuerpo, qué queda deshabilitado | `apps/web/src/tests/*.test.jsx` |
| Guardia estática | Que no reaparezca un hex, un `dark:`, una clase de la paleta, un `Table*`, un `find()` sobre órdenes en un `onClick`, un include de hijo sin `empresa_id`, un `create` bajo un padre sin validar | `apps/web/src/tests/guardiasDeDiseno.test.js` · `apps/api/src/tests/aislamientoEmpresas.test.js`, `observabilidad.test.js`, `caminosDeCostos.test.js` |
| **Prueba de navegador** | Lo que exige un motor de maquetado: qué scrollea, cuánto mide, si un texto se recorta, si el `<body>` desborda, si dos columnas se solapan | `apps/web/pruebas-de-navegador/*.navegador.js` |
| Paso manual reproducible | Lo que queda: un Postgres de verdad, una planilla de verdad, y lo que hay que mirar | Sección «Los pasos manuales de `sdd-verify`», al final |

**Primero la función pura.** Un test de render que verifica una regla es diez
veces más lento y se pone en rojo cuando alguien mueve un `<div>`. **Y el
navegador es el último recurso**: el listón está en `CONVENCIONES.md` y acá se
respeta —cuatro afirmaciones bajan, y las cuatro miden píxeles.

**Ninguna tarea de acá abajo pide un test de integración**, porque no existe la
infraestructura para escribirlo (proyecto **5c** de `PROXIMOS-PROYECTOS.md`), y
ninguna llama «test» a algo que en realidad se mira a mano.

### 2. Lo que ya está y no lleva tarea

- **El commit `dfd7009` cerró los defectos 1 y 2 del relevamiento** y este hito
  **no los vuelve a tocar**: `POST /:id/payments` ya resuelve el proveedor antes
  de crear, `createOrder` ya tiene `assertEmpresaId`, los `include` de hijos ya
  filtran por `empresa_id`, `getOrders` y `cancelOrder` ya validan la empresa, y
  la guardia `analizarCreates` ya existe. Verificado leyendo el código.
- **No hay modelo nuevo que registrar** en `apps/api/src/models/index.js`.
- **No hay ruta nueva que montar** en `apps/api/src/server.js`: las dos rutas
  nuevas cuelgan de `/api/suppliers`, que ya está montado con `authEmpresa`.
- **No hay ítem de menú que agregar**: `components/navegacion.js:34` y `:36` ya
  declaran los dos, con su `modulo` y su `permission`.
- **No se crea ningún permiso** (supuesto 9). Los nueve alcanzan y
  `ordenes_compra.editar` sigue sin usarse porque sigue sin haber edición de
  órdenes.
- **No van gates de superadmin.** Las dos pantallas son para el cliente y no
  están en la lista de `CONVENCIONES.md`. El gateo es el de módulo, y lo único
  que falta es `RouteGuard` en `/proveedores` (T1232).
- **FR-073 quedó sin objeto.** «Si se decide **no** actualizar el costo, la
  pantalla DEBE avisar cuando el precio difiere»: la decisión 1 de la spec eligió
  actualizar confirmando, así que la rama no existe. **Se cumple por vacuidad y
  no se implementa nada por él.** Queda escrito para que `sdd-verify` no lo
  busque.

### 3. Los tres cortes que se despliegan primero y se pueden desplegar solos

**Fases 1, 2 y 3 son API pura.** Las doce tareas tocan
`apps/api/src/services/purchaseService.js`,
`apps/api/src/routes/suppliers.js`, `apps/api/src/utils/` y sus tests. **Ninguna
toca una línea de dibujo**, y la única que toca la web es el puente de T1219,
que está en la fase 4. Se mergean y se despliegan sin esperar a nada.

Lo que cierran, en orden de daño:

| Fase | Qué deja de pasar |
|---|---|
| 1 | Recibir la orden #118 deja de cargar la #112. Una línea sin producto deja de revertir la transacción entera con un 500. «La orden ya fue recibida completa» deja de llegar como 500. Una recepción de las 21:30 deja de fecharse mañana |
| 2 | Comprar a $1.200 lo costeado a $900 deja de dejar el costo en $900 —y el elaborado que lo usa como insumo deja de quedar costeado con el precio viejo— |
| 3 | Una orden deja de poder guardar el `product_id` de otro cliente. El filtro «Todos» deja de romper el listado en silencio |

### 4. ⚠ La cascada a recetas va en la MISMA tarea que el costo

**T1209 hace las dos cosas y no se parte.** El motivo está en la decisión 2 del
plan y hay que tenerlo a la vista:

| Qué se despliega | Qué pasa |
|---|---|
| El costo sin la cascada | El insumo pasa a $1.200 y el producto elaborado que lo usa **sigue costeado con $900**. El margen que muestra el POS es mentira, que es el defecto 3 corrido un nivel |
| La cascada sin el costo | No hay nada que propagar |
| Las dos juntas | Lo buscado |

Los cinco caminos que cambian un costo llaman después a
`costService.recalculateCascadingCosts`. `productionService.js:263-275` es el
molde exacto. **La spec no lo menciona** y es trabajo real que hay que
presupuestar.

### 5. ⚠ El defecto de la línea está en las DOS pantallas

La spec culpa a `Orders.jsx` (defecto 4) y tiene razón. Pero **la otra pantalla
tiene la mitad del mismo defecto**, verificado leyendo el código:

| Pantalla | Qué está mal | Línea |
|---|---|---|
| `Orders.jsx` | El botón «Confirmar Recepción» hace `selectedSupplier?.orders?.find(o => o.status === 'pending' \|\| o.status === 'partial')`: recibe **la primera pendiente**, no la que se abrió | `:612` |
| `Orders.jsx` | `receiveItems` se indexa por `item.product_id`, y el `key` del `<div>` también | `:595`, `:603-604` |
| `PurchaseOrders.jsx` | `receiveForm` se indexa por `item.product_id`, el `key` también, y `handleReceive` manda `{ product_id, quantity_received }` | `:380`, `:392-393`, `:168-171` |

Una orden con dos líneas del mismo producto tiene **un solo campo** y dos `key`
de React repetidos, en las dos pantallas. Por eso FR-031 **no es una corrección
de `Orders.jsx`**: es del contrato, y por eso T1204 cambia el cuerpo del request
a identidad por posición.

**Ninguna tarea arregla una pantalla y deja la otra.** T1237 cierra
`PurchaseOrders.jsx` y T1240/T1242 cierran `Orders.jsx`; hasta que las dos estén,
la guardia del `find()` (T1231) sigue en rojo y **eso es el mecanismo**, no un
efecto colateral.

### 6. Las tres guardias existentes que este trabajo mueve

Cada una tiene su tarea. **Ajustar el número sin leer lo que cambió es
exactamente cómo una guardia deja de servir**, y por eso cada tarea escribe la
cuenta en el comentario del propio test:

| Guardia | Hoy | Queda | Tarea |
|---|---|---|---|
| `analizarIncludes` en `aislamientoEmpresas.test.js:657` | `toBe(8)` | `toBe(4)` | **T1218** |
| `analizarCreates` en `aislamientoEmpresas.test.js:607` | Ancla en `['routes/suppliers.js', 'services/purchaseService.js']` | Igual, **con el motivo escrito** | **T1223** |
| `guardiasDeDiseno.test.js:149` | `toHaveLength(12)` | `toHaveLength(16)` | **T1231** |

**Bajar un número es tan sospechoso como subirlo.** El comentario de
`analizarIncludes` hoy solo advierte sobre subir; T1218 lo corrige y deja la
cuenta de los cuatro `include` que se van, con archivo y línea de cada uno.

### 7. Las cinco decisiones de la spec que mandan sobre el planteo largo

De la tabla «Lo que faltaba decidir · **resuelto**». Se repiten acá porque el
planteo de abajo de esa tabla enumera opciones descartadas y alguien las puede
leer como abiertas:

1. **El costo se actualiza confirmando, línea por línea** (opción D). No se pisa
   solo: a veces se compra caro por urgencia y eso no tiene que mover los precios
   de venta.
2. **La deuda es la mercadería recibida** (opción B). Una orden emitida y no
   entregada no genera deuda, y «pedido pendiente de recibir» se muestra **al
   lado**, con su etiqueta, porque es el número que Comprafit leía del sistema
   viejo.
3. **El saldo lo calcula el servidor.** El cliente sumando plata es el mismo
   error que el total de una venta calculado por el cliente.
4. **La exportación es xlsx con la forma de la de ventas**: fecha, tipo,
   descripción, debe, haber y saldo. **No es un asiento contable formal.**
5. **Sí se crean órdenes desde la pantalla de Órdenes de compra.** Manda la
   maqueta.

Y una de nombre: **la pantalla sigue llamándose «Órdenes de compra»**, aunque en
Argentina el término suele nombrar lo que manda un cliente. Se conserva porque es
el término del sistema viejo.

---

## Phase 1: La recepción se aplica a la línea que se eligió, y los errores se leen

**Purpose**: recibir la orden #118 marca la #118; una orden con dos líneas del
mismo producto tiene dos líneas; una línea sin producto genera deuda y no
revierte nada; «La orden ya fue recibida completa» llega como 409 con su
mensaje; y la deuda de las 21:30 del 31 de julio se fecha el 31 de julio.

**Es API pura: no depende de ninguna pantalla y no la bloquea.** Es el corte 1
del plan y es donde está el daño irreversible.

- [x] **T1201** [P] Crear `apps/api/src/utils/centavos.js` con `aCentavos`,
      `deCentavos` y `sumaEnCentavos`, moviendo `aCentavos` desde
      `apps/api/src/utils/historialDeCostos.js:104`, que pasa a importarla y
      **borra la suya**. El encabezado dice por qué existe el archivo: FR-050
      pide sumar plata «con la misma disciplina que `esCambioSignificativo`», y
      sin la extracción cada suma nueva escribe su propio `Math.round(n * 100)`
      —dos conversiones a centavos son dos redondeos que se separan—.
      ⚠ **Esta tarea está en la fase 1 y el plan la pone en el corte 4.** El
      motivo del adelanto va escrito en el commit: `utils/recepcionDeOrden.js`
      (T1203) suma importes línea por línea, así que dejarlo para el corte 4
      significa que ese archivo **nace con el duplicado que la extracción existe
      para evitar**. Es la misma tarea, tres cortes antes, y no cambia ningún
      comportamiento.
      **Verificación**: `npm --prefix apps/api test -- centavos historialDeCostos`
      pasa, y `apps/api/src/utils/historialDeCostos.js` **no** contiene
      `Math.round(` en la definición de una conversión propia.
      **El test**: `apps/api/src/utils/centavos.test.js` con
      `it('NO se come el cambio de 1200 a 1200,01')` —`aCentavos(1200.01) -
      aCentavos(1200)` es exactamente `1`, que es el caso que
      `esCambioSignificativo` documenta y que en punto flotante daba
      `0.009999999999999787`—; `it('convierte el DECIMAL que el driver devuelve
      como string')` con `'1234.56'`; `it('null y undefined dan cero y no NaN')`;
      y `it('NO devuelve 1234.5600000000002 al sumar')` sobre un arreglo de
      importes que en punto flotante da ese residuo.
      **Cómo se comprueba que el test sirve**: se reemplaza el cuerpo de
      `aCentavos` por `Math.round(n * 100)` sin el `Number(n) || 0` previo y el
      tercero se pone en rojo con `NaN`; se hace que `sumaEnCentavos` acumule en
      pesos con `+=` y el cuarto se pone en rojo con el residuo a la vista.
      **Y en `historialDeCostos.test.js`**, `it('esCambioSignificativo sigue
      usando la conversión compartida')`: guardia estática, el archivo tiene que
      contener `require('./centavos')` y **no** una definición local de
      `aCentavos`. Se comprueba pegando la función de vuelta y viéndola en rojo.

- [x] **T1202** [P] Mover `hoyDelNegocio` de `apps/api/src/routes/sales.js:57` a
      `apps/api/src/utils/fechas.js`, que ya exporta `fechaDelNegocio` y ya tiene
      el encabezado que explica el defecto. `routes/sales.js` la importa en vez
      de declararla. **No cambia de comportamiento**: sigue leyendo el `timezone`
      de la empresa y sigue cayendo a `America/Argentina/Buenos_Aires`.
      **Por qué sube**: `purchaseService` la necesita en T1206 y dejarla adentro
      de una ruta obliga a repetir la consulta de la empresa. Es la decisión 5
      del plan.
      **Verificación**: `npm --prefix apps/api test -- fechas rutasDeVentas` pasa
      y `npm run test:api` sigue en verde: si `hoyDelNegocio` se rompiera, el
      listado de ventas dejaría de completar el rango.
      **El test**: en `apps/api/src/tests/fechas.test.js`,
      `it('hoyDelNegocio NO devuelve mañana a las 21:30 de Argentina')` —con
      `vi`/`jest.setSystemTime` en `2026-07-31T23:30:00Z` y una empresa con
      `timezone` de Buenos Aires, tiene que dar `'2026-07-31'`—, y
      `it('una empresa sin timezone cae a la zona por defecto y no a UTC')`.
      **Cómo se comprueba que el test sirve**: se reemplaza el cuerpo por
      `new Date().toISOString().split('T')[0]` —o sea, se copia la línea que
      `purchaseService` tiene hoy— y el primero se pone en rojo devolviendo
      `'2026-08-01'`.
      **Y una guardia**: `it('sales.js ya no declara su propia hoyDelNegocio')`,
      que afirma que el archivo contiene `require('../utils/fechas')` y no
      `function hoyDelNegocio`.

- [x] **T1203** Crear `apps/api/src/utils/recepcionDeOrden.js` con
      `aplicarRecepcion(detail, items)` **puro**: recibe el `detail` de la orden
      y los `items` del cuerpo —`{ linea, cantidad }`— y devuelve
      `{ detalle, totalRecibido, estado, lineas, avisos }` sin tocar la base ni
      la transacción. Las reglas, todas del contrato:
      **(1)** la línea se resuelve por **posición**, `detail[item.linea]`, y un
      índice que no existe es un error de cuerpo, no un `continue`;
      **(2)** `cantidad <= 0` se saltea **y lo dice** en `avisos`;
      **(3)** `cantidad > pendiente` se recorta a lo pendiente **y lo dice**, con
      el número que entró de verdad en `lineas[].recibido_ahora` (FR-033);
      **(4)** el estado se decide sobre **todas** las líneas del detalle, no
      sobre las que vinieron —`detail` vacío **no** marca `received`, y una línea
      de cantidad cero tampoco—;
      **(5)** el importe se acumula con `sumaEnCentavos` de T1201.
      Devuelve un `detalle` **nuevo**: la copia profunda que hoy hace
      `purchaseService.js:89` sigue existiendo por el JSONB, y esta función no
      muta lo que recibe.
      **Verificación**: `npm --prefix apps/api test -- recepcionDeOrden`.
      **El test**: `apps/api/src/utils/recepcionDeOrden.test.js` con
      `it('dos líneas del mismo producto son DOS líneas')` —el detalle tiene
      Colágeno en la posición 0 y en la 2; recibir 10 en la 2 deja la 0 en cero—,
      que es **el** test de esta tarea y es el defecto 4 hecho aritmética;
      `it('una cantidad mayor a lo pendiente se recorta y lo dice')` —12 pedidas,
      8 recibidas, se mandan 9: entran 4 y `avisos` nombra el producto—;
      `it('una cantidad cero o negativa se saltea y lo dice')`;
      `it('un detail vacío NO marca la orden como recibida')` —el `.every` sobre
      `[]` da `true` por vacuidad y ese es el caso de borde de la spec—;
      `it('una línea de cantidad cero NO marca la orden como recibida')`;
      `it('una línea sin product_id se recibe igual y suma al importe')`; y
      `it('NO muta el detail que recibe')`.
      **Cómo se comprueba que el test sirve**: se reemplaza `detail[item.linea]`
      por `detail.find(d => d.product_id === item.product_id)` —que es la línea
      de hoy, `purchaseService.js:93`— y el primero se pone en rojo con la
      cantidad en la línea equivocada; se arranca `todoRecibido` en `true` y solo
      se baja adentro del bucle —el bug que ya se corrigió una vez— y el cuarto y
      el quinto se ponen en rojo.

- [x] **T1204** ⚠ **Es el corazón del corte 1.** En
      `apps/api/src/services/purchaseService.js`, `receiveOrder` (`:71-190`) pasa
      a usar `aplicarRecepcion` de T1203 y a resolver la línea por posición. Lo
      que cambia, en orden:
      **(a)** la firma pasa a `receiveOrder(orderId, cuerpo, empresaId)`, con
      `cuerpo = { items, punto_de_venta_id }`; `location` **se ignora** (FR-104,
      y `:114-118` ya documenta que no ubicaba nada).
      **(b)** `resolverSucursal` **sube antes del bucle** (hallazgo 5): hoy está
      adentro del `for` (`:124-128`) y una orden de veinte líneas son veinte
      resoluciones de la misma sucursal con la transacción abierta.
      **(c)** cada línea se clasifica antes de tocar nada, con la tabla de la
      decisión 3: producto de la empresa → stock y deuda; `product_id: null` o
      producto borrado → **deuda sí, stock no**, con su aviso; `product_id` de
      **otra empresa** → **la recepción se rechaza entera** con `ErrorDeNegocio`.
      El producto se resuelve con
      `findScoped(Product, linea.product_id, empresaId, { transaction: t })` y
      **no** con `findByPk`.
      **(d)** validaciones del cuerpo: índice inexistente → `400
      LINEA_INEXISTENTE`; `linea` y `product_id` que no coinciden → `400
      LINEA_INCONSISTENTE`.
      **(e)** **el respaldo transitorio**, y dura **un solo corte**: si el cuerpo
      viene con la forma vieja `{ product_id, quantity_received }`, se acepta
      **solo si la orden no es ambigua** —ninguna línea sin `product_id` y ningún
      `product_id` repetido—; si lo es, `400 LINEA_REQUERIDA` con el nombre del
      producto repetido en el mensaje. **T1239 borra este camino.**
      **(f)** la respuesta pasa a ser la del contrato: `{ id, status, recibido[],
      deuda, avisos[] }`. `deuda` es `null` cuando no entró nada válido (FR-037).
      En `apps/api/src/routes/suppliers.js:33-41`, el handler pasa `req.body`
      entero y devuelve `data` tal cual.
      **Lo que NO cambia y hay que dejar intacto** (FR-038, supuesto 3 de la
      spec): `assertEmpresaId`, la transacción única, el `lock: t.LOCK.UPDATE`
      sobre la fila de `Stock`, la copia profunda del `detail` más el
      `changed('detail', true)`, y `empresa_id` en el `where` **y** en el alta de
      `Stock`. Los tres comentarios que explican esos bugs se conservan.
      **Verificación**: `npm run test:api` pasa, y los pasos manuales **P2** y
      **P3** del final —contra Postgres: dos líneas del mismo producto quedan con
      **dos** `quantity_received` distintos después del commit, y una línea con
      `product_id: null` deja el movimiento de deuda **y** las otras líneas
      cargadas—.
      **El test**: `apps/api/src/tests/recepcionDeOrden.test.js`, con
      `modelosFalsos`:
      `it('recibir la orden #118 NO marca la #112')` —dos órdenes del mismo
      proveedor que comparten producto; se recibe la #118 y la #112 queda en
      `pending` con su detalle en cero—, que es el criterio de éxito 1;
      `it('la deuda usa el unit_price de la orden que se recibió')` —las dos
      órdenes tienen precios distintos y el `SupplierMovement` creado lleva el de
      la #118—;
      `it('una línea sin product_id genera deuda, no toca stock y devuelve su
      aviso')` —hoy esto revierte la transacción entera con un 500 y **no entra
      nada, ni de las otras líneas**—;
      `it('un product_id de otra empresa rechaza la recepción entera')`;
      `it('un índice de línea que no existe responde LINEA_INEXISTENTE y no
      recibe nada')`;
      `it('el cuerpo viejo sobre una orden con dos líneas del mismo producto
      responde LINEA_REQUERIDA y nombra el producto')`; y
      `it('el cuerpo viejo sobre una orden sin ambigüedad todavía funciona')`,
      que es lo que hace que este corte se pueda desplegar con la pantalla vieja
      arriba.
      **Cómo se comprueba que el test sirve**: se vuelve la resolución de línea a
      `detail.find((d) => d.product_id === received.product_id)` —la línea de
      hoy, `:93`— y el primero y el segundo se ponen en rojo; se saca la rama de
      `product_id: null` y el tercero se pone en rojo con el error del
      `Stock.create`; se cambia `findScoped` por `findByPk` y el cuarto.
      ⚠ **Riesgo 1 del plan, y va en el commit**: entre este corte y T1239 un
      navegador con la pantalla abierta desde antes del deploy manda el cuerpo
      viejo. El respaldo lo acepta mientras la orden no sea ambigua y lo rechaza
      con un mensaje legible cuando lo es. **Lo que no se hace**: dejar el
      respaldo para siempre — es el camino ambiguo que este hito viene a cerrar,
      y un camino que nadie usa es un camino que nadie mira cuando cambia.

- [x] **T1205** En `apps/api/src/services/purchaseService.js`, los **cinco**
      `throw new Error(...)` pasan a `ErrorDeNegocio`: «Orden no encontrada»
      (`:80`, `:200`, `:262`) con **404**, y «La orden ya fue recibida completa»
      (`:81`), «La orden está anulada» (`:82`), «No se puede anular una orden ya
      recibida» (`:201`) y «La orden ya está anulada» (`:202`) con **409**. Los
      mensajes no cambian: ya están en castellano y son los únicos que saben el
      contexto.
      **No hace falta tocar ninguna ruta**: `fallo()` ya responde `err.status`
      con el mensaje tal cual cuando `err.publico` es verdadero
      (`utils/errores.js:60-73`), y `ErrorDeNegocio` lo pone en `true`
      (`:43`).
      **Verificación**: `npm --prefix apps/api test -- recepcionDeOrden` pasa con
      los casos nuevos, y `npm run test:api` sigue en verde.
      **El test**: en `apps/api/src/tests/recepcionDeOrden.test.js`,
      `it('recibir una orden ya recibida devuelve 409 con su mensaje, no 500')` y
      `it('recibir una orden anulada devuelve 409 con su mensaje, no 500')`,
      que ejercitan el handler y miran el `status` y el `error` de la respuesta;
      más `it('anular una orden ya recibida devuelve 409 y no 500')`.
      **Cómo se comprueba que el test sirve**: se vuelve cualquiera de los cinco
      a `throw new Error(...)` y su caso se pone en rojo con **500 «Error al
      recibir la orden de compra»**, que es literalmente lo que el usuario ve
      hoy. Es el hallazgo 3 del plan: el caso de borde de la spec —«tiene que
      llegar como mensaje legible y no como 500»— **hoy no se cumple ni siquiera
      con la corrección de la pantalla**.

- [x] **T1206** En `apps/api/src/services/purchaseService.js`, las dos fechas
      calculadas en UTC pasan a `await hoyDelNegocio(empresaId)` (T1202): la
      fecha por defecto de `createOrder` (`:51`) y la del movimiento de deuda de
      `receiveOrder` (`:182`). Las dos son hoy
      `new Date().toISOString().split('T')[0]`, que es exactamente lo que
      `utils/fechas.js` vino a cerrar para las ventas, con el comentario escrito
      en su encabezado.
      **La consecuencia de hoy**: una recepción de las 21:30 del 31 de julio
      genera un movimiento de deuda fechado el **1 de agosto**, que se va al mes
      siguiente del estado de cuenta y del archivo exportado. **No falla nada**,
      y por eso hay que testearlo.
      **Verificación**: `npm --prefix apps/api test -- recepcionDeOrden`.
      **El test**: `it('la deuda de una recepción de las 21:30 NO se fecha
      mañana')` —reloj congelado en `2026-07-31T23:30:00Z`, empresa con la zona
      de Buenos Aires, y el `SupplierMovement` creado tiene que llevar
      `date: '2026-07-31'`—, más el mismo caso para `createOrder`.
      **Cómo se comprueba que el test sirve**: se vuelve la línea a
      `new Date().toISOString().split('T')[0]` y los dos se ponen en rojo con
      `'2026-08-01'`.
      **Alternativa descartada y que no hay que volver a intentar**: que el
      navegador mande la fecha. Es la misma razón por la que `POST /api/sales` no
      la acepta: **la fecha de un asiento la decide el servidor**.

**Checkpoint**: contra Postgres, recibir la segunda orden pendiente de un
proveedor marca la segunda; una orden con dos líneas del mismo producto queda con
dos `quantity_received` distintos; una línea sin producto deja la deuda y no
revierte las otras; y `npm run test:api` pasa. **Este corte se puede mergear,
desplegar y olvidar**: no hay nada de la pantalla adentro, la pantalla vieja
sigue funcionando por el respaldo, y el daño irreversible quedó cerrado.

---

## Phase 2: El costo del producto se actualiza al recibir, y se propaga

**Purpose**: comprar a $1.200 lo costeado a $900 propone el cambio línea por
línea, lo escrito queda en `ProductCostHistory` con su motivo, y el producto
elaborado que usa ese insumo se recostea en el mismo paso.

Es el corte 2 del plan y va separado del 1 **porque es comportamiento nuevo** y
porque es el que toca `Product` y `caminosDeCostos.test.js`.

- [x] **T1207** Dos archivos, un commit. En
      `apps/api/src/utils/historialDeCostos.js`, agregar a `MOTIVOS` (`:60`)
      `RECEPCION_DE_COMPRA: 'Actualización por recepción de compra'` (FR-072). Y
      en `apps/api/src/tests/caminosDeCostos.test.js:299-305`, agregar
      `['services/purchaseService.js', PURCHASE]` a `ARCHIVOS`, con su `leer`
      correspondiente.
      **La guardia entra ANTES de que el servicio escriba un costo**, y es a
      propósito: `caminosDeCostos.test.js:308` prohíbe `ProductCostHistory.create`
      fuera de `utils/historialDeCostos.js`, y `:320` prohíbe
      `reason: '…'` como cadena suelta. Agregarlas después significa descubrir el
      texto libre cuando ya está escrito.
      **Verificación**: `npm --prefix apps/api test -- caminosDeCostos
      historialDeCostos` pasa. Hoy pasa **trivialmente**, porque
      `purchaseService.js` todavía no toca costos: es lo buscado y muerde en
      T1209.
      **El test**: los que ya existen, ampliados a seis archivos, más
      `it('el motivo de la recepción de compra existe en MOTIVOS y no es una
      cadena escrita a mano')` en `historialDeCostos.test.js`.
      **Cómo se comprueba que el test sirve**: se escribe
      `reason: 'Actualización por recepción de compra'` a mano dentro de
      `purchaseService.js` y la guardia de `:320` lo nombra con el archivo. Sin
      ella, el motivo entra como texto libre y el día que alguien quiera contar
      «cuántos costos cambiaron por compras» le alcanza una falta de acento para
      que la mitad de las filas desaparezca del conteo.

- [x] **T1208** En `apps/api/src/services/purchaseService.js`, `getOrderDetail`
      (`:255-275`) enriquece cada línea del detalle con los tres campos del
      contrato: `linea` —la posición en `detail`, **explícita**, para que la
      pantalla no la deduzca del orden del arreglo—, `costo_actual` —el
      `Product.cost` de hoy, resuelto con `findScoped`, `null` si la línea no
      tiene producto o el producto ya no existe— y `propone_costo`
      —`esCambioSignificativo(costo_actual, unit_price)`—.
      **La regla vive acá y no en el navegador** (decisión 2 del plan): poner una
      copia de `esCambioSignificativo` en la web crearía una **cuarta**
      implementación de la comparación de importes —la que su propio comentario
      documenta como la que se comía cambios reales según la magnitud— y una que
      puede **discrepar** con la del servidor: una casilla dibujada que al
      confirmar no hace nada, o una línea sin casilla que sí habría cambiado el
      costo.
      **No se agrega al listado** `GET /api/suppliers/orders`: serían N consultas
      de producto para dibujar una tabla que no muestra costos.
      **Verificación**: `npm --prefix apps/api test -- recepcionDeOrden`.
      **El test**: `it('el detalle dice qué línea es cuál, y no obliga a
      contarlas')` —las tres líneas traen `linea: 0, 1, 2` aunque dos compartan
      `product_id`—; `it('una línea sin producto NO propone costo')`
      —`costo_actual: null`, `propone_costo: false`—;
      `it('un producto sin costo cargado SÍ propone')` —`Product.cost` es `0` por
      defecto y `esCambioSignificativo(0, 1200)` da verdadero—; y
      `it('el costo_actual sale de findScoped y no de findByPk')`, guardia
      estática sobre el archivo.
      **Cómo se comprueba que el test sirve**: se saca `linea` del objeto y el
      primero se pone en rojo; se cambia `findScoped` por `findByPk` y el cuarto.
      El cuarto importa porque un `product_id` de otra empresa en el `detail` de
      una orden vieja —posible, porque FR-062 recién lo impide en T1210— no puede
      terminar mostrando el costo de otro cliente.

- [x] **T1209** ⚠ **La cascada va acá y no en una tarea siguiente (punto 4 de
      «Antes de empezar»).** En
      `apps/api/src/services/purchaseService.js`, `receiveOrder`, dentro de la
      misma transacción y por cada línea con `actualizar_costo: true`:
      **(1)** **vuelve a evaluar** `esCambioSignificativo(product.cost,
      unit_price)` antes de escribir —la casilla del cliente es un pedido, no una
      orden—;
      **(2)** `product.update({ cost: unit_price }, { transaction: t })`;
      **(3)** `registrarCambioDeCosto({ producto, costoAnterior, costoNuevo,
      motivo: MOTIVOS.RECEPCION_DE_COMPRA, usuarioId, transaction: t })`;
      **(4)** **la cascada**: `RecipeItem.findAll({ where: {
      ingredient_product_id } })` y `costService.recalculateCascadingCosts` por
      cada receta dependiente, con el `visited` que corta los ciclos. El molde
      exacto es `productionService.js:263-275` y se copia, no se reinventa.
      La respuesta suma `costos[]` con `{ linea, product_id, costo_anterior,
      costo_nuevo, aplicado, recosteos }`, donde `recosteos` es cuántos
      elaborados se recostearon: está para que **se vea que pasó**.
      **Sin (4), un producto elaborado que use el insumo comprado se queda
      costeado con el precio viejo y el margen que muestra el POS es mentira** —el
      defecto 3 corrido un nivel—. La spec no lo menciona y es trabajo real.
      **Verificación**: `npm --prefix apps/api test -- recepcionDeOrden
      caminosDeCostos` pasa.
      **El test**: `it('recibir más caro NO deja el costo viejo cuando se aceptó
      la propuesta')`; `it('la casilla del cliente NO alcanza: el servidor
      reevalúa el umbral')` —se manda `actualizar_costo: true` con un cambio de
      medio centavo y el costo **no** se toca, y `costos` sale vacío—;
      `it('rechazar la propuesta NO escribe nada en el historial')`;
      `it('el elaborado NO se queda costeado con el insumo viejo')` —una receta
      que usa el insumo comprado, y después de la recepción el costo del
      elaborado cambió y `recosteos` dice 1—; y
      `it('la actualización y el historial van en la MISMA transacción que el
      stock')`, guardia estática: `product.update(` y `registrarCambioDeCosto(`
      tienen que llevar `transaction: t`.
      **Cómo se comprueba que el test sirve**: se saca el bloque de la cascada y
      el cuarto se pone en rojo con el costo viejo del elaborado —**ese es el
      test que da nombre a esta tarea**—; se saca la reevaluación y el segundo se
      pone en rojo escribiendo un cambio de medio centavo; se sacan los
      `transaction: t` y el quinto.
      ⚠ **Riesgo 2 del plan, y hay que decirlo en el commit**: el margen del POS,
      el punto de equilibrio y el precio recomendado del Comparador se calculan
      sobre `Product.cost`. A partir de este corte, recibir mercadería más cara
      los mueve. **Es la consecuencia buscada** —es el defecto 3— pero el dueño
      va a ver bajar un margen sin haber tocado ningún precio. Se documenta en
      T1253. *Lo que no se hace*: dejar la casilla desmarcada por defecto para
      que «no cambie nada» — eso es la opción A con más pasos.
      ⚠ **Riesgo 3**: `recalculateCascadingCosts` es recursiva y corre **dentro
      de la transacción**. Una orden de veinte insumos anidados puede recostear
      decenas de productos con la transacción abierta. Se acepta porque es
      exactamente lo que hace `productionService.recibirOrden` desde siempre,
      sobre el mismo grafo. *Si aparece*: sacarla de la transacción es un cambio
      de una línea y **una decisión propia**, porque deja una ventana donde el
      insumo ya cambió y el elaborado no. Queda anotado en T1252.

**Checkpoint**: recibir una orden con un precio más alto propone el costo, lo
escribe con su motivo si se acepta, y el elaborado que usa ese insumo queda
recosteado. `npm run test:api` pasa y `caminosDeCostos` sigue limpia.

---

## Phase 3: El aislamiento que quedó vivo, y los filtros que rompen en silencio

**Purpose**: una orden no puede guardar el `product_id` de otro cliente, el
nombre del proveedor del listado sale de un `include` acotado a la empresa, y
elegir «Todos» en el filtro deja de romper el listado sin avisar.

Corte 3 del plan: chico, aislado, y son los dos requisitos de aislamiento que
`dfd7009` **no** cerró.

- [x] **T1210** FR-062. En `apps/api/src/services/purchaseService.js`,
      `createOrder` (`:15-59`): antes del `SupplierOrder.create`, validar que
      todo `product_id` del detalle sea de la empresa.

      ```js
      const ids = [...new Set(detalle.map(l => l.product_id).filter(Boolean))];
      const propios = await Product.findAll({ where: { id: ids, empresa_id: empresaId }, attributes: ['id'] });
      if (propios.length !== ids.length) throw new ErrorDeNegocio('…', 400);
      ```

      El mensaje **nombra** los productos que no son de la empresa. **400 y no
      404**: acá el proveedor sí es propio y el error es del cuerpo, no del
      recurso.
      **Qué pasa hoy**: `:40` guarda `item.product_id || null` sin mirar nada, así
      que una empresa puede dejar en su propio `detail` una línea que apunta al
      producto de otro cliente. La consecuencia se ve al recibir: el
      `Stock.findOne` lleva `empresa_id`, así que no encuentra la fila del otro,
      pero el `Stock.create` **crea una fila de stock propia para un producto
      ajeno**.
      ⚠ Este `findAll` con `empresa_id` en el `where` es además lo que el
      detector `analizarCreates` acepta como validación previa
      (`/find(One|All)\(\s*\{[^;]*?empresa_id/`), así que el `SupplierOrder.create`
      de tres líneas más abajo sigue limpio. **No reformatear el `findAll` a
      varias líneas sin volver a correr `aislamientoEmpresas`.**
      **Verificación**: `npm --prefix apps/api test -- aislamientoDeProveedores
      aislamientoEmpresas` pasa.
      **El test**: en `apps/api/src/tests/aislamientoDeProveedores.test.js`,
      `it('NO crea una orden con el producto de otra empresa en el detalle')` —y
      afirma además que **no quedó ninguna `SupplierOrder`**, porque un error que
      llega después del `create` es una orden fantasma—; y
      `it('sigue creando la orden cuando todos los productos son propios')`, que
      es lo que impide que la validación quede fallando siempre.
      **Cómo se comprueba que el test sirve**: se borra el `findAll` previo y el
      primero se pone en rojo con la orden creada.

- [x] **T1211** FR-067. En `apps/api/src/services/purchaseService.js`,
      `getOrders` (`:232-238`): el `include` de `Supplier` gana
      `where: { empresa_id }, required: false`.
      **`required: false` no es decorativo**: Sequelize convierte el include en
      `INNER JOIN` apenas ve un `where`, y sin él las órdenes de un proveedor
      borrado desaparecerían del listado.
      ⚠ **Esto NO mueve el ancla de `analizarIncludes`**: es un `belongsTo`, y el
      detector solo clasifica `HasMany` y `HasOne`. Queda escrito porque es lo
      primero que alguien va a mirar cuando el número de T1218 no cierre.
      **Verificación**: `npm --prefix apps/api test -- aislamientoDeProveedores
      aislamientoEmpresas` pasa, y el ancla de includes **sigue en 8** hasta
      T1218.
      **El test**: `it('el nombre del proveedor del listado sale de un include
      acotado a la empresa')` —guardia estática sobre `purchaseService.js`: el
      bloque del `include` de `getOrders` tiene que contener `empresa_id`—, más
      `it('el listado sigue mostrando órdenes de un proveedor que ya no está')`,
      que es lo que el `required: false` protege.
      **Cómo se comprueba que el test sirve**: se saca el `where` y el primero se
      pone en rojo; se saca el `required: false` y el segundo.

- [x] **T1212** FR-021 y el tope de `limit`. En
      `apps/api/src/routes/suppliers.js`, `GET /orders` (`:13-20`) valida los
      filtros antes de llamar al servicio: `supplier_id` entero positivo,
      `status` uno de los cuatro del `ENUM`, `from` y `to` con forma
      `YYYY-MM-DD`. Lo que falla responde **`400 FILTRO_INVALIDO`**. Y en
      `purchaseService.getOrders` (`:229`), `limit` se recorta a **200** en vez
      de aceptar lo que venga.
      **Qué pasa hoy**: `if (supplier_id) where.supplier_id = supplier_id`
      (`:221`) manda `' '` —un espacio— a una columna `INTEGER`, Postgres
      responde `invalid input syntax for type integer`, y el `catch` de la
      pantalla hace `console.error` (`PurchaseOrders.jsx:134`): **la lista queda
      con lo anterior y sin ningún aviso**. Es el criterio de éxito 7.
      **La corrección de fondo es de la pantalla** (FR-020, T1234): la opción
      «todos» produce la **ausencia** del parámetro y no un valor centinela. El
      servidor valida igual, porque el requisito dice que un valor del tipo
      equivocado no puede subir como 500 **y porque el navegador no es una
      barrera**.
      **Verificación**: `npm --prefix apps/api test -- aislamientoDeProveedores`.
      **El test**: `it('getOrders con supplier_id de un espacio responde 400 y no
      un 500 de Postgres')`; `it('un status inventado responde 400 y no devuelve
      la lista entera')`; `it('una fecha con forma inválida responde 400')`; y
      `it('limit=999999 NO pide la tabla entera')`, que afirma que el `limit` que
      llega al `findAndCountAll` es 200.
      **Cómo se comprueba que el test sirve**: se borra la validación de
      `supplier_id` y el primero se pone en rojo con el error crudo de Postgres;
      se saca el recorte de `limit` y el cuarto.

**Checkpoint**: `npm run test:api` pasa; las guardias de aislamiento y
observabilidad siguen limpias **sin excepciones nuevas**; y los tres cortes de
API que cierran daño irreversible están desplegados. **De acá en adelante empieza
lo que se puede posponer.**

---

## Phase 4: El saldo lo calcula el servidor, con los índices que eso exige

**Purpose**: `GET /api/suppliers` devuelve `deuda`, `pagado`, `saldo` y
`pendiente_de_recibir` ya hechos, en centavos enteros, y deja de traer la
contabilidad entera en cada carga. El historial pagina con su saldo inicial.

Corte 4 del plan. **Es el corte con migración y va solo.**

- [x] **T1213** [P] Crear `apps/api/src/utils/cuentaDeProveedor.js` con cuatro
      funciones **puras**, todas sumando en centavos con `sumaEnCentavos` de
      T1201:
      **`resumenDeCuenta(filasAgregadas)`** → `{ deuda, pagado, saldo }` a partir
      de las filas del `GROUP BY supplier_id, type`, que llegan con `total` como
      **string** (el driver devuelve `DECIMAL` como texto y el `SUM` de Postgres
      también);
      **`pendienteDeRecibir(ordenes)`** → `Σ (quantity − quantity_received) ×
      unit_price` sobre el `detail` JSONB de las órdenes `pending` y `partial`;
      **`conSaldoAcumulado(movimientos, saldoInicial)`** → cada movimiento con su
      `saldo` acumulado, calculado **ascendente** y devuelto **descendente**;
      **`filaDeCuentaParaExport(movimiento, saldo, proveedor)`** → la fila del
      archivo: fecha, tipo, descripción, debe, haber, saldo y cuit.
      **Por qué la agregación va en SQL y la aritmética acá**: el `GROUP BY` no
      lo pueden ejecutar los dobles de `tests/helpers/modelosFalsos.js` —no
      soportan `group`, ni `Op.*`, ni `order`, ni `limit`, y lo dicen en su
      encabezado—, así que una suma escrita adentro del handler **no la alcanza
      ningún test unitario**. Es el mismo corte que hizo `exportVentas.js` y por
      el motivo escrito ahí.
      **Por qué `pendienteDeRecibir` no va en SQL**: es una suma sobre un JSONB.
      En SQL sería un `jsonb_array_elements` que ningún doble entiende y que nadie
      va a leer dos veces; en JS es la misma función pura que hace falta para la
      barra de recepción.
      **Verificación**: `npm --prefix apps/api test -- cuentaDeProveedor`.
      **El test**: `apps/api/src/utils/cuentaDeProveedor.test.js` con
      `it('NO devuelve 1234,5600000000002')` —movimientos que en punto flotante
      dan ese residuo devuelven `1234.56`—, que es el criterio de éxito 8;
      `it('una deuda y un pago que se cancelan exactamente dan cero de verdad')`
      —`0` y no `0.0000000001`, porque de ese cero cuelga el badge «Saldado»—;
      `it('un pago mayor que la deuda da saldo negativo y eso NO es un error')`
      (US6 escenario 6);
      `it('un proveedor sin movimientos da los tres en cero y no NaN')`;
      `it('convierte el DECIMAL que llega como string antes de sumar')`;
      `pendienteDeRecibir` con orden sin ítems, línea de cantidad cero, línea
      totalmente recibida y **orden anulada que no cuenta**;
      `conSaldoAcumulado` en la primera página, en una del medio y sin
      movimientos; y las filas del archivo con un movimiento sin notas.
      **Cómo se comprueba que el test sirve**: se reemplaza `sumaEnCentavos` por
      un `reduce` con `+=` en pesos y el primero y el segundo se ponen en rojo;
      se saca el filtro de estado de `pendienteDeRecibir` y la orden anulada
      empieza a contar; se saca `saldoInicial` de `conSaldoAcumulado` y la página
      del medio arranca en cero, que es exactamente lo que FR-101 prohíbe.

- [x] **T1214** [P] La migración y el modelo, **en el mismo commit**. Crear
      `apps/api/src/migrations/20260808-indices-de-empresa-en-proveedores.js` con
      los cuatro índices compuestos de `data-model.md`
      —`supplier_movements(empresa_id, supplier_id)`,
      `supplier_orders(empresa_id, status)`, `supplier_orders(empresa_id, date)`
      y `supplier_documents(empresa_id, supplier_id)`—, siguiendo el molde de
      `20260807-punto-de-venta-en-cashflow.js`: **SQL crudo, una sola
      transacción, `IF NOT EXISTS` en el `up` e `IF EXISTS` en el `down`**. Y en
      `apps/api/src/models/Supplier.js`, los mismos cuatro en los bloques
      `indexes` de las tres tablas (`:88`, `:136`, `:177`), **cada uno con su
      `name` explícito, idéntico al de la migración**.
      **Por qué las dos mitades van juntas**: el proyecto 0 de
      `PROXIMOS-PROYECTOS.md` cierra con «faltan además tres índices que los
      modelos declaran y las migraciones no crean». Este hito no puede agregar un
      cuarto caso **al revés**: un índice que la migración crea y el modelo no
      declara desaparecería la primera vez que alguien levante una base con
      `sync({ alter: true })`, y nadie lo notaría porque el `SELECT` sigue
      funcionando —solo tarda—.
      **Por qué el `name` explícito**: Sequelize nombra los índices del modelo
      como `<tabla>_<col>_<col>`, no como el `idx_…` de la migración. Sobre una
      base creada por migraciones, `sync({ alter: true })` intentaría crear un
      **segundo** índice con su propio nombre sobre las mismas columnas.
      **Por qué sin `CONCURRENTLY`**: `CREATE INDEX CONCURRENTLY` no puede correr
      dentro de una transacción y las migraciones de este repositorio corren con
      lock (`0264075`). Las tres tablas son chicas —son las compras de un
      negocio, no sus ventas—.
      **Verificación**: los pasos manuales **P4** y **P5** del final: contra una
      base con datos, `npm --prefix apps/api run db:migrate` deja los cuatro
      índices (`\di supplier*`), `npm --prefix apps/api run verificar:esquema`
      pasa, el `down` los borra y el `up` vuelve a correr sin error.
      ⚠ **`verificar:esquema` NO mira índices** —está escrito en su propio
      comentario: hace un `findOne` por modelo, o sea que verifica que la tabla y
      las columnas existan—. Si la migración se olvidara de uno, el chequeo
      pasaría igual. Lo que sí lo detecta es el `EXPLAIN` del paso **P6**.
      **El test**: en `apps/api/src/tests/asociaciones.test.js` —o un archivo
      nuevo `indicesDeProveedores.test.js` si conviene—,
      `it('los cuatro índices del modelo tienen el MISMO nombre que los de la
      migración')`: lee los dos archivos como texto y compara los cuatro
      `idx_…`. Es grosero y es lo que hace falta: el desajuste no lo ve ningún
      test de comportamiento y aparece meses después como una consulta lenta.
      **Cómo se comprueba que el test sirve**: se le saca el `name` a una entrada
      del modelo y el test lo nombra.
      ⚠ **Riesgo 8**: `supplier_movements.type` y `supplier_orders.status` son dos
      de las ocho columnas declaradas `ENUM` en el modelo y creadas `VARCHAR` por
      las migraciones (proyecto 0). **Este hito no las toca**: un índice no
      depende del tipo de la columna y se crea igual sobre las dos formas.
      Aprovechar el viaje para convertirlas exige contemplar los dos estados
      posibles del esquema, y eso es el proyecto 0, no este hito.

- [x] **T1215** En `apps/api/src/routes/suppliers.js`, `GET /` (`:75-101`) se
      reescribe: **tres consultas, ninguna con `include`**, más las funciones de
      T1213.
      **(1)** `Supplier.findAll({ where: { empresa_id } })` con `q` —filtra por
      nombre sin distinguir mayúsculas ni acentos, FR-059—, `page` 1-indexado y
      `limit` por defecto **50**, recortado al rango 1-200 **sin rechazar**.
      **(2)** `SupplierMovement.findAll({ attributes: ['supplier_id', 'type',
      [fn('SUM','amount'),'total'], [fn('COUNT','id'),'n']], where: { empresa_id },
      group: ['supplier_id','type'] })`.
      **(3)** `SupplierOrder.findAll({ attributes: ['supplier_id','detail'],
      where: { empresa_id, status: ['pending','partial'] } })`.
      La respuesta pasa a `{ ok, total, data: [{ …escalares, deuda, pagado,
      saldo, pendiente_de_recibir, movimientos, documentos }] }`.
      **Lo que desaparece: `movements` y `documents`.** Es el hallazgo 7 de la
      spec: con tres años de operación ese par de arreglos es la contabilidad
      entera en cada carga de pantalla, y el único uso que tenían era sumarse para
      mostrar un número.
      ⚠ **Riesgo 5 del plan, ya verificado**: `getSuppliers()` se llama desde
      **exactamente dos lugares**, `Orders.jsx:75` y `PurchaseOrders.jsx:142`.
      Faltantes y Comparador **no** la usan. Lo que hay que hacer con esos dos es
      T1219, y va en esta misma fase.
      **Verificación**: `npm --prefix apps/api test -- cuentaDeProveedor
      aislamientoDeProveedores` pasa, y el paso manual **P1** —contra Postgres, el
      `GROUP BY` devuelve las dos filas por proveedor con `amount` como string y
      el endpoint responde `1234.56`—.
      **El test**: `apps/api/src/tests/cuentaDeProveedor.test.js` con
      `it('el listado NO devuelve los movimientos')` —la respuesta no tiene la
      clave `movements` en ningún proveedor, que es el hallazgo 7 hecho
      afirmación—; `it('devuelve el saldo ya calculado y no el arreglo para
      sumarlo')`; `it('un proveedor sin movimientos sigue apareciendo en el
      listado')` —lo que el `required: false` protegía y que ahora protege el no
      tener `include`—; y `it('q filtra por nombre sin distinguir acentos')`.
      **Cómo se comprueba que el test sirve**: se vuelven a poner los dos
      `include` y el primero se pone en rojo.
      ⚠ **El `GROUP BY` no lo puede probar ningún test unitario** (riesgo 9):
      `modelosFalsos` no soporta `group`. Lo que sí está testeado es la
      aritmética, en T1213, con arreglos planos. Lo que queda sin test automático
      es que la consulta traiga las filas correctas, y eso es el paso manual
      **P1**. *Por qué se acepta*: la alternativa —traer todos los movimientos y
      sumar en JS— es testeable y es exactamente el hallazgo 7.

- [x] **T1216** En `apps/api/src/routes/suppliers.js`, `GET /:id` (`:104-121`):
      **se van los `include` de `orders` y de `movements`**, se queda el de
      `documents` con su `where: { empresa_id }`, y la respuesta gana los cuatro
      números —`deuda`, `pagado`, `saldo`, `pendiente_de_recibir`— calculados por
      **las mismas funciones** que el listado. Ni la lista ni la cuenta pueden
      decir números distintos.
      **`orders` se va** porque salen de `GET /api/suppliers/orders?supplier_id=`,
      que ya existe, ya pagina y ya exige `ordenes_compra.ver`.
      ⚠ **Ese cambio de permiso es buscado y es riesgo 12**: un usuario con
      `proveedores.ver` y sin `ordenes_compra.ver` hoy ve las órdenes del
      proveedor —porque venían en el include, que solo miraba `proveedores.ver`—
      y a partir de acá no. **Es lo que la spec pide** en su caso de borde, pero
      es una función que alguien puede estar usando hoy. La mitigación es de la
      pantalla (T1242): el bloque dice «No tenés permiso para ver las órdenes de
      compra», **no** «Sin órdenes», que son cosas distintas.
      **Verificación**: `npm --prefix apps/api test -- cuentaDeProveedor
      aislamientoDeProveedores` pasa.
      **El test**: `it('la ficha NO devuelve las órdenes ni los movimientos')`;
      `it('el saldo de la ficha es el MISMO número que el de la lista')` —se piden
      los dos y se comparan, que es el criterio 8 del lado del servidor—; y
      `it('los documentos siguen viniendo, y filtrados por empresa')`, que es el
      caso que `aislamientoDeProveedores.test.js:227` ya cubre y que no puede
      dejar de cubrirse.
      **Cómo se comprueba que el test sirve**: se vuelven a poner los dos
      `include` y el primero se pone en rojo; se le saca el `where` al de
      documentos y el tercero.

- [x] **T1217** Crear `GET /api/suppliers/:id/movimientos` en
      `apps/api/src/routes/suppliers.js`, con `proveedores.ver`. Paginado
      —`page`, `limit`, `desde`, `hasta`—, **orden descendente por `date`
      desempatando por `id`**, y con el **`saldo` acumulado ya calculado** por
      `conSaldoAcumulado` de T1213. Devuelve además `saldo_inicial`: el saldo al
      final del período anterior al primer movimiento de **esta** página, que sale
      de un `SUM` sobre los movimientos más viejos que el corte.
      **Sin `saldo_inicial`, el acumulado de la página 2 sería la suma de un
      subconjunto** y la última fila del archivo no coincidiría con el saldo
      grande de la pantalla, que es exactamente lo que FR-101 y el escenario 6 de
      US8 prohíben.
      **`date` es `DATEONLY`**: viaja como `"2026-07-28"` y **la pantalla no lo
      pasa por `new Date()`** (FR-052, T1224).
      ⚠ **Va colgado de `/:id/…` a propósito.** `router.get('/:id')` está en
      `:104` y se come cualquier palabra literal declarada después; un
      `GET /api/suppliers/export` no se podría declarar ahí abajo. Es la misma
      trampa documentada en `routes/sales.js:226-230`, y queda escrita en el
      comentario del endpoint nuevo.
      **Verificación**: `npm --prefix apps/api test -- cuentaDeProveedor`.
      **El test**: `it('la página 2 NO arranca el saldo acumulado en cero')`
      —**es el test de esta tarea**—; `it('devuelve los movimientos del más nuevo
      al más viejo')`; `it('la fecha viaja como texto y no como timestamp')`; y
      `it('un proveedor sin movimientos devuelve 200 con la lista vacía')`.
      **Cómo se comprueba que el test sirve**: se saca `saldo_inicial` del
      cálculo y el primero se pone en rojo.

- [x] **T1218** ⚠ **El ancla de `analizarIncludes`: `toBe(8)` → `toBe(4)`.** En
      `apps/api/src/tests/aislamientoEmpresas.test.js:649-658`, cambiar el número
      **y el título del caso**, y escribir la cuenta en el comentario, con
      archivo y línea de cada uno de los cuatro que se van:

      | Include | Dónde estaba | Por qué se fue |
      |---|---|---|
      | `SupplierMovement as 'movements'` | `suppliers.js:92` (listado) | Los saldos salen del agregado (T1215) |
      | `SupplierDocument as 'documents'` | `suppliers.js:93` (listado) | La lista solo necesita el conteo |
      | `SupplierOrder as 'orders'` | `suppliers.js:111` (detalle) | Salen de `GET /suppliers/orders?supplier_id=` (T1216) |
      | `SupplierMovement as 'movements'` | `suppliers.js:112` (detalle) | Paginan por su propio endpoint (T1217) |

      El de `SupplierDocument` del detalle (`:113`) **se queda**, con su `where`:
      es el único `include` de hijo que sobrevive en el archivo.
      El comentario de hoy dice «si **sube**, hay un include nuevo y hay que
      leerlo, no ajustar el número». **Se corrige para que diga las dos
      direcciones**: bajar es igual de sospechoso y merece la misma lectura. Y
      queda escrito que `SupplierOrder.belongsTo(Supplier)` —el de T1211— **no
      entra en la cuenta**, porque el detector solo clasifica `HasMany` y
      `HasOne`.
      **Verificación**: `npm --prefix apps/api test -- aislamientoEmpresas` pasa,
      y el caso `it.each` por archivo sigue en verde **sin excepciones nuevas**
      (FR-068).
      **El test**: el mismo, con el número nuevo, más
      `it('el detector sigue encontrando el include mal escrito')`, que ya existe
      con sus dos muestras sintéticas y que es lo que impide que el número baje
      porque el detector dejó de reconocer la forma.
      **Cómo se comprueba que el test sirve**: se vuelve a poner uno cualquiera
      de los cuatro `include` en `suppliers.js` y el ancla se pone en rojo con
      `5`. ⚠ **Riesgo 4 del plan**: alguien que vea el diff ve un número más chico
      en un test de aislamiento. La cuenta de arriba va **copiada en el
      comentario del test**; y si el número bajara **más** de cuatro, se sacó un
      include que este plan no nombra.

- [x] **T1219** ⚠ **El puente, y el plan no lo vio.** `GET /api/suppliers` y
      `GET /api/suppliers/:id` cambian de forma en T1215 y T1216, y
      `pages/Orders.jsx` los lee en **cinco** lugares: `calculateBalance`
      (`:93-98`, sobre `s.movements`), el contador de la lista (`:265`), el bloque
      de pedidos (`:329`, `:335`), el historial (`:424`) y los dos usos de
      `selectedSupplier.orders` del diálogo de recepción (`:589`, `:612`). Sin
      esta tarea, entre este corte y T1240 **la pantalla vieja muestra $0 de saldo
      para todos los proveedores, el historial vacío y ningún pedido — en
      silencio**.
      Lo mínimo para que siga diciendo la verdad, en
      `apps/web/src/services/api.js` y `apps/web/src/pages/Orders.jsx`:
      **(a)** `getSuppliers(params)` acepta parámetros y `Orders.jsx` /
      `PurchaseOrders.jsx` la llaman con `{ limit: 200 }` —el nuevo por defecto es
      50 y `PurchaseOrders.jsx:142` la usa para llenar el desplegable de
      proveedores del filtro: una empresa con 60 proveedores perdería 10 opciones
      sin que nada avise—;
      **(b)** `calculateBalance` se borra y la fila lee `s.saldo`; el contador lee
      `s.movimientos`;
      **(c)** la ficha pide los movimientos por `GET /suppliers/:id/movimientos` y
      las órdenes por `getPurchaseOrders({ supplier_id })`.
      **Esto es código con fecha de vencimiento y hay que decirlo**: son unas
      veinte líneas en un archivo que T1240 reescribe entero. Se escribe igual
      porque la alternativa es dejar una pantalla de plata mintiendo durante siete
      cortes, y porque el corte 4 tiene que poder desplegarse solo.
      **Verificación**: `npm --prefix apps/web test -- contratosDeApi` pasa, y a
      ojo: `/proveedores` sigue mostrando el saldo, el historial y los pedidos del
      proveedor seleccionado.
      **El test**: en `apps/web/src/tests/contratosDeApi.test.js`,
      `it('getSuppliers pide más de los 50 por defecto')` —la URL que sale lleva
      `limit`— y `it('la pantalla vieja NO suma movimientos que ya no vienen')`,
      guardia estática sobre `Orders.jsx`: el archivo no puede contener
      `movements.reduce` ni `calculateBalance`.
      **Cómo se comprueba que el test sirve**: se deja `calculateBalance` en el
      archivo y el segundo se pone en rojo.

**Checkpoint**: `/proveedores` y `/ordenes-compra` siguen funcionando con el
contrato nuevo; el saldo de la lista y el de la ficha son el mismo número; los
cuatro índices existen y `verificar:esquema` pasa; y el ancla de includes bajó a
4 **con la cuenta escrita**.

---

## Phase 5: El archivo del contador, el borrado con saldo, y el ancla que no se mueve

**Purpose**: se puede pedir la cuenta corriente de un proveedor como filas listas
para una planilla; eliminar un proveedor con saldo distinto de cero se bloquea
con el número adentro del mensaje; y un pago de importe cero, negativo o `NaN` no
llega a la base.

Corte 5 del plan, más la tercera guardia con ancla.

- [x] **T1220** Crear `GET /api/suppliers/:id/movimientos/export` en
      `apps/api/src/routes/suppliers.js`, con `proveedores.ver` (FR-102). Mismo
      molde que `GET /api/sales/export` (`routes/sales.js:232-290`): **el
      servidor arma las filas con `filaDeCuentaParaExport` de T1213, el navegador
      arma la hoja** (FR-097). Devuelve `{ ok, total, proveedor, saldo_final,
      data }`, **ascendente** —del más viejo al más nuevo, al revés que la
      pantalla y a propósito: un saldo acumulado que crece hacia abajo es como se
      lee una cuenta en una planilla—.
      Reglas: `debe` y `haber` son **números**, no strings (FR-098); `cuit` viaja
      **como string** en cada fila (FR-099); **sin paginar, con tope**
      `LIMITE_EXPORT` como en ventas, y por encima `400 LIMITE_EXPORT_SUPERADO`
      con el total y el límite en el cuerpo para que la pantalla diga qué acotar;
      `saldo_final` sale de **la misma función** que el saldo del listado
      (FR-101); sin movimientos, `data: []`, `total: 0` y **200**.
      **Verificación**: `npm --prefix apps/api test -- cuentaDeProveedor`.
      **El test**: `it('los importes salen como número y no como texto
      formateado')` —**es la trampa de los importes argentinos vista desde el lado
      de la escritura**: si la celda dice `"1.234,50"`, la columna Total no suma y
      el archivo abre, se ve bien y está mal—; `it('el CUIT sale como string')`;
      `it('el saldo final es el MISMO número que el del listado')`;
      `it('un proveedor sin movimientos devuelve 200 con la lista vacía')`; y
      `it('por encima del límite responde 400 con el total y el límite')`.
      **Cómo se comprueba que el test sirve**: se formatea `debe` con
      `toLocaleString` y el primero se pone en rojo; se calcula `saldo_final` con
      un segundo `reduce` en vez de reusar `resumenDeCuenta` y el tercero deja de
      cerrar en el caso del residuo de coma flotante.

- [x] **T1221** [PENDIENTE 10] por defecto. En
      `apps/api/src/routes/suppliers.js`, `DELETE /:id` (`:149-169`) calcula el
      saldo con `resumenDeCuenta` —la misma función, no una segunda suma— y, si
      no es cero, responde `ErrorDeNegocio` con el número adentro: «Nutrifit tiene
      un saldo de $64.000,00. Saldá la cuenta antes de eliminarlo.» Con saldo
      cero, el `DELETE` hace **exactamente** lo que hace hoy.
      **Qué pasa hoy**: se borra la cuenta entera —órdenes, movimientos y
      documentos— con una confirmación genérica. **Es borrar el respaldo de una
      deuda.**
      ⚠⚠ **Las tres líneas de `destroy` NO se reformatean.** Están en la lista de
      excepciones de `observabilidad.test.js:182-191` como **match exacto sobre la
      línea recortada**. El chequeo del saldo va **antes** de ellas. Un cambio de
      espaciado rompe la exención y aparece como un hallazgo de aislamiento que no
      lo es. **FR-068 dice que la lista no puede crecer: no crece.**
      **Verificación**: `npm --prefix apps/api test -- cuentaDeProveedor
      observabilidad` pasa, y la lista de excepciones de `observabilidad.test.js`
      **tiene los mismos tres elementos que antes**.
      **El test**: `it('NO borra un proveedor con saldo distinto de cero')` —400,
      y las cuatro tablas quedan con las mismas filas—;
      `it('el mensaje dice el saldo, para que se sepa cuánto saldar')`;
      `it('con saldo cero sigue borrando las cuatro cosas en una transacción')`; y
      en `observabilidad.test.js`, `it('la lista de excepciones de suppliers.js
      no creció')`, que afirma que tiene exactamente tres entradas.
      **Cómo se comprueba que el test sirve**: se borra el chequeo del saldo y el
      primero se pone en rojo con las tablas vacías; se le agrega un espacio a
      cualquiera de las tres líneas de `destroy` y `observabilidad` la reporta
      como hallazgo — que es justamente el falso positivo que esta advertencia
      existe para evitar.

- [x] **T1222** FR-088, del lado del servidor. En
      `apps/api/src/routes/suppliers.js`, `POST /:id/payments` (`:186-213`)
      valida el importe antes de crear: ausente, `NaN`, cero o negativo →
      **400** «El monto del pago tiene que ser un número mayor que cero». Un
      importe **mayor que el saldo se acepta**: pagar por adelantado es legítimo
      (FR-089), y la confirmación con los dos números es de la pantalla (T1244).
      **Qué pasa hoy**: `Orders.jsx:125` manda `parseFloat(payData.amount)` sin
      validar nada, así que un formulario vacío escribe `NaN` en una columna
      `DECIMAL(14,2)`.
      **La validación va en los dos lados** —navegador y servidor— porque el
      requisito lo dice y **porque el navegador no es una barrera**.
      ⚠ **El `findScoped` previo del proveedor (`:196`) NO se toca**: es el
      arreglo de `dfd7009` y es lo que ancla la guardia `analizarCreates` a este
      archivo. La validación del importe va **después** de él.
      **Verificación**: `npm --prefix apps/api test -- aislamientoDeProveedores
      aislamientoEmpresas` pasa.
      **El test**: en `apps/api/src/tests/cuentaDeProveedor.test.js`,
      `it('un pago sin importe NO escribe NaN en la base')`;
      `it('un pago de cero o negativo se rechaza con un mensaje legible')`; y
      `it('un pago mayor que el saldo SÍ se registra')`, que es el que impide que
      alguien «arregle» esto bloqueando los adelantos.
      **Cómo se comprueba que el test sirve**: se borra la validación y el
      primero se pone en rojo con el movimiento creado.

- [x] **T1223** ⚠ **El ancla de `analizarCreates`, y por qué el `create` del pago
      no se puede mudar.** En `apps/api/src/tests/aislamientoEmpresas.test.js:599-611`,
      el caso «leyó los archivos que dice leer» ancla en
      `expect.arrayContaining(['routes/suppliers.js', 'services/purchaseService.js'])`.
      **Consecuencia concreta que hay que escribir en el comentario**: el
      `SupplierMovement.create` del pago (`suppliers.js:200`) **se queda en
      `routes/suppliers.js`** y **no se muda a un servicio**. Es la clase de
      mudanza que alguien hace «para ordenar» y que pone el ancla en rojo sin que
      se entienda por qué.
      Esta tarea **no cambia el ancla**: agrega el párrafo que dice qué la
      sostiene, cuál es el `create` de cada archivo, y qué hay que hacer el día
      que haya que moverlo —**mover el ancla con él y escribir el motivo ahí
      mismo**, nunca borrarla—.
      **Y agrega el caso que hoy falta**:
      `it('el create del pago sigue viviendo en routes/suppliers.js')`, que
      afirma que `routes/suppliers.js` contiene `SupplierMovement.create(` con un
      `findScoped(Supplier` antes. Sin él, el ancla dice «este archivo tiene
      **algún** create con clave foránea» y eso lo cumpliría cualquier otro.
      **Verificación**: `npm --prefix apps/api test -- aislamientoEmpresas` pasa.
      **El test**: el de arriba, más el que ya existe.
      **Cómo se comprueba que el test sirve**: se mueve el `create` del pago a un
      `services/supplierService.js` nuevo y el caso se pone en rojo **nombrando
      el archivo**, en vez de fallar con un `arrayContaining` que no dice nada.
      **Por qué esto es una tarea y no un comentario suelto**: ajustar un número
      o una lista de anclas sin leer lo que cambió es exactamente cómo una guardia
      deja de servir. Las tres de este hito —ésta, T1218 y T1231— llevan su
      cuenta escrita al lado, y las tres se mueven **en el corte donde el cambio
      ocurre**, nunca al final.

**Checkpoint**: `npm run test:api` y `npm run build` pasan; las guardias de
aislamiento y observabilidad siguen limpias **sin excepciones nuevas**; y la API
entera de este hito está terminada. **De acá en adelante es todo la web.**

---

## Phase 6: Las siete funciones puras de la web, y las dos copias que se juntan

**Purpose**: existe —y está testeado— todo lo que decide **qué estado tiene una
orden, qué porcentaje lleva recibido, en qué segmento entra, qué badge le toca a
un proveedor, cómo se escribe un importe y una fecha, de qué nube es un enlace,
qué dice un error y qué tipo tiene cada celda del archivo**, sin que nada de la
pantalla haya cambiado todavía.

Corte 6 del plan. El criterio fue uno solo: **¿se puede afirmar sin un DOM?**

- [x] **T1224** [P] Crear `apps/web/src/utils/formato.js` con `pesos` y
      `fechaCorta`, movidas desde `apps/web/src/components/PanelVenta.jsx:36` y
      `:48`, que las importa y **borra las suyas**.
      **`pesos` es la única del repositorio que fija los dos extremos** de
      decimales (`minimumFractionDigits: 2` **y** `maximumFractionDigits: 2`). La
      de `PurchaseOrders.jsx:147` no: sin el máximo, el valor por defecto es 3 y
      `1234.567` sale «1.234,567». La spec la da por correcta y **no lo es**
      (hallazgo 7 del plan).
      **`fechaCorta` no pasa por `new Date()`**: `new Date('2026-08-01')` se
      interpreta en UTC y en Argentina muestra el día anterior. FR-052 dice
      literalmente «reutilizando `fechaCorta`», y hoy eso no se puede hacer sin
      copiarla.
      **Verificación**: `npm --prefix apps/web test -- formato historialDeVentas`
      y `npm run build` pasan; `PanelVenta.jsx` sigue en verde en
      `guardiasDeDiseno.test.js`.
      **El test**: `apps/web/src/utils/formato.test.js` con
      `it('un importe entero se ve $1.234,00 y no $1.234')`;
      `it('NO deja tres decimales')` —`1234.567` da `1.234,57`, que es el defecto
      de `PurchaseOrders.jsx:147`—; `it('cero y null dan 0,00 y no NaN')`;
      `it('el primero de mes NO se corre un día')` —`'2026-08-01'` da `01/08/2026`
      y no `31/07/2026`, que es el criterio de éxito 9—; y
      `it('una fecha con forma inválida devuelve el texto y no Invalid Date')`.
      **Cómo se comprueba que el test sirve**: se saca `maximumFractionDigits` y
      el segundo se pone en rojo; se reemplaza el cuerpo de `fechaCorta` por
      `new Date(iso).toLocaleDateString('es-AR')` y el cuarto se pone en rojo con
      el 31/07.
      **Y una guardia**: `it('PanelVenta NO tiene su propia copia de pesos')`,
      sobre el archivo. Sin ella la copia vuelve la próxima vez que alguien
      necesite formatear un importe y no quiera importar nada.

- [x] **T1225** [P] Crear `apps/web/src/utils/ordenDeCompra.js` con `ESTADOS`
      —los cuatro, cada uno con `etiqueta`, `tono`, `recibible` y `anulable`,
      tal cual la decisión 10 del plan—, más `porcentajeRecibido`, `esRecibible`,
      `esAnulable`, `filtrarOrdenes` y `contadoresPorSegmento`.
      **`anulable: true` para `partial`** confirma [PENDIENTE 9]: se puede anular
      una orden parcialmente recibida, la deuda de lo ya recibido **queda viva**,
      y la pantalla lo dice con el número antes de confirmar (T1237). Lo que no
      puede quedar es sin escribir.
      **`porcentajeRecibido` es de unidades, no de importe** ([PENDIENTE 6]), y
      la etiqueta lo dice: es lo que el modelo guarda.
      `filtrarOrdenes` cubre los cuatro segmentos y la búsqueda **por nombre de
      proveedor y por número de orden** (FR-009).
      **Verificación**: `npm --prefix apps/web test -- ordenDeCompra`.
      **El test**: `apps/web/src/utils/ordenDeCompra.test.js` con
      `it('una orden sin ítems NO dice 100% recibida')` —el `.every` sobre `[]`
      da `true` por vacuidad y es el caso de borde de la spec—;
      `it('recibir más de lo pedido NO pasa del 100%')`;
      `it('una orden anulada no es recibible ni anulable')` y las otras tres
      combinaciones; `it('la búsqueda encuentra por número de orden y no solo por
      proveedor')`; y `it('el contador de cada segmento cuenta lo que el segmento
      muestra')`, recorriendo los cuatro y comparando contra el largo de la lista
      filtrada — un contador que no coincide con lo que se ve es peor que no
      tenerlo.
      **Cómo se comprueba que el test sirve**: se hace que `porcentajeRecibido`
      devuelva 100 con `detail` vacío y el primero se pone en rojo; se saca el
      número de orden de la búsqueda y el cuarto; se calcula el contador sobre la
      lista sin filtrar y el quinto.

- [x] **T1226** Crear `apps/web/src/tests/estadosDeOrden.test.js`: el contrato
      entre `ESTADOS` de T1225 y el `ENUM` de
      `apps/api/src/models/Supplier.js:82`, **leyendo el archivo del modelo como
      texto**, igual que hace `tests/mediosDePago.test.js` con `exportVentas.js`.
      **Es grosero y es lo que hace falta**: si mañana el modelo gana un quinto
      estado, la pantalla lo dibujaría como código crudo y nadie lo vería, que es
      exactamente lo que pasó con `tc3`.
      En el mismo commit, `pages/Orders.jsx:44-49` y
      `pages/PurchaseOrders.jsx:51-63` **borran sus copias** de `STATUS_LABELS` y
      `STATUS_VARIANTS` e importan de `utils/ordenDeCompra.js` (FR-107). Son dos
      copias de la misma lista con el mismo riesgo que ya tuvieron los medios de
      pago: se separan y nada avisa. Las dos pantallas siguen siendo las viejas;
      lo único que cambia es de dónde sale la etiqueta.
      **Verificación**: `npm --prefix apps/web test -- estadosDeOrden` y
      `npm run build` pasan.
      **El test**: `it('la lista de la pantalla y el ENUM del modelo no se
      separaron')`, con igualdad de conjuntos **en los dos sentidos** —una clave
      de más en la web es un estado que la base no puede guardar; una de más en el
      modelo es un estado que la pantalla dibujaría crudo—; y
      `it('ninguna de las dos pantallas tiene su propia copia de las
      etiquetas')`, guardia estática: ni `Orders.jsx` ni `PurchaseOrders.jsx`
      pueden contener `STATUS_LABELS = {`.
      **Cómo se comprueba que el test sirve**: se agrega un quinto estado al
      `ENUM` del modelo y el primero se pone en rojo nombrándolo; se pega
      `STATUS_LABELS` de vuelta en cualquiera de las dos pantallas y el segundo.

- [x] **T1227** [P] Crear `apps/web/src/utils/cuentaDeProveedor.js` con
      `estadoDeProveedor({ deuda, pagado, saldo })` —los cuatro de la tabla de la
      spec: Sin movimientos, Saldado, Pago parcial, Con deuda—, `tonoDeProveedor`
      y `ETIQUETAS`.
      **`tonoDeProveedor` copia el molde de `tonoDeStock`
      (`utils/inventario.js:221`), no la función**: devuelve las **tres clases
      juntas** salidas de tokens —`border-…-line bg-…-soft text-…`— porque las
      del stock no son las del saldo (FR-056). **Nunca un color suelto.**
      **Verificación**: `npm --prefix apps/web test -- cuentaDeProveedor`.
      **El test**: `apps/web/src/utils/cuentaDeProveedor.test.js` con las cuatro
      combinaciones de la tabla, más
      `it('un saldo que se compensa exactamente dice Saldado y no Con deuda')`
      —criterio de éxito 8: el badge cuelga de que el cero sea cero de verdad—;
      `it('un saldo negativo por adelanto sigue diciendo Saldado')` (US6 escenario
      6: el proveedor me debe a mí, y eso no es un error); y
      `it('ningún tono sale de un color suelto')`, que recorre los cuatro y
      afirma que ninguno contiene un `-500` ni un `#`.
      **Cómo se comprueba que el test sirve**: se cambia la condición de
      «Saldado» a `saldo === 0` y el caso del saldo negativo se pone en rojo; se
      reemplaza un tono por `text-red-500` y el último.

- [x] **T1228** [P] Crear `apps/web/src/utils/documentosDeProveedor.js` con
      `nubeDelEnlace(url)` —Google Drive, Dropbox, OneDrive, «otro»—,
      `esEnlaceAceptable(url)` y `TIPOS` —factura / remito / presupuesto / otro,
      los del modelo (`models/Supplier.js:163`)—.
      **Favalio no valida los enlaces** (supuesto 6): solo verifica que empiecen
      con `http`, como el legacy. Un enlace roto o privado no se puede saber desde
      acá y está en «Fuera de alcance».
      **Verificación**: `npm --prefix apps/web test -- documentosDeProveedor`.
      **El test**: `it('un enlace sin http NO se acepta')` (FR-082, US7 escenario
      3); `it('un enlace con espacios o vacío tampoco')`;
      `it('reconoce las tres nubes y etiqueta el resto como otro')`; y
      `it('un enlace de una nube desconocida se acepta igual')`, que es el caso de
      borde de la spec y lo que impide que alguien convierta esto en una lista
      blanca.
      **Cómo se comprueba que el test sirve**: se acepta cualquier string no
      vacío y el primero se pone en rojo; se hace que una nube desconocida se
      rechace y el cuarto.

- [x] **T1229** [P] Crear `apps/web/src/utils/exportarProveedores.js` con
      `COLUMNAS`, `armarHoja(filas)` y `nombreDelArchivo({ proveedor, desde,
      hasta })`, copiando el corte de `utils/exportarVentas.js:32,76,115`.
      **Lo que se copia es el corte, no las columnas**: las de una cuenta
      corriente no son las de una venta. Las seis son las de [PENDIENTE 4]:
      fecha, tipo, descripción, debe, haber, saldo.
      `armarHoja` fuerza el tipo **celda por celda**: los importes con `{ t: 'n' }`
      (FR-098) y el CUIT con `{ t: 's', z: '@' }` (FR-099) —once dígitos
      inferidos como número salen en notación científica y pierden dígitos, igual
      que el CAE (`exportarVentas.js:63-65`)—.
      **Verificación**: `npm --prefix apps/web test -- exportarProveedores`.
      **El test**: `apps/web/src/utils/exportarProveedores.test.js` con
      `it('la columna de importes NO sale como texto')` —cada celda de debe,
      haber y saldo tiene `t: 'n'`, que es el criterio de éxito 12 del lado que un
      test puede afirmar—; `it('el CUIT NO se escribe como número')`;
      `it('el nombre del archivo lleva el proveedor y el período')` —para que dos
      exportaciones distintas no se pisen en la carpeta de descargas—; y
      `it('sin movimientos la hoja sale con encabezados y sin filas')` (US8
      escenario 7).
      **Cómo se comprueba que el test sirve**: se escribe el importe con
      `toLocaleString` antes de meterlo en la celda y el primero se pone en rojo.
      ⚠ **Lo que este test NO puede afirmar** es que la columna **sume** al
      abrirla en una planilla de verdad. Eso es el paso manual **P7**, y es lo
      único de la exportación que no baja a un test.

- [x] **T1230** [P] Crear `apps/web/src/utils/erroresDeApi.js` con
      `mensajeDeError(err, generico)`, que lee `err.response?.data?.error`, cae a
      `err.response?.data?.message` y después al genérico.
      **Nunca `err.message`**: en axios eso es «Request failed with status code
      500», que es literalmente lo que el usuario ve hoy en los cuatro
      `toast.error(err.message)` de `Orders.jsx` (`:107`, `:118`, `:133`, `:185`).
      **Alternativa descartada**: mapear los códigos en la pantalla con un
      `switch`, **porque** los mensajes ya están en castellano del lado del
      servidor y son los únicos que saben el contexto —«La orden ya fue recibida
      completa» sabe cuál—.
      **Verificación**: `npm --prefix apps/web test -- erroresDeApi`.
      **El test**: `it('NO le muestra al usuario Request failed with status code
      500')` —**es el test de esta tarea**, y es el criterio de éxito 14—;
      `it('prefiere el error del servidor sobre el message genérico')`;
      `it('un error sin respuesta —la red caída— dice algo legible')`; y
      `it('un error sin nada adentro no devuelve undefined')`.
      **Cómo se comprueba que el test sirve**: se devuelve `err.message` primero
      y el primero se pone en rojo con la frase de axios.

**Checkpoint**: `npm run test:web` pasa con siete archivos de funciones puras
nuevos más el de contrato de estados. **Nada se ve todavía**: las dos pantallas
son las mismas, con la única diferencia de que las etiquetas de estado salen de
un solo lugar y `PanelVenta` importa su `pesos` en vez de declararlo.

---

## Phase 7: Las guardias entran **antes** de escribir las pantallas

**Purpose**: cada hex, cada `dark:`, cada clase de la paleta, cada `Table*` y
cada `find()` sobre órdenes adentro de un `onClick` falla **en el momento en que
se escribe** y no treinta juntos al final, cuando ya nadie sabe cuál vino de
dónde y la salida barata es comentar la guardia.

- [x] **T1231** ⚠⚠ **Esta tarea deja `npm run test:web` EN ROJO a propósito, y
      así se queda hasta T1242.** En
      `apps/web/src/tests/guardiasDeDiseno.test.js`:
      **(a)** entran cuatro archivos a `ARCHIVOS` (`:68-84`) y el
      `toHaveLength(12)` de `:149` pasa a **16**, con el título del caso
      —«los doce archivos existen»— cambiado: `pages/Orders.jsx` y
      `pages/PurchaseOrders.jsx` **antes** de reescribirlas (FR-012, FR-069), y
      `components/PanelOrdenDeCompra.jsx` y `components/BloqueDeDocumentos.jsx`
      creados **vacíos** —un componente que devuelve `null` y el comentario de
      qué va a ser, con más de 60 caracteres, que es lo que el propio test
      exige—.
      **(b)** se agrega el quinto patrón, el del defecto 4: falla si en
      `pages/Orders.jsx` o `pages/PurchaseOrders.jsx` aparece un `find(` sobre una
      colección de órdenes **adentro** de un handler de clic. La forma exacta que
      hay que detectar se puede leer del archivo:
      `selectedSupplier?.orders?.find(o => o.status === 'pending' …)` dentro del
      `onClick` del botón (`Orders.jsx:611-614`). Va con **sus dos muestras
      sintéticas** —con y sin el defecto—, como las de `dfd7009`, porque una
      guardia sin ancla es una guardia que nadie sabe si mira algo.
      **Qué la pone en rojo hoy, exactamente** (verificado leyendo los archivos):
      `border-green-500/30` (`Orders.jsx:320`, `:431`), `border-green-600/30`
      (`:388`), `bg-green-600 hover:bg-green-700` (`:644`) contra el patrón de la
      paleta; los `Table*` de las dos (`Orders.jsx:415-434`,
      `PurchaseOrders.jsx:254-344`) contra el de shadcn; y el `find()` del
      `onClick` de `Orders.jsx:612` contra el patrón nuevo.
      **Las tareas que la ponen en verde**: **T1237** para
      `pages/PurchaseOrders.jsx`, **T1240** y **T1242** para `pages/Orders.jsx`.
      Queda escrito en el comentario del archivo, arriba de la lista, con esos
      tres números.
      **⚠ Lo que nadie puede hacer para «arreglarlo» mientras tanto**: sacar
      cualquiera de los cuatro de `ARCHIVOS`, comentar el patrón nuevo, meter las
      clases adentro de un comentario para que `lineasQueMatchean` las saltee, o
      bajar el `toHaveLength`. **Si el rojo molesta, la salida es T1237, T1240 y
      T1242, no la lista.**
      **Verificación**: `npm --prefix apps/web test -- guardiasDeDiseno` **falla**,
      y falla **nombrando los archivos y las líneas exactas** de arriba. Que esté
      en rojo es el resultado buscado de esta tarea, y es lo mismo que hicieron la
      010 con `Inventory.jsx` (T1031) y la 011 con `Billing.jsx` (T1115).
      **El test**: los que ya existen, ampliados a dieciséis archivos, más
      `it('ninguna pantalla elige la orden a recibir con un find() adentro de un
      onClick')`, con sus dos muestras:
      `it('el detector encuentra la forma y la nombra con archivo y línea')` sobre
      la muestra mala, y `it('el detector NO se queja cuando la orden sale del
      estado')` sobre la buena.
      **Cómo se comprueba que el test sirve**: la muestra mala tiene que ponerlo
      en rojo y la buena en verde —eso es lo que impide que la guardia esté
      fallando siempre o pasando siempre—; y para la lista, se agrega a mano un
      `text-red-500` a `components/PanelOrdenDeCompra.jsx` y la guardia lo nombra
      con archivo y línea.
      **Alternativa descartada y que no hay que volver a intentar**: agregar los
      archivos **después** de reescribirlos. Es el riesgo 8 del plan de la 010 y
      la decisión 11 del de la 011, textual: se descubren treinta hexadecimales
      al final, cuando ya nadie sabe cuál vino de dónde.

**Checkpoint**: la suite de la web está en rojo, **en un solo archivo y por
razones enumeradas**, y cada línea que se escriba de acá en adelante en los
dieciséis archivos de la lista se verifica en el momento.

---

## Phase 8: `/proveedores` gana el gateo de módulo que le falta

**Purpose**: el módulo `proveedores` está gateado en los tres lados —barra
lateral, `RouteGuard` y API— y no en dos.

⚠ **Esta fase tiene una sola tarea y va sola, antes de las reescrituras, aunque
sea de otra pantalla.** Es **una línea** que puede dejar a alguien afuera de una
ruta, y mezclada con setecientas líneas de reescritura nadie sabría cuál de las
dos cosas la rompió. El revert es de una línea.

- [x] **T1232** FR-090. En `apps/web/src/App.jsx:283`, `/proveedores` pasa de
      `<MarcoDePantalla><Orders /></MarcoDePantalla>` a
      `<MarcoDePantalla><RouteGuard requiredModule="proveedores"><Orders /></RouteGuard></MarcoDePantalla>`,
      **con el mismo anidamiento que `/ordenes-compra`** (`:284`): el marco
      afuera, el guard adentro. El valor `"proveedores"` es el que
      `components/navegacion.js:34` ya declara como `modulo`.
      **Riesgo bajo, verificado**: `app-sidebar.jsx:74` ya filtra el menú por
      `enabled_modules`, así que a una empresa sin el módulo el ítem ya no le
      aparecía. **Lo único que cierra el guard es la URL escrita a mano.**
      ⚠ **Riesgo 6, y hay que hacerlo antes de mergear**: mirar en producción qué
      empresas tienen `proveedores` en `enabled_modules`. Una que no lo tenga
      pierde la ruta y redirige a `/pos`.
      **Verificación**: `npm --prefix apps/web test -- marcoDePantalla` pasa con
      el caso nuevo, `npm run build` pasa, y el paso manual **P8** —las dos rutas
      siguen centradas a 1320px, porque esta tarea toca `App.jsx`—.
      **El test**: en `apps/web/src/tests/marcoDePantalla.test.js`,
      `it('toda ruta cuyo ítem de menú declara un módulo lleva RouteGuard con ese
      mismo módulo')` — lee `components/navegacion.js` **y** `App.jsx` como
      texto, saca los ítems con `modulo`, y afirma que el elemento de la `<Route>`
      correspondiente contiene `requiredModule="<el mismo valor>"`.
      **Cómo se comprueba que el test sirve**: se saca el `RouteGuard` de
      `/proveedores` —o sea, se revierte esta tarea— y el test se pone en rojo
      **nombrando la ruta y el módulo**. Se le saca a `/ordenes-compra` y también.
      **Por qué la guardia lee las dos listas y no solo `App.jsx`**: afirmar
      «`/proveedores` tiene guard» es una constante que hay que recordar
      actualizar. Afirmar «lo que el menú gatea, la ruta lo gatea» detecta **la
      próxima** pantalla que se olvide, que es el error que esta tarea viene a
      corregir por segunda vez.

**Checkpoint**: `/proveedores` redirige a `/pos` para una empresa sin el módulo,
las diecisiete pantallas siguen centradas, y el commit se puede revertir solo.

---

## Phase 9: `/ordenes-compra`, la lista con la tabla en grid de la maqueta

**Purpose**: la pantalla se ve como el bloque `isCompras` de la maqueta —tabla en
grid, segmentos con contador, búsqueda, filtro de fechas, paginación y dos
estados vacíos distintos— y **el detalle sigue abriendo los modales viejos**.

Corte 9 del plan. **El corte 10 después del 9 es deliberado**: la lista es dibujo
puro y el panel lleva el defecto de plata. Si el panel falla, tiene que saberse
que es el panel.

- [x] **T1233** En `apps/web/src/pages/PurchaseOrders.jsx`, la tabla
      (`:245-310`) se reescribe con `TablaGrid` / `Encabezado` / `Fila` /
      `BotonDeFila` (`components/TablaGrid.jsx:47,63,86,114`) y **se van los
      `Table*` de shadcn** (FR-001). El `grid-template-columns` es **el mismo
      string** en el encabezado y en las filas —`96px minmax(0,1fr) 112px 96px
      148px 132px 120px`— con `gap-x` de 16px (FR-002). Columnas: Orden ·
      Proveedor · Fecha · Ítems · Recepción · Total · Acciones, con las etiquetas
      en `.eyebrow` (FR-003). Número de orden, fecha, ítems y total en `.num`, el
      total a la derecha (FR-004). La celda de Recepción tiene **dos líneas**: la
      etiqueta del estado en su tono y, debajo, una barra de **4px** con bordes
      redondeados cuyo ancho es `porcentajeRecibido` de T1225 (FR-005). Una orden
      anulada va al **55 %** de opacidad y **sin ninguna acción** (FR-006). Los
      botones de la fila son de 29px y **frenan la propagación**; `BotonDeFila` ya
      hace el `stopPropagation` (FR-007). `formatCurrency` (`:145-148`) se borra y
      se usa `pesos` de T1224.
      **Verificación**: `npm --prefix apps/web test -- renderDeOrdenesDeCompra`
      pasa, y `guardiasDeDiseno` deja de nombrar los `Table*` de
      `PurchaseOrders.jsx` —sigue en rojo por `Orders.jsx`, que es lo esperado—.
      **El test**: crear `apps/web/src/tests/renderDeOrdenesDeCompra.test.jsx`
      con `it('el encabezado y las filas comparten el MISMO string de
      grid-template-columns')` —se leen los dos `style` y se comparan, que es el
      criterio 15 y lo que hace que las columnas queden alineadas—;
      `it('una orden anulada no ofrece ninguna acción')`;
      `it('el clic en la fila abre el detalle y el clic en Recibir NO lo dispara
      dos veces')` (FR-007, US1 escenario 7); y
      `it('la barra de recepción de una orden a medias no dice 100%')`.
      Las filas se buscan por su `grid-template-columns`, como manda
      `CONVENCIONES.md`: la tabla es un grid y no hay `role="row"`.
      **Cómo se comprueba que el test sirve**: se le cambia una columna al
      encabezado y el primero se pone en rojo; se saca el `stopPropagation` y el
      tercero dispara dos veces.
      ⚠ **Lo que este test NO puede afirmar**: que la tabla scrollee dentro de su
      tarjeta y que el `<body>` no desborde. jsdom devuelve **cero** en
      `scrollWidth` y `clientWidth`, así que un test que los mire pasa con y sin el
      cambio. Eso es **P-N1**, en el navegador.

- [x] **T1234** En `apps/web/src/pages/PurchaseOrders.jsx`, los controles de
      arriba: el bloque de filtros (`:203-243`) se reemplaza por el **control
      segmentado** —Todas / Pendientes / Parciales / Recibidas, **cada uno con su
      contador en `.num`**, FR-008— copiando el patrón de
      `pages/Inventory.jsx:758-773` (`bg-surface-3 p-[3px]`, botones de 28px),
      **con el comentario que dice de dónde salió**; una **búsqueda** que filtra
      por nombre de proveedor y por número de orden con `filtrarOrdenes` de T1225
      (FR-009); y el **filtro de fechas** como un botón de filtro de 36px con el
      período vigente escrito adentro (FR-010).
      ⚠ **FR-020, y es la corrección de fondo del defecto del filtro**: la opción
      «todos» produce la **ausencia** del parámetro, no un valor centinela. Los
      dos `<SelectItem value=" ">` (`:212`, `:224`) **desaparecen**. Hoy ese
      espacio viaja a una columna `INTEGER` y Postgres responde
      `invalid input syntax`; T1212 lo convirtió en un 400 legible, pero **el
      valor centinela sigue estando mal**.
      **El segmentado se copia, no se extrae.** El patrón está escrito en
      `Inventory.jsx` y esta funcionalidad lo usa una vez: extraerlo con dos usos
      es adivinar la interfaz del tercero.
      **Verificación**: `npm --prefix apps/web test -- renderDeOrdenesDeCompra`.
      **El test**: `it('los cuatro segmentos muestran su contador')` (US1 escenario
      9); `it('elegir Todos NO manda un parámetro con un espacio')` —se espía
      `api.get` y se afirma que la URL **no** tiene `supplier_id`, que es el
      criterio de éxito 7 del lado de la pantalla—; y
      `it('la búsqueda encuentra una orden por su número')`.
      **Cómo se comprueba que el test sirve**: se vuelve a poner
      `<SelectItem value=" ">` y se elige esa opción: el segundo se pone en rojo
      mostrando el parámetro en la URL.

- [x] **T1235** FR-022 y FR-011. En `apps/web/src/pages/PurchaseOrders.jsx`, la
      paginación pasa a usarse: `components/Pagination.jsx` —que ya existe y es
      **1-indexado**, `{ page, totalPages, onPageChange }`— y `getPurchaseOrders`
      con `limit` y `offset`. Hoy `:128` manda `limit = 100` fijo y **nunca**
      `offset`, así que no hay forma de llegar a la orden 101.
      **No hay trabajo de servidor acá**: `getOrders` ya acepta `limit`/`offset` y
      ya devuelve `total` (`purchaseService.js:229-252`); el tope de 200 se puso
      en T1212.
      Y los **dos estados vacíos**, que son cosas distintas (FR-011): «todavía no
      hay órdenes de compra» y «ninguna orden coincide con el filtro», cada uno con
      dos líneas y el segundo diciendo qué filtro sacar.
      **Verificación**: `npm --prefix apps/web test -- renderDeOrdenesDeCompra
      contratosDeApi`.
      **El test**: en `renderDeOrdenesDeCompra.test.jsx`,
      `it('la lista vacía distingue «no hay órdenes» de «el filtro no devolvió
      ninguna»')` (US1 escenario 12); y en `contratosDeApi.test.js`,
      `it('la página 2 pide offset y no vuelve a pedir la 1')` —la URL lleva
      `offset=50`—.
      **Cómo se comprueba que el test sirve**: se usa el mismo texto para los dos
      estados vacíos y el primero se pone en rojo; se saca el `offset` y el
      segundo.

**Checkpoint**: `/ordenes-compra` se ve como la maqueta, los cuatro segmentos
cuentan lo que muestran, se puede llegar a la orden 101, y elegir «Todos» no
rompe el listado. El detalle todavía abre los dos modales viejos.

---

## Phase 10: El panel de la orden, uno solo, compartido por las dos pantallas

**Purpose**: abrir una orden entra en un panel lateral de 520px que muestra su
detalle **y** registra su recepción, sin que la lista desaparezca. **La orden que
se recibe es, por construcción, la que se abrió.**

Corte 10 del plan. Es FR-034 exactamente: «la recepción DEBE ser un solo
componente usado por las dos pantallas. **Dos implementaciones es lo que dejó una
de ellas rota.**»

- [x] **T1236** Escribir `apps/web/src/components/PanelOrdenDeCompra.jsx` (creado
      vacío en T1231) en **modo detalle**, sobre `ui/sheet.jsx`. El ancho va en
      `style={{ width: '520px', maxWidth: '92vw' }}` y **no en clases**, porque el
      `data-[side=right]:sm:max-w-sm` propio de `SheetContent` vive en una media
      query que gana por orden de hoja: el molde exacto está en
      `PanelVenta.jsx:99-106`, con su comentario (FR-014).
      Contenido: kicker «Orden de compra», el número y el proveedor como título,
      «Emitida el {fecha} · {n} ítems» como subtítulo (FR-015); el bloque de
      seguimiento en grilla de **dos columnas**; la tabla de ítems con
      `recibido / pedido` **en una sola celda** —`8 / 12`— y
      `grid-template-columns: minmax(0,1fr) 64px 96px 100px` (FR-016); el total en
      `.num` a **19px** sobre `surface-2`; la nota informativa sobre la
      actualización de stock **solo si la orden es recibible** (FR-017); y el pie.
      ⚠ **Dos desviaciones declaradas de la maqueta**, y van escritas en el
      encabezado del archivo porque `sdd-verify` compara contra el dibujo:
      **(1)** el bloque de seguimiento tiene **cuatro** filas —Estado, Recibido
      (%), Fecha y Notas— y no seis: la maqueta dibuja «Entrega estimada» y
      «Condición de pago» (`:1136-1137`) y `supplier_orders` **no las tiene**.
      [PENDIENTE 7] resolvió no inventar columnas.
      **(2)** el pie **no** lleva «Descargar PDF» ni «Duplicar orden»
      (maqueta `:1146-1147`): las dos están explícitamente Fuera de alcance.
      Queda: «Anular orden» destructiva a la izquierda (FR-015), las **dos** de
      WhatsApp como secundarias —con precios y sin precios, conservando
      `enviarPedidoPorWhatsapp` tal cual y su aviso cuando el proveedor no tiene
      teléfono (FR-018)—, y «Registrar recepción» como principal. **Una orden no
      recibible no tiene acción principal** (FR-017, US2 escenario 8).
      El componente **recibe props explícitos y no lee el store por su cuenta**,
      igual que los tres de `components/pos/`. La regla queda en su encabezado.
      **Verificación**: `npm --prefix apps/web test -- renderDeOrdenesDeCompra`.
      **El test**: `it('una orden recibida o anulada no ofrece anular ni
      recibir')` (US2 escenario 8); `it('las dos acciones de WhatsApp siguen
      estando')` —**una función liberada no se pierde por seguir un dibujo**, el
      mismo criterio que FR-009 de la 010—; `it('avisa cuando el proveedor no
      tiene teléfono cargado')`; y `it('la nota de stock solo aparece en una
      orden recibible')`.
      **Cómo se comprueba que el test sirve**: se saca la condición de recibible
      del pie y el primero se pone en rojo con «Anular orden» sobre una orden ya
      anulada; se borra uno de los dos botones de WhatsApp y el segundo.

- [x] **T1237** ⚠ **Es donde se cierra el defecto 4 del lado de la pantalla.** El
      **modo recepción** de `PanelOrdenDeCompra.jsx`, y `PurchaseOrders.jsx`
      reemplaza sus **dos** modales (`:310-405`) por el panel. Lo que hay que
      hacer bien:
      **(a)** el estado de las cantidades se indexa por **`item.linea`** —el
      campo que `GET /suppliers/orders/:id` devuelve explícito desde T1208— y
      **nunca** por `product_id`; el `key` de React también. Hoy las dos cosas
      están mal en `:380` y `:392-393`.
      **(b)** cada campo muestra `Pedido: 12 · Recibido: 8` y su **máximo es lo
      pendiente** (FR-032).
      **(c)** las líneas con `propone_costo` dibujan una casilla con el texto
      «Colágeno: $900,00 → $1.200,00», **marcada por defecto**; con
      `costo_actual` en cero dice «sin costo cargado → $1.200,00». El motivo de
      que venga marcada está en la decisión 2 del plan: **hoy no pasa nada**, así
      que el costo de olvidarse es el defecto 3 de nuevo. La casilla marcada con
      el número a la vista deja el rechazo a un clic; la casilla vacía deja el
      olvido a cero clics.
      **(d)** el cuerpo que sale es
      `{ items: [{ linea, cantidad, actualizar_costo }] }`, y **el `:id` es el de
      la orden que está abierta en el estado del panel**. En
      `apps/web/src/services/api.js`, `receivePurchaseOrder(id, items)` deja de
      mandar `location` (FR-104: ya no ubicaba nada).
      **(e)** confirmar dos veces registra **una** recepción (FR-036).
      **(f)** un error del servidor **deja el panel abierto**, con las cantidades
      escritas intactas, y muestra `mensajeDeError` de T1230 (FR-035, FR-095).
      Hoy hace `console.error` y no muestra nada (`:179-181`).
      **(g)** la respuesta se lee de `recibido[].recibido_ahora` para decir
      **cuánto entró de verdad** cuando el servidor recortó (FR-033), y los
      `avisos[]` se muestran como frases. **Los avisos no se parsean**: todo lo
      que la pantalla necesita por producto está en `recibido[]` y `costos[]`,
      indexado por `linea`. Es la lección del campo `stock` de `POST /api/sales`.
      **(h)** `ordenes_compra.recibir` y `ordenes_compra.anular` se consultan con
      `Can` / `usePermission` —**con `codigo=`, nunca `permission=`**— y lo que
      falta queda **deshabilitado con su explicación**, no ausente (FR-019).
      **Verificación**: `npm --prefix apps/web test -- renderDeOrdenesDeCompra
      contratosDeApi` pasa, y `guardiasDeDiseno` **deja de nombrar
      `pages/PurchaseOrders.jsx`** — sigue en rojo por `pages/Orders.jsx`.
      **El test**: en `renderDeOrdenesDeCompra.test.jsx`,
      `it('«Recibir» en la SEGUNDA orden abre el panel de la segunda')` —**es el
      defecto 4 y es lo que hay que blindar**, criterio de éxito 1—;
      `it('confirmar manda UNA sola api.put, con el id de esa orden y con linea
      en el cuerpo')`;
      `it('dos órdenes con el mismo producto: escribir en una no cambia el campo
      de la otra')` (criterio 2);
      `it('una orden con dos líneas sin product_id tiene DOS campos')`;
      `it('una línea con 12 pedidas y 8 recibidas tiene máximo 4')`;
      `it('confirmar dos veces seguidas produce UNA llamada')`;
      `it('un error del servidor deja el panel abierto con las cantidades
      escritas y muestra el mensaje del servidor')`;
      `it('sin ordenes_compra.recibir la acción está deshabilitada CON su
      explicación, no ausente')`; y lo mismo para `anular`.
      Se espía la instancia de axios (`vi.spyOn(api, 'put')`) y **no se mockea
      `@/services/api` entero**, como manda `CONVENCIONES.md`.
      **Cómo se comprueba que el test sirve**: se indexa el estado por
      `product_id` —o sea, se copia `:392-393`— y el tercero y el cuarto se ponen
      en rojo; se saca el guardia del doble envío y el sexto; se cierra el panel
      en el `catch` y el séptimo.
      ⚠ **Riesgo 10 del plan, y va en el commit**: `Orders.jsx` y
      `PurchaseOrders.jsx` no consultan hoy **ninguna** llamada a `Can` ni a
      `usePermission` en sus 1.065 líneas. Un usuario que hoy ve botones que la
      API le rechaza va a ver esos mismos botones deshabilitados, y **puede
      leerse como una pérdida de función**. Lo que no cambia: la API ya los
      exigía; lo que se agrega es que la pantalla lo diga antes.

- [x] **T1238** El panel se abre **desde los dos lugares** de
      `/ordenes-compra`: el clic en la fila lo abre en modo detalle, y el botón
      «Recibir» de la fila lo abre **en modo recepción**, no un diálogo aparte. Es
      lo que dibuja la maqueta —el `onClick` del botón «Recibir» es el mismo de la
      fila (`:675`)— **y es lo que hace que la orden que se recibe sea, por
      construcción, la que se abrió** (decisión 7 del plan).
      Y el botón de más acciones de la fila ([PENDIENTE 8]): las que ya existen y
      no entran en la fila —WhatsApp con y sin precios— más «Anular», para no
      obligar a abrir el panel.
      **Alternativas descartadas y que no hay que volver a intentar**: un
      `PanelDeRecepcion.jsx` aparte del panel de detalle —son dos componentes que
      necesitan la misma orden, las mismas líneas y los mismos permisos, y el
      usuario que abre una orden para mirarla y decide cargarla tendría que cerrar
      uno y abrir el otro—; y dejar la recepción de `/proveedores` como estaba,
      **que es literalmente lo que produjo el defecto**.
      **Verificación**: `npm --prefix apps/web test -- renderDeOrdenesDeCompra`.
      **El test**: `it('el botón Recibir de la fila abre el MISMO panel que la
      fila, en modo recepción')`; y `it('cerrar el panel deja el filtro, el
      segmento y la página donde estaban')` (criterio 16, US2 «Independent
      Test»).
      **Cómo se comprueba que el test sirve**: se hace que «Recibir» abra un
      diálogo propio y el primero se pone en rojo; se resetea el filtro al cerrar
      y el segundo.
      ⚠ **US2 escenario 2 —«el foco vuelve a la fila que lo abrió»— no lleva
      test propio**: lo resuelve `ui/sheet.jsx` (Radix) y afirmarlo acá sería
      testear la librería. Se mira en el paso manual **P9**.

- [x] **T1239** ⚠ **Se borra el respaldo del cuerpo viejo.** En
      `apps/api/src/services/purchaseService.js`, `receiveOrder`: desaparece la
      rama que aceptaba `{ product_id, quantity_received }` (T1204, punto **e**).
      A partir de acá, `linea` es obligatorio y un cuerpo sin él responde
      **`400 LINEA_REQUERIDA`** siempre, sea la orden ambigua o no.
      **Por qué se borra y no se deja «por las dudas»**: es el camino ambiguo que
      este hito viene a cerrar, y **un camino que nadie usa es un camino que nadie
      mira cuando cambia**. La ventana de convivencia era entre el corte 1 y este;
      con la pantalla nueva desplegada ya no hay quien mande el cuerpo viejo.
      **Verificación**: `npm run test:api` y `npm run test:web` pasan.
      **El test**: en `apps/api/src/tests/recepcionDeOrden.test.js`,
      `it('el cuerpo viejo se rechaza aunque la orden no sea ambigua')` —el caso
      que en T1204 afirmaba lo contrario **cambia de signo**, y el comentario dice
      por qué y desde qué tarea—.
      **Cómo se comprueba que el test sirve**: se vuelve a poner la rama del
      respaldo y el test se pone en rojo con un 200.

**Checkpoint**: recibir desde `/ordenes-compra` carga la orden que se abrió, con
la cantidad en la línea que se escribió, propone el costo y avisa cuánto entró de
verdad. `guardiasDeDiseno` sigue en rojo **solo** por `pages/Orders.jsx`.

---

## Phase 11: `/proveedores`, dos columnas, con el saldo que calcula el servidor

**Purpose**: la lista dice a quién se le debe y cuánto con un badge por
proveedor, y la cuenta del elegido muestra el saldo en grande, el total comprado,
el total pagado, el pendiente de recibir y el historial paginado.

Corte 11 del plan. ⚠ **La maqueta no dibuja esta pantalla**: `proveedores` cae en
`isStub` (`:1282`). El diseño sale del texto del plan, de los primitivos que la
maqueta sí fijó y de la referencia viva, `pages/Comparador.jsx`. **Cualquier cosa
que `sdd-verify` quiera comparar contra la maqueta acá no tiene contra qué.**

- [x] **T1240** En `apps/web/src/pages/Orders.jsx`, la columna izquierda: las dos
      columnas con lista a la izquierda y cuenta a la derecha (FR-054); cada fila
      con nombre, **badge de estado** —`estadoDeProveedor` y `tonoDeProveedor` de
      T1227— y el **saldo en `.num`** a la derecha (FR-055, FR-056); el buscador
      por nombre (FR-059); y el estado vacío de «ningún proveedor seleccionado»
      que dice qué hacer.
      Se borran: el puente de T1219, la copia de `STATUS_LABELS` (ya la borró
      T1226) y los cuatro `toast.error(err.message)` (`:107`, `:118`, `:133`,
      `:185`), que pasan a `mensajeDeError` de T1230.
      **Verificación**: `npm --prefix apps/web test -- renderDeProveedores` pasa.
      **El test**: crear `apps/web/src/tests/renderDeProveedores.test.jsx` con
      `it('el badge de deuda está en la fila del proveedor que corresponde')`
      —cuatro proveedores en los cuatro estados; se busca cada fila por su
      `grid-template-columns` y se mira con `within`, que es como manda
      `CONVENCIONES.md`— (US5 escenario 2);
      `it('el saldo grande del seleccionado es el MISMO número que su columna en
      la lista')` (US5 escenario 5); y
      `it('un error de la API muestra el mensaje del servidor y no «Request
      failed»')` (criterio 14).
      **Cómo se comprueba que el test sirve**: se dibuja el badge con el estado
      del proveedor anterior —el error clásico del `map`— y el primero se pone en
      rojo nombrando la fila; se vuelve a `toast.error(err.message)` y el tercero.

- [x] **T1241** En `apps/web/src/pages/Orders.jsx`, la columna derecha: el
      **saldo pendiente en grande y en `.num`**, con el tono del signo, como
      elemento de más peso visual del bloque (FR-057); **total comprado** y
      **total pagado** al lado —un saldo de $0 no distingue «nunca le compré» de
      «le compré y le pagué todo», y es lo que hacía el legacy (`:7659-7663`)—;
      **«pedido pendiente de recibir»** con su etiqueta, que es la decisión 2 de
      la spec hecha número y el que Comprafit leía del sistema viejo; y el
      historial de movimientos con `TablaGrid` —Fecha · Operación · Notas · Debe ·
      Haber, importes en `.num` a la derecha— paginado contra
      `GET /suppliers/:id/movimientos` (FR-058).
      ⚠ **El orden lo decide el servidor y la pantalla NO ordena** (FR-053, y es
      una desviación declarada del texto del requisito, explicada en el plan):
      el historial pagina, y un orden decidido en el navegador sobre una página es
      un orden sobre un subconjunto. Lo que sí se afirma acá es que la pantalla
      **no mute el estado**: `Orders.jsx:424` hace hoy
      `selectedSupplier.movements?.sort(...)` **sobre el arreglo del estado de
      React**, que es una mutación en medio de un render.
      Todos los importes con `pesos` y todas las fechas con `fechaCorta`, de
      T1224 (FR-051, FR-052).
      **Verificación**: `npm --prefix apps/web test -- renderDeProveedores` pasa,
      y `npm run test:web` **pasa entero**: `guardiasDeDiseno` queda en verde para
      `pages/Orders.jsx` salvo lo que cierre T1242.
      **El test**: `it('el historial se dibuja descendente SIN que el arreglo del
      store cambie de orden')` —se guarda una copia del arreglo antes de
      renderizar y se compara después— (FR-053, US5 escenario 8);
      `it('un movimiento del 1 de agosto se ve 01/08 y no 31/07')` (criterio 9);
      `it('un importe entero se ve $1.234,00')` (criterio 10);
      `it('un proveedor sin movimientos muestra el estado vacío y no una tabla en
      blanco')`; y `it('el resumen muestra comprado y pagado además del saldo')`.
      **Cómo se comprueba que el test sirve**: se vuelve a poner el `.sort()`
      sobre el arreglo del estado y el primero se pone en rojo; se dibuja la
      fecha con `new Date(iso).toLocaleDateString()` y el segundo.

- [x] **T1242** ⚠ **Acá la guardia del corte 7 queda en verde del todo.** En
      `apps/web/src/pages/Orders.jsx`, el bloque de órdenes del proveedor: deja de
      leer `selectedSupplier.orders` —que ya no viene (T1216)— y pide
      `getPurchaseOrders({ supplier_id })`. Cada orden abre **el mismo
      `PanelOrdenDeCompra`** de T1236/T1237, en modo detalle o recepción (FR-034,
      US3 escenario 12). **Se borran los dos diálogos de recepción de esta
      pantalla** (`:580-620`), incluido el `find()` de `:612`.
      **Y no contradice «Panel lateral en Proveedores: No»** de la tabla de
      patrones de la spec: esa fila dice que **el detalle del proveedor** no es un
      panel —es la mitad derecha de la pantalla—. Una orden abierta desde acá
      sigue siendo una orden, y su detalle es el mismo panel que en la otra
      pantalla. Queda escrito porque `sdd-verify` va a leer esa fila y encontrar
      un `Sheet` en `/proveedores`.
      ⚠ **Riesgo 12**: un usuario con `proveedores.ver` y **sin**
      `ordenes_compra.ver` deja de ver las órdenes. El bloque dice **«No tenés
      permiso para ver las órdenes de compra»**, no «Sin órdenes», que son cosas
      distintas.
      **Verificación**: `npm --prefix apps/web test -- renderDeProveedores
      guardiasDeDiseno` pasa. **`npm run test:web` vuelve a estar entero en
      verde**, por primera vez desde T1231.
      **El test**: en `renderDeProveedores.test.jsx`,
      `it('recibir desde Proveedores usa el MISMO componente y manda el id de la
      orden que se abrió')` —se abre la segunda orden pendiente y se afirma que la
      `api.put` lleva **su** id, que es el defecto 4 del lado de esta pantalla—;
      y `it('sin ordenes_compra.ver el bloque explica el permiso y no dice «sin
      órdenes»')`.
      Y en `guardiasDeDiseno.test.js`, el patrón del `find()` **pasa a verde**
      para los dos archivos, sin haber tocado la guardia.
      **Cómo se comprueba que el test sirve**: se vuelve a poner el
      `selectedSupplier?.orders?.find(o => o.status === 'pending' ...)` en el
      `onClick` —o sea, la línea de hoy— y **se ponen en rojo dos cosas a la vez**:
      el test de render, que ve el id equivocado, y la guardia estática de T1231,
      que nombra el archivo y la línea. Que las dos muerdan sobre la misma
      reversión es lo que se buscaba al escribir la guardia antes.

**Checkpoint**: `/proveedores` muestra el badge correcto por proveedor, el saldo
grande coincide con la columna de la lista, el historial pagina sin mutar el
estado, y recibir desde acá usa el mismo panel que la otra pantalla. **`npm run
test:web` pasa entero.**

---

## Phase 12: Documentos, pagos y movimientos — lo que existe y nadie llama

**Purpose**: los enlaces de Drive de las facturas están en la cuenta del
proveedor; un pago vacío, de cero o negativo no llega a la API; y los dos
endpoints de editar y eliminar movimientos, que existen desde siempre, por fin
tienen un botón.

- [x] **T1243** [P] Escribir `apps/web/src/components/BloqueDeDocumentos.jsx`
      (creado vacío en T1231) y engancharlo en la cuenta de `Orders.jsx`. Nombre,
      tipo, fecha y enlace (FR-080); alta con los cuatro tipos del modelo;
      **Favalio no sube ningún archivo, guarda el enlace** (FR-081); un enlace
      sin `http` se rechaza **antes de mandar la llamada** con
      `esEnlaceAceptable` de T1228 (FR-082); la nube se deriva del enlace con
      `nubeDelEnlace` (FR-083); los enlaces abren en pestaña nueva **con
      `rel="noopener noreferrer"` y `target="_blank"`** —el enlace lo escribió una
      persona y apunta afuera— (FR-084); se puede copiar el enlace y eliminar el
      documento (FR-085); el aviso de «sin factura» sale de `documentos === 0` que
      ya devuelve el listado (FR-086); y todo respeta `proveedores.editar` y
      `proveedores.eliminar`, **deshabilitado con su explicación** (FR-087).
      **Los dos endpoints del servidor no se tocan**: son los que ya estaban
      bien —validan el proveedor con `findScoped` y usan lista blanca
      (`suppliers.js:246-279`)— y US7 escenario 10 lo dice explícitamente.
      El componente **recibe props explícitos y no lee el store**, como
      `PanelOrdenDeCompra`.
      **Verificación**: `npm --prefix apps/web test -- renderDeProveedores`.
      **El test**: `it('un enlace sin http NO dispara ninguna llamada')` (US7
      escenario 3, y es lo que separa «validar» de «que el servidor lo rechace»);
      `it('los enlaces llevan rel="noopener noreferrer" y target="_blank"')`
      (FR-084); `it('sin proveedores.editar el bloque se lee y no se edita, con
      la explicación a la vista')` (US7 escenario 9); y
      `it('un proveedor sin documentos ve cómo cargar el primero')`.
      **Cómo se comprueba que el test sirve**: se saca la validación del enlace y
      el primero se pone en rojo con la llamada espiada; se saca el `rel` y el
      segundo.
      ⚠ **Copiar al portapapeles no se afirma acá**: `navigator.clipboard` no
      existe en jsdom sin doblarlo, y un test sobre el doble dice que se llamó al
      doble. Se mira en el paso manual **P10**.

- [x] **T1244** En `apps/web/src/pages/Orders.jsx`, el formulario de pago: se
      valida **antes** de llamar —vacío, cero o negativo no salen (FR-088,
      criterio 13)—; se agrega **cheque** a los métodos, que hoy faltan
      (`:636-639` tiene efectivo, transferencia y QR, FR-091); la **fecha pasa a
      ser elegible** —hoy el estado la guarda (`:64`) y **no hay ningún campo**,
      así que un pago de ayer se registra con la fecha de hoy (FR-092)—; y un pago
      **mayor que el saldo** abre `useConfirmDialog` diciendo **los dos números**,
      saldo y monto, y si se confirma se registra: **pagar por adelantado es
      legítimo** (FR-089).
      **Verificación**: `npm --prefix apps/web test -- renderDeProveedores`.
      **El test**: `it('un pago vacío NO dispara ninguna llamada')` —hoy manda
      `amount: parseFloat('')` = `NaN`— (US9 escenario 1, criterio 13);
      `it('un pago de cero o negativo tampoco')`;
      `it('un pago mayor al saldo abre la confirmación con LOS DOS números')` (US9
      escenario 3); y `it('el método cheque se puede elegir')`.
      **Cómo se comprueba que el test sirve**: se vuelve a
      `parseFloat(payData.amount)` sin validar y el primero se pone en rojo con la
      llamada espiada; se saca uno de los dos números de la confirmación y el
      tercero.

- [x] **T1245** En `apps/web/src/pages/Orders.jsx`, editar y eliminar un
      movimiento del historial (FR-093): los dos endpoints existen desde siempre
      —`PUT /api/suppliers/movements/:id` y `DELETE …` (`suppliers.js:218`,
      `:233`), los dos con `findScoped` y lista blanca— y **ningún botón los
      llama**. La eliminación pide confirmación con `ConfirmDialog` diciendo
      **cuánto** se borra y **en qué queda el saldo** (FR-094), y las dos
      respetan `proveedores.editar` y `proveedores.eliminar`.
      **Verificación**: `npm --prefix apps/web test -- renderDeProveedores`.
      **El test**: `it('eliminar un movimiento pide confirmación diciendo el
      importe y el saldo resultante')` (US9 escenario 7);
      `it('cancelar la confirmación NO dispara ninguna llamada')`; y
      `it('sin proveedores.eliminar el botón está deshabilitado con su
      explicación')`.
      **Cómo se comprueba que el test sirve**: se llama al endpoint sin
      confirmación y el segundo se pone en rojo.

- [x] **T1246** En `apps/web/src/pages/Orders.jsx`, eliminar un proveedor: con
      saldo cero, la confirmación dice **cuántas órdenes, movimientos y
      documentos** se van; con saldo distinto de cero, el servidor lo bloquea
      (T1221) y la pantalla muestra **el mensaje del servidor tal cual**, con el
      número adentro, vía `mensajeDeError` de T1230.
      **Y el caso de borde del nombre repetido**: el índice único
      `(empresa_id, name)` (`models/Supplier.js:44`) rechaza un proveedor con el
      nombre de otro. `fallo` ya evita que el error de constraint llegue crudo,
      pero **el mensaje tiene que decir que ese nombre ya existe**. Si el
      servidor no lo dice, esta tarea lo agrega en `POST /` y `PUT /:id` de
      `routes/suppliers.js`.
      **Verificación**: `npm --prefix apps/web test -- renderDeProveedores` y
      `npm --prefix apps/api test -- cuentaDeProveedor` pasan.
      **El test**: `it('la confirmación de borrado dice cuántas órdenes y
      movimientos se van')`; `it('con saldo, muestra el mensaje del servidor con
      el número')` (US9 escenario 9); y en la API,
      `it('un proveedor con el nombre de otro NO devuelve el error de
      constraint crudo')`.
      **Cómo se comprueba que el test sirve**: se usa una confirmación genérica
      —«¿Eliminar?»— y el primero se pone en rojo; se saca el manejo del nombre
      duplicado y el tercero muestra `SequelizeUniqueConstraintError`.

**Checkpoint**: se puede cargar el enlace de una factura, abrirlo y copiarlo; un
pago vacío no llega a la API; un movimiento cargado mal se puede corregir; y
ninguna de las dos pantallas falla en silencio.

---

## Phase 13: La exportación de la cuenta para el contador

**Purpose**: se baja la cuenta corriente de un proveedor en un archivo cuya
columna de importes **suma** y cuyo saldo es el mismo número que muestra la
pantalla.

- [x] **T1247** En `apps/web/src/pages/Orders.jsx` y
      `apps/web/src/services/api.js`, la exportación (US8): `exportarCuenta(id,
      { desde, hasta })` pide `GET /api/suppliers/:id/movimientos/export`
      (T1220), y la pantalla arma la hoja con `armarHoja` y
      `nombreDelArchivo` de T1229. Es el corte de `filaDeExport` / `armarHoja`
      —**el servidor arma las filas, el navegador arma la hoja**— copiado de
      ventas (FR-097).
      El botón está en las acciones de la cuenta (FR-096) y respeta
      `proveedores.ver` (FR-102, que la API ya exige).
      Cuando el servidor responde `400 LIMITE_EXPORT_SUPERADO`, la pantalla dice
      **qué acotar** con el total y el límite que vinieron en el cuerpo, y **no**
      un mensaje genérico.
      **Verificación**: `npm --prefix apps/web test -- contratosDeApi
      exportarProveedores` pasa, y el paso manual **P7** —el archivo se abre en
      una planilla y la columna de importes suma—.
      **El test**: en `contratosDeApi.test.js`,
      `it('la exportación pide el rango que está mirando la pantalla')`; y en
      `renderDeProveedores.test.jsx`,
      `it('pasado el límite dice el total y qué acotar, y no «error al
      exportar»')`.
      **Cómo se comprueba que el test sirve**: se manda el rango vacío y el
      primero se pone en rojo; se reemplaza el mensaje del límite por uno genérico
      y el segundo.
      ⚠ **El saldo del archivo y el de la pantalla son el mismo número porque
      salen del mismo lugar** (FR-101), no porque dos funciones coincidan: el
      servidor calcula los dos con `resumenDeCuenta`. **La pantalla no calcula
      ningún saldo.** Es una forma más fuerte que la escrita en el requisito y
      queda anotada acá para que `sdd-verify` no busque «la función compartida».

**Checkpoint**: se exporta la cuenta de un proveedor, el archivo abre con las
seis columnas, los importes son numéricos, el CUIT conserva sus once dígitos y el
saldo de la última fila es el de la pantalla.

---

## Phase 14: Recibir en la sucursal que corresponde

**Purpose**: una empresa con dos sucursales elige en cuál entra la mercadería, y
una con una sola no ve ningún selector.

Corte 14 del plan. **Último a propósito: se puede cortar sin romper nada.**

- [x] **T1248** [P] En `apps/api/src/services/purchaseService.js`,
      `receiveOrder` acepta `punto_de_venta_id` en el cuerpo y se lo pasa a
      `resolverSucursal({ empresaId, puntoDeVentaId, transaction })` —que ya subió
      antes del bucle en T1204—. El orden de precedencia es: el del cuerpo, si no
      la cabecera `X-Punto-De-Venta-Id`, si no la sucursal por defecto de la
      empresa.
      **`resolverSucursal` no se reabre** (supuesto 4 de la spec): la decisión se
      cerró en el hito 4 y romperla crea filas de stock que la pantalla no
      muestra. **El parámetro `location` sigue sin ubicar nada** (FR-104) y desde
      T1204 ni se lee.
      **Verificación**: `npm --prefix apps/api test -- recepcionDeOrden
      aislamientoEmpresas` pasa, y la guardia «ninguna fila de stock se escribe
      sin sucursal» sigue en verde (FR-105, US10 escenario 5).
      **El test**: `it('el stock sube en la sucursal elegida y no en la por
      defecto')`; `it('sin punto_de_venta_id cae a la cabecera, y sin cabecera a
      la sucursal por defecto')`; y `it('una sucursal de otra empresa no se puede
      elegir')`, que es lo que `resolverSucursal` ya garantiza y que no puede
      dejar de garantizar.
      **Cómo se comprueba que el test sirve**: se ignora el `punto_de_venta_id`
      del cuerpo y el primero se pone en rojo con la fila en la sucursal
      equivocada.

- [x] **T1249** En `apps/web/src/components/PanelOrdenDeCompra.jsx`, modo
      recepción: **con más de una sucursal** aparece un selector de destino con la
      **vigente preseleccionada** (FR-103); **con una sola no hay selector**, que
      es US10 escenario 2 y no un detalle —un control con una sola opción es ruido
      que hace dudar—. El valor viaja como `punto_de_venta_id` en el cuerpo.
      **Verificación**: `npm --prefix apps/web test -- renderDeOrdenesDeCompra`.
      **El test**: `it('con una sola sucursal NO hay selector')`;
      `it('con dos, la vigente viene preseleccionada')`; y
      `it('la sucursal elegida viaja en el cuerpo de la recepción')`, espiando
      `api.put`.
      **Cómo se comprueba que el test sirve**: se dibuja el selector siempre y el
      primero se pone en rojo; se saca el campo del cuerpo y el tercero.

**Checkpoint**: con dos sucursales, recibir eligiendo la segunda hace crecer la
fila de `Stock` de esa sucursal y deja el `StockMovement` con ese
`punto_de_venta_id`.

---

## Phase 15: El navegador y los tres documentos

**Purpose**: las cuatro afirmaciones que solo contesta un motor de maquetado
están automatizadas, y lo que cambió para quien opera está escrito donde lo va a
buscar.

- [x] **T1250** ⚠ **El plan da por sembrado algo que no está.** En
      `apps/web/pruebas-de-navegador/preparacion.js`, sembrar **proveedores y
      órdenes**. El plan dice que el nombre de 80 caracteres de `:35` ya sirve
      para la afirmación del nombre largo de proveedor — **y no**: ese
      `NOMBRE_LARGO` es un **producto** (`:128-149`), y el archivo no crea ningún
      `Supplier` ni ninguna `SupplierOrder`. Sin esta tarea, dos de las cuatro
      pruebas de T1251 no tienen contra qué correr.
      Qué hace falta, con los mismos criterios que el catálogo —**los datos salen
      del sistema por HTTP, no de un doble**—: cuatro proveedores en los **cuatro
      estados** de la tabla de la spec —sin movimientos, saldado, pago parcial,
      con deuda—, uno de ellos con el `NOMBRE_LARGO` de 80 caracteres reusado
      para el nombre del proveedor; y seis órdenes en los **cuatro estados**, una
      de ellas con **dos líneas del mismo producto**, que es el caso que el
      defecto 4 exige.
      El prefijo `PRUEBA-` se conserva para no duplicar en cada corrida, y el
      encabezado del archivo dice de dónde salen los números —de los pasos de
      maquetado de esta spec— igual que hoy dice de dónde salieron los del POS.
      **Verificación**: `npm --prefix apps/web run test:navegador` arranca sin el
      error de preparación, y `preparacion.js` es idempotente: correrlo dos veces
      no duplica proveedores.
      **El test**: no lleva uno propio —es infraestructura de pruebas—, y su
      verificación es que T1251 pueda correr. Lo que sí lleva es el fallo con el
      **comando exacto** cuando algo falta, como ya hace `:60-75`: una suite que
      falla veinte veces con `ECONNREFUSED` no le dice a nadie qué hacer.

- [x] **T1251** Crear `apps/web/pruebas-de-navegador/proveedoresYOrdenes.navegador.js`
      con **las cuatro afirmaciones que solo contesta un navegador**, y ninguna
      más:
      **(1)** la tabla de órdenes scrollea **dentro de su tarjeta** y el `<body>`
      no desborda a lo ancho, a 1140px y a 1920px (FR-013, US1 escenario 13,
      criterio 18);
      **(2)** el panel mide **520px de verdad**, después de que opinen el
      `max-w-[92vw]` y el `data-[side=right]:sm:max-w-sm` que el propio
      `sheet.jsx` trae (US2 escenario 1);
      **(3)** el nombre de proveedor de 80 caracteres **no se mete en la columna
      del saldo** —se compara la caja del nombre contra la del saldo en la misma
      fila— (caso de borde de «Proveedores y cuenta»);
      **(4)** las dos columnas de `/proveedores` **no se solapan** a 1140px (US5).
      ⚠ **Lo que NO baja acá, aunque se pueda escribir**: el color del badge, qué
      órdenes entran en cada segmento, el porcentaje de la barra de recepción y el
      redondeo de un importe. Los cuatro los contesta una función pura de la fase
      6, y repetirlos en Chromium cuesta cincuenta veces más por caso. **Una suite
      lenta es una suite que alguien termina salteando.**
      ⚠ **`src/index.css` tiene un `@source not` para esta carpeta**, y hay una
      guardia en `guardiasDeDiseno.test.js` que lo protege. Sin esa línea, cada
      clase arbitraria mencionada en una prueba —`w-[520px]`, `min-w-[1140px]`—
      entra al CSS que baja el navegador del cliente.
      **Verificación**: `npm --prefix apps/web run test:navegador` pasa con los
      cuatro casos nuevos, con la API descartable arriba (procedimiento **P0** del
      final).
      **El test**: son las cuatro afirmaciones. **Y cada una lleva su mutación**,
      que es lo que la 011 aprendió a la mala —tres de sus primeras once **no se
      pusieron en rojo** con su mutación—: para (1) se le saca el
      `overflow-x-auto` a la tarjeta y el `<body>` tiene que ganar barra
      horizontal; para (2) se pasa el ancho a `className="w-[520px]"` en vez de
      `style` y la medida tiene que bajar a la del `sm:max-w-sm`; para (3) se le
      saca el `truncate`/`min-w-0` a la celda del nombre y las cajas tienen que
      solaparse; para (4) se cambia el `grid` por un `flex` sin `min-w-0` y las
      columnas tienen que pisarse. **Una prueba de geometría que pasa con y sin el
      defecto no vale nada, y acá es más fácil que en ningún otro nivel.**

- [x] **T1252** [P] En `docs/REGLAS-DISENO.md`, el **badge de estado por
      tokens**, con el ejemplo del saldo. Hoy la referencia del patrón es
      `tonoDeStock` y está atada al inventario; lo que hay que escribir es la
      **forma**: una función pura que devuelve **las tres clases juntas**
      —`border-…-line bg-…-soft text-…`— salidas de tokens, y por qué las tres
      juntas y no una variante de `Badge`: porque el tono depende de un cálculo
      —el signo del saldo, el umbral del stock— y no de una prop que alguien
      elige a mano.
      **Verificación**: quien dibuje el próximo badge de estado lee esa sección y
      encuentra **la regla con su motivo**, sin abrir esta spec. Un patrón que se
      repite en dos pantallas y no está escrito es un patrón que la tercera
      resuelve distinto, y **nada lo detectaría** porque la guardia solo prohíbe
      colores fuera del sistema, no formas distintas de usarlos.

- [x] **T1253** [P] En `docs/PROXIMOS-PROYECTOS.md`, anotar lo que este hito
      dejó afuera **con su motivo y su primer paso**:
      **(1)** **enlace de factura por orden**, además del del proveedor —el
      legacy lo tenía (`:8182`) y es una columna nueva en `supplier_documents`—;
      **(2)** **estado de cuenta del proveedor por WhatsApp** (`legacy:8242`); el
      envío de la orden ya existe y se conserva;
      **(3)** **badge de «sin factura» en la barra lateral** (`legacy:1445`,
      `:7889`); el badge por proveedor sí entró;
      **(4)** ⚠ **el lock sobre la orden en la recepción concurrente** —riesgo 7
      del plan—: el `lock: t.LOCK.UPDATE` es sobre la fila de `Stock`
      (`purchaseService.js:137`), **no sobre la orden**, así que dos personas
      recibiendo la misma orden se pisan las cantidades. Este hito **empeora la
      exposición**: «Recibir» pasa a estar en cada fila donde antes había que
      expandir un acordeón. **La mitigación mínima es una línea** —agregarle
      `lock: t.LOCK.UPDATE` al `SupplierOrder.findOne`— y hay que anotarla como
      «lo primero a hacer si aparece». No entra ahora porque cambiar el locking de
      una transacción que ya bloquea filas de `Stock` en otro orden es una
      decisión sobre deadlocks que merece su propia verificación contra Postgres;
      **(5)** **sacar la cascada de costos de la transacción de la recepción**
      —riesgo 3—, si el tiempo de recepción se vuelve un problema: es un cambio de
      una línea y deja una ventana donde el insumo ya cambió y el elaborado no.
      **Verificación**: cada anotación dice **qué falta**, **por qué no entró** y
      **cuál es el primer paso**. Una función que desaparece de una pantalla sin
      quedar anotada es una función que alguien vuelve a pedir dentro de tres
      meses; y un riesgo conocido sin su mitigación escrita es un riesgo que se
      reconstruye desde cero el día que muerde.

- [x] **T1254** [P] ⚠ **Riesgo 2.** En `docs/OPERACION.md`, en «Situaciones», una
      sección nueva: **el costo de los productos y el margen del panel van a
      cambiar a partir del día del deploy**. Cuatro cosas:
      **(1)** **qué cambia** — recibir mercadería más cara actualiza
      `Product.cost` si se acepta la propuesta, y sobre ese costo se calculan el
      margen del POS, el punto de equilibrio y el precio recomendado del
      Comparador. Además, el elaborado que use ese insumo se recostea en cascada;
      **(2)** **por qué es lo correcto** — es el defecto 3: hoy comprar a $1.200
      lo costeado a $900 **no hace nada**, y el margen que muestra el sistema es
      mentira;
      **(3)** **dónde se ve el porqué** — cada cambio queda en
      `ProductCostHistory` con el motivo «Actualización por recepción de compra»,
      y el panel de historial ya existe (`components/HistorialDeCostos.jsx`), así
      que la pregunta «¿por qué bajó el margen?» tiene respuesta **en la
      pantalla**;
      **(4)** **qué NO cambió** — el saldo del proveedor sigue siendo la
      mercadería **recibida**, no la pedida; el número que el sistema viejo
      contaba al emitir se muestra al lado, con la etiqueta «pedido pendiente de
      recibir», y **son dos números distintos a propósito**.
      **Verificación**: quien opera puede leer esa sección el día que note el
      margen distinto y entender **que no se rompió nada**, sin abrir la spec, el
      plan ni el código. Esta tarea existe porque es exactamente el tipo de cambio
      que llega como «el sistema está mal, el margen de ayer no da»: sin el
      documento, la respuesta se reconstruye desde cero cada vez.

**Checkpoint**: `npm run test:api`, `npm run test:web`, `npm run build` y
`npm --prefix apps/web run test:navegador` pasan; las guardias de aislamiento,
observabilidad y diseño siguen limpias **sin excepciones nuevas**; y lo que
cambió para quien opera está escrito donde lo va a buscar.

---

## Los pasos manuales de `sdd-verify`

**Esto no son tareas.** Son las verificaciones que no se pueden escribir como
test en este repositorio, escritas como pasos reproducibles justamente para no
disfrazarlas de test.

⚠ **La lista arrancó con doce y se corrió uno.** Eso no fue un problema de
disciplina: doce pasos a mano antes de cada release es una lista que nadie hace
entera, y una lista que nadie hace entera es peor que una corta, porque figura al
lado de cincuenta y cuatro casillas marcadas y se lee como «verificado» cuando lo
único que dice es «escrito».

**Hoy quedan dos** —P9 y P10, que son una sola tarea de `pruebas-de-navegador`—.
Siete bajaron a test de integración, P8 ya era automático desde T1250, **P5** lo
cerró `scripts/verificar-reversibilidad.js` y **P7** seis casos que escriben el
`.xlsx` y lo vuelven a leer.

De doce a dos, y ninguno de los diez se cerró afirmando menos: cada uno encontró
algo. Los dos últimos son los únicos que de verdad piden ojos.

---

### Lo que dejó de ser manual

Los siete bajaron a test **el día que existió con qué escribirlos**, no antes: el
proyecto **5c** dejó un arnés de integración contra un Postgres de verdad
(`apps/api/src/tests/integracion/`, con la aplicación montada con `supertest` y
dos empresas de fixture). Todo lo que estos pasos pedían mirar en `psql` es lo
que ese arnés puede afirmar.

Corren con `npm --prefix apps/api run test:integracion`. **`npm run test:api` no
los levanta**: es otra suite y hay que pedirla (`CONVENCIONES.md`, definición de
terminado, punto 4).

| Paso | Dónde vive ahora | Qué afirma, y qué mutación lo pone en rojo |
|---|---|---|
| **P1** · El centavo del `GROUP BY` | `integracion/centavoDelSaldo.integracion.test.js` | Que el saldo dé `999.94` y no `999.9399999999999`, en el listado, en la ficha y en el `saldo_final` del archivo del contador. Muere si la resta de `resumenDeCuenta` deja de ir en centavos, y si el `saldo_inicial` del export vuelve a ser un `0` literal |
| **P2** · Dos líneas del mismo producto | `integracion/recepcionPorLinea.integracion.test.js` | Que el JSONB quede con **dos** `quantity_received` distintos, leído con el mismo `jsonb_array_elements` que pedía el paso. Muere si la línea se vuelve a resolver por `product_id`, y si `aplicarRecepcion` vuelve a devolver la misma referencia sin `changed('detail', true)` |
| **P3** · La línea sin producto | `integracion/recepcionPorLinea.integracion.test.js` | Que una línea con `product_id: null` genere deuda, no toque stock y **no revierta las otras**. Muere si se saca la rama del producto ausente: vuelve el 500 y no entra nada |
| **P4** · Los cuatro índices existen | `integracion/indicesQueSeUsan.integracion.test.js` | Que los cuatro `idx_…` que declara la migración estén creados, sobre su tabla y **con sus columnas en ese orden**. Los nombres se leen del archivo de la migración, no de una copia |
| **P6** · El índice se USA | `integracion/indicesQueSeUsan.integracion.test.js` | `EXPLAIN` sobre el SQL que emitió la aplicación —capturado del request real, no retipeado— con volumen suficiente para que `empresa_id` sea selectivo. Muere si el índice no está: el plan pasa a `Seq Scan` |
| **P11** · La recepción con cascada | `integracion/cascadaDeRecepcion.integracion.test.js` | Que el recosteo llegue a todo el grafo sobre un **diamante** y sobre una **cadena de tres niveles**, y que el costo de una línea de más sea un número **fijo** de consultas. Ver abajo por qué la medición de tiempo no bajó |
| **P12** · Dos personas recibiendo | `integracion/recepcionesEnParalelo.integracion.test.js` | **Documenta el defecto, no lo arregla** (sigue Fuera de alcance). Dos requests en paralelo: la orden queda con 5 recibidas, el stock sube 10 y se generan dos deudas por 10. Ver abajo el hallazgo sobre la mitigación |
| **P8** · Las rutas centradas | `apps/web/pruebas-de-navegador/` | Ya era automático desde T1250/T1251 |

⚠ **Los siete primeros se verificaron por mutación, uno por uno**: se revirtió la
línea que cada test dice cubrir, se corrió, se comprobó el rojo y se restauró. Lo
que **no** murió con ninguna mutación está dicho adentro de cada archivo, en el
comentario del test que lo tiene —hay dos, y los dos están marcados como
caracterización y no como guardia—.

#### Tres cosas que salieron de bajarlos a test

**1. El `\di supplier*` de P4 nunca habría mostrado los cuatro índices.** `\di`
filtra por el nombre del **índice**, no por el de la tabla, y los cuatro se llaman
`idx_…`. Quien hubiera corrido el paso tal como estaba escrito habría visto los
nueve viejos, ninguno de los nuevos, y concluido que la migración no hizo nada.
Hay un test que lo fija para que la corrección no se pierda.

**2. `P11` dejó de ser una medición de tiempo, y eso es definitivo.** Un umbral
de segundos no se puede elegir —la misma recepción tarda distinto en cada
máquina— y sin umbral no puede ponerse en rojo, que era exactamente el problema
del paso. Lo que sí crece cuando esto se degrada es la **cantidad de consultas**,
que es la misma en cualquier máquina, y eso es lo que quedó afirmado: la sucursal
se resuelve las mismas veces con una línea que con seis, los productos se leen en
una sola consulta, y cada línea de más cuesta exactamente dos. *Si algún día
duele de verdad*: sacar la cascada de la transacción sigue anotado en T1253.

**3. ⚠ La mitigación de P12 que estaba anotada NO funciona escrita así.** T1253 y
el paso decían «una línea, `lock: t.LOCK.UPDATE` sobre el `SupplierOrder.findOne`».
Aplicada tal cual, **rompe todas las recepciones**: ese `findOne` lleva un
`include` de `Supplier`, Sequelize lo traduce a un `LEFT OUTER JOIN` y Postgres
responde `0A000: FOR UPDATE cannot be applied to the nullable side of an outer
join`. O sea un **500 en cada recepción**, no solo en las simultáneas. La forma
que sí funciona —medida, con el defecto desapareciendo— es
`lock: { level: t.LOCK.UPDATE, of: SupplierOrder }`. Está escrito en el encabezado
de `recepcionesEnParalelo.integracion.test.js` porque una mitigación de una línea
que en realidad rompe todo es peor que ninguna: se aplica apurado el día que
alguien reporta el problema.

---

### Los dos que siguen necesitando una persona

> **Nota de reconciliación.** Esta sección la escribieron dos trabajos en
> paralelo, y cada uno cerró un paso que el otro dejó anotado como manual. Se
> verificó el árbol y se unificó: **P5 y P7 ya no son manuales.** Queda abajo lo
> que aprendieron, porque el motivo sigue valiendo aunque el paso esté cerrado.

#### ~~P5 · La migración es reversible~~ · cerrado — T1214

Lo cierra `apps/api/scripts/verificar-reversibilidad.js`: levanta un Postgres
descartable propio, aplica todo hasta el hito anterior, siembra datos, y para
cada migración hace foto → `up` → foto → `undo` → foto y **compara** columna por
columna, índice por índice, restricción por restricción y tipo ENUM por tipo
ENUM. Después vuelve a aplicar el `up` y compara otra vez. Las cinco migraciones
del hito 6 y del proyecto 0 pasan.

La mitad que corre siempre —sin Postgres— es
`src/tests/reversibilidadDeMigraciones.test.js`: ninguna migración se quedó sin
`down`, las que se niegan lo hacen con un mensaje útil, y **el comparador de
fotos distingue de verdad** (un comparador que devolviera siempre `[]` dejaría el
script en verde para siempre y no lo notaría nadie).

No se podía hacer con el arnés de integración, y por eso quedó como script
aparte: ejecutar un `down` **muta el esquema de la base compartida**, y los demás
archivos corren en serie sobre ella —un `down` en el medio deja a
`indicesQueSeUsan` afirmando `Seq Scan`—.

**Y leerlo no contaba.** El paso encontró dos defectos que leyendo el `down` no
se ven: uno reinsertaba las filas archivadas con la fecha **truncada al
milisegundo** —los microsegundos se pierden al pasar por `JSON.stringify`, antes
del JSON— y otro repone una foreign key **con otro nombre**. La vuelta atrás se
descubre rota el día que hay que revertir un deploy, que es el peor momento
posible para enterarse.

#### ~~P7 · La columna Saldo suma en una planilla de verdad~~ · cerrado — T1229, T1247

Ningún test abre Excel, pero **sí puede escribir el libro y volver a leerlo**, que
es lo que faltaba. Seis casos en `exportarProveedores.test.js` serializan la hoja
con `XLSX.write` y afirman sobre **las celdas releídas**, no sobre el objeto que
devolvió `armarHoja` — que es la diferencia con el test que ya existía.

La suma se calcula como la calcula una planilla: se saltea toda celda cuyo `t` no
sea `'n'`, igual que `=SUMA()`. Un `reduce` con `Number(v) || 0` habría convertido
el texto en número y el caso habría pasado con y sin el defecto.

Lo que encontró: el tipo **sí** sobrevive a la ida y vuelta. Lo que **puede**
perderse y solo se ve mirando el archivo es que **el escritor recorre el `!ref` y
lo que quede afuera no se escribe** — con un `!ref` una fila corto, el último
movimiento desaparece del `.xlsx` y sigue presente en el objeto de hoja. Es la
forma de perder una fila sin error ni aviso, y ningún assert sobre el objeto la
ve. Tiene su caso dedicado.

Y una trampa que vale para todo el repositorio: **`toBeCloseTo` acepta una cadena
numérica y la compara como número**. Con los importes escritos como texto, el
assert quedaba en verde. Los `DECIMAL` de Postgres llegan como string, así que
cualquier `toBeCloseTo` sobre un valor que venga de la base necesita además un
`expect(typeof …).toBe('number')`.

#### P9 y P10 · El foco al cerrar el panel, y el portapapeles — T1238, T1243

**P9**: abrir una orden desde la tabla, apretar `Esc`; el panel se cierra y el
foco vuelve **a la fila que lo abrió**.
**P10**: cargar un documento, tocar «Copiar enlace» y pegar; aparece el enlace
completo.

*Por qué siguen acá*: **son de navegador, no de API**, y el nivel que les
corresponde existe: `apps/web/pruebas-de-navegador/*.navegador.js`. Ninguno de
los dos se puede afirmar en jsdom —`navigator.clipboard` no existe sin doblarlo,
y un test sobre el doble dice que se llamó al doble; el foco lo resuelve Radix y
afirmarlo en jsdom sería testear la librería—.

⚠ **Están juntos a propósito**: son **una tarea de `pruebas-de-navegador`**, no
dos pasos manuales permanentes. Mientras esa tarea no exista, se miran a mano una
vez por release, y «se mira una vez» solo vale si esa vez ocurre.

---

### P0 · El procedimiento para lo que queda a mano

Hace falta para **P9 y P10** —que se miran a mano hasta que exista su tarea de
`pruebas-de-navegador`—. Los pasos que bajaron a test **no lo necesitan**: el
arnés levanta su propia base con `npm --prefix apps/api run test:db:levantar`, y
la reversibilidad de las migraciones la verifica
`apps/api/scripts/verificar-reversibilidad.js`, que levanta y borra la suya.

> **Actualización.** Este procedimiento pedía **dos** bases descartables, porque
> una base migrada **no levantaba** con `NODE_ENV=development`: ocho columnas
> eran `ENUM` en los modelos y `VARCHAR` en las migraciones, y
> `sequelize.sync({ alter: true })` moría al convertirlas con
> `default for column "unit_type" cannot be cast automatically`. Era el síntoma
> del proyecto 0.
>
> **Ya no.** `20260809-tipos-enum-y-indices-de-productos.js` convergió el esquema
> migrado con el de producción, así que **alcanza con una sola base**: se migra,
> se levanta en desarrollo, y anda. El job del navegador de CI hace exactamente
> eso en cada push, así que si la divergencia vuelve, se cae ahí.
>
> Lo que sigue abajo se conserva porque el resto —CORS, superadmin, el choque de
> puertos— se descubrió a los golpes y sigue valiendo.

```bash
# ── La base descartable. Vacía o migrada: las dos levantan. ──
docker run -d --name favalio-e2e-pg \
  -e POSTGRES_USER=favalio -e POSTGRES_PASSWORD=favalio \
  -e POSTGRES_DB=favalio_e2e -p 55432:5432 postgres:16-alpine

# NO se corren las migraciones sobre esta base. El arranque en desarrollo crea
# el esquema con sync(), siembra los permisos, la empresa 1 con sus tres
# sucursales y el usuario `test-user-id`.
#
# BYPASS_AUTH=true (server.js:264) inyecta req.userId, req.empresaId y
# req.userRole, y checkPermission.js:5 deja pasar sin mirar permisos: no hace
# falta token ni copiar nada de las devtools.
#
# Es seguro fuera de produccion y SOLO fuera de produccion: con
# NODE_ENV=production, checkPermission responde 500 y loguea «BYPASS_AUTH esta
# activo en produccion». Nunca ponerlo en Railway.
cd apps/api && DATABASE_URL=postgres://favalio:favalio@localhost:55432/favalio_e2e \
  DB_SSL=false NODE_ENV=development BYPASS_AUTH=true PORT=5099 \
  ALLOWED_ORIGINS=http://localhost:5199 node src/server.js
```

⚠ **El puerto 55432 es el mismo que usa el contenedor del arnés de integración
(`favalio-pg-integracion`).** Los dos no pueden estar arriba a la vez: o se baja
uno (`npm --prefix apps/api run test:db:bajar`) o esta base A se levanta en otro
puerto. Es la clase de choque que se ve como «la API no arranca» y no como «hay
dos Postgres peleando por un puerto».

⚠⚠ **`ALLOWED_ORIGINS` no es opcional y no estaba escrito en ninguna parte.** La
lista blanca de CORS (`server.js:112-119`) trae `5173`, `5174` y `3000`, y el
servidor de las pruebas de navegador corre en el **5199**
(`playwright.config.js:56`). Sin esa variable el navegador recibe la respuesta sin
cabecera de CORS, la carga del contexto falla y `App.jsx` dibuja «Redirigiendo al
inicio de sesión…»: **las diecisiete pruebas fallan diciendo que no encuentran
`<main>`**, que es el síntoma que no deja adivinar la causa. El único rastro es un
`WARN CORS: origen rechazado` en el log de la API. Está también en el mensaje de
error de `pruebas-de-navegador/preparacion.js`.

⚠ Y el usuario de pruebas tiene que ser **superadmin**, o seis de las diecisiete
pantallas redirigen a `/pos` y la prueba del marco no prueba nada.
`preparacion.js` lo verifica y dice el comando:

```bash
cd apps/api && DATABASE_URL=<la de pruebas> DB_SSL=false \
  node scripts/superadmin.js activar dev@favalio.com
```

Y si querés partir del camino migrado —que ahora es el mismo que el de
producción— en vez de dejar que `sync` cree el esquema:

```bash
cd apps/api && DATABASE_URL=postgres://favalio:favalio@localhost:55432/favalio_e2e \
  DB_SSL=false npm run db:migrate

# El chequeo de esquema NO necesita levantar el servidor: hace un findOne por
# modelo, y además compara el TIPO declarado contra information_schema.
cd apps/api && DATABASE_URL=postgres://favalio:favalio@localhost:55432/favalio_e2e \
  DB_SSL=false npm run verificar:esquema
```

⚠ **Con `NODE_ENV=production` el servidor no sirve para esto**: ahí `BYPASS_AUTH`
responde 500 a propósito. Para inspeccionar sin levantar nada están `psql` y
`verificar:esquema`.

⚠ **La reversibilidad NO se prueba a mano contra esta base.** Ejecutar un `down`
acá deja la base en un estado que el resto del procedimiento no espera. Para eso
está `node scripts/verificar-reversibilidad.js`, que levanta y borra la suya.

⚠ **`verificar:esquema` NO mira índices** —está escrito en su propio comentario:
hace un `findOne` por modelo—. Lo que sí los mira es
`indicesQueSeUsan.integracion.test.js`, que corre solo.

**El camino de desarrollo ya no está roto.** Lo estuvo, y era el proyecto 0: una
base migrada moría al arrancar con `NODE_ENV=development`. Lo cerró
`20260809-tipos-enum-y-indices-de-productos.js`, y ahora el job del navegador de
CI migra antes de levantar, así que la convergencia se verifica en cada push en
vez de confiarse. El camino de producción nunca estuvo afectado —el `Dockerfile`
corre con `NODE_ENV=production`, que no sincroniza—.

---

## Resumen

| Fase | Corte | Tareas | Qué queda funcionando |
|---|---|---|---|
| 1 · La recepción por línea | 1 | T1201–T1206 (6) | Recibir la #118 marca la #118; una línea sin producto no revierte nada; los errores llegan como 409 con su mensaje; la fecha es la del negocio |
| 2 · El costo al recibir | 2 | T1207–T1209 (3) | El costo se propone, se escribe con su motivo **y se propaga a las recetas** |
| 3 · El aislamiento que quedó | 3 | T1210–T1212 (3) | Una orden no puede guardar el producto de otro cliente; «Todos» no rompe el listado |
| 4 · La cuenta del servidor | 4 | T1213–T1219 (7) | El saldo sale del servidor en centavos enteros, con sus cuatro índices y el ancla de includes movida con su cuenta |
| 5 · Export, borrado y ancla | 5 | T1220–T1223 (4) | El archivo del contador, el proveedor con saldo que no se borra, el pago que se valida |
| 6 · Las funciones puras | 6 | T1224–T1230 (7) | Estados, porcentajes, badges, formatos, enlaces, celdas y mensajes de error, testeados y sin copias |
| 7 · Las guardias | 7 | T1231 (1) | Cada color, cada `Table*` y cada `find()` falla en el momento. **En rojo a propósito hasta T1242** |
| 8 · El gateo de `/proveedores` | 8 | T1232 (1) | El módulo gateado en los tres lados. Una línea, un corte, un revert |
| 9 · La lista de órdenes | 9 | T1233–T1235 (3) | La tabla en grid de la maqueta, los cuatro segmentos con contador, y la orden 101 |
| 10 · El panel compartido | 10 | T1236–T1239 (4) | Un solo panel para las dos pantallas; el respaldo del cuerpo viejo, borrado |
| 11 · `/proveedores` | 11 | T1240–T1242 (3) | Badges, saldo grande, historial paginado sin mutar el estado. **La guardia pasa a verde** |
| 12 · Documentos y pagos | 12 | T1243–T1246 (4) | Los enlaces de Drive, el pago validado y los dos endpoints que nadie llamaba |
| 13 · La exportación | 13 | T1247 (1) | La cuenta en un archivo cuya columna suma |
| 14 · La sucursal | 14 | T1248–T1249 (2) | Recibir en la sucursal que corresponde |
| 15 · Navegador y documentos | 15 | T1250–T1254 (5) | Las cuatro medidas automatizadas y lo que cambió, escrito |

**Total: 54 tareas.**

### El registro, revisado contra el código

Las cincuenta y cuatro casillas se recorrieron una por una contra el árbol al
cerrar el hito 6, y **las cincuenta y cuatro coinciden**: cada archivo que una
tarea manda crear existe, cada guardia que manda mover tiene el número nuevo, y
cada pantalla que manda reescribir importa lo que la tarea dice que importe.
Queda escrito porque una revisión que no deja rastro se vuelve a pedir.

⚠ **Lo que «54 tareas completas» NO dice.** Las casillas cubren lo que se puede
afirmar con un test. Los pasos manuales de la sección de arriba son otra lista, y
las dos se leen juntas o no se leen. Al cierre del hito 6 esa lista tenía **doce
pasos y se había corrido uno**, que es cómo un hito queda escrito sin quedar
verificado.

**Hoy son cuatro**, porque siete bajaron a test de integración cuando existió el
arnés que los hacía escribibles (proyecto 5c) y P8 ya era automático. Los cuatro
que quedan tienen su motivo escrito, y ninguno es «alguien se olvidó de
correrlo»: **P7** necesita abrir Excel, **P9** y **P10** necesitan un navegador
con manos y tienen su nivel esperándolos, y **P5** está a una base descartable de
poder automatizarse.

⚠ **Y una desviación deliberada que no hay que «corregir»:** varias tareas de la
API piden el test en `apps/api/src/utils/<algo>.test.js` —T1201, T1203, T1213—.
Están implementados en `apps/api/src/tests/`, que es lo correcto: el `testMatch`
de `apps/api/jest.config.js` solo levanta `**/__tests__/**` y `**/src/tests/**`,
así que un `src/utils/algo.test.js` **jest no lo corre nunca** —no falla, no
avisa, simplemente no existe para la suite—. Está en `CONVENCIONES.md` y lo
protege `src/tests/todosLosTestsCorren.test.js`. Mover esos archivos «adonde dice
la tarea» sería apagar tres tests sin que nada se ponga en rojo.

**La primera es T1201**: la conversión a centavos compartida. No es la más
visible, pero **es la que habilita T1203**, que es donde vive la aritmética de la
recepción, y sin ella ese archivo nace con el duplicado que la extracción existe
para evitar.

**Las fases 1, 2 y 3 son un corte cerrado.** Se mergean y se despliegan solas,
sin esperar a nada del rediseño, y cierran lo que **no se puede reparar
después**: una recepción aplicada a la orden equivocada con los precios de la
orden equivocada, una transacción que se revierte entera por una línea sin
producto, un error que llega como 500, una fecha corrida un día y un costo que no
se actualiza nunca. Todo lo demás —el grid, el panel, los badges— es incomodidad,
no daño.

**La fase 8 va sola.** Es una línea que puede dejar a alguien afuera de una ruta,
y mezclada con setecientas líneas de reescritura nadie sabría cuál de las dos
cosas la rompió.
