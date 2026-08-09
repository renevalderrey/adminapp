# Feature Specification: Inventario — pasada fina

**Feature Branch**: `010-inventario`
**Created**: 1 de agosto de 2026
**Decisiones cerradas**: 1 de agosto de 2026
**Status**: Ready for plan
**Input**:

> Pasada fina de la pantalla **Inventario**. Es el hito 4 del plan
> (`docs/PLAN-COMPRAFIT.md`, 4.3), y es **la pantalla con más deuda funcional
> contra el sistema viejo**.
>
> **Diseño.** Llevarla al sistema de diseño. Edición en panel lateral en vez de
> modal: se edita un producto mirando la lista, no tapándola.
>
> **Función — lo que el sistema viejo hacía y acá no:**
> - **Importar pegando texto.** Es como llega media lista de precios.
> - **Exportar a Excel y PDF** desde la propia pantalla. Hoy solo se puede desde
>   Reportes, que va a quedar oculto para el cliente.
> - **Comparar sucursales lado a lado.** Hoy hay pestañas por sucursal; el
>   sistema viejo mostraba las columnas juntas, que es como se decide una
>   transferencia.
> - **Historial de costos con pantalla.** La API lo guarda desde siempre
>   (`ProductCostHistory`) y nadie puede verlo.
> - **Transferencias entre sucursales.** El endpoint existe y está testeado; la
>   pantalla es un formulario mínimo dentro de un modal.

Los dieciocho puntos abiertos de la primera versión de esta spec fueron
resueltos el 1/8/2026 y están incorporados como requisitos o como supuestos. No
queda nada marcado como pendiente.

> **La decisión más importante no estaba en el pedido original.** Al relevar
> apareció que `Stock` tiene **dos formas de decir en qué sucursal está** y que
> ocho módulos no están de acuerdo sobre cuál manda. Se decidió arreglarlo acá,
> antes de importar los datos de Comprafit, y eso amplía el alcance de esta
> funcionalidad. Está en «La arquitectura de `Stock`».

---

## El patrón de tabla ya está fijado. Esta pantalla lo copia.

Lo dice el plan y lo dice la spec anterior: la funcionalidad 009 —Historial de
ventas— **fijó el patrón de tabla que copian las otras cinco pantallas del
rediseño**, y lo dejó escrito en un componente compartido.

- **El marco es `apps/web/src/components/TablaGrid.jsx`**, con sus cuatro
  piezas: `TablaGrid`, `Encabezado`, `Fila`, `BotonDeFila`. Ahí viven las
  medidas literales —11px 20px en el encabezado, 15px 20px en las filas, 16px
  entre columnas, botones de 29px, el scroll horizontal dentro de la tarjeta,
  el `stopPropagation` de los botones de fila—.
- **El ejemplo completo es `apps/web/src/pages/InvoicesList.jsx`.**
- **Las reglas están en `docs/REGLAS-DISENO.md`, sección «Tabla».**
- **El panel lateral se apoya en `components/ui/sheet.jsx`**, igual que
  `components/PanelVenta.jsx`: `Sheet` ya resuelve `Esc`, el clic en el
  overlay, la trampa de foco, el bloqueo del scroll del body y el retorno del
  foco a la fila. Escribir eso a mano deja la accesibilidad a medias.

**Inventario no inventa un patrón nuevo.** No define anchos propios de
encabezado, no reimplementa el scroll, no escribe su propio botón de 29px y no
copia y pega el marco. Lo que cambia por pantalla —cuáles son las columnas, qué
dice cada celda, el ancho mínimo— lo escribe la pantalla; lo demás sale del
marco.

Cuando `Inventory.jsx` esté terminado, **se agrega a la lista de
`apps/web/src/tests/guardiasDeDiseno.test.js`** (hoy tiene `InvoicesList.jsx`,
`TablaGrid.jsx` y `PanelVenta.jsx`), que es lo que verifica que no queden
hexadecimales, reglas `dark:` ni `<table>` de shadcn.

### Un desacuerdo entre la maqueta y el marco, resuelto

La maqueta dibuja Inventario con `gap: 0 14px`
(`docs/maqueta/Favalio-Rediseno.dc.html:599`), y `TablaGrid` fija `gap-x-4`
(16px), que es lo que usa Historial de ventas. **Manda el marco: 16px.**

El marco existe justamente para que las seis pantallas midan igual. Dos píxeles
no valen un prop nuevo en el componente compartido, y la alternativa —que cada
pantalla escriba su gap— es la puerta por la que entra que la sexta quede en
`py-3.5` sin que nada lo detecte: no hay test visual.

---

## Contexto: qué existe hoy

Relevado antes de escribir. Sirve para no especificar de nuevo lo que ya está y
para no dar por hecho lo que está roto.

| Cosa | Dónde | Estado real |
|---|---|---|
| Pantalla | `apps/web/src/pages/Inventory.jsx` | Usa `<Table>` de shadcn (`:306`), pestañas por sucursal (`:220-232`), edición en un `Dialog` |
| Marco de tabla | `apps/web/src/components/TablaGrid.jsx` | **Ya existe.** Lo fijó la funcionalidad 009 |
| Panel lateral | `apps/web/src/components/ui/sheet.jsx` + `PanelVenta.jsx` | **Ya existe** y resuelve accesibilidad |
| Maqueta de esta pantalla | `docs/maqueta/Favalio-Rediseno.dc.html:558-627` | **La maqueta sí dibuja Inventario**, con las columnas de sucursal **lado a lado** |
| Listado | `GET /api/products` (`apps/api/src/routes/products.js:17`) | Acepta `search`, `brand`, `active`, `page`, `limit` |
| Carga de datos | `apps/web/src/store/useStore.js:38` | `GET /products?active=true` **sin paginar**: trae el catálogo entero al navegador |
| Búsqueda y paginación | `Inventory.jsx:118-132` | En memoria, sobre el catálogo completo ya cargado |
| Alta / edición | `components/ProductForm.jsx` | `Dialog`. Edita producto **y** stock por sucursal (`:173-186`) |
| Precio de venta | `apps/web/src/utils/precios.js:98` (`calcularPrecios`) | Función pura, ya testeada, con bandera `sinCosto` |
| Importar | `components/ImportWizard.jsx` → `POST /api/import/products` | Asistente de 3 pasos con mapeo de columnas. **Solo archivo**: `upload.single('file')` (`import.js:173`) |
| Exportar | `apps/web/src/pages/Reports.jsx:320-324` | XLSX y CSV, **solo en Reportes**, que el plan deja oculto |
| PDF | — | **No hay ninguna biblioteca de PDF en el monorepo**, y no se va a agregar. Ver «El PDF es la vista de impresión» |
| Historial de costos | `ProductCostHistory` + `GET /api/products/:id/cost-history` | Existe, con el scoping ya corregido. **Sin pantalla**, sin `empresa_id` y sin usuario |
| Transferir | `POST /api/stock/transfer` (`routes/stock.js:10`) | Existe, transaccional, con validación de stock suficiente |
| Backfill de sucursal | `apps/api/src/seedPuntosDeVenta.js` | **Ya intenta el mapeo `location` → `punto_de_venta_id`**, y se queda corto. Ver más abajo |
| Precios masivos | `components/PreciosMasivos.jsx` + selección en `Inventory.jsx:280-304` | **Función liberada el 1/8**, con deshacer |
| Guardia de diseño | `apps/web/src/tests/guardiasDeDiseno.test.js` | Hex, `dark:` y `<table>`. Inventario todavía no está en la lista |
| Permisos | `apps/api/src/seedPermissions.js:6-13` | `products.ver/crear/editar/eliminar`, `stock.ver/editar/transferir`. Alcanzan |

### Lo que la maqueta ya resolvió y conviene saber antes de discutirlo

`Favalio-Rediseno.dc.html:558-627` dibuja Inventario completo, y **resuelve la
comparación de sucursales sin pestañas**: las columnas de stock de cada sucursal
están **siempre presentes, una al lado de la otra** (`Centro`, `Depósito`), y el
selector de sucursal de arriba es un segmento que acota, no una solapa que
oculta.

Eso significa que «comparar sucursales lado a lado» **no es un modo aparte**:
es la tabla por defecto. Es exactamente lo que pedía el sistema viejo
(`invRenderComparar`, `legacy/index-legacy.html:5162`) y lo que la pantalla de
hoy perdió al partirla en pestañas.

Lo demás que fija la maqueta:

- **Encabezado**: título, la línea «Stock por sucursal, costos y márgenes. Hacé
  clic en un producto para editarlo sin salir de la lista.» (`:563`) y tres
  botones: `Transferir` y `Importar` secundarios, `Nuevo producto` principal.
- **Barra de indicadores** en una sola tarjeta: Productos activos, Valor del
  stock, Stock bajo (en `warn`), Sin stock (en `danger`) (`:1327-1332`), con el
  selector de sucursal a la derecha.
- **Barra de filtros**: búsqueda «por nombre, marca, SKU o categoría», un filtro
  de Categoría, un botón conmutador «Stock bajo» en colores `warn`, y a la
  derecha un botón «Columnas».
- **Columnas**: `Producto` (nombre + SKU en mono debajo), `Marca`, `Categoría`
  (chip), `Costo` (derecha, mono), `Precio` (derecha, mono, más peso), una
  columna por sucursal (centrada, badge con color según el nivel), y acciones.
- **Pie**: «Mostrando N de M productos» y paginación.

---

## La arquitectura de `Stock`

> Esta sección no estaba en el pedido. Salió del relevamiento, y es la parte que
> más cambia. Se decidió resolverla **acá**, antes de importar los datos de
> Comprafit: *«Lo mejor es que quede la arquitectura bien planteada ahora para
> que al importar productos no se rompa.»*

### El problema

`Stock` tiene **dos** formas de decir en qué sucursal está una fila:
`location` (texto, `allowNull: false`, default `'general'`) y
`punto_de_venta_id` (entero, **nullable**). No son lo mismo, y ocho módulos no
están de acuerdo sobre cuál manda:

| Quién | Qué usa |
|---|---|
| `Inventory.jsx:48,157` | `pv.code` comparado contra `Stock.location` |
| `GET /api/stock` (`general.js:16-30`) | `punto_de_venta_id` si hay cabecera activa; si no, `location` |
| `POST /api/stock` (`general.js:103`) | `punto_de_venta_id` del body si viene; el `location` del body si no |
| `POST /api/import/products` (`import.js:303`) | **Solo `location`.** Nunca escribe `punto_de_venta_id` |
| `POST /api/products/bulk` (`products.js:220-227`) | `punto_de_venta_id` de la cabecera si hay; si no, `location` |
| `POST /api/stock/transfer` (`stock.js:29-32`) | Resuelve el `PuntoDeVenta` por `code`; si no lo encuentra, cae a `location` |
| `purchaseService`, `productionService`, `tiendanubeService` | Cada uno a su manera |
| Índice único de `Stock` | `['product_id', 'punto_de_venta_id']` |

Tres consecuencias reales, no teóricas:

1. **El índice único no separa nada.** En PostgreSQL dos `NULL` no colisionan.
   Con `punto_de_venta_id` en `null` se pueden crear dos filas de stock del
   mismo producto con `location` distinto, y una tercera igual a una de las dos.
2. **Importar rompe el inventario.** La importación escribe stock por `location`
   y nunca por sucursal. Si el `code` del punto de venta no es exactamente el
   texto de la columna, la fila que se crea **no es la que la pantalla lee**: el
   usuario importa 300 productos, la pantalla sigue mostrando los stocks viejos,
   y no falla nada.
3. **El backfill que ya existe se queda corto.**
   `apps/api/src/seedPuntosDeVenta.js` ya intenta el mapeo
   (`mapLocationField(Stock, 'location', 'punto_de_venta_id', 'stock')`), pero:
   - **solo mapea si hay un `code` que coincida**; si no hay coincidencia, la
     fila se queda en `null` para siempre, sin aviso;
   - **no consolida duplicados**: dos filas del mismo producto que caen en la
     misma sucursal violan el índice único en el segundo `update`, y como el
     seeder tiene un `catch` que loguea y sigue de largo, **el mapeo se corta a
     la mitad en silencio**;
   - es un **seeder**, no una migración: es de mejor esfuerzo y no deja nada
     garantizado detrás.

### La decisión

**`punto_de_venta_id` es la identidad de la sucursal.** `location` pasa a ser un
espejo que escribe el servidor y que existe solo por compatibilidad con lo que
todavía lo lee.

Los datos **no se borran**. Se ofreció borrar el stock cargado y volver a
cargarlo; no hace falta y no se hace: el backfill resuelve el caso completo, y
una migración que borra datos es un arma que después queda en el repositorio.

### El orden de la migración

El orden importa: invertirlo hace que `NOT NULL` falle sobre las filas que
todavía no se mapearon.

1. **Asegurar que toda empresa con stock tenga al menos un punto de venta.** Si
   no tiene ninguno, se le crea uno (`code: 'principal'`), que es lo mismo que
   hace `POST /api/empresas` al crear una empresa (`empresas.js:110-114`). Sin
   esto no hay adónde mandar las filas y `NOT NULL` no se puede aplicar.
2. **Backfill.** Para cada fila con `punto_de_venta_id` nulo, se busca el punto
   de venta de **esa misma empresa** cuyo `code` sea igual al `location` de la
   fila. Si no hay coincidencia, va al punto de venta por defecto.
3. **Consolidar duplicados.** Ver abajo.
4. **`location` se reescribe** con el `code` del punto de venta asignado, para
   que el espejo quede sincronizado desde el primer día.
5. **`punto_de_venta_id` pasa a `NOT NULL`** y el índice único
   `(product_id, punto_de_venta_id)` pasa a separar de verdad.

### La consolidación de duplicados

Es la parte delicada y **no es opcional**: el índice único la obliga. Dos filas
del mismo producto que caen en la misma sucursal —por ejemplo una en
`'general'` y otra en `'principal'`, si ninguna de las dos tiene un `code` que
coincida y las dos terminan en la sucursal por defecto— no pueden coexistir
después del paso 5.

Se consolidan en una sola fila:

| Campo | Qué queda |
|---|---|
| `quantity`, `available` | **La suma** de las filas que se fusionan |
| `min_stock` | **El máximo** |
| `expiration_date`, `current_batch`, `purchase_date` | Los de la fila con más cantidad |

**Se suma y no se elige una** porque cada fila es mercadería que alguien contó
en algún lado: quedarse con una descarta la otra, y el criterio acordado es que
ningún dato se pierda. El máximo del mínimo es el criterio conservador: avisa
antes de más, no de menos.

La migración **informa cada consolidación** —producto, sucursal, filas
fusionadas y cantidades— para que quede el rastro de qué se sumó. Una migración
que fusiona filas sin decir cuáles es indistinguible de una que las pierde.

---

## Los seis defectos: cuáles entran y cuáles no

Entran los que rompen datos o cuentas. Los otros quedan anotados con su
consecuencia.

### Entran

**1. Todo lo del modelo `Stock`.** Ver la sección de arriba. → **FR-040** a
**FR-052**.

**2. Importar una lista de precios no deja rastro en el historial de costos.**
`PUT /api/products/:id` escribe `ProductCostHistory` cuando el costo cambia
(`products.js:135-142`). **`POST /api/import/products` no lo hace**
(`import.js:288-295`) y **`POST /api/products/bulk` tampoco** (`products.js:203`).

Es decir: el camino por el que llega una lista de precios entera —el que más
costos mueve, el que esta funcionalidad viene justamente a ampliar con el
pegado de texto— es el único que **no** registra nada. Sin corregirlo, la
pantalla de historial de la historia 6 queda inútil **justo en el caso
principal**. → **FR-104**.

**3. `ProductCostHistory` no guarda quién hizo el cambio ni de qué empresa es.**
El modelo tiene `product_id`, `change_date`, `old_cost`, `new_cost` y `reason`.
Nada más.

Sin usuario, el historial contesta «cuánto» y «cuándo», pero no «quién», que es
la primera pregunta cuando un costo aparece cambiado. El sistema viejo sí lo
mostraba (`legacy/index-legacy.html:5110`).

Sin `empresa_id`, cualquier consulta que no entre por un producto ya scopeado
es una consulta sin aislamiento — exactamente la clase de cosa que este
proyecto ya pagó cara dos veces (veinte endpoints con fuga en la auditoría, ocho
más un mes después). Las dos columnas son migraciones aditivas. → **FR-108**,
**FR-109**.

**4. `POST /api/stock` acepta cantidades negativas; `PUT /api/stock/:id` no.**
`PUT` rechaza `quantity < 0` y `available < 0` explícitamente
(`general.js:48-53`). **`POST` no valida nada** (`general.js:103-152`).

Y `ProductForm.jsx:173-186` usa `PUT` cuando la fila de stock ya existe y `POST`
cuando no. O sea: la misma pantalla, con el mismo campo, valida o no **según si
el producto ya tenía stock cargado en esa sucursal**. → **FR-036**.

**5. Un producto desactivado desaparece y no hay forma de traerlo de vuelta.**
`DELETE /api/products/:id` es un borrado blando: pone `is_active = false`
(`products.js:171`). La pantalla carga con `?active=true` (`useStore.js:38`) y
no tiene ningún filtro para lo otro. Desactivar un producto lo hace invisible
**para siempre desde la interfaz**. → **FR-078**, **FR-039**.

### Queda anotado, fuera de alcance

**6. La pantalla se trae el catálogo entero al navegador.**
`useStore.initialize()` pide `GET /products?active=true` **sin `page` ni
`limit`** (`useStore.js:38`), y la respuesta incluye marca, proveedor y **todas
las filas de stock de cada producto** (`products.js:59`). La API ya sabe paginar
y buscar (`products.js:26-69`); la pantalla no lo usa.

**Precisión importante:** esto **no** es el defecto que la funcionalidad 009
arregló en ventas. Allá la búsqueda miraba las 20 filas de la página cargada y
un CAE de la página 3 no aparecía. Acá el catálogo entero está en memoria, así
que `filteredProducts` (`Inventory.jsx:118`) **sí busca sobre todo el catálogo**
y sí encuentra un producto que cae en la página 40. La búsqueda es correcta.

Lo que está mal es la **escala**, y la consecuencia hay que decirla:

- Con un catálogo grande la pantalla **se va a poner lenta al abrir**: con 5.000
  productos y tres sucursales son 15.000 filas de stock en una sola respuesta,
  antes de dibujar nada.
- **Comparar sucursales y exportar trabajan sobre lo que haya en memoria.** El
  tope de 5.000 del export (FR-128) es un límite del archivo; el techo real es
  cuántos productos entran en la carga inicial.
- El día que el catálogo crezca, esto se arregla usando la paginación que la API
  **ya tiene**. No hace falta trabajo de servidor: hace falta que la pantalla
  deje de pedir todo.

Se anota en `docs/PROXIMOS-PROYECTOS.md`.

---

## Vocabulario: qué significa cada palabra en esta pantalla

Sin esto, «stock», «sucursal» y «costo» significan cosas distintas según quién
las lea, y los criterios de aceptación no se pueden verificar.

| Palabra | Qué es exactamente |
|---|---|
| **Producto** | Una fila de `Product`. Tiene costo, marca, categoría, SKU y márgenes. **No tiene stock**: el stock cuelga de él, por sucursal |
| **Sucursal** | Una fila de `PuntoDeVenta` (`id`, `name`, `code`, `address`, `is_active`) |
| **Stock** | Una fila de `Stock`: un producto **en una** sucursal, con `quantity`, `available` y `min_stock`. Después de la migración, **una sola fila por producto y sucursal**, garantizado por el índice único |
| **Costo** | `Product.cost`. Es **uno solo por producto**, no por sucursal |
| **Precio** | Lo calcula `calcularPrecios` (`utils/precios.js:98`) a partir del costo, del margen del producto o de la empresa, y del precio manual si lo hay. **No se guarda**: se deriva |
| **Valorizado** | `quantity × cost` de una fila de stock. Es una derivación de la pantalla, no un campo |
| **Stock bajo** | El `min_stock` de esa fila si está cargado; si es 0, el umbral general. Ver abajo |

### `quantity` y `available` no son lo mismo

`quantity` es lo que hay; `available` es lo que se puede vender. Deberían
moverse juntos y hay rutas que mueven una sola.

**La tabla muestra `quantity`.** El panel del producto muestra **los dos cuando
difieren**, con la diferencia explicada, porque es el único lugar donde hay
espacio para explicarla y el único momento en que alguien puede corregirla.
→ **FR-033b**.

### «Stock bajo» hoy quiere decir tres cosas distintas

| Quién | Regla |
|---|---|
| `GET /api/alerts` (`general.js:351-354`) | `quantity <= min_stock` **y** `min_stock > 0`. Un producto sin mínimo cargado nunca alerta |
| `GET /api/faltantes` (`general.js:445-449`) | `min_stock` si está cargado; si no, un **umbral general** (hoy 3, `general.js:416`). Es el mismo `d<=3` del sistema viejo (`legacy:5175`) |
| `Inventory.jsx:160-167` | `total > 0 && total <= min_stock`. Con `min_stock` en 0 no cuenta nunca, y el stock cero se cuenta aparte |

**Se unifica a la regla de Faltantes**, que es la única que se diseñó a
propósito y la que ya conoce el usuario. Vale para el indicador, para el filtro,
para el color del badge y para Faltantes. → **FR-016**, **FR-017**.

---

## El PDF es la vista de impresión

**No se agrega ninguna biblioteca de PDF.** El listado para imprimir se arma con
HTML y estilos de impresión, se abre, y el usuario elige «Guardar como PDF» en
el diálogo del navegador.

Tres razones, en orden de peso:

1. **Es lo que hacía el sistema viejo.** `invExportarPDF`
   (`legacy:5246-5324`) no usa ninguna biblioteca: arma un HTML, lo abre en una
   pestaña y llama a `window.print()`. El usuario ya conoce estos dos pasos.
2. **El bundle ya pesa 1,4 MB en un solo chunk.** Una biblioteca de PDF suma
   cientos de KB a la primera carga de **todas** las pantallas, para una función
   de fin de mes.
3. Lo que se ve es lo que imprime: se controla con CSS, con los mismos tokens
   que el resto.

→ **FR-131** a **FR-135**.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Ver el inventario con el patrón de tabla ya fijado (Priority: P1)

Como dueño de Comprafit, quiero ver mi catálogo en una tabla densa y escaneable,
para encontrar un producto y ver su costo, su precio y su stock de un vistazo.

**Why this priority**: es la base de las otras seis historias —todas se abren
desde una fila— y es el hito 4 del plan. Es también la segunda pantalla que
aplica el patrón de 009: si acá se desvía, el patrón deja de ser un patrón y
pasa a ser «lo que hizo Ventas».

**Independent Test**: cargar la pantalla con productos de dos sucursales y
comparar contra el bloque `isInv` de la maqueta
(`Favalio-Rediseno.dc.html:558-627`), verificando que el marco venga de
`TablaGrid`.

**Acceptance Scenarios**:

1. **Given** productos cargados, **When** abro la pantalla, **Then** la tabla
   usa `TablaGrid`, `Encabezado`, `Fila` y `BotonDeFila` de
   `components/TablaGrid.jsx`, y en el archivo no queda ningún `<table>` ni
   ningún componente `Table*` de shadcn.
2. **Given** la tabla, **When** miro el encabezado, **Then** dice
   `Producto · Marca · Categoría · Costo · Precio · <una columna por sucursal> ·
   Acciones`, y el `grid-template-columns` es **el mismo string** en el
   encabezado y en cada fila.
3. **Given** una fila, **When** la miro, **Then** el nombre va arriba y el SKU
   debajo en `.num` y `fg-3`; costo, precio y las cantidades de stock van en
   `.num`; marca y categoría, no.
4. **Given** la columna Precio, **When** la miro, **Then** el valor sale de
   `calcularPrecios` (`utils/precios.js:98`) y no de un cálculo escrito de
   nuevo en la pantalla.
5. **Given** un producto sin costo y sin precio manual, **When** lo miro,
   **Then** la fila lo marca —`calcularPrecios` ya devuelve `sinCosto`— en vez
   de mostrar `$0` como si fuera un precio.
6. **Given** una fila, **When** paso el mouse, **Then** el fondo pasa a
   `surface-2` y el cursor es `pointer`; las acciones son botones de 29px que
   frenan la propagación del clic.
7. **Given** el archivo terminado, **When** lo reviso, **Then** no tiene ningún
   valor hexadecimal ni ninguna regla `dark:`, y `Inventory.jsx` **está agregado
   a la lista de `guardiasDeDiseno.test.js`**.
8. **Given** una ventana angosta, **When** la achico, **Then** la tabla scrollea
   horizontal dentro de su tarjeta y el cuerpo de la página **no** scrollea
   horizontal.
9. **Given** que la empresa no tiene productos, **When** miro la tarjeta,
   **Then** veo el estado vacío del sistema, **distinto** del mensaje de
   «ninguno coincide con la búsqueda».
10. **Given** el catálogo cargado, **When** escribo en la búsqueda, **Then** el
    listado se acota sin ir al servidor y sin perder el cursor del campo.
11. **Given** la barra de indicadores, **When** la miro, **Then** dice
    Productos activos, Valor del stock, Stock bajo (en `warn`) y Sin stock (en
    `danger`), en mono, y los cuatro corresponden a **la sucursal elegida**.
12. **Given** el pie del listado, **When** lo miro, **Then** dice «Mostrando N
    de M productos» con **25 filas por página**, igual que Historial de ventas.
13. **Given** que estoy en la página 5 y aplico un filtro cuyo resultado tiene 2
    páginas, **When** se aplica, **Then** vuelvo a la página 1.
14. **Given** productos seleccionados para la actualización masiva de precios,
    **When** aplico el rediseño, **Then** la selección y el botón «Actualizar
    precios» **siguen funcionando**: es una función liberada el 1/8, no se
    pierde porque la maqueta se dibujó antes.

---

### User Story 2 — Editar un producto en un panel lateral, sin tapar la lista (Priority: P1)

Como usuario, quiero hacer clic en un producto y editarlo en un panel al
costado, para corregir un costo o un stock mirando el resto de la lista.

**Why this priority**: es la mitad «diseño» del pedido y es la casa de casi todo
lo demás —el stock por sucursal, el historial de costos, la reactivación—. Y es
lo que la maqueta le promete al usuario en la línea del encabezado: «Hacé clic
en un producto para editarlo sin salir de la lista.»

**Independent Test**: abrir un producto con stock en dos sucursales, cambiar el
costo y el mínimo de una, guardar, y verificar que la fila se actualiza sin que
la lista pierda página, búsqueda ni scroll.

**Acceptance Scenarios**:

1. **Given** el listado, **When** hago clic en una fila fuera de los botones de
   acción, **Then** entra un panel de 520px (`max-w-[92vw]`, `shadow-nivel-3`,
   `anim-panel`) con overlay, construido sobre `components/ui/sheet.jsx`.
2. **Given** un botón de acción de la fila, **When** lo toco, **Then** ejecuta
   su acción y **no** abre el panel además.
3. **Given** el panel abierto, **When** miro el encabezado, **Then** veo el
   kicker «Producto», el nombre como título, y `marca · categoría · SKU` debajo.
4. **Given** el panel, **When** miro los campos, **Then** están los del producto
   (nombre, SKU, código de barras, descripción, costo, margen, precio manual,
   márgenes mayoristas, marca, categoría, unidad, tamaño, gravado) y, en su
   propia sección, **una fila por sucursal** con cantidad y mínimo.
5. **Given** el panel, **When** miro la sección de precios, **Then** veo el
   precio resultante calculado en vivo mientras escribo el costo o el margen,
   con la misma función que usa la tabla y el POS.
6. **Given** una fila de stock donde `available` difiere de `quantity`, **When**
   la miro en el panel, **Then** veo **los dos números** y una línea que explica
   la diferencia. En la tabla se muestra solo `quantity`.
7. **Given** que cambio el costo y guardo, **When** vuelve la respuesta,
   **Then** la fila del listado y los indicadores se actualizan **sin recargar
   la pantalla** y sin perder página, búsqueda ni scroll.
8. **Given** el panel abierto con cambios sin guardar, **When** aprieto `Esc` o
   clic en el overlay, **Then** se me avisa antes de descartarlos.
9. **Given** el panel abierto sin cambios, **When** aprieto `Esc`, **Then** se
   cierra y la lista queda exactamente como estaba.
10. **Given** un producto sin ninguna fila de stock, **When** abro el panel,
    **Then** la sección de stock muestra las sucursales en cero y **deja
    cargarlas**, en vez de aparecer vacía.
11. **Given** que escribo una cantidad negativa, **When** intento guardar,
    **Then** se rechaza con un mensaje, **tanto si la fila de stock ya existía
    como si no** (defecto 4).
12. **Given** un usuario con `products.ver` pero sin `products.editar`, **When**
    abre el panel, **Then** ve los datos y **no** puede guardar; los campos
    están deshabilitados, no ausentes.
13. **Given** un producto desactivado, **When** abro su panel, **Then** se dice
    que está desactivado y hay cómo reactivarlo.

---

### User Story 3 — Comparar sucursales lado a lado (Priority: P1)

Como dueño de Comprafit, quiero ver el stock de todas mis sucursales en columnas
juntas, para decidir de un vistazo qué transferir de dónde a dónde.

**Why this priority**: es la deuda funcional que más pesa. El sistema viejo lo
tenía (`invRenderComparar`, `legacy:5162`) y Favalio lo perdió al partir la
vista en pestañas: con pestañas, comparar dos sucursales exige memorizar un
número, cambiar de solapa y comparar de memoria. **La maqueta ya lo resolvió**
como la tabla por defecto, así que no es una vista nueva: es cómo se dibuja esta
tabla.

**Independent Test**: cargar un producto con 12 unidades en una sucursal y 0 en
otra, y verificar que las dos cantidades se ven en la misma fila, cada una con
el color de su nivel.

**Acceptance Scenarios**:

1. **Given** una empresa con dos sucursales, **When** abro la pantalla con
   «Todas» elegido, **Then** cada fila muestra **una columna por sucursal**, en
   la misma fila, sin cambiar de solapa.
2. **Given** una celda de stock, **When** la miro, **Then** es un badge con la
   cantidad en mono, y su color sale de los tokens: `danger` en cero o negativo,
   `warn` por debajo del mínimo, neutro si está bien. **No** hay hexadecimales.
3. **Given** una celda de stock, **When** la miro con más atención, **Then**
   además de la cantidad puedo ver el **mínimo** y el **valorizado** de esa
   sucursal: mil unidades de algo barato no justifican un viaje, y sin el
   valorizado esa decisión se toma a ciegas.
4. **Given** el selector de sucursal, **When** elijo una, **Then** el listado
   acota a los productos con stock en esa sucursal y los cuatro indicadores de
   arriba pasan a ser los de esa sucursal.
5. **Given** el selector del encabezado de la aplicación con una sucursal
   activa, **When** abro Inventario, **Then** el filtro arranca en esa sucursal;
   **When** elijo «Todas», **Then** **veo todas**, y la cabecera
   `X-Punto-De-Venta-Id` no pisa la elección en silencio.
6. **Given** una sucursal dada de baja con stock cargado, **When** miro la
   tabla, **Then** su columna aparece marcada «(inactiva)» y **no** desaparece
   con el stock adentro.
7. **Given** un producto sin fila de stock en una sucursal, **When** lo miro,
   **Then** esa celda dice `0` y **no** queda en blanco: es la diferencia entre
   «hay cero» y «no sé», y para transferir hay que saber cuál es.
8. **Given** una fila donde una sucursal está en cero y otra tiene existencias,
   **When** toco la acción de transferir de esa fila, **Then** se abre la
   transferencia **con origen, destino y producto ya cargados**.
9. **Given** una empresa con **hasta tres** sucursales, **When** abro la
   pantalla, **Then** las tres columnas se muestran a la vez.
10. **Given** una empresa con **más de tres** sucursales, **When** abro la
    pantalla, **Then** hay un selector que elige cuáles comparar, con tres
    elegidas por defecto, y la tabla no se deforma.
11. **Given** el inventario después de la migración, **When** miro cualquier
    fila, **Then** **ninguna** cantidad quedó fuera de una sucursal: no hay
    stock invisible.

---

### User Story 4 — Importar pegando texto (Priority: P2)

Como dueño de Comprafit, quiero pegar la lista de precios que me llegó por mail
o por WhatsApp, para actualizar los costos sin armar un Excel antes.

**Why this priority**: el pedido lo dice y el sistema viejo lo tenía por
duplicado —`bulkParseTxt` (`legacy:4871`) y `parsePaste` (`legacy:9870`)—, que es
la mejor evidencia de cuánto se usaba. Va después de las tres primeras porque
escribe en la base: conviene que la identidad de sucursal y el historial de
costos ya estén cerrados antes de abrir un camino nuevo de escritura.

**Es un modo más del asistente que ya existe, no un camino aparte.**
`ImportWizard.jsx` ya tiene los tres pasos —subir, mapear, resultados—, la
detección de columnas por alias (`:53-76`), la vista previa y el informe de
errores por fila. Un camino paralelo duplicaría los tres y divergiría: el
sistema viejo tenía exactamente eso y terminó con dos parsers distintos, con
separadores distintos y resultados distintos, en el mismo archivo. Lo que cambia
es **de dónde salen las filas** en el paso 1; del paso 2 en adelante es el mismo
asistente.

**Independent Test**: pegar diez líneas separadas por tabulaciones, mapear las
columnas y confirmar; verificar los costos en la base y que el historial de
costos registró los diez cambios.

**Acceptance Scenarios**:

1. **Given** el asistente de importación, **When** lo abro, **Then** el paso 1
   ofrece **dos orígenes**: subir un archivo (lo de hoy) y **pegar texto**.
2. **Given** el modo pegar, **When** pego texto, **Then** se separa una línea
   por producto y las columnas por tabulación, `;` o dos o más espacios
   seguidos, que son los separadores con los que llega una lista pegada de
   Excel, de un PDF o de WhatsApp.
3. **Given** texto pegado **con** una fila de encabezado reconocible, **When**
   sigo, **Then** el asistente la detecta y mapea las columnas solo, con los
   mismos alias que ya usa para los archivos.
4. **Given** texto pegado **sin** encabezado, **When** sigo, **Then** el paso 2
   muestra las columnas como `Columna 1`, `Columna 2`… **con las primeras filas
   de ejemplo al lado**, y yo elijo a mano qué es cada una. La propuesta por
   defecto es `1 = Nombre`, `2 = Costo`, `3 = Stock`, y se puede cambiar antes
   de confirmar.
5. **Given** texto sin encabezado, **When** el asistente propone el mapeo,
   **Then** **no** adivina qué columna es cuál mirando la magnitud de los
   números. El sistema viejo lo hacía —`parseBulkRows` decidía que la columna 2
   era stock si el máximo era ≤ 9999 y costo si no (`legacy:4738-4746`)— y con
   una lista de productos de menos de $9.999 leía **los costos como stock** y
   dejaba los costos en cero, sin avisar de nada.
6. **Given** una columna de importes en formato argentino, **When** la mapeo a
   Costo, **Then** `1.234,50` se lee como mil doscientos treinta y cuatro con
   cincuenta. Leerlo al revés convierte $1.234 en $1,234 y **no falla nada**.
7. **Given** el paso 2, **When** miro la vista previa, **Then** dice cuántos
   productos se van a **crear** y cuántos **actualizar**, y muestra las primeras
   filas con esa marca en cada una.
8. **Given** una línea que no tiene nombre, o cuyo costo no es un número,
   **When** confirmo, **Then** esa línea se informa como error **con su número
   de línea** y las demás se importan igual, como ya hace el archivo
   (`import.js:314-321`).
9. **Given** una lista con **el mismo producto repetido**, **When** confirmo,
   **Then** gana **la última fila** y el resultado dice **cuántas se pisaron**.
   Nunca en silencio: si el proveedor mandó el mismo producto dos veces con dos
   precios, el usuario tiene que enterarse.
10. **Given** la lista con una columna de sucursal, **When** confirmo, **Then**
    esa columna se resuelve contra el `code` del punto de venta; si no resuelve,
    la fila se informa como error con su número de línea y **no se inventa una
    sucursal nueva** (defecto 1).
11. **Given** una importación que cambia costos, **When** termina, **Then**
    **cada cambio quedó registrado en el historial de costos** con su costo
    anterior, su costo nuevo y quién lo hizo (defecto 2).
12. **Given** una pegada de más de **2.000 líneas**, **When** intento confirmar,
    **Then** se avisa y se pide partirla, en vez de mandar un pedido que se
    procesa fila por fila sin transacción envolvente.
13. **Given** una importación en curso, **When** vuelvo a apretar confirmar,
    **Then** no se dispara una segunda importación.
14. **Given** el resultado, **When** lo miro, **Then** dice cuántos se crearon,
    cuántos se actualizaron, cuántos se pisaron y cuántos fallaron, y **la lista
    de abajo se refresca sola**.
15. **Given** un usuario sin `products.crear`, **When** abre la pantalla,
    **Then** no ve el botón de importar, y la API lo rechaza igual si lo llama
    de todos modos.

---

### User Story 5 — Transferir stock entre sucursales con una pantalla de verdad (Priority: P2)

Como encargado, quiero mover varios productos de una sucursal a otra en un solo
paso, para no cargar la transferencia de a un producto por vez.

**Why this priority**: es lo más barato de las siete —el endpoint existe, es
transaccional y está testeado (`routes/stock.js:10-114`)— y es la acción que
sigue naturalmente a la comparación de la historia 3. Hoy el formulario mueve
**un producto por vez** dentro de un `Dialog` (`Inventory.jsx:434-482`): mover
diez productos son diez transferencias sueltas.

**Independent Test**: transferir tres productos de una sucursal a otra en una
sola operación y verificar que las seis filas de stock quedaron bien y que
quedó **una** transferencia registrada con los tres ítems.

**Acceptance Scenarios**:

1. **Given** el botón «Transferir», **When** lo toco, **Then** se abre un panel
   —no un modal— con origen, destino y **una lista de productos con cantidad**.
2. **Given** la fila de un producto en la comparación, **When** toco su acción
   de transferir, **Then** se abre el mismo panel con **origen, destino y
   producto precargados**, y solo tengo que poner la cantidad.
3. **Given** el panel de transferencia, **When** busco un producto, **Then**
   veo su stock **en el origen** al lado del nombre, para no pedir más de lo que
   hay.
4. **Given** varios productos cargados, **When** confirmo, **Then** se manda
   **una sola** transferencia con todos los ítems y queda **un solo** registro
   en el historial.
5. **Given** un producto sin stock suficiente en el origen, **When** confirmo,
   **Then** la operación **entera** falla con el mensaje de negocio que ya
   devuelve la API («Stock insuficiente en "X" para "Y"…») y **ninguna** de las
   filas se movió.
6. **Given** origen y destino iguales, **When** intento confirmar, **Then** se
   rechaza antes de mandar.
7. **Given** una cantidad en cero o negativa, **When** intento confirmar,
   **Then** se rechaza **en la pantalla**. Hoy la API se saltea esos ítems en
   silencio (`stock.js:39`), lo que puede terminar en una transferencia
   registrada **sin ningún ítem**.
8. **Given** el selector de destino, **When** lo abro, **Then** **no ofrece
   sucursales inactivas**: meter mercadería en un local cerrado no es una
   operación que tenga sentido.
9. **Given** el selector de origen, **When** lo abro, **Then** **sí ofrece
   sucursales inactivas**: si quedó mercadería ahí, hay que poder sacarla.
10. **Given** una transferencia confirmada, **When** vuelvo a la lista, **Then**
    las columnas de las dos sucursales ya muestran las cantidades nuevas, sin
    recargar la pantalla.
11. **Given** el historial de transferencias, **When** lo abro, **Then** veo
    fecha, origen, destino y los ítems de cada una, con el patrón de tabla y no
    como tarjetas dentro de un modal.
12. **Given** un usuario sin `stock.transferir`, **When** abre la pantalla,
    **Then** no ve el botón, y la API lo rechaza igual.

---

### User Story 6 — Ver el historial de costos de un producto (Priority: P3)

Como dueño de Comprafit, quiero ver cómo se movió el costo de un producto y
quién lo cambió, para saber cuánto subió el proveedor y desde cuándo.

**Why this priority**: el dato **ya está guardado desde siempre** y nadie puede
verlo, que es la definición de deuda barata. Va en P3 y no antes porque no
bloquea ninguna operación del día: sin esto se sigue vendiendo, comprando y
transfiriendo.

**Va dentro del panel lateral del producto, no en una pantalla propia.** El
endpoint que existe es **por producto**
(`GET /api/products/:id/cost-history`, `products.js:241`) y resuelve el producto
con `findScoped` antes de leer. Y la pregunta se hace **mirando un producto**:
«¿por qué esto está a este costo?». La pantalla global de «qué cambió esta
semana» es otra cosa, y queda fuera de alcance.

**Independent Test**: cambiar el costo de un producto tres veces desde tres
caminos distintos —a mano, por importación y por actualización masiva—, abrir su
panel y verificar los tres movimientos con su fecha, su origen y su autor.

**Acceptance Scenarios**:

1. **Given** un producto con historial, **When** abro su panel, **Then** hay una
   sección «Historial de costos» con una fila por cambio: fecha, costo anterior,
   costo nuevo, variación en %, motivo y **quién lo hizo**.
2. **Given** el historial, **When** lo miro, **Then** está ordenado del más
   reciente al más viejo y los importes van en mono.
3. **Given** una suba y una baja, **When** las miro, **Then** se distinguen por
   color y por signo, con los tokens de `danger` y `ok`.
4. **Given** un producto sin ningún cambio de costo, **When** abro el panel,
   **Then** la sección lo dice —«todavía no cambió de costo»— en vez de mostrar
   una tabla vacía.
5. **Given** un producto con muchos cambios, **When** abro el panel, **Then** se
   muestran los últimos y hay cómo ver el resto, sin traer la serie entera de
   una.
6. **Given** un costo que cambió por una actualización masiva de precios,
   **When** miro el motivo, **Then** dice que fue una actualización masiva y
   no «Edición manual de costo base».
7. **Given** un costo que cambió por una importación, **When** miro el
   historial, **Then** **el cambio está** y el motivo dice que fue una
   importación (defecto 2).
8. **Given** un costo que cambió por el recosteo de una receta, **When** lo
   miro, **Then** se distingue de un cambio hecho a mano.
9. **Given** un cambio anterior a esta funcionalidad, **When** lo miro, **Then**
   el autor aparece vacío y se entiende que es un dato viejo, no un error.
10. **Given** el id de un producto de otra empresa, **When** se pide su
    historial, **Then** la API responde 404, como ya hace hoy.
11. **Given** las filas nuevas de historial, **When** se escriben, **Then**
    llevan `empresa_id`, para que ninguna consulta futura sobre el historial
    tenga que quedarse sin filtro de empresa.

---

### User Story 7 — Exportar el inventario e imprimirlo (Priority: P3)

Como dueño de Comprafit, quiero bajarme el listado de inventario o imprimirlo,
para mandarlo al contador, llevarlo al conteo o compartirlo con el proveedor.

**Why this priority**: la exportación ya existe en Reportes
(`Reports.jsx:320-324`), que el plan deja oculto para el cliente
(`PLAN-COMPRAFIT.md`, 4.12) — así que hay que traerla, pero es una función de
fin de mes, no del día. Va última porque depende de que los filtros de las
historias 1 y 3 ya definan qué es «el listado que estoy viendo».

**Independent Test**: filtrar por una marca y una sucursal, exportar, abrir el
`.xlsx` y verificar fila por fila contra la pantalla; después imprimir y
verificar que la hoja dice lo mismo.

**Acceptance Scenarios**:

1. **Given** filtros aplicados, **When** exporto a Excel, **Then** bajo un
   `.xlsx` con **todo el resultado filtrado**, no las 25 filas de la página
   visible — el mismo criterio que fijó la funcionalidad 009 para ventas.
2. **Given** el archivo, **When** lo abro, **Then** las columnas son
   `Producto · SKU · Marca · Categoría · Costo · Precio · <una por sucursal> ·
   Stock total · Valorizado`, una fila por producto.
3. **Given** la columna Costo, **When** la sumo en la planilla, **Then** suma:
   va como número, no como el texto `1.234,50`.
4. **Given** un SKU que parece un número (`0012345`), **When** miro su celda,
   **Then** se lee entero, como texto, sin perder los ceros de adelante.
5. **Given** el total del valorizado exportado, **When** lo comparo con el
   indicador «Valor del stock» de la pantalla, **Then** coinciden.
6. **Given** un producto sin costo, **When** miro su celda de precio, **Then**
   está **vacía**, no en cero: cero es un precio, y vacío es «no hay».
7. **Given** un filtro sin resultados, **When** exporto, **Then** se avisa que
   no hay nada que exportar y **no** se descarga un archivo vacío.
8. **Given** un filtro que devuelve más de 5.000 productos, **When** intento
   exportar, **Then** se avisa y se pide acotar, en vez de colgar la pestaña.
9. **Given** una exportación, **When** miro el nombre del archivo, **Then**
   identifica la fecha y la sucursal, para que dos exportaciones no se pisen en
   la carpeta de descargas.
10. **Given** filtros aplicados, **When** toco imprimir, **Then** se abre una
    **vista para imprimir** con el listado filtrado, y desde el diálogo del
    navegador puedo guardarla como PDF. **No** se descarga ninguna biblioteca de
    PDF.
11. **Given** la vista de impresión, **When** la miro, **Then** tiene encabezado
    con la fecha, la sucursal y la cantidad de productos, y al pie los totales:
    productos, sin stock y stock bajo.
12. **Given** la vista de impresión, **When** la imprimo, **Then** los colores
    salen —`print-color-adjust: exact`, como hacía el sistema viejo
    (`legacy:5294`)— y no se cortan filas a la mitad entre páginas.
13. **Given** un usuario con `products.ver`, **When** abre la pantalla, **Then**
    puede exportar e imprimir.

---

### Edge Cases

**Datos raros del producto**

- **Producto sin costo** (`cost = 0` o `null`) y sin precio manual: la fila lo
  marca y no muestra `$0` como si fuera un precio. `calcularPrecios` ya devuelve
  `sinCosto` para esto (`precios.js:128`). En el export va vacío, no cero.
- Producto sin costo **pero con precio manual**: tiene precio y no está roto. No
  se marca.
- Producto con `price_override` cargado: el precio que se muestra es el manual y
  se distingue del calculado, para que nadie se pregunte por qué el margen no da.
- Producto sin marca, sin categoría o sin SKU: la celda dice «—», no queda en
  blanco, y **no se rompe la búsqueda** por esos campos.
- Nombre de producto largo: la columna es `minmax(0,1.6fr)` y recorta con
  elipsis sin empujar las demás.
- Producto desactivado: se puede encontrar y reactivar (defecto 5).

**Stock**

- **Stock negativo**: la pantalla **lo muestra tal cual, marcado en `danger`**
  —esconderlo no lo arregla— y **no deja guardar uno nuevo** por ninguna de las
  dos puertas (defecto 4).
- Producto sin ninguna fila de stock: cuenta como 0 en todas las sucursales,
  aparece en el listado, y desde el panel se le puede cargar.
- **Fila de stock sin sucursal**: después de la migración **no puede existir**.
  `punto_de_venta_id` es `NOT NULL` y ninguna ruta puede crear una fila sin él.
- **Dos filas del mismo producto en la misma sucursal**: después de la migración
  **no pueden existir**; el índice único lo impide de verdad. Antes de la
  migración existen, y la migración las consolida sumando.
- `quantity` y `available` desincronizados: la tabla muestra `quantity`; el
  panel muestra los dos y explica la diferencia.
- `min_stock` en 0: cae al umbral general, la misma regla que Faltantes.
- Sucursal dada de baja **con stock adentro**: sigue apareciendo como columna,
  marcada «(inactiva)», y se puede sacar stock de ahí pero no meter. Cerrar un
  local no evapora su mercadería, y ese stock es justamente lo que hay que
  transferir a otro lado.
- **Empresa sin ningún punto de venta**: después de la migración no puede
  existir teniendo stock —la migración le crea uno—, y `POST /api/empresas` ya
  crea uno al dar de alta la empresa (`empresas.js:110-114`).

**La migración**

- Fila cuyo `location` no coincide con ningún `code`: va al punto de venta por
  defecto, no queda en `null`.
- Fila de una empresa que no tiene ningún punto de venta: se le crea uno antes
  de mapear.
- Dos filas que caen en la misma sucursal: se consolidan sumando, y la
  consolidación queda informada.
- Empresa sin ninguna fila de stock: no hay nada que mapear y la migración no
  rompe.
- Migración corrida dos veces: la segunda no tiene nada que hacer y no duplica
  ni suma de nuevo.

**Importación**

- **El mismo producto repetido** dentro de la lista pegada: gana la última fila
  y se informa cuántas se pisaron.
- Un producto de la lista que ya existe con **otro** nombre pero el mismo SKU:
  la API busca primero por SKU (`import.js:269`), así que actualiza el que
  existe. La vista previa tiene que decirlo antes de confirmar, o el usuario
  cree que está creando y está renombrando.
- Línea sin costo cuando el mapeo dice que hay columna de costo: **no se pone el
  costo en cero**. Ya se corrigió una vez para archivos (`import.js:254-259`) y
  el pegado no puede reintroducirlo.
- Columna de sucursal que no resuelve contra ningún `code`: la fila se informa
  como error, no se inventa una sucursal.
- Texto pegado con una sola columna (solo nombres): sin costo mapeado no se
  actualiza ningún costo; sirve para dar de alta productos, y se dice.
- Texto pegado con líneas vacías, espacios de más o el separador cambiando entre
  líneas.
- Costos con `$`, con puntos de miles y con coma decimal, mezclados en la misma
  lista.
- Pegar, cerrar el asistente sin confirmar y volver a abrirlo: no queda nada del
  intento anterior.
- Importación que falla a la mitad: qué quedó escrito. El bucle sigue producto
  por producto y no hay transacción envolvente — es el motivo del tope de 2.000.

**Escala**

- **Catálogo grande**: la pantalla trae todo al abrir (defecto 6, fuera de
  alcance). La búsqueda sobre lo cargado es correcta y rápida; la carga inicial
  es el cuello de botella conocido.
- Buscar con acentos y mayúsculas («Colágeno» vs. «colageno»).
- Búsqueda que no devuelve nada vs. catálogo vacío: dos mensajes distintos.

**Presentación**

- Modo oscuro: la pantalla no necesita ni una regla `dark:`.
- `prefers-reduced-motion`: `anim-panel` se desactiva.
- Ventana angosta: scroll horizontal dentro de la tarjeta, nunca en el body.
- Vista de impresión: es la única parte que **no** usa los tokens de pantalla
  sino estilos de impresión sobre papel blanco.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Tabla y patrón visual

- **FR-001**: La tabla DEBE construirse con `TablaGrid`, `Encabezado`, `Fila` y
  `BotonDeFila` de `apps/web/src/components/TablaGrid.jsx`. NO DEBE reimplementar
  el marco, ni usar `<table>`, ni los componentes `Table*` de shadcn.
- **FR-002**: El `grid-template-columns` DEBE ser **el mismo string** en el
  encabezado y en las filas, y DEBE derivar de la maqueta
  (`Favalio-Rediseno.dc.html:599`) con la cantidad de columnas de sucursal que
  se estén comparando: base `minmax(0,1.6fr) 116px 116px 104px 104px`, luego una
  columna por sucursal, y `56px` para las acciones.
- **FR-003**: La separación entre columnas DEBE ser la del marco (16px). NO DEBE
  copiarse el `gap: 0 14px` de la maqueta: el marco existe para que las seis
  pantallas midan igual.
- **FR-004**: Las columnas DEBEN ser, en orden: selección, Producto, Marca,
  Categoría, Costo (derecha), Precio (derecha), una por sucursal (centradas),
  Acciones (derecha).
- **FR-005**: La celda Producto DEBE mostrar el nombre arriba y el SKU debajo,
  el SKU en `.num` y `fg-3`. Costo, Precio y las cantidades de stock DEBEN ir en
  `.num`. Marca y Categoría, no.
- **FR-006**: La Categoría DEBE mostrarse como chip sobre `surface-3` con texto
  en `fg-2`.
- **FR-007**: Cada celda de stock DEBE ser un badge con la cantidad en mono, con
  el trío de tokens del nivel: `danger` en cero o negativo, `warn` por debajo del
  mínimo, neutro si está bien.
- **FR-008**: La fila entera DEBE ser clickeable y abrir el panel del producto.
  Los botones de acción DEBEN frenar la propagación (lo hace `BotonDeFila`).
- **FR-009**: La columna de selección para la actualización masiva de precios
  DEBE conservarse, con el «seleccionar todo lo que da la búsqueda» que ya
  existe. La maqueta se dibujó antes de que esa función se liberara; no se
  pierde una función liberada por seguir un dibujo.
- **FR-010**: Todo color DEBE salir de los tokens de `index.css`. CERO
  hexadecimales y CERO reglas `dark:`, con la única excepción de la hoja de
  impresión (FR-133).
- **FR-011**: `pages/Inventory.jsx` y los componentes nuevos DEBEN agregarse a
  la lista de `apps/web/src/tests/guardiasDeDiseno.test.js`.
- **FR-012**: La tabla DEBE scrollear horizontal dentro de su tarjeta —lo hace
  `TablaGrid` con su `anchoMinimo`—. El body de la página NO DEBE scrollear
  horizontal.
- **FR-013**: El encabezado de pantalla DEBE tener título, la descripción de una
  línea (`max-w-[60ch]`) y a la derecha las acciones, con **un solo botón
  principal**: `Nuevo producto`.
- **FR-014**: Los botones secundarios del encabezado DEBEN ser `Transferir`,
  `Importar` y `Exportar` (con Excel e Imprimir adentro). La maqueta dibuja los
  dos primeros; el tercero lo agrega esta funcionalidad porque Reportes queda
  oculto.
- **FR-015**: La barra de indicadores DEBE mostrar Productos activos, Valor del
  stock, Stock bajo (`warn`) y Sin stock (`danger`), en mono, **referidos a la
  sucursal elegida**.
- **FR-016**: «Stock bajo» DEBE calcularse con **una sola regla**, la misma en
  el indicador, en el filtro, en el color del badge y en Faltantes: el
  `min_stock` de esa fila si está cargado; si es 0, el umbral general.
- **FR-017**: El umbral general DEBE ser el mismo que ya usa
  `GET /api/faltantes` (`general.js:416`), que es el del sistema viejo. Cambiarlo
  acá y no allá haría que dos pantallas del mismo sistema no coincidan sobre qué
  falta.
- **FR-018**: El pie DEBE mostrar «Mostrando N de M productos» y la paginación,
  con **25 filas por página**, consistente con Historial de ventas.
- **FR-019**: DEBE haber dos estados vacíos distintos: «no hay productos
  cargados» y «ninguno coincide con la búsqueda», el segundo con la opción de
  limpiarla.

#### Panel del producto

- **FR-030**: El panel DEBE ser de 520px, `max-w-[92vw]`, `shadow-nivel-3`, con
  overlay y `anim-panel`, construido sobre `components/ui/sheet.jsx` — que ya
  resuelve `Esc`, el clic en el overlay, la trampa de foco, el bloqueo del
  scroll del body y el retorno del foco.
- **FR-031**: DEBE mostrar el kicker «Producto», el nombre como título y
  `marca · categoría · SKU` como subtítulo.
- **FR-032**: DEBE editar los mismos campos que hoy edita `ProductForm.jsx`, sin
  perder ninguno.
- **FR-033**: DEBE tener una sección de stock con **una fila por sucursal**, con
  cantidad y mínimo, incluidas las sucursales donde el producto todavía no tiene
  fila de stock.
- **FR-033b**: Cuando `available` difiera de `quantity`, el panel DEBE mostrar
  **los dos** y explicar la diferencia. La tabla muestra solo `quantity`.
- **FR-034**: DEBE mostrar el precio resultante calculado en vivo con
  `calcularPrecios` (`utils/precios.js:98`). NO DEBE recalcularse en la pantalla:
  una segunda implementación del precio es una segunda respuesta a la misma
  pregunta.
- **FR-035**: Guardar DEBE actualizar la fila y los indicadores **sin recargar
  la pantalla** y sin perder página, búsqueda, orden ni scroll.
- **FR-036**: Una cantidad de stock negativa DEBE rechazarse **tanto en `POST
  /api/stock` como en `PUT /api/stock/:id`**. Hoy solo el segundo la rechaza
  (defecto 4), y cuál de los dos se llama depende de si la fila ya existía.
- **FR-037**: Cerrar el panel con cambios sin guardar DEBE avisar antes de
  descartarlos. Sin cambios, DEBE cerrarse sin preguntar nada.
- **FR-038**: Un usuario con `products.ver` y sin `products.editar` DEBE poder
  abrir el panel y ver los datos, con los campos **deshabilitados** y no
  ausentes.
- **FR-039**: El panel DEBE permitir reactivar un producto desactivado.

#### La arquitectura de `Stock`

- **FR-040**: `Stock.punto_de_venta_id` DEBE ser **la identidad de la sucursal**
  y DEBE pasar a `NOT NULL` después del backfill.
- **FR-041**: `Stock.location` DEBE quedar como **espejo del `code`** del punto
  de venta. Lo escribe **el servidor** a partir del punto de venta resuelto;
  **ninguna ruta DEBE aceptar `location` del cliente para decidir dónde va el
  stock**. Se conserva solo por compatibilidad con lo que todavía lo lee.
- **FR-042**: El índice único de `Stock` DEBE ser
  `(product_id, punto_de_venta_id)` **sin nulos que lo esquiven**. Hoy no separa
  nada porque en PostgreSQL dos nulos no chocan.
- **FR-043**: La migración DEBE, en este orden: (1) asegurar que toda empresa con
  stock tenga al menos un punto de venta, creándole uno (`code: 'principal'`) si
  no lo tiene; (2) mapear cada fila con `punto_de_venta_id` nulo al punto de
  venta de **su misma empresa** cuyo `code` sea igual a su `location`; (3) mandar
  al punto de venta por defecto las que no encuentren coincidencia; (4)
  consolidar duplicados; (5) reescribir `location` con el `code` asignado; (6)
  recién ahí aplicar `NOT NULL` y el índice único.
- **FR-044**: El «punto de venta por defecto» DEBE ser el de `code = 'principal'`
  si existe —que es el que crea `POST /api/empresas` (`empresas.js:113`)—, y si
  no, el activo de menor `id`.
- **FR-045**: Las filas que después del backfill queden duplicadas para el mismo
  producto y sucursal DEBEN consolidarse en una sola: `quantity` y `available`
  **se suman**, `min_stock` toma **el máximo**, y `expiration_date`,
  `current_batch` y `purchase_date` salen de la fila con más cantidad.
- **FR-046**: La migración DEBE **informar cada consolidación** —producto,
  sucursal, filas fusionadas y cantidades—. Una migración que fusiona filas sin
  decir cuáles es indistinguible de una que las pierde.
- **FR-047**: La migración NO DEBE borrar ninguna fila de stock sin haber sumado
  su cantidad en la fila que queda. **Ningún dato se pierde.**
- **FR-048**: La migración DEBE ser idempotente: corrida dos veces, la segunda no
  tiene nada que hacer y no vuelve a sumar.
- **FR-049**: Toda escritura de stock DEBE resolver la sucursal por **una única
  función compartida**. Los ocho módulos que hoy escriben `Stock` —`general.js`,
  `import.js`, `products.js`, `stock.js`, `sales.js`, `purchaseService`,
  `productionService`, `tiendanubeService`— DEBEN usarla.
- **FR-050**: `POST /api/import/products` DEBE grabar `punto_de_venta_id`. La
  columna «Sucursal» del archivo DEBE resolverse contra el `code` del punto de
  venta; si no resuelve, la fila DEBE informarse como error con su número de
  línea y NO DEBE inventarse una sucursal nueva. **Este es el punto de la
  decisión: que al importar productos no se rompa.**
- **FR-051**: `POST /api/stock/transfer` DEBE aceptar el `punto_de_venta_id` de
  origen y destino. Puede seguir aceptando el `code` por compatibilidad,
  resolviéndolo a id antes de tocar nada.
- **FR-052**: NINGUNA ruta DEBE poder crear una fila de `Stock` con
  `punto_de_venta_id` nulo. DEBE haber una **guardia estática** que falle si
  vuelve a aparecer una escritura de stock que no resuelva la sucursal, con la
  misma forma que `aislamientoEmpresas.test.js`.

#### Comparación de sucursales

- **FR-060**: La tabla DEBE mostrar **una columna de stock por sucursal, lado a
  lado**, en la vista por defecto. NO DEBE haber pestañas que oculten una
  sucursal para mostrar otra.
- **FR-061**: La correspondencia entre una fila de `Stock` y una sucursal DEBE
  resolverse por **`punto_de_venta_id`**, no por el texto `location`.
- **FR-062**: La comparación DEBE mostrar, por sucursal, la **cantidad**, el
  **mínimo** y el **valorizado** (`quantity × cost`). El valorizado es lo que
  decide si conviene mover: mil unidades de algo barato no justifican un viaje.
- **FR-063**: DEBEN mostrarse **hasta tres** columnas de sucursal a la vez. Con
  más de tres, DEBE haber un selector que elija cuáles comparar, con tres
  elegidas por defecto.
- **FR-064**: El selector de sucursal DEBE acotar el listado y los cuatro
  indicadores a esa sucursal, y «Todas» DEBE mostrar todas.
- **FR-065**: El selector de sucursal del encabezado de la aplicación DEBE
  definir el **valor inicial** del filtro, y el filtro de la pantalla DEBE mandar
  sobre él. `X-Punto-De-Venta-Id` NO DEBE pisar la elección en silencio.
- **FR-066**: Las sucursales dadas de baja **con stock** DEBEN seguir apareciendo
  como columna, marcadas «(inactiva)».
- **FR-067**: Un producto sin fila de stock en una sucursal DEBE mostrar `0` en
  esa celda, no una celda vacía.
- **FR-068**: Desde la fila de la comparación DEBE poder dispararse la
  transferencia, con origen, destino y producto **precargados**.

#### Listado, búsqueda y filtros

- **FR-070**: La búsqueda DEBE cubrir nombre, marca, SKU, categoría y costo, y
  DEBE correr sobre **el catálogo completo** —que hoy está entero en memoria—, no
  sobre la página visible.
- **FR-071**: La búsqueda DEBE tolerar acentos y mayúsculas.
- **FR-072**: DEBE haber un filtro de categoría y un conmutador «Stock bajo»,
  como los dibuja la maqueta.
- **FR-073**: El filtro de categoría DEBE armarse con **los valores que existen
  en el catálogo**, no con una lista cerrada: `Product.category` es texto libre.
- **FR-074**: Los filtros DEBEN ser combinables entre sí y con la búsqueda.
- **FR-075**: Cambiar cualquier filtro o la búsqueda DEBE volver a la página 1.
- **FR-076**: El contador del pie y los cuatro indicadores DEBEN corresponder al
  **resultado filtrado**.
- **FR-077**: Con 1.000 productos ya cargados, acotar por búsqueda o por filtro
  DEBE responder en menos de 150 ms. La carga inicial queda como está y su
  consecuencia está anotada en «Fuera de alcance».
- **FR-078**: DEBE poder verse y reactivarse un producto desactivado (defecto 5).
- **FR-079**: Toda consulta nueva DEBE filtrar por `empresa_id` y usar
  `findScoped` cuando reciba un id del cliente. Ninguna guardia de
  `aislamientoEmpresas.test.js` puede empezar a fallar.

#### Importar pegando texto

- **FR-090**: Pegar texto DEBE ser **un origen más del asistente que ya existe**
  (`components/ImportWizard.jsx`), con el mismo paso de mapeo, la misma vista
  previa y el mismo informe de errores. NO DEBE construirse un camino paralelo.
- **FR-091**: El separador de columnas DEBE reconocer tabulación, `;` y dos o
  más espacios seguidos; el de filas, el salto de línea.
- **FR-092**: Si la primera fila es un encabezado reconocible, DEBE detectarse y
  usarse el mapeo automático por alias que ya existe (`ImportWizard.jsx:53-76`).
- **FR-093**: Sin encabezado, el paso 2 DEBE mostrar `Columna 1`, `Columna 2`…
  **con filas de ejemplo al lado**, y el mapeo DEBE hacerlo el usuario. La
  propuesta por defecto es `1 = Nombre`, `2 = Costo`, `3 = Stock`.
- **FR-094**: El mapeo NO DEBE deducirse de la magnitud de los valores. El
  sistema viejo lo hacía (`legacy:4738-4746`) y con una lista de productos
  baratos leía **los costos como stock**, dejando los costos en cero sin avisar.
- **FR-095**: Los importes DEBEN leerse con las reglas argentinas: `1.234,50`
  son mil doscientos treinta y cuatro con cincuenta. Es el mismo criterio que ya
  aplicó el Comparador de proveedores.
- **FR-096**: La vista previa DEBE decir cuántos productos se van a **crear** y
  cuántos a **actualizar**, y marcar cada fila con cuál de las dos.
- **FR-097**: Un producto repetido dentro de la misma importación DEBE resolverse
  quedándose con **la última fila**, y el resultado DEBE informar **cuántas se
  pisaron**. NUNCA en silencio.
- **FR-098**: Una línea inválida DEBE informarse **con su número de línea** y
  las demás DEBEN importarse igual.
- **FR-099**: Una celda de costo vacía NO DEBE poner el costo en cero. Ya se
  corrigió para archivos (`import.js:254-259`); el pegado no puede
  reintroducirlo.
- **FR-100**: Una pegada de más de **2.000 filas** DEBE rechazarse con un aviso
  que pida partirla. El bucle de importación corre fila por fila y sin
  transacción envolvente; sin tope, una pegada grande queda a medias sin que
  nadie sepa dónde.
- **FR-101**: Confirmar dos veces NO DEBE disparar dos importaciones, y al
  terminar el listado DEBE refrescarse solo. Importar DEBE requerir
  `products.crear`, en la pantalla **y** en la API.

#### Historial de costos

- **FR-102**: El historial DEBE mostrarse **dentro del panel del producto**, con
  fecha, costo anterior, costo nuevo, variación en %, motivo y **autor**, del más
  reciente al más viejo.
- **FR-103**: DEBE consumir `GET /api/products/:id/cost-history`, que ya resuelve
  el producto con `findScoped` antes de leer.
- **FR-104**: **Toda escritura que cambie el costo DEBE registrar el historial.**
  Hoy `POST /api/import/products` (`import.js:288-295`) y
  `POST /api/products/bulk` (`products.js:203`) no lo hacen, que es justo por
  donde llega una lista de precios entera (defecto 2).
- **FR-105**: El motivo DEBE distinguir el origen del cambio: edición manual,
  actualización masiva de precios, importación, recosteo de receta.
- **FR-106**: Un producto sin cambios DEBE decirlo, en vez de mostrar una tabla
  vacía.
- **FR-107**: El historial NO DEBE traerse entero de una: se muestran los
  últimos y hay cómo ver el resto.
- **FR-108**: `ProductCostHistory` DEBE guardar **el usuario** que hizo el
  cambio. Migración aditiva; las filas anteriores quedan con el autor vacío y la
  pantalla lo muestra como dato viejo, no como error.
- **FR-109**: `ProductCostHistory` DEBE guardar **`empresa_id`**. Migración
  aditiva, con backfill desde el producto. Sin esa columna, toda consulta al
  historial que no entre por un producto ya scopeado es una consulta sin
  aislamiento — la clase de cosa que este proyecto ya pagó cara dos veces.

#### Transferencias

- **FR-110**: La transferencia DEBE poder llevar **varios productos en una sola
  operación**, y DEBE quedar **un solo** registro en `StockTransfer` con todos
  los ítems.
- **FR-111**: DEBE hacerse en un panel lateral, no en un modal.
- **FR-112**: El selector de producto DEBE mostrar el stock **en el origen** al
  lado del nombre.
- **FR-113**: Un ítem con cantidad cero o negativa DEBE rechazarse **en la
  pantalla**. Hoy la API se los saltea en silencio (`stock.js:39`), lo que puede
  dejar registrada una transferencia **sin ningún ítem**.
- **FR-114**: Si un ítem no tiene stock suficiente, la operación **entera** DEBE
  fallar con el mensaje de negocio que la API ya devuelve, y **ninguna** fila
  DEBE quedar movida. El endpoint ya es transaccional.
- **FR-115**: El destino NO DEBE ofrecer sucursales inactivas. El origen **SÍ**
  DEBE ofrecerlas: si quedó mercadería en un local cerrado, hay que poder
  sacarla.
- **FR-116**: Al confirmar, las columnas de las dos sucursales DEBEN actualizarse
  sin recargar la pantalla.
- **FR-117**: El historial de transferencias DEBE mostrarse con el patrón de
  tabla, no como tarjetas dentro de un modal.
- **FR-118**: Transferir DEBE requerir `stock.transferir`, en la pantalla **y**
  en la API.

#### Exportación e impresión

- **FR-120**: DEBE exportarse un `.xlsx` con la biblioteca `xlsx` que ya usa el
  resto de la aplicación.
- **FR-121**: DEBE exportarse **exactamente el resultado de los filtros
  aplicados**, con una fila por producto — el mismo criterio que la funcionalidad
  009. La consistencia entre pantallas vale más que reproducir lo que hacía el
  sistema viejo, que exportaba el catálogo entero.
- **FR-122**: Las columnas DEBEN ser `Producto`, `SKU`, `Marca`, `Categoría`,
  `Costo`, `Precio`, una por sucursal, `Stock total` y `Valorizado`.
- **FR-123**: Costo, Precio, las cantidades y el valorizado DEBEN escribirse como
  **número**, para que las columnas sean sumables.
- **FR-124**: El SKU DEBE escribirse como **texto**, para que Excel no se coma
  los ceros de adelante ni lo pase a notación científica.
- **FR-125**: La suma del valorizado exportado DEBE coincidir con el indicador
  «Valor del stock» de la pantalla.
- **FR-126**: Un producto sin costo DEBE exportarse con la celda de precio
  **vacía**, no en cero.
- **FR-127**: Exportar con cero resultados DEBE avisar en vez de descargar un
  archivo vacío.
- **FR-128**: Un filtro de más de **5.000 productos** DEBE avisar y pedir acotar,
  el mismo tope que fijó la funcionalidad 009.
- **FR-129**: El nombre del archivo DEBE identificar fecha y sucursal.
- **FR-130**: Exportar e imprimir DEBEN requerir `products.ver`.
- **FR-131**: El PDF DEBE resolverse con la **vista de impresión del navegador**.
  NO DEBE agregarse ninguna biblioteca de PDF al proyecto.
- **FR-132**: La vista de impresión DEBE mostrar **el resultado filtrado**, con
  encabezado (fecha, sucursal, cantidad de productos) y totales al pie
  (productos, sin stock, stock bajo), como hacía `invExportarPDF`
  (`legacy:5296-5320`).
- **FR-133**: La hoja de impresión DEBE llevar `print-color-adjust: exact` para
  que los colores salgan (`legacy:5294`). Es el único lugar donde se permiten
  estilos fuera de los tokens de pantalla, porque imprime sobre papel blanco.
- **FR-134**: La vista de impresión NO DEBE cortar filas a la mitad entre
  páginas.
- **FR-135**: Si el navegador bloquea la ventana emergente, DEBE avisarse con
  qué hacer, en vez de no pasar nada.

### Key Entities

| Entidad | Campos que importan acá |
|---|---|
| `Product` | `id`, `name`, `sku`, `barcode`, `description`, `cost`, `brand_id`, `supplier_id`, `category`, `unit_type`, `unit_size`, `margin_override`, `price_override`, `wholesale_margin`, `wholesale_price`, `taxed`, `is_active`, `empresa_id` |
| `Stock` | `id`, `product_id`, **`punto_de_venta_id` (pasa a `NOT NULL` — la identidad de la sucursal)**, `location` (espejo del `code`, lo escribe el servidor), `quantity`, `available`, `min_stock`, `expiration_date`, `current_batch`, `purchase_date`, `empresa_id`. Índice único `(product_id, punto_de_venta_id)` **efectivo** |
| `PuntoDeVenta` | `id`, `name`, `code`, `is_active`, `empresa_id`. El de `code = 'principal'` es el por defecto |
| `Brand` | `id`, `name`, `color`, `empresa_id` |
| `ProductCostHistory` | `id`, `product_id`, `change_date`, `old_cost`, `new_cost`, `reason` + **`empresa_id` (nuevo)** + **el usuario que hizo el cambio (nuevo)**. Las dos migraciones son aditivas y dejan lo existente en nulo |
| `StockTransfer` | `from_punto_de_venta_id`, `to_punto_de_venta_id` (los que mandan), `from_location`, `to_location` (espejos), `items` (JSON), `empresa_id` |
| `Setting` | `margin_efectivo`, `recargo_tarjeta`, `recargo_modo`, `descuento_alianza` — entradas de `calcularPrecios` |

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

1. `Inventory.jsx` no contiene ningún valor hexadecimal, ninguna regla `dark:`,
   ni ningún import de `@/components/ui/table`, y **está en la lista de
   `guardiasDeDiseno.test.js`**.
2. El `grid-template-columns` del encabezado y el de las filas son el mismo
   string, y ninguna etiqueta queda sobre la columna equivocada.
3. La tabla se construye con las piezas de `TablaGrid.jsx`: no hay una segunda
   implementación del encabezado, de la fila ni del botón de 29px.
4. El stock de todas las sucursales se lee **en una sola fila**, sin cambiar de
   solapa. Verificable contra hoy, donde hace falta cambiar de pestaña.
5. **Después de la migración, `SELECT count(*) FROM stock WHERE
   punto_de_venta_id IS NULL` devuelve 0**, y la suma de `quantity` por producto
   antes y después de la migración **es la misma**. Ningún dato se perdió.
6. **Ninguna ruta puede crear una fila de stock sin sucursal**, y hay una guardia
   estática que falla si alguien vuelve a escribir una.
7. Importar un archivo con una columna de sucursal actualiza **el stock que la
   pantalla muestra**. Verificable contra hoy, donde la importación escribe por
   `location`, la pantalla lee por otra cosa y el usuario no se entera.
8. Cargar un stock negativo falla **tanto en un producto que ya tenía stock en
   esa sucursal como en uno que no**. Verificable contra hoy, donde el segundo
   caso pasa.
9. Pegar una lista de 200 líneas de una lista de precios real actualiza los 200
   costos, y **los 200 cambios aparecen en el historial de costos con su autor**.
   Verificable contra hoy, donde una importación no registra nada.
10. Una lista de productos de menos de $9.999 pegada sin encabezado importa los
    **costos como costos**. Verificable contra el sistema viejo, donde los leía
    como stock.
11. Una lista con el mismo producto dos veces informa cuántas filas se pisaron.
12. Mover tres productos de una sucursal a otra son **tres ítems en una
    transferencia**, no tres transferencias. Verificable contra hoy, donde el
    formulario mueve uno por vez.
13. Una transferencia con un ítem sin stock suficiente no mueve **ninguna** de
    las filas.
14. Se puede sacar stock de una sucursal inactiva y no se puede meter.
15. El historial de costos de un producto se ve desde la pantalla, con quién hizo
    cada cambio. Verificable contra hoy, donde el dato está guardado, no dice
    quién, y no hay forma de verlo.
16. Un producto desactivado se puede encontrar y reactivar desde la pantalla.
    Verificable contra hoy, donde desaparece para siempre.
17. Un export de 1.000 productos abre en Excel con los SKU completos, y la suma
    de la columna Valorizado coincide con el indicador «Valor del stock».
18. La vista de impresión sale con sus colores y sin filas cortadas, **sin que se
    haya agregado ninguna dependencia al `package.json`**.
19. «Stock bajo» dice el mismo número en el indicador, en el filtro y en
    Faltantes.
20. `npm run test:api`, `npm run test:web` y `npm run build` pasan, y las
    guardias estáticas de aislamiento, observabilidad y diseño siguen limpias.
21. Cada criterio de aceptación tiene al menos un test que **falla** si se
    revierte el cambio que lo implementa.

---

## Fuera de alcance

Explícito, para que no se discuta después si estaba incluido:

- **Paginar el listado contra el servidor.** La pantalla se sigue trayendo el
  catálogo entero (`useStore.js:38`), aunque la API ya sabe paginar. **La
  consecuencia**: con un catálogo grande la pantalla se va a poner lenta al
  abrir, y comparar sucursales y exportar trabajan sobre lo que haya en memoria.
  La búsqueda **sí** es correcta —corre sobre todo el catálogo cargado—; lo que
  falla es la escala. Cuando haga falta, se arregla usando la paginación que ya
  existe. Se anota en `docs/PROXIMOS-PROYECTOS.md`.
- **Anular una transferencia.** `StockTransfer` no tiene estado; una
  transferencia equivocada se arregla haciendo la inversa.
- **Una pantalla global de «qué costos cambiaron esta semana».** El `empresa_id`
  que agrega FR-109 la hace posible más adelante, pero no entra acá.
- **Resolver la edición concurrente de un producto.** Hoy gana el último que
  guarda, sin aviso, y se queda así. Con el autor en el historial de costos al
  menos queda el rastro de quién tocó qué.
- **Hacer configurable el umbral de «stock bajo».** Se unifica a la regla de
  Faltantes con el umbral que ya existe; que sea una configuración por empresa es
  otro proyecto.
- **Agregar una biblioteca de PDF.** El PDF es la vista de impresión del
  navegador.
- **El botón «Columnas»** que la maqueta dibuja
  (`Favalio-Rediseno.dc.html:595`). Igual que en la funcionalidad 009: queda
  para el repaso de coherencia (hito 9).
- **Importar desde PDF o desde una foto con IA.** El sistema viejo lo tenía
  (`legacy:1844-1878`, panel «PDF / IMAGEN IA») y no está en el pedido.
- **Edición rápida dentro de la tabla** (editar el costo en la celda). El pedido
  pide panel lateral.
- **Rehacer la actualización masiva de precios ni su deshacer.** Se liberó el
  1/8 y funciona; esta funcionalidad solo tiene que no romperla.
- **Rehacer Faltantes ni el Comparador de proveedores.**
- **Cambiar cómo se calcula el precio.** `calcularPrecios` está testeada y la usa
  el POS; acá se consume, no se toca.
- **Recetas, producción y el recosteo en cascada.** Se ven en el historial de
  costos como origen de un cambio; no se editan desde acá.
- **Historial de movimientos de stock** (quién ajustó qué cantidad y cuándo). El
  sistema viejo tenía un historial de **actualizaciones masivas de stock**
  (`invHistRender`, `legacy:5080`), que es otra cosa que el historial de
  **costos** de `ProductCostHistory`. Confundirlos es fácil y caro: el pedido
  dice «historial de costos», y eso es lo que entra.
- **Sacar `Sale.location` y `ProductionOrder.location`.** La migración de
  identidad de sucursal es **solo para `Stock`**, que es donde rompe la
  importación. Las otras dos tablas tienen el mismo patrón y quedan anotadas.
- **Vista mobile en tarjetas.** La pantalla es de escritorio y la tabla scrollea
  horizontal, igual que Historial de ventas.
- **Reportes.** Queda oculto para el cliente; el export de esta pantalla no lo
  reemplaza ni lo modifica.
- **Migrar los datos de Comprafit.** Bloqueado por el acceso al hosting viejo —
  pero esta funcionalidad es justamente lo que hay que tener hecho antes, para
  que esa importación no rompa el inventario.
- **Rediseñar POS, Órdenes de compra, Gastos o Equipo.** Cada una aplica el
  patrón en su propio hito.

---

## Assumptions

Supuestos vigentes. Si alguno resulta falso, cambia el resultado.

1. El aislamiento por empresa se mantiene tal cual: toda consulta nueva filtra
   por `empresa_id` y usa `findScoped` cuando recibe un id del cliente.
2. **El patrón de tabla y el panel lateral ya están resueltos** por la
   funcionalidad 009 y no se rediscuten: `TablaGrid.jsx` es el marco,
   `InvoicesList.jsx` el ejemplo, `REGLAS-DISENO.md` § Tabla la referencia.
3. Los permisos vigentes alcanzan y **no se crean permisos nuevos**:
   `products.ver` para mirar, exportar e imprimir; `products.editar` para editar;
   `products.crear` para importar y crear; `stock.editar` para ajustar stock;
   `stock.transferir` para transferir.
4. **El stock cargado hoy no se borra.** Se ofreció borrarlo y volver a cargarlo;
   el backfill resuelve el caso completo sin destruir nada, y una migración que
   borra datos es un arma que después queda en el repositorio.
5. `seedPuntosDeVenta.js` seguirá existiendo, pero **la migración no depende de
   él**: hace su propio backfill, completo y con el fallback que al seeder le
   falta. Después de la migración, el `mapLocationField` de `Stock` en el seeder
   no tiene nada que hacer.
6. `POST /api/stock/transfer` conserva su contrato: sigue siendo transaccional y
   sigue devolviendo `ErrorDeNegocio` con el mensaje de stock insuficiente. Lo
   que cambia es que acepta ids, que la pantalla le manda varios ítems y que
   valida antes.
7. `GET /api/products` conserva su contrato. Lo que cambia es que la respuesta
   de stock ahora trae siempre `punto_de_venta_id`.
8. `calcularPrecios` (`utils/precios.js:98`) es la única fuente del precio de
   venta, y su bandera `sinCosto` es la que marca los productos sin costo.
9. El costo es **uno por producto**, no por sucursal. Nada en el modelo permite
   costos distintos por local, y esta funcionalidad no lo cambia.
10. Los importes se muestran en formato argentino (`1.234,50`) en pantalla; en el
    archivo exportado van como número.
11. La pantalla es visible para el cliente, no solo para superadmin.
12. **Comprafit tiene una sola sucursal**; la maqueta dibuja dos. El límite de
    tres columnas con selector para más cubre las dos situaciones sin que la
    tabla se deforme.
13. `available` y `quantity` se mantienen sincronizados por las rutas que ya
    existen. La tabla muestra `quantity`; cuando difieran, el panel muestra los
    dos.
14. La categoría es texto libre en `Product.category` (`'otro'` por defecto en la
    importación), así que el filtro se arma con los valores que existan.
15. El tope de 5.000 del export es un límite del archivo; el techo real de la
    pantalla es cuántos productos entran en la carga inicial, que queda fuera de
    alcance.
16. Las filas de historial de costos anteriores a esta funcionalidad quedan sin
    autor. No se reconstruye: ese dato no existe y no se puede inferir.
