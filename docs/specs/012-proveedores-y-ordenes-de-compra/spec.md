# Feature Specification: Proveedores y Órdenes de compra — pasada fina

**Feature Branch**: `012-proveedores-y-ordenes-de-compra`
**Created**: 4 de agosto de 2026
**Status**: Draft — hay puntos abiertos, ver «Lo que falta decidir»
**Input**:

> Pasada fina de **Proveedores y Órdenes de compra**. Es el hito 6 del plan
> (`docs/PLAN-COMPRAFIT.md`, secciones 4.4 y 4.5). Van juntas porque comparten
> datos: una orden de compra es de un proveedor, y recibirla mueve su cuenta
> corriente.
>
> **4.4 · Proveedores (cuentas corrientes)**
>
> **Diseño.** Lista de proveedores a la izquierda, cuenta del seleccionado a la
> derecha. Saldo en grande y en mono.
>
> **Función.**
> - **Facturas con enlace a Drive.** El modelo `SupplierDocument` existe y el
>   endpoint también; no hay UI. El legacy lo tenía y es donde el contador busca.
> - **Exportar el asiento contable.** Del legacy, no está.
> - Badges de deuda en la lista, para ver de un vistazo a quién se le debe.
>
> **4.5 · Órdenes de compra**
>
> **Diseño.** Tabla en grid, detalle en panel lateral.
> **Función.** Completa (recepción parcial, anulación, WhatsApp). Solo diseño.

---

## Un aviso antes de empezar

El pedido dice que la función de Órdenes de compra está **completa** y que solo
falta el diseño. **El relevamiento dice otra cosa.** Hay cuatro defectos —dos de
plata, uno de aislamiento entre empresas y uno de filtros— que esta spec
incorpora porque rediseñar una pantalla que suma stock a la orden equivocada es
pintar la pared del lado de afuera.

Los cuatro están detallados en «Hallazgos del relevamiento». El más caro es que
la recepción de mercadería desde la pantalla de Proveedores **se aplica a la
primera orden pendiente y no a la que se eligió**: llega mercadería de la orden
#118 y el sistema la descuenta de la #112, con los precios de la #112.

---

## Qué patrones ya están fijados, y cuáles de ellos aplican acá

Las funcionalidades 009 (Historial de ventas), 010 (Inventario) y 011 (Punto de
venta) dejaron el patrón escrito en componentes compartidos. **Estas dos
pantallas no inventan nada que ya exista.** Decirlo explícitamente es parte del
trabajo: sin esto, `sdd-verify` marca como desvío cada cosa que se resolvió
distinta a propósito.

| Patrón | ¿Aplica? | Dónde y por qué |
|---|---|---|
| `MarcoDePantalla` (dos capas: la de afuera scrollea a ancho completo, la de adentro centra a 1320px) | **Sí, las dos pantallas** | `App.jsx:283-284` ya las envuelve. **Ninguna de las dos se sale del marco**, a diferencia del POS: no hay dos zonas de scroll independientes ni nada que pida el alto completo. `pruebas-de-navegador/marcoDeLasPantallas.navegador.js:42` ya las incluye en las diecisiete |
| `TablaGrid` / `Encabezado` / `Fila` / `BotonDeFila` | **Sí, en Órdenes de compra** | La maqueta la dibuja completa (`AdminApp-Rediseno.dc.html:657-682`) con las cuatro piezas: encabezado en `surface-2` con `11px 20px`, filas con `15px 20px`, `gap 0 16px`, botón de acción de 29px, fila entera clickeable, opacidad `.55` en las anuladas (`:1363`) |
| `TablaGrid` en Proveedores | **Sí, para el historial de cuenta** | La lista de proveedores de la izquierda **no** es una tabla —es una lista de selección, como el catálogo del POS—, pero el historial de movimientos de la derecha sí lo es, y hoy es un `<Table>` de shadcn (`Orders.jsx:413-447`), que es exactamente lo que `guardiasDeDiseno.test.js` prohíbe |
| La disciplina del `grid-template-columns` | **Sí, sin excepción** | El encabezado y las filas comparten el **mismo string**. En Órdenes de compra ese string ya está escrito en la maqueta: `96px minmax(0,1fr) 112px 96px 148px 132px 120px` |
| Panel lateral (`ui/sheet.jsx`, con `PanelVenta.jsx` y `PanelProducto.jsx` de ejemplo) | **Sí, en Órdenes de compra** | El pedido lo nombra y la maqueta lo dibuja (`:807-878`): 520px, `max-w-[92vw]`, kicker + título + subtítulo, bloques de datos en grilla de dos columnas, tabla de ítems con `minmax(0,1fr) 64px 96px 100px`, total en mono a 19px, nota de color, y pie con acción destructiva a la izquierda + secundaria + principal. Hoy son **dos modales** (`PurchaseOrders.jsx:310` y `:367`) |
| Panel lateral en Proveedores | **No** | El pedido pide dos columnas permanentes —lista a la izquierda, cuenta a la derecha—, no un panel que entra y sale. Es la misma forma que el POS: el detalle **es** la mitad derecha de la pantalla |
| Tokens de `index.css`, cero hex, cero `dark:`, cero clases de la paleta de Tailwind | **Sí, sin excepción** | Hoy `Orders.jsx` las rompe en cuatro lugares (`:320` y `:431` con `border-green-500/30`, `:388` con `border-green-600/30`, `:644` con `bg-green-600 hover:bg-green-700`). **Las dos pantallas entran a la lista de `guardiasDeDiseno.test.js` ANTES de reescribirlas**, igual que hicieron Inventario y el POS, y la guardia queda en rojo hasta que se reescriban |
| `.eyebrow` para etiquetas de columna, `.num` para todo lo comparable | **Sí** | Importes, saldos, cantidades, fechas de la tabla, número de orden y CUIT |
| Estado vacío con ícono apagado y dos líneas | **Sí, cuatro veces** | Sin órdenes, sin órdenes con ese filtro, sin proveedores, y proveedor sin movimientos |
| Encabezado de pantalla (`PageHeader`: `h1` + descripción + acción principal) | **Sí, las dos** | La maqueta lo dibuja para Órdenes de compra (`:634-642`). Hoy `PurchaseOrders.jsx:198` ya lo usa y `Orders.jsx:234-244` lo escribe a mano |
| `utils/` para las reglas, antes que un test de render | **Sí** | El saldo, el estado del proveedor, el color del badge, el porcentaje de recepción y las filas del archivo exportado son funciones puras. Ver «Qué se verifica en qué nivel» |
| `findScoped` / `scoped` / `assertEmpresaId` de `utils/tenantScope.js` | **Sí, y es el hallazgo principal** | Ver «Hallazgos del relevamiento», defectos 1 y 2 |
| `esCambioSignificativo` y `MOTIVOS` de `utils/historialDeCostos.js` | **Sí, si se decide [PENDIENTE 1]** | La comparación de costos en centavos enteros ya está resuelta ahí (`historialDeCostos.js:128`). **No se vuelve a escribir `Math.abs(a - b) >= 0.01`** en ningún lado: es el error que se comía cambios de costo reales según la magnitud del número |
| `armarHoja` / `celda` de `utils/exportarVentas.js` + `filaDeExport` de `api/utils/exportVentas.js` | **Sí** | Es el problema equivalente ya resuelto: la exportación para el contador. Ver «La exportación» |
| `aNumero` de `utils/importes.js` | **Solo si hay una entrada de importes escritos a mano** | Hoy los importes de estas dos pantallas entran por `<input type="number">`, que no admite `1.234,50`. La función existe para el camino contrario —leer lo que pegó una persona— y **no** hay que usarla para formatear |
| `enviarPedidoPorWhatsapp` de `utils/pedidoWhatsapp.js` | **Sí** | Ya lo usa `PurchaseOrders.jsx:91-118` para mandar la orden. El legacy además mandaba **el estado de cuenta** del proveedor (`legacy:8242`), que acá no existe |

---

## Contexto: qué existe hoy

Relevado antes de escribir. Sirve para no especificar de nuevo lo que ya está y
para no dar por hecho lo que está roto.

### Las dos pantallas

| Cosa | Dónde | Estado real |
|---|---|---|
| Pantalla de Proveedores | `apps/web/src/pages/Orders.jsx` (ruta `/proveedores`) | 654 líneas. Dos columnas `340px 1fr` (`:246`), lista con importe coloreado, cuenta con tres tarjetas apiladas y **cuatro diálogos modales** |
| Pantalla de Órdenes de compra | `apps/web/src/pages/PurchaseOrders.jsx` (ruta `/ordenes-compra`) | 411 líneas. Filtros en tarjeta, `<Table>` de shadcn, **dos modales** (detalle y recepción) |
| Marco | `App.jsx:283-284` | Las dos usan `MarcoDePantalla`. `/ordenes-compra` lleva `RouteGuard requiredModule="ordenes-compra"`; **`/proveedores` no lleva ninguno**, aunque `navegacion.js:34` declara `modulo: 'proveedores'`. Ver defecto 8 |
| Saldo del proveedor | `Orders.jsx:93-98` (`calculateBalance`) | Lo calcula **el navegador**, sumando en punto flotante todos los movimientos que trajo el listado |
| Badges de deuda | — | **No hay.** Hay un importe coloreado `text-destructive` / `text-ok` (`:267`) |
| Documentos / enlaces de Drive | `SupplierDocument` (`models/Supplier.js:143`), `POST /:id/documents` (`suppliers.js:195`), `DELETE /documents/:id` (`:207`) | **El modelo y los dos endpoints existen y funcionan. No hay una sola línea de interfaz.** El listado ya los trae (`suppliers.js:61`) y la pantalla los descarta |
| Exportación | — | **No hay ninguna**, ni de proveedores ni de órdenes |
| WhatsApp | `utils/pedidoWhatsapp.js`, botones en `PurchaseOrders.jsx:353-359` | Manda **la orden**. El estado de cuenta del proveedor (legacy `:8242`) no existe |
| Búsqueda y filtros en Proveedores | — | **No hay ninguno.** El legacy tenía búsqueda por nombre, filtro por estado y filtro por mes (`legacy:7539-7585`) |
| Filtros en Órdenes de compra | `PurchaseOrders.jsx:203-243` | Proveedor, estado, desde, hasta. **El valor «Todos» está roto**: ver defecto 4 |
| Paginación | `PurchaseOrders.jsx:128` (`params.limit = 100`) | Se muestra el total pero solo llegan 100 órdenes y **no hay forma de ver la 101** |
| Panel lateral | `components/ui/sheet.jsx`, `PanelVenta.jsx`, `PanelProducto.jsx` | Existe y está en producción en dos pantallas. Estas dos usan modales |
| Manejo de errores | `PurchaseOrders.jsx:133`, `:179`, `:190` | `console.error(err)`. **Una recepción que falla no le dice nada al usuario**: el diálogo queda abierto y la mercadería no se cargó |

### La API

| Cosa | Dónde | Estado real |
|---|---|---|
| Listar proveedores | `GET /api/suppliers` (`suppliers.js:55`) | Trae **todos** los proveedores con **todos** sus movimientos y **todos** sus documentos. Sin paginación, sin búsqueda, sin saldo calculado |
| Detalle de proveedor | `GET /api/suppliers/:id` (`:72`) | Scoping correcto. El `order` va **adentro** del `include` (`:77-78`), donde Sequelize lo ignora: los pedidos y los movimientos **no vienen ordenados por fecha** aunque el código diga que sí |
| Crear / editar / eliminar proveedor | `:90`, `:100`, `:112` | Scoping correcto. El `DELETE` borra pedidos, movimientos y documentos en una transacción |
| Registrar pago | `POST /api/suppliers/:id/payments` (`:149`) | **No verifica que el proveedor sea de la empresa.** Ver defecto 1 |
| Crear pedido | `POST /api/suppliers/:id/orders` (`:137`) → `purchaseService.createOrder` (`:14`) | **No verifica que el proveedor sea de la empresa, ni que los productos lo sean.** No llama a `assertEmpresaId`. Ver defecto 1 |
| Listar órdenes | `GET /api/suppliers/orders` (`:12`) → `getOrders` (`purchaseService.js:188`) | `if (empresa_id) where.empresa_id = empresa_id` (`:191`). Es un `if`, **no un assert**: con `empresaId` no resuelto devuelve las órdenes de todas las empresas. Ver defecto 2 |
| Recibir orden | `PUT /api/suppliers/orders/:id/receive` (`:32`) → `receiveOrder` (`purchaseService.js:56`) | **Lo mejor que hay acá.** `assertEmpresaId`, transacción, `lock: t.LOCK.UPDATE` sobre la fila de stock, copia profunda del JSONB, estado recalculado sobre **todas** las líneas, `empresa_id` en el `where` y en el alta. Tres bugs viejos documentados en el propio archivo |
| Anular orden | `:43` → `cancelOrder` (`purchaseService.js:177`) | Scoping correcto, pero **sin `assertEmpresaId`**. Rechaza `received` y `cancelled`; **acepta `partial`** y deja viva la deuda de lo ya recibido |
| Costo del producto al recibir | — | **`receiveOrder` no toca `Product.cost` ni escribe en `ProductCostHistory`.** Ver defecto 3 y [PENDIENTE 1] |
| Sucursal de la recepción | `purchaseService.js:109-113` | Sale de `resolverSucursal({ empresaId, puntoDeVentaId })`: la cabecera `X-Punto-De-Venta-Id`, y si no, la sucursal por defecto de la empresa. El parámetro `location` **ya no ubica nada** y está documentado así (`:99-103`). **El usuario no puede elegir dónde entra la mercadería** |
| Permisos | `seedPermissions.js:26-35` | Los nueve existen: `proveedores.{ver,crear,editar,eliminar}` y `ordenes_compra.{ver,crear,editar,recibir,anular}`. `ordenes_compra.editar` **no lo exige ningún endpoint** porque no hay edición de órdenes |
| Guardias estáticas | `aislamientoEmpresas.test.js`, `observabilidad.test.js:186-190` | `suppliers.js` está en la lista de excepciones **documentadas** de `observabilidad.test.js` por los tres `destroy` de hijos del `DELETE`. **Ninguna guardia mira el patrón de los defectos 1 y 2**: no hay `findByPk`, hay un `create` con un `parent_id` que nadie validó |

### El modelo de datos

`apps/api/src/models/Supplier.js` define cuatro tablas y **ninguna cambia en
esta funcionalidad** salvo lo que decida [PENDIENTE 1].

| Tabla | Campos | Notas |
|---|---|---|
| `suppliers` (`:10`) | `id`, `empresa_id`, `name`, `phone`, `email`, `address`, `cuit` | Único por `(empresa_id, name)` (`:44`) |
| `supplier_orders` (`:49`) | `id`, `empresa_id`, `supplier_id`, `date` (DATEONLY), `total` (DECIMAL 14,2), `notes`, `detail` (JSONB), `status` (`pending`/`partial`/`received`/`cancelled`) | El `detail` guarda `{product_id, product_name, quantity, unit_price, quantity_received}`. **No hay tabla de líneas**: es un JSONB |
| `supplier_movements` (`:95`) | `id`, `empresa_id`, `supplier_id`, `type` (`deuda`/`pago`), `date`, `amount` (DECIMAL 14,2), `payment_method`, `notes`, `due_date` | `due_date` existe y **nadie lo escribe ni lo lee** |
| `supplier_documents` (`:143`) | `id`, `empresa_id`, `supplier_id`, `name`, `type` (`factura`/`remito`/`presupuesto`/`otro`), `url` (TEXT), `date` | Es exactamente lo que el legacy guardaba en `prov.facturas` |

**Ninguna de las tres tablas hijas tiene índice por `empresa_id`** (`:88-91`,
`:136-139`, `:177-179`). Con el saldo calculado en el servidor eso pasa a
importar.

### Lo que el legacy hacía y acá no está

`legacy/index-legacy.html`, módulo «Cuentas con proveedores» (`:7484-8470`). Es
la mejor fuente sobre qué espera Comprafit.

| Función del legacy | Dónde | ¿Está en AdminApp? |
|---|---|---|
| Saldo = total pedidos − total pagos | `:7517` (`ccTotalDeuda`) | Sí, pero calculado en el navegador y **sobre otra definición de deuda**. Ver [PENDIENTE 2] |
| Cuatro estados: Sin pedidos / Saldado / Pago parcial / Con deuda | `:7522` (`ccEstado`) | **No.** Hay un importe coloreado en dos tonos |
| Barra de «% pagado» por proveedor | `:7617`, `:7643-7646` | **No** |
| Tarjetas de totales: proveedores, comprado, pagado, saldo | `:7592-7596` | **No** |
| Badge «✅ Factura cargada» / «⚠️ Sin factura» por proveedor | `:7621`, `:7637-7640` | **No** |
| Badge «N sin factura» en la barra lateral | `:1445`, `:7889` (`ccActualizarBadgeSidebar`) | **No** |
| Documentos con enlace de nube (nombre + link + tipo + fecha) | `:7924` (`ccAgregarFacturaLink`), `:7948` (`ccRenderFacturas`) | **Modelo y endpoints sí; interfaz no** |
| Instrucciones de Google Drive dentro de la pantalla | `:2516-2549` | **No** |
| Enlace de factura **por pedido**, además del del proveedor | `:8068`, `:8182` (`ccGuardarFacturaPedido`, detecta Drive / Dropbox / OneDrive) | **No.** `SupplierDocument` cuelga del proveedor, no de la orden |
| Copiar el enlace al portapapeles | `:7993`, `:8201` | **No** |
| Asiento contable DEBE / HABER en pantalla | `:8268` (`ccRenderAsiento`) | **No** |
| Exportar el asiento (texto al portapapeles) | `:8432` (`ccExportarAsiento`) | **No** |
| Estado de cuenta por WhatsApp | `:8242` (`ccExportarWhatsApp`) | **No** |
| Cuatro solapas en la cuenta: movimientos / pedidos / facturas / asiento | `:2460`, `:7875` (`ccSetTab`) | **No** |
| Pago: valida monto > 0 y **avisa si supera el saldo** | `:8411-8417` | **No.** Hoy se acepta cualquier número, incluido `NaN` |
| Métodos de pago: transferencia, efectivo, **cheque**, QR | `:8248`, `:8283` | **Falta cheque** (`Orders.jsx:636-638` ofrece tres) |
| Editar y eliminar un movimiento | `:8348`, `:8399` | Endpoints sí (`suppliers.js:170`, `:182`); **botones no** |
| Búsqueda, filtro por estado y filtro por mes | `:7539-7585` | **No** |

---

## Hallazgos del relevamiento

Los ocho defectos que el relevamiento encontró. **Los seis primeros entran**;
los dos últimos quedan anotados con su motivo.

### Entran

**1. Dos endpoints escriben en la cuenta de un proveedor de otra empresa.** Es
la regla que este proyecto ya rompió veintiocho veces, y esta vez **con una
forma que ninguna guardia mira**.

`POST /api/suppliers/:id/payments` (`suppliers.js:149-165`) hace:

```js
const movement = await SupplierMovement.create({
  supplier_id: req.params.id,      // ← nadie verificó de quién es este proveedor
  empresa_id: req.empresaId,
  type: 'pago', date, amount, payment_method, notes,
});
```

`POST /api/suppliers/:id/orders` (`:137`) → `purchaseService.createOrder`
(`purchaseService.js:14-44`) hace lo mismo con `SupplierOrder`, y además **no
llama a `assertEmpresaId`** ni valida que los `product_id` del detalle sean de
la empresa.

El contraste está tres líneas más abajo, en el mismo archivo:
`POST /:id/documents` (`:195-204`) **sí** busca el proveedor con `empresa_id`
antes de crear el hijo. O sea que la forma correcta ya está escrita acá al lado.

**Por qué no lo detecta ninguna guardia**: `aislamientoEmpresas.test.js:57`
busca `findByPk(req.params…)` y acá no hay ninguno; `observabilidad.test.js:191`
busca `where: { algo_id: req.params.id }` y acá no hay un `where`, hay un
`create`. El patrón es nuevo: **escribir una fila hija bajo un padre que nadie
validó**.

**Por qué se ve del otro lado**: los `include` de `GET /api/suppliers` (`:60`) y
`GET /api/suppliers/:id` (`:77-79`) traen los hijos **por `supplier_id`, sin
filtrar por `empresa_id`**. Un pago inyectado desde la empresa B aparece en la
cuenta corriente de la empresa A y le cambia el saldo. Ni la empresa A ni la B
tienen forma de darse cuenta. → **FR-060 a FR-064**.

**2. `getOrders` filtra por empresa con un `if`, no con un assert.**
`purchaseService.js:191`:

```js
if (empresa_id) where.empresa_id = empresa_id;
```

Es exactamente el patrón `req.empresaId || 1` que
`aislamientoEmpresas.test.js:39-53` prohíbe, escrito al revés: ante un contexto
de empresa no resuelto no cae en la empresa 1, cae en **todas**. Además el
`include` de `Supplier` (`:206`) no lleva filtro de empresa, así que
`supplier_name` puede venir de otro cliente. `cancelOrder` (`:177`) tampoco
llama a `assertEmpresaId`. → **FR-065, FR-066**.

**3. Recibir mercadería no actualiza el costo del producto, y nada avisa.**
`receiveOrder` suma stock, marca las cantidades recibidas y crea la deuda con el
proveedor (`purchaseService.js:162-171`). **No toca `Product.cost` ni escribe
una fila de `ProductCostHistory`.**

Comprar a $1.200 un producto costeado a $900 deja el costo en $900. El margen
que muestra el POS y el punto de equilibrio del panel se calculan sobre un costo
que dejó de ser cierto, y no falla nada: la pantalla abre, se ve bien, y el
precio recomendado garantiza menos ganancia de la que dice.

Que la recepción de una **orden de producción** sí lo haga
(`historialDeCostos.js:67`, `MOTIVOS.ORDEN_DE_PRODUCCION`) hace la asimetría más
difícil de justificar: los dos son mercadería que entra con un costo nuevo.

**Qué hacer exactamente es [PENDIENTE 1]**, porque pisar el costo con el último
precio de compra tampoco es gratis. Lo que **no** se hace en ningún caso es
escribir una comparación de importes con tolerancia de punto flotante: la
comparación en centavos enteros ya existe en `esCambioSignificativo`
(`historialDeCostos.js:128`) y el motivo está escrito arriba de la función.
→ **FR-070 a FR-073**.

**4. La recepción desde Proveedores se aplica a la orden equivocada.**
`Orders.jsx:611-614`:

```jsx
onClick={() => {
  const order = selectedSupplier?.orders?.find(o => o.status === 'pending' || o.status === 'partial')
  if (order) handleReceiveOrder(order)
}}
```

El diálogo se abre desde el botón «Recibir» de **una** orden (`:388-391`), pero
no guarda cuál: recibe siempre contra **la primera pendiente de la lista**.

Peor: los ítems que muestra el diálogo salen de aplanar el detalle de **todas**
las órdenes pendientes y deduplicar por `product_id` (`:588-593`), y
`receiveItems` se indexa **solo por `product_id`** (`:604`). Entonces:

- Escribir «recibí 10 de Colágeno» en la orden #118 manda esa cantidad a la
  orden #112, que es la primera pendiente.
- `receiveOrder` la valora con el `unit_price` de la #112
  (`purchaseService.js:91`), así que **la deuda que se crea es por un importe que
  nunca se acordó**.
- La orden #118 sigue pendiente para siempre y la #112 se marca recibida sin
  que haya llegado nada de ella.
- Dos líneas de órdenes distintas con el mismo producto comparten un solo campo
  de entrada.

Un ítem con `product_id: null` —que `createOrder` permite (`purchaseService.js:25`)
y la pantalla produce cuando se escribe un nombre libre (`Orders.jsx:172`)—
colapsa con todos los demás sin producto bajo la misma clave `null`.

Es un error de plata y de stock, y es silencioso: la pantalla dice «Mercadería
recibida». → **FR-030 a FR-034**.

**5. El filtro «Todos» de Órdenes de compra rompe el listado.**
`PurchaseOrders.jsx:212` y `:224` usan `<SelectItem value=" ">` —un espacio— para
la opción «Todos». `fetchOrders` filtra con `if (filters.supplier_id)`
(`:124`), y `' '` es verdadero: sale `?supplier_id=%20`, que llega a
`where.supplier_id = ' '` sobre una columna `INTEGER`. Postgres responde
`invalid input syntax for type integer`, el `catch` hace `console.error`
(`:134`) y **la pantalla queda con la lista anterior y sin ningún aviso**.

Volver a «Todos» después de filtrar por un proveedor no vuelve a «Todos»:
rompe. → **FR-020, FR-021**.

**6. Cuatro errores de plata y de fecha en la pantalla de Proveedores.**
Ninguno hace fallar nada:

- **El saldo se suma en punto flotante** (`Orders.jsx:95-97`) sobre `DECIMAL`
  que el driver devuelve como texto. Es el mismo problema que
  `esCambioSignificativo` documenta.
- **Los importes se formatean con `.toLocaleString()` sin opciones**
  (`:268`, `:312`, `:355`, `:377`): `1234` sale «1.234», `1234.5` sale «1.234,5»
  y `1234.56` sale «1.234,56». Tres formatos distintos en la misma columna, y
  la cantidad de decimales depende del dato. `PurchaseOrders.jsx:147` ya lo hace
  bien con `es-AR` y `minimumFractionDigits: 2`, y `PanelVenta.jsx:36` también.
- **Las fechas se corren un día.** `new Date(m.date).toLocaleDateString()`
  (`Orders.jsx:427`) sobre un `DATEONLY` `'2026-08-04'` lo interpreta como
  medianoche **UTC** y en Argentina (UTC−3) muestra el 3. `PanelVenta.jsx:49-56`
  ya tiene la solución escrita —`fechaCorta`, que parte el string sin pasar por
  `Date`— y hasta el comentario que explica por qué.
- **El historial ordena mutando el estado de React**
  (`:424`: `selectedSupplier.movements?.sort(...)`). → **FR-050 a FR-053**.

### Queda anotado, fuera de alcance

**7. `GET /api/suppliers` trae la contabilidad entera en cada carga.** Todos los
proveedores, con todos sus movimientos y todos sus documentos, sin paginar
(`suppliers.js:57-64`), y el único uso de esos movimientos es sumarlos para
mostrar un número. Con tres años de operación son decenas de miles de filas por
cada vez que se abre la pantalla. **Lo cubre [PENDIENTE 3]**: si el saldo pasa
al servidor, el `include` de movimientos se cae solo.

**8. `/proveedores` no tiene `RouteGuard`.** `navegacion.js:34` declara
`modulo: 'proveedores'` y `App.jsx:283` monta la ruta sin guardia, mientras que
`/ordenes-compra` sí la tiene (`:284`). El plan (sección 2) dice que el gateo va
en los tres lados o no sirve. Es una línea y **entra** —está en FR-090—, pero se
anota acá porque no es de esta funcionalidad: es una inconsistencia del gateo
que se arrastra.

---

## Vocabulario: qué significa cada palabra acá

Sin esto, «deuda» quiere decir tres cosas distintas en la misma pantalla.

| Palabra | Qué significa | Dónde vive |
|---|---|---|
| **Proveedor** | A quién se le compra | `suppliers` |
| **Orden de compra** / **pedido** | Lo que se le pidió a un proveedor. Son la misma cosa: la pantalla de Proveedores dice «pedido» (`Orders.jsx:318`) y la de Órdenes dice «orden». **La spec usa «orden» en las dos** | `supplier_orders` |
| **Recepción** | Lo que **efectivamente llegó** de una orden. Puede ser parcial y puede repetirse | `detail[].quantity_received` |
| **Movimiento** | Una línea de la cuenta corriente. Solo dos tipos: `deuda` (mercadería recibida) y `pago` | `supplier_movements` |
| **Deuda** | La suma de los movimientos de tipo `deuda`. **Hoy la genera la recepción, no la emisión de la orden.** El legacy contaba al revés: [PENDIENTE 2] |
| **Pagado** | La suma de los movimientos de tipo `pago` |
| **Saldo** | `deuda − pagado`. **Positivo = se le debe al proveedor.** El signo importa: `Orders.jsx:267` ya usa esa convención y el color va atado a ella |
| **Documento** | Una factura, remito o presupuesto del proveedor, guardado como **enlace** a Drive / Dropbox / OneDrive. **AdminApp no almacena el archivo**, ni el legacy tampoco (`legacy:2516-2518`) | `supplier_documents` |
| **Asiento contable** | La vista DEBE / HABER de la cuenta corriente, que es como la lee un contador. En el legacy es texto plano (`legacy:8268`) |

### Los cuatro estados de una orden

Son los del enum (`models/Supplier.js:82`), y ya tienen etiqueta en las dos
pantallas (`Orders.jsx:44-49`, `PurchaseOrders.jsx:51-56`). **Las dos listas son
copias**, con el mismo riesgo que ya tuvieron los medios de pago: se separan y
nada avisa.

| Estado | Etiqueta | Recibible | Anulable | Tono |
|---|---|---|---|---|
| `pending` | Pendiente | Sí | Sí | Neutro (`surface-3` / `fg-2`) |
| `partial` | Recibida parcial | Sí | Sí | Advertencia (`warn`) |
| `received` | Recibida | No | **No** (`purchaseService.js:180`) | Correcto (`ok`) |
| `cancelled` | Anulada | No | No | Neutro, fila al 55 % de opacidad (maqueta `:1363`) |

### Los cuatro estados de un proveedor

Del legacy (`:7522`), que es lo que Comprafit leyó durante años. Son la regla
detrás del badge de deuda que pide el plan.

| Estado | Condición | Tono |
|---|---|---|
| Sin movimientos | `deuda === 0 && pagado === 0` | Neutro |
| Saldado | `saldo <= 0` con deuda > 0 | Correcto (`ok`) |
| Pago parcial | `saldo > 0 && pagado > 0` | Advertencia (`warn`) |
| Con deuda | `saldo > 0 && pagado === 0` | Peligro (`danger`) |

---

## La exportación para el contador

El problema equivalente ya está resuelto en el historial de ventas, y **se
copia**, no se vuelve a resolver.

`apps/api/src/utils/exportVentas.js` y `apps/web/src/utils/exportarVentas.js`
dejaron escritas tres cosas que valen igual acá:

1. **El servidor arma las filas, el navegador arma la hoja.** `filaDeExport`
   (`exportVentas.js:76`) decide qué dice cada celda y es pura; `armarHoja`
   (`exportarVentas.js:76`) fuerza el tipo celda por celda.
2. **Los importes van como número, no como texto formateado.** `total:
   Number(venta.total) || 0` (`exportVentas.js:94`) y `{ t: 'n' }`
   (`exportarVentas.js:60`). Es **la trampa de los importes argentinos vista
   desde el lado de la escritura**: si la celda dice el string `"1.234,50"`,
   Excel la toma como texto en un idioma y como `1234.5` en otro, la columna
   Total no suma, y el archivo abre, se ve bien, y está mal. La versión de
   lectura de ese mismo problema es `utils/importes.js`, y **acá no se usa**.
3. **El nombre del archivo lleva los filtros adentro** (`nombreDelArchivo`,
   `:115`), para que dos exportaciones distintas no se pisen en la carpeta de
   descargas.

Lo que **no** se copia es la lista de columnas: las de una cuenta corriente no
son las de una venta. Cuáles son, y si además hay una salida de texto tipo
asiento como la del legacy, es **[PENDIENTE 4]**.

---

## Qué se verifica en qué nivel

`docs/specs/CONVENCIONES.md` fija la tabla; acá se aplica caso por caso, porque
es donde se equivoca. **Primero la función pura.** Las pruebas de navegador
existen desde hoy y el listón es alto a propósito.

| Afirmación | Nivel | Archivo |
|---|---|---|
| El saldo de un proveedor a partir de sus movimientos | **Función pura** | `utils/cuentaDeProveedor.js` |
| El estado del proveedor y el tono de su badge | **Función pura** | idem |
| El porcentaje de recepción de una orden | **Función pura** | `utils/ordenDeCompra.js` |
| Qué órdenes entran en cada segmento y con qué contador | **Función pura** | idem |
| Si una orden es recibible o anulable | **Función pura** | idem |
| El formato de un importe y de una fecha `DATEONLY` | **Función pura** | idem / reutilizar `fechaCorta` |
| Que un enlace de documento sea aceptable y de qué nube es | **Función pura** | `utils/documentosDeProveedor.js` |
| Las filas y los tipos de celda del archivo exportado | **Función pura** | `utils/exportarProveedores.js`, como `exportarVentas.test.js` |
| Que el badge de deuda esté **en la fila del proveedor que corresponde** | **Test de render** | `tests/renderDeProveedores.test.jsx` |
| Que el encabezado y las filas de la tabla compartan `grid-template-columns` | **Test de render** | `tests/renderDeOrdenesDeCompra.test.jsx` |
| Que «Recibir» de la orden #118 abra el panel de la #118 | **Test de render** | idem — es el defecto 4 y es lo que hay que blindar |
| Que confirmar la recepción mande **una sola** llamada, con el id de esa orden | **Test de render**, espiando `api.put` | idem |
| Que el campo de cantidad quede deshabilitado sin `ordenes_compra.recibir` | **Test de render** | idem |
| Que un error de la API muestre un aviso y **no cierre** el panel | **Test de render** | idem |
| Que la tabla scrollee dentro de su tarjeta y el `<body>` no desborde | **Prueba de navegador** | `pruebas-de-navegador/` (las dos rutas ya están en la lista de `marcoDeLasPantallas.navegador.js:42`) |
| Que el nombre de un proveedor largo no se meta en la columna de saldo | **Prueba de navegador** | idem |
| Que el panel lateral mida 520px de verdad, después de que opine el `max-w-[92vw]` | **Prueba de navegador** | idem |
| Que las dos columnas de Proveedores no se solapen a 1140px | **Prueba de navegador** | idem |
| Que ningún endpoint escriba un hijo bajo un padre de otra empresa | **Test de API + guardia estática** | `tests/aislamientoEmpresas.test.js` (patrón nuevo) |

**Lo que NO baja al navegador**, aunque se pueda escribir: el color del badge,
qué órdenes entran en un segmento, el redondeo de un importe. Todo eso lo
contesta una función pura, y repetirlo en Chromium cuesta cincuenta veces más
por caso.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Órdenes de compra con la tabla en grid de la maqueta (Priority: P1)

Como responsable de compras, quiero ver todas las órdenes en una tabla que se
lee de un vistazo, con el estado de recepción visible en la fila, para saber qué
está por llegar sin abrir nada.

**Why this priority**: es la mitad «diseño» del pedido y **la única de las dos
pantallas que la maqueta dibuja completa** (`AdminApp-Rediseno.dc.html:632-684`).
Todo lo demás de esta funcionalidad se apoya en ella.

**Independent Test**: abrir `/ordenes-compra` con seis órdenes en los cuatro
estados y comparar contra el bloque `isCompras` de la maqueta.

**Acceptance Scenarios**:

1. **Given** la pantalla abierta, **When** la miro, **Then** hay un
   `PageHeader` con «Órdenes de compra», la descripción de la maqueta (`:637`) y
   un botón principal a la derecha.
2. **Given** la tabla, **When** la miro, **Then** está construida con
   `TablaGrid` / `Encabezado` / `Fila` y **no** con los `Table*` de shadcn
   (`PurchaseOrders.jsx:254-304`).
3. **Given** el encabezado, **When** lo miro, **Then** dice
   `Orden · Proveedor · Fecha · Ítems · Recepción · Total · Acciones` con
   `.eyebrow`, y su `grid-template-columns` es **exactamente el mismo string**
   que el de cada fila: `96px minmax(0,1fr) 112px 96px 148px 132px 120px`.
4. **Given** una fila, **When** la miro, **Then** el número de orden y la fecha
   van en `.num`, el nombre del proveedor trunca con elipsis en una línea, los
   ítems van centrados y el total a la derecha en `.num` con más peso.
5. **Given** la celda de Recepción, **When** la miro, **Then** tiene dos
   líneas: la etiqueta del estado en su tono, y debajo una barra de **4px** de
   alto y bordes redondeados cuyo ancho es el porcentaje recibido (maqueta
   `:667-672`).
6. **Given** una orden anulada, **When** la miro, **Then** la fila está al
   **55 %** de opacidad y no ofrece ninguna acción (maqueta `:1363`).
7. **Given** una orden pendiente o parcial, **When** miro sus acciones,
   **Then** hay un botón «Recibir» en tono correcto y un botón de más acciones,
   los dos de **29px**, y los dos **frenan la propagación del clic**.
8. **Given** cualquier fila, **When** la toco en cualquier lugar que no sea un
   botón, **Then** se abre el panel lateral de esa orden.
9. **Given** los segmentos de arriba, **When** los miro, **Then** son
   `Todas · Pendientes · Parciales · Recibidas` con el estilo de segmentos de la
   maqueta (`:645-649`), **cada uno con su contador en `.num`**, y no cuatro
   botones sueltos ni un `<select>`.
10. **Given** el buscador, **When** escribo, **Then** filtra por nombre de
    proveedor **y por número de orden** (maqueta `:652`), sin recargar la página.
11. **Given** el filtro de fechas, **When** lo miro, **Then** es un botón de
    filtro de **36px** con ícono a la izquierda y chevron a la derecha, con el
    período vigente escrito adentro (maqueta `:654`).
12. **Given** una lista vacía, **When** la miro, **Then** veo el estado vacío
    con dos líneas, y **dice si es porque no hay órdenes o porque el filtro no
    devolvió ninguna**, que son cosas distintas.
13. **Given** una ventana de 1140px, **When** la achico, **Then** la tabla
    scrollea **dentro de su tarjeta** y el `<body>` no desborda a lo ancho.
14. **Given** el archivo terminado, **When** lo reviso, **Then** no tiene ningún
    hexadecimal, ninguna regla `dark:`, ninguna clase de la paleta de Tailwind
    ni ningún `Table*`, y `pages/PurchaseOrders.jsx` **está en la lista de
    `guardiasDeDiseno.test.js`**.

---

### User Story 2 — El detalle de la orden en un panel lateral, sin perder la lista (Priority: P1)

Como responsable de compras, quiero abrir una orden y ver sus ítems, su estado y
sus acciones sin que la lista desaparezca, para revisar tres órdenes seguidas
sin volver a filtrar cada vez.

**Why this priority**: el pedido lo nombra explícitamente («detalle en panel
lateral») y hoy son **dos modales** que tapan la pantalla y se pisan entre sí.

**Independent Test**: abrir una orden parcial, cerrar el panel y verificar que
el filtro, el segmento, el scroll y la posición de la lista quedaron donde
estaban.

**Acceptance Scenarios**:

1. **Given** una fila, **When** la toco, **Then** entra un panel lateral de
   **520px** con `max-w-[92vw]` desde la derecha, con `anim-panel`, y la lista
   sigue detrás.
2. **Given** el panel abierto, **When** aprieto `Esc` o toco fuera, **Then** se
   cierra y el foco vuelve a la fila que lo abrió (lo resuelve `ui/sheet.jsx`).
3. **Given** el panel, **When** miro el encabezado, **Then** dice «Orden de
   compra» como kicker, el número y el proveedor como título, y «Emitida el
   {fecha} · {n} ítems» como subtítulo (maqueta `:1131`).
4. **Given** el panel, **When** miro el bloque de seguimiento, **Then** está en
   una grilla de **dos columnas** con las filas que el modelo tiene de verdad:
   estado, porcentaje recibido, fecha y notas. **[PENDIENTE 7]** decide qué pasa
   con «Entrega estimada» y «Condición de pago», que la maqueta dibuja
   (`:1136-1137`) y `supplier_orders` **no guarda**.
5. **Given** el panel, **When** miro los ítems, **Then** el encabezado dice
   «Ítems · recibido / pedido» y cada línea muestra `recibido / pedido` en una
   sola celda —`8 / 12`, como la maqueta (`:1126`)— más unitario y subtotal,
   todo en `.num`, con `grid-template-columns: minmax(0,1fr) 64px 96px 100px`.
6. **Given** el panel, **When** miro el pie de los ítems, **Then** el total va
   en `.num` a **19px** sobre `surface-2`.
7. **Given** una orden recibible, **When** miro el pie del panel, **Then** hay
   «Anular orden» en tono destructivo a la izquierda y «Registrar recepción»
   como acción principal a la derecha.
8. **Given** una orden ya recibida o anulada, **When** miro el pie, **Then**
   **no** hay ninguna acción destructiva ni de recepción.
9. **Given** una orden recibible, **When** miro el panel, **Then** aparece la
   nota informativa de la maqueta (`:1144`) explicando que la recepción
   actualiza el stock en el mismo paso.
10. **Given** el panel, **When** miro las acciones de WhatsApp, **Then** siguen
    estando las dos que ya funcionan —con precios y sin precios
    (`PurchaseOrders.jsx:353-359`)—, y siguen avisando cuando el proveedor no
    tiene teléfono cargado. **Una función liberada no se pierde por seguir un
    dibujo** (mismo criterio que FR-009 de la funcionalidad 010).
11. **Given** un usuario sin `ordenes_compra.recibir`, **When** abro una orden
    pendiente, **Then** la acción de recepción está deshabilitada **con su
    explicación**, y no ausente.
12. **Given** un usuario sin `ordenes_compra.anular`, **When** abro una orden
    pendiente, **Then** «Anular orden» está deshabilitada con su explicación.

---

### User Story 3 — La recepción se aplica a la orden que elegí, y a ninguna otra (Priority: P1)

Como responsable de compras, quiero que cargar lo que llegó de la orden #118
sume stock y genere deuda **por la orden #118**, para que el saldo del proveedor
y el stock del depósito digan la verdad.

**Why this priority**: es el defecto 4, y es de plata **y** de stock, **y** es
silencioso: hoy la pantalla dice «Mercadería recibida» mientras carga la orden
equivocada con los precios equivocados. El pedido daba la función por completa.

**Independent Test**: un proveedor con dos órdenes pendientes que comparten un
producto; recibir 10 unidades desde la segunda y verificar contra la API que la
que cambió de estado es **la segunda**, y que la deuda creada usa **su**
`unit_price`.

**Acceptance Scenarios**:

1. **Given** un proveedor con dos órdenes pendientes, **When** aprieto
   «Recibir» en la segunda, **Then** el formulario de recepción muestra
   **únicamente los ítems de esa orden**.
2. **Given** ese formulario, **When** confirmo, **Then** sale **una sola**
   llamada a `PUT /api/suppliers/orders/:id/receive` y el `:id` es el de la
   orden que abrí.
3. **Given** dos órdenes que piden el mismo producto, **When** cargo una
   cantidad en una de ellas, **Then** el campo de la otra no cambia: **los
   campos se indexan por línea de la orden, no por `product_id`**.
4. **Given** una orden con dos líneas sin `product_id` —nombre libre—, **When**
   miro el formulario, **Then** hay **dos** campos independientes y no uno solo.
5. **Given** una línea con 12 pedidas y 8 ya recibidas, **When** miro su campo,
   **Then** el máximo que puedo escribir es **4** y la pantalla dice
   `Pedido: 12 · Recibido: 8`.
6. **Given** una cantidad mayor a la pendiente, **When** confirmo, **Then** el
   servidor recorta a lo pendiente (`purchaseService.js:86`) y la pantalla
   **avisa cuánto se cargó realmente**, en vez de decir que se cargó lo que se
   escribió.
7. **Given** una recepción parcial, **When** se confirma, **Then** la orden
   queda en `partial`, se crea **un** movimiento de deuda por el importe de lo
   recibido en esa recepción, y la lista y la cuenta se actualizan sin recargar
   la página.
8. **Given** una recepción que completa la orden, **When** se confirma,
   **Then** la orden queda en `received` y ya no ofrece «Recibir».
9. **Given** una recepción que falla en el servidor, **When** llega el error,
   **Then** el panel **queda abierto**, con las cantidades escritas intactas y
   un aviso legible. Hoy hace `console.error` y no muestra nada
   (`PurchaseOrders.jsx:179-181`).
10. **Given** una recepción en curso, **When** aprieto confirmar dos veces,
    **Then** se registra **una** recepción.
11. **Given** una orden con todas las líneas en cantidad cero recibida,
    **When** confirmo, **Then** no se crea ningún movimiento de deuda y la orden
    no cambia de estado.
12. **Given** la pantalla de Proveedores, **When** recibo desde ahí, **Then**
    vale exactamente lo mismo: es el **mismo componente de recepción**, no una
    segunda copia. Hoy hay dos implementaciones distintas y la de Proveedores es
    la que está rota.

---

### User Story 4 — Nadie de otra empresa puede escribir en la cuenta de mis proveedores (Priority: P1)

Como dueño de una empresa cliente, quiero que ninguna otra empresa pueda crear
un pago, una orden o un movimiento sobre mis proveedores, para que mi saldo sea
mi saldo.

**Why this priority**: es la regla que no se negocia
(`CONVENCIONES.md`, «Aislamiento entre empresas»), la auditoría ya encontró
veinte endpoints con esta falla y ocho más un mes después, y **el patrón de
estos dos no lo detecta ninguna guardia existente**.

**Independent Test**: con dos empresas sembradas, autenticar como la B y hacer
`POST /api/suppliers/{id_de_A}/payments`. Tiene que responder **404** y no dejar
ninguna fila. Verificable contra hoy, donde responde 201 y le cambia el saldo a
la empresa A.

**Acceptance Scenarios**:

1. **Given** un proveedor de la empresa A, **When** la empresa B hace
   `POST /api/suppliers/{id}/payments`, **Then** responde **404** y no se crea
   ningún `SupplierMovement`.
2. **Given** el mismo proveedor, **When** la empresa B hace
   `POST /api/suppliers/{id}/orders`, **Then** responde **404** y no se crea
   ninguna `SupplierOrder`.
3. **Given** un producto de la empresa A, **When** la empresa B lo mete en el
   detalle de una orden propia, **Then** la orden se rechaza con un error de
   negocio legible, y **no** queda una línea que apunta al producto de otro
   cliente.
4. **Given** una empresa con proveedores y movimientos, **When** se piden su
   listado y su detalle, **Then** los `include` de órdenes, movimientos y
   documentos filtran **también por `empresa_id`**, y no solo por `supplier_id`.
5. **Given** `getOrders` sin `empresa_id` resuelto, **When** se la llama,
   **Then** **falla con 500** por `assertEmpresaId` y no devuelve las órdenes de
   todas las empresas.
6. **Given** `cancelOrder`, **When** se la llama, **Then** también valida el
   `empresaId` con `assertEmpresaId`.
7. **Given** el listado de órdenes, **When** miro el nombre del proveedor de
   cada fila, **Then** viene de un `include` acotado a la empresa.
8. **Given** el código de `routes/` y `services/`, **When** corre la guardia,
   **Then** **falla si vuelve a aparecer un `Model.create({ …_id: req.params.… })`
   sin que el padre se haya resuelto con `empresa_id` unas líneas antes**. Es un
   patrón nuevo: el que ya existe busca `findByPk` y `where`, y este no es
   ninguno de los dos.
9. **Given** las guardias que ya existen, **When** corre la suite, **Then**
   ninguna de `aislamientoEmpresas.test.js` ni de `observabilidad.test.js`
   empieza a fallar, y la excepción documentada de `suppliers.js`
   (`observabilidad.test.js:186-190`) sigue siendo la misma o se achica.

---

### User Story 5 — Proveedores: quién me debe qué, de un vistazo (Priority: P1)

Como dueño, quiero ver la lista de proveedores con un badge que diga a quién le
debo y cuánto, y la cuenta del que elijo a la derecha con el saldo en grande,
para decidir a quién pagar sin abrir uno por uno.

**Why this priority**: es la mitad «diseño» de la sección 4.4 y los badges de
deuda son el tercer punto de su lista de función.

**Independent Test**: abrir `/proveedores` con cuatro proveedores en los cuatro
estados y verificar que cada badge es el que corresponde y que el saldo grande
del seleccionado coincide con su columna de la lista.

**Nota de contexto**: **la maqueta no dibuja esta pantalla.** `proveedores` es
un ítem del menú (`AdminApp-Rediseno.dc.html:956`, `:1161`) y cae en `isStub`
(`:1282`). El diseño sale del texto del plan más los primitivos que la maqueta
sí fijó —tabla en grid, badges, segmentos, estado vacío, saldo en mono— y de la
referencia viva, `pages/Comparador.jsx`.

**Acceptance Scenarios**:

1. **Given** la pantalla, **When** la miro, **Then** hay dos columnas: lista de
   proveedores a la izquierda y cuenta del seleccionado a la derecha.
2. **Given** una fila de la lista, **When** la miro, **Then** veo el nombre, un
   **badge de estado** —Sin movimientos / Saldado / Pago parcial / Con deuda,
   con los tonos de la tabla de arriba— y el **saldo en `.num`** alineado a la
   derecha.
3. **Given** el badge, **When** miro su color, **Then** sale de los tokens
   (`danger-soft` / `danger-line` / `danger` y sus pares `warn` y `ok`), como el
   `tonoDeStock` de Inventario, y **nunca de un color suelto**.
4. **Given** un proveedor seleccionado, **When** lo miro, **Then** su fila está
   marcada y la columna derecha muestra su cuenta.
5. **Given** la cuenta del proveedor, **When** la miro, **Then** el **saldo
   pendiente está en grande y en `.num`**, es el elemento de más peso visual del
   bloque, y su tono sale del signo del saldo.
6. **Given** la cuenta, **When** miro el resumen, **Then** además del saldo veo
   **total comprado** y **total pagado**, como el legacy (`:7659-7663`): un
   saldo de $0 no distingue «nunca le compré» de «le compré y le pagué todo».
7. **Given** la cuenta, **When** miro el historial de movimientos, **Then**
   está construido con `TablaGrid` y no con los `Table*` de shadcn
   (`Orders.jsx:413-447`), con columnas Fecha · Operación · Notas · Debe ·
   Haber, los importes en `.num` a la derecha.
8. **Given** el historial, **When** lo miro, **Then** está ordenado por fecha
   descendente **sin mutar el estado de React** (`Orders.jsx:424`), y el orden
   lo decide una función pura.
9. **Given** un proveedor sin movimientos, **When** lo abro, **Then** veo el
   estado vacío con dos líneas y no una tabla en blanco.
10. **Given** ningún proveedor seleccionado, **When** entro, **Then** veo el
    estado vacío que dice qué hacer, como hoy (`Orders.jsx:451-455`).
11. **Given** una lista larga, **When** la miro, **Then** hay un buscador por
    nombre, como el legacy (`:7542`). **[PENDIENTE 3]** decide si además hay
    paginación.
12. **Given** el archivo terminado, **When** lo reviso, **Then** no tiene
    hexadecimales, `dark:`, clases de la paleta de Tailwind ni `Table*`, y
    `pages/Orders.jsx` **está en la lista de `guardiasDeDiseno.test.js`**.
13. **Given** la ruta `/proveedores`, **When** la abre alguien de una empresa
    que no tiene el módulo habilitado, **Then** `RouteGuard` la corta, igual que
    hace `/ordenes-compra` (`App.jsx:284`).

---

### User Story 6 — El saldo, los importes y las fechas dicen la verdad (Priority: P1)

Como dueño, quiero que el número que muestra la pantalla sea el que resulta de
los movimientos, con la misma cantidad de decimales siempre y con la fecha del
día en que pasó la cosa.

**Why this priority**: es el defecto 6. Un error de plata no falla: la pantalla
abre, se ve bien, y el número está mal. Y las tres piezas correctas ya existen
en el repositorio.

**Independent Test**: sembrar movimientos que exhiban los tres problemas —una
suma que en punto flotante da `1234.5600000000002`, un importe entero, una fecha
`DATEONLY` del primero de mes— y verificar los tres contra funciones puras.

**Acceptance Scenarios**:

1. **Given** un proveedor con movimientos, **When** miro su saldo, **Then**
   sale de una función pura que suma **en centavos enteros**, con la misma
   disciplina que `esCambioSignificativo` (`historialDeCostos.js:128`), y no de
   una acumulación de `parseFloat` (`Orders.jsx:95-97`).
2. **Given** cualquier importe de las dos pantallas, **When** lo miro,
   **Then** tiene **siempre dos decimales** y separadores `es-AR`, como
   `PurchaseOrders.jsx:147` y `PanelVenta.jsx:36`. Un importe entero se ve
   `$1.234,00` y no `$1.234`.
3. **Given** un movimiento del 1 de agosto, **When** miro su fecha en la
   pantalla, **Then** dice **01/08**, y no 31/07. La conversión no pasa por
   `new Date(iso)`: se reutiliza `fechaCorta`, que ya está escrita y comentada
   (`PanelVenta.jsx:49-56`).
4. **Given** el archivo exportado, **When** miro la columna de importes,
   **Then** las celdas son de tipo **número** (`{ t: 'n' }`) y la columna suma
   en la planilla. **Nunca un string formateado**: es la trampa de los importes
   argentinos vista desde el lado de la escritura.
5. **Given** un proveedor con deuda y pagos que se cancelan exactamente,
   **When** miro su saldo, **Then** dice `$0,00` y el badge dice «Saldado», no
   «Con deuda» por un residuo de coma flotante.
6. **Given** un pago mayor que la deuda, **When** miro el saldo, **Then** es
   **negativo** y el badge sigue siendo «Saldado»: el proveedor me debe a mí, no
   al revés, y eso no es un error.
7. **Given** cualquier `DECIMAL` que venga de la API como string, **When** se
   usa en una cuenta, **Then** se convierte explícitamente antes de sumar, como
   hace `totalDelPeriodo` (`exportVentas.js:112`).

---

### User Story 7 — Los documentos del proveedor y sus enlaces de Drive (Priority: P2)

Como dueño, quiero cargar el enlace de Drive de cada factura del proveedor y
abrirlo desde la cuenta, para que cuando el contador pregunte por la factura de
marzo esté a un clic y no en un chat de WhatsApp.

**Why this priority**: el plan lo pone primero en la lista de función de 4.4, el
legacy lo tenía y **el modelo y los dos endpoints ya están escritos y probados**
(`suppliers.js:195`, `:207`). Es la funcionalidad con mejor relación entre lo
que falta y lo que ya está: falta la interfaz y nada más.

**Independent Test**: cargar dos documentos con enlace de Drive en un proveedor,
recargar la pantalla y verificar que siguen, que abren en una pestaña nueva y
que el badge de «sin factura» del proveedor desapareció.

**Acceptance Scenarios**:

1. **Given** la cuenta de un proveedor, **When** la miro, **Then** hay un
   bloque de documentos con lo que ya guarda `SupplierDocument`: nombre, tipo,
   fecha y enlace.
2. **Given** el bloque, **When** cargo un documento, **Then** pido nombre,
   tipo —factura / remito / presupuesto / otro, los del modelo
   (`models/Supplier.js:163`)— y el enlace, y **AdminApp no sube ningún
   archivo**: guarda el enlace, como el legacy (`legacy:2516-2518`).
3. **Given** un enlace que no empieza con `http`, **When** intento guardarlo,
   **Then** la pantalla lo rechaza con un mensaje legible, como el legacy
   (`:7930`), y no manda la llamada.
4. **Given** un documento cargado, **When** miro su fila, **Then** dice de qué
   nube es —Google Drive, Dropbox, OneDrive u «otro»—, derivado del enlace por
   una función pura, como hacía `ccGuardarFacturaPedido` (`legacy:8190-8193`).
5. **Given** un documento, **When** lo toco, **Then** abre en una pestaña
   nueva, **con `rel="noopener noreferrer"`**: el enlace lo escribió una
   persona y apunta afuera.
6. **Given** un documento, **When** miro sus acciones, **Then** puedo copiar el
   enlace al portapapeles y eliminarlo, como el legacy (`:7993`, `:8001`).
7. **Given** un proveedor con órdenes y **sin ningún documento**, **When** lo
   miro en la lista, **Then** tiene el aviso de «sin factura», como el legacy
   (`:7621`, `:7637-7640`). Es el aviso que evita cerrar el mes sin el
   respaldo.
8. **Given** un proveedor sin documentos, **When** abro su bloque, **Then** veo
   el estado vacío que explica cómo cargar el primero.
9. **Given** un usuario sin `proveedores.editar`, **When** miro el bloque,
   **Then** puedo abrir los documentos y **no** cargar ni eliminar, con la
   explicación a la vista.
10. **Given** el enlace de un documento, **When** se guarda, **Then** el
    servidor sigue exigiendo que el proveedor sea de la empresa, como ya hace
    (`suppliers.js:197-199`). Este es el endpoint que está bien y **no se toca**.

---

### User Story 8 — Exportar la cuenta para el contador (Priority: P2)

Como dueño, quiero bajarme la cuenta corriente de un proveedor en un archivo que
el contador pueda abrir y sumar, para no dictarle los movimientos por teléfono.

**Why this priority**: el plan lo pide en 4.4 («Exportar el asiento contable»),
el legacy lo tenía (`:8432`) y el problema equivalente ya está resuelto en el
historial de ventas, así que es copiar un patrón probado.

**Independent Test**: exportar la cuenta de un proveedor con cinco movimientos y
verificar sobre el objeto de hoja —sin abrir Excel— que la columna de importes
es numérica, que las fechas no están corridas y que el total del archivo es el
saldo de la pantalla.

**Acceptance Scenarios**:

1. **Given** la cuenta de un proveedor, **When** miro sus acciones, **Then**
   hay una exportación.
2. **Given** la exportación, **When** la disparo, **Then** el servidor arma las
   filas y el navegador arma la hoja, con el corte de `filaDeExport` /
   `armarHoja` (`exportVentas.js:76`, `exportarVentas.js:76`).
3. **Given** el archivo, **When** miro la columna de importes, **Then** las
   celdas son de tipo número y **la columna suma**.
4. **Given** el archivo, **When** miro el CUIT del proveedor, **Then** está
   como **texto** (`{ t: 's', z: '@' }`), por el mismo motivo por el que el CAE
   lo está (`exportarVentas.js:63-65`): un número de once dígitos inferido como
   número se escribe en notación científica y pierde dígitos.
5. **Given** el archivo, **When** miro su nombre, **Then** lleva el proveedor y
   el período adentro, como `nombreDelArchivo` (`exportarVentas.js:115`), para
   que dos exportaciones distintas no se pisen en la carpeta de descargas.
6. **Given** el archivo, **When** comparo su última fila con la pantalla,
   **Then** el saldo del archivo y el saldo grande de la pantalla son **el mismo
   número**, calculado por **la misma función**.
7. **Given** un proveedor sin movimientos, **When** exporto, **Then** el
   archivo sale con encabezados y sin filas, y no falla.
8. **Given** la exportación, **When** la disparo con un usuario sin
   `proveedores.ver`, **Then** la API la rechaza.
9. **Given** la vista de asiento en pantalla, **When** la miro, **Then** el
   formato DEBE / HABER y el alcance de la exportación son los que decida
   **[PENDIENTE 4]**.

---

### User Story 9 — Registrar pagos y movimientos sin errores silenciosos (Priority: P2)

Como quien paga a los proveedores, quiero que la pantalla me frene cuando cargo
un pago que no tiene sentido y me deje corregir uno que cargué mal, para no
descubrir el error tres meses después conciliando.

**Why this priority**: el pago es la operación con la que se toca la plata de
verdad y hoy no valida **nada**. Los endpoints de editar y eliminar movimientos
existen desde siempre (`suppliers.js:170`, `:182`) y **ningún botón los llama**.

**Independent Test**: intentar registrar un pago vacío, uno de cero, uno
negativo y uno mayor que el saldo, y verificar el comportamiento de los cuatro.

**Acceptance Scenarios**:

1. **Given** el formulario de pago, **When** lo mando vacío, **Then** no sale
   ninguna llamada y la pantalla dice qué falta. Hoy manda
   `amount: parseFloat('')` = `NaN` (`Orders.jsx:125`).
2. **Given** un importe de cero o negativo, **When** lo mando, **Then** se
   rechaza con un mensaje legible, del lado del navegador **y** del servidor.
3. **Given** un pago mayor que el saldo, **When** lo mando, **Then** la
   pantalla **pide confirmación** diciendo saldo y monto, como el legacy
   (`:8416`), y si confirmo lo registra: pagar por adelantado es legítimo.
4. **Given** el formulario, **When** miro los métodos, **Then** están los
   cuatro del legacy: efectivo, transferencia, **cheque** y QR. Hoy faltan
   cheque (`Orders.jsx:637-639`).
5. **Given** el formulario, **When** miro la fecha, **Then** **puedo
   elegirla**. Hoy el estado la guarda pero **no hay ningún campo**
   (`Orders.jsx:64`), así que un pago de ayer se registra con la fecha de hoy.
6. **Given** un movimiento del historial, **When** lo miro, **Then** puedo
   editarlo y eliminarlo si tengo el permiso, y los dos endpoints que ya existen
   quedan usados.
7. **Given** la eliminación de un movimiento, **When** la disparo, **Then**
   pide confirmación con `ConfirmDialog` y dice **cuánto** se va a borrar y en
   qué queda el saldo.
8. **Given** cualquier operación de estas dos pantallas que falle, **When**
   llega el error, **Then** el usuario ve un aviso legible. Hoy hay tres
   `console.error` sin aviso (`PurchaseOrders.jsx:133`, `:179`, `:190`) y cuatro
   `toast.error(err.message)` que muestran «Request failed with status code
   500» en vez del mensaje de la API (`Orders.jsx:107`, `:118`, `:133`, `:185`).
9. **Given** la eliminación de un proveedor, **When** la disparo con saldo
   distinto de cero, **Then** pasa lo que decida **[PENDIENTE 10]**. Hoy borra
   la cuenta entera —órdenes, movimientos y documentos— con una confirmación
   genérica (`suppliers.js:112-132`).

---

### User Story 10 — Recibir en la sucursal que corresponde (Priority: P3)

Como responsable de compras de una empresa con dos sucursales, quiero elegir en
cuál entra la mercadería que estoy recibiendo, para no tener que hacer una
transferencia después de cada camión.

**Why this priority**: es real pero es el caso menos frecuente, y el
comportamiento actual —la sucursal por defecto de la empresa— es correcto para
una empresa de una sola sucursal, que es la mayoría. Se pone en P3 para que se
pueda cortar sin romper nada.

**Independent Test**: con dos sucursales, recibir una orden eligiendo la segunda
y verificar que la fila de `Stock` que creció es la de esa sucursal.

**Acceptance Scenarios**:

1. **Given** una empresa con más de una sucursal, **When** abro la recepción,
   **Then** puedo elegir la sucursal de destino, con la vigente preseleccionada.
2. **Given** una empresa con una sola sucursal, **When** abro la recepción,
   **Then** **no** hay selector: no hay nada que elegir.
3. **Given** una sucursal elegida, **When** confirmo, **Then** el stock sube en
   esa sucursal y el `StockMovement` queda con ese `punto_de_venta_id`.
4. **Given** el parámetro `location` que la API todavía recibe
   (`purchaseService.js:56`), **When** se manda, **Then** sigue sin ubicar nada
   —está documentado en `:99-103`— y la sucursal viaja por el mecanismo que ya
   existe, `resolverSucursal`. **No se reabre esa decisión**: se cerró en el
   hito 4 y romperla crea filas de stock que la pantalla no muestra.
5. **Given** cualquier recepción, **When** se guarda, **Then** ninguna guardia
   de «ninguna fila de stock se escribe sin sucursal»
   (`aislamientoEmpresas.test.js`, FR-052 de la 010) empieza a fallar.

---

### Edge Cases

**Órdenes**

- **Orden sin ítems.** `createOrder` la acepta con `detail: []` y `total: 0`
  (`purchaseService.js:19`). ¿Qué muestra la fila, qué muestra el panel, y
  puede recibirse? Con `detail` vacío, `todoRecibido` es `true` por vacuidad
  (`.every` sobre `[]`) y la orden pasaría a `received` sin recibir nada.
- **Orden con una línea de cantidad cero.** Misma cuenta: `recibido >= pedido`
  con los dos en cero.
- **Recibir cantidad cero o negativa.** El servidor la saltea
  (`purchaseService.js:82`); la pantalla tiene que decirlo, no callarlo.
- **Recibir de más.** El servidor recorta a lo pendiente (`:86`). La pantalla
  informa cuánto entró de verdad.
- **Recibir una orden anulada o ya recibida.** El servidor tira
  (`:66-67`); tiene que llegar como mensaje legible y no como 500.
- **Dos personas reciben la misma orden a la vez.** El `lock: t.LOCK.UPDATE`
  es sobre la fila de `Stock` (`:122`), **no sobre la orden**: las dos leen el
  mismo `detail` y la segunda pisa las cantidades de la primera. El stock no se
  duplica, pero la orden puede quedar con menos recibido del que entró.
- **Anular una orden parcial.** Hoy se permite y la deuda de lo ya recibido
  queda viva. Es **[PENDIENTE 9]**.
- **Un producto de la orden que se eliminó del catálogo.** El `detail` guarda
  `product_name` además del id (`:26`), así que la orden se sigue leyendo; el
  `Stock.create` con un `product_id` que ya no existe falla contra la FK.
- **Una línea con `product_id: null`.** `createOrder` lo permite (`:25`).
  `receiveOrder` la busca con `d.product_id === received.product_id` y podría
  matchear la primera de todas las líneas sin producto.
- **Más de 100 órdenes.** Hoy se ven 100 y no hay cómo llegar a la 101
  (`PurchaseOrders.jsx:128`).
- **Órdenes de un proveedor eliminado.** El `DELETE` de proveedor las borra
  (`suppliers.js:124`).

**Proveedores y cuenta**

- **Proveedor sin movimientos y sin órdenes.** Badge «Sin movimientos», saldo
  `$0,00`, estado vacío en las tres secciones.
- **Saldo exactamente cero por compensación.** Badge «Saldado», y el `$0,00`
  tiene que ser cero de verdad, no `0.0000000001`.
- **Saldo negativo** (adelanto). Es válido: ver US6 escenario 6.
- **Un proveedor con el mismo nombre que otro.** El índice único
  `(empresa_id, name)` (`models/Supplier.js:44`) lo rechaza. El error de
  constraint **no puede llegar crudo al usuario**: `fallo` ya lo evita, pero el
  mensaje tiene que decir que ese nombre ya existe.
- **Nombre de proveedor muy largo.** Trunca con elipsis y el nombre completo
  queda en el `title` o en la cuenta. **Que no se meta en la columna del saldo
  es una prueba de navegador.**
- **Documento con enlace roto o privado.** AdminApp no puede saberlo: guarda y
  abre. Se dice explícitamente en «Fuera de alcance».
- **Documento con un enlace que no es de ninguna nube conocida.** Se acepta si
  empieza con `http` y se etiqueta «otro».
- **Movimiento con `due_date`.** La columna existe (`models/Supplier.js:130`) y
  nada la escribe ni la lee. Queda como está.
- **Miles de movimientos en un proveedor.** Ver [PENDIENTE 3].

**Aislamiento y permisos**

- **Superadmin operando sobre una empresa donde no tiene membresía.** Sigue
  operando sobre **una empresa por vez** (plan, sección 3): nada de lo de acá
  cruza empresas.
- **Un id de proveedor que no existe.** 404, y el 404 no distingue «no existe»
  de «no es tuyo» (`tenantScope.js:70-73`).
- **Un usuario con `proveedores.ver` y sin `ordenes_compra.ver`.** Ve la cuenta
  y **no** ve las órdenes del proveedor: es el mismo permiso que gatea la otra
  pantalla y tiene que respetarse dentro de esta.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Órdenes de compra · tabla y patrón visual

- **FR-001**: La tabla DEBE usar `TablaGrid` / `Encabezado` / `Fila` /
  `BotonDeFila`, y **no** los `Table*` de shadcn.
- **FR-002**: El `grid-template-columns` DEBE ser el mismo string en el
  encabezado y en las filas, y ese string DEBE ser
  `96px minmax(0,1fr) 112px 96px 148px 132px 120px`, con `gap-x` de 16px.
- **FR-003**: Las columnas DEBEN ser Orden · Proveedor · Fecha · Ítems ·
  Recepción · Total · Acciones, con las etiquetas en `.eyebrow`.
- **FR-004**: El número de orden, la fecha, la cantidad de ítems y el total
  DEBEN ir en `.num`. El total DEBE ir alineado a la derecha.
- **FR-005**: La celda de Recepción DEBE mostrar la etiqueta del estado en su
  tono y, debajo, una barra de progreso de 4px cuyo ancho es el porcentaje
  recibido.
- **FR-006**: Una orden anulada DEBE mostrarse con opacidad reducida y sin
  acciones.
- **FR-007**: La fila entera DEBE abrir el panel lateral, y todo botón de la
  fila DEBE frenar la propagación del clic.
- **FR-008**: Los filtros de estado DEBEN ser un control segmentado
  —Todas / Pendientes / Parciales / Recibidas— con el contador de cada uno.
- **FR-009**: DEBE haber una búsqueda que filtre por nombre de proveedor y por
  número de orden.
- **FR-010**: El filtro de fechas DEBE ser un botón de filtro de 36px con el
  período vigente escrito adentro.
- **FR-011**: Los estados vacíos DEBEN distinguir «no hay órdenes» de «el
  filtro no devolvió ninguna».
- **FR-012**: `pages/PurchaseOrders.jsx` DEBE entrar en la lista de
  `guardiasDeDiseno.test.js` **antes** de reescribirla, con la consecuencia
  aceptada de dejar esa guardia en rojo hasta que se reescriba.
- **FR-013**: La tabla DEBE scrollear horizontalmente dentro de su tarjeta, sin
  desbordar el `<body>`.

#### Órdenes de compra · panel lateral

- **FR-014**: El detalle DEBE abrirse en un panel lateral de 520px con
  `max-w-[92vw]`, construido sobre `ui/sheet.jsx`, y **no** en un modal.
- **FR-015**: El panel DEBE tener kicker, título, subtítulo, un bloque de datos
  en grilla de dos columnas, la tabla de ítems, el total en `.num` a 19px y un
  pie con acción destructiva, secundaria y principal.
- **FR-016**: La tabla de ítems DEBE mostrar `recibido / pedido` en una sola
  celda y usar `minmax(0,1fr) 64px 96px 100px`.
- **FR-017**: Una orden recibible DEBE mostrar la nota informativa sobre la
  actualización de stock; una no recibible, ninguna acción destructiva ni de
  recepción.
- **FR-018**: Las dos acciones de WhatsApp que ya existen DEBEN conservarse,
  con su aviso cuando el proveedor no tiene teléfono.
- **FR-019**: Las acciones DEBEN respetar `ordenes_compra.recibir` y
  `ordenes_compra.anular`, deshabilitadas **con su explicación** y no ausentes.

#### Órdenes de compra · filtros

- **FR-020**: La opción «todos» de un filtro DEBE producir la **ausencia** del
  parámetro y no un valor centinela. Ningún `<SelectItem>` puede llevar `" "`
  como valor (`PurchaseOrders.jsx:212`, `:224`).
- **FR-021**: El servidor DEBE rechazar con un error de negocio un
  `supplier_id` o un `status` que no sea del tipo esperado, en vez de dejar que
  el error de Postgres suba como 500.
- **FR-022**: El listado DEBE poder llegar más allá de las primeras 100
  órdenes: paginación o carga incremental, y el total mostrado tiene que ser
  coherente con lo que se puede alcanzar.

#### La recepción

- **FR-030**: El formulario de recepción DEBE aplicarse **a la orden que el
  usuario abrió**, cuyo id se conserva explícitamente. Queda prohibido
  resolverla con un `find` sobre el estado (`Orders.jsx:612`).
- **FR-031**: Los campos de cantidad DEBEN indexarse por **línea de la orden**,
  no por `product_id`, para que dos líneas del mismo producto —o dos líneas sin
  producto— no compartan campo.
- **FR-032**: Cada campo DEBE mostrar pedido y ya recibido, y limitar su máximo
  a lo pendiente.
- **FR-033**: Cuando el servidor recorta la cantidad recibida, la pantalla DEBE
  informar **cuánto se cargó realmente**.
- **FR-034**: La recepción DEBE ser **un solo componente** usado por las dos
  pantallas. Dos implementaciones es lo que dejó una de ellas rota.
- **FR-035**: Un error de recepción DEBE dejar el panel abierto, con las
  cantidades escritas, y mostrar un aviso legible.
- **FR-036**: Confirmar dos veces DEBE registrar una sola recepción.
- **FR-037**: Una recepción de cero unidades no DEBE crear movimiento ni
  cambiar el estado de la orden.
- **FR-038**: `receiveOrder` DEBE conservar todo lo que ya resuelve
  —`assertEmpresaId`, transacción, lock sobre la fila de stock, copia profunda
  del JSONB, estado recalculado sobre todas las líneas, `empresa_id` en el
  `where` y en el alta—. **Ninguno de sus tres bugs corregidos puede volver.**

#### Aislamiento entre empresas

- **FR-060**: `POST /api/suppliers/:id/payments` DEBE resolver el proveedor con
  `findScoped` (o equivalente con `empresa_id`) **antes** de crear el
  movimiento, y responder 404 si no es de la empresa.
- **FR-061**: `purchaseService.createOrder` DEBE llamar a `assertEmpresaId` y
  resolver el proveedor con scoping de empresa antes de crear la orden.
- **FR-062**: `createOrder` DEBE validar que todo `product_id` del detalle
  pertenezca a la empresa, y rechazar la orden con un `ErrorDeNegocio` si no.
- **FR-063**: Los `include` de órdenes, movimientos y documentos en
  `GET /api/suppliers` y `GET /api/suppliers/:id` DEBEN filtrar por
  `empresa_id`, y no solo por `supplier_id`.
- **FR-064**: DEBE existir una guardia estática que falle si vuelve a aparecer
  el patrón «crear una fila hija con un `*_id` que viene del cliente sin haber
  resuelto el padre con `empresa_id`». Es un patrón que las guardias actuales
  **no** cubren.
- **FR-065**: `getOrders` DEBE usar `assertEmpresaId` y no `if (empresa_id)`.
- **FR-066**: `cancelOrder` DEBE usar `assertEmpresaId`.
- **FR-067**: El `include` de `Supplier` en el listado de órdenes DEBE estar
  acotado a la empresa.
- **FR-068**: Ninguna guardia de `aislamientoEmpresas.test.js` ni de
  `observabilidad.test.js` puede empezar a fallar, y la lista de excepciones de
  `suppliers.js` no puede crecer.

#### El costo del producto al recibir

- **FR-070**: El comportamiento del costo al recibir una orden DEBE quedar
  definido explícitamente por **[PENDIENTE 1]**, y escrito donde alguien lo
  encuentre. Hoy no está definido en ningún lado y el resultado es que no pasa
  nada.
- **FR-071**: Si se decide actualizarlo, la comparación de importes DEBE usar
  `esCambioSignificativo` (`historialDeCostos.js:128`). **Queda prohibido
  escribir `Math.abs(a - b) >= 0.01`** en cualquier variante: es el error que se
  comía cambios de costo reales según la magnitud del número, y ya está
  documentado.
- **FR-072**: Si se decide actualizarlo, la fila de historial DEBE escribirse
  con `registrarCambioDeCosto` y un motivo de `MOTIVOS`, que DEBE ampliarse con
  el origen nuevo. Ninguna cadena escrita a mano.
- **FR-073**: Si se decide **no** actualizarlo, la pantalla DEBE avisar cuando
  el precio de compra difiere del costo cargado, para que la decisión sea del
  usuario y no un silencio.

#### Proveedores · pantalla y cuenta

- **FR-050**: El saldo DEBE calcularlo una función pura que sume **en centavos
  enteros**.
- **FR-051**: Todo importe de las dos pantallas DEBE formatearse con `es-AR` y
  **dos decimales fijos**.
- **FR-052**: Toda fecha `DATEONLY` DEBE formatearse **sin pasar por
  `new Date(iso)`**, reutilizando `fechaCorta` (`PanelVenta.jsx:49-56`).
- **FR-053**: El orden del historial DEBE salir de una función pura y **no** de
  un `.sort()` sobre el estado de React.
- **FR-054**: La pantalla DEBE tener dos columnas: lista a la izquierda, cuenta
  del seleccionado a la derecha.
- **FR-055**: Cada proveedor de la lista DEBE mostrar un **badge de estado**
  —Sin movimientos / Saldado / Pago parcial / Con deuda— y su saldo en `.num`.
- **FR-056**: Los tonos del badge DEBEN salir de los tokens (`ok`, `warn`,
  `danger` con sus `-soft` y `-line`), como el `tonoDeStock` de Inventario.
- **FR-057**: La cuenta DEBE mostrar el saldo en grande y en `.num`, más total
  comprado y total pagado.
- **FR-058**: El historial de movimientos DEBE usar `TablaGrid`.
- **FR-059**: DEBE haber búsqueda por nombre de proveedor.
- **FR-069**: `pages/Orders.jsx` DEBE entrar en la lista de
  `guardiasDeDiseno.test.js` antes de reescribirla.

#### Documentos

- **FR-080**: La cuenta DEBE tener un bloque de documentos con nombre, tipo,
  fecha y enlace, sobre `SupplierDocument` y sus dos endpoints, **sin cambiar el
  modelo**.
- **FR-081**: AdminApp **no** DEBE almacenar archivos: guarda el enlace.
- **FR-082**: Un enlace que no empieza con `http` DEBE rechazarse antes de
  mandar la llamada.
- **FR-083**: La nube del enlace —Drive, Dropbox, OneDrive, otro— DEBE
  derivarse con una función pura.
- **FR-084**: Los enlaces DEBEN abrirse en una pestaña nueva con
  `rel="noopener noreferrer"`.
- **FR-085**: DEBE poder copiarse el enlace y eliminarse el documento.
- **FR-086**: Un proveedor con órdenes y sin documentos DEBE mostrar el aviso de
  «sin factura» en la lista.
- **FR-087**: El bloque DEBE respetar `proveedores.editar` y
  `proveedores.eliminar`.

#### Pagos y movimientos

- **FR-088**: El importe de un pago DEBE validarse mayor que cero en el
  navegador **y** en el servidor.
- **FR-089**: Un pago mayor que el saldo DEBE pedir confirmación con los dos
  números a la vista, y poder confirmarse.
- **FR-091**: Los métodos de pago DEBEN incluir cheque, además de efectivo,
  transferencia y QR.
- **FR-092**: La fecha del pago DEBE ser elegible.
- **FR-093**: Un movimiento DEBE poder editarse y eliminarse desde la pantalla,
  usando los endpoints que ya existen.
- **FR-094**: La eliminación DEBE pedir confirmación diciendo el importe y el
  saldo resultante.
- **FR-095**: Todo error de las dos pantallas DEBE llegarle al usuario como
  aviso legible. Ningún `console.error` mudo y ningún
  `toast.error(err.message)` que muestre «Request failed with status code 500».

#### Exportación

- **FR-096**: DEBE poder exportarse la cuenta corriente de un proveedor.
- **FR-097**: El servidor arma las filas con una función pura; el navegador arma
  la hoja forzando el tipo celda por celda.
- **FR-098**: Los importes DEBEN ir como celda **numérica**. Ningún importe
  formateado como texto.
- **FR-099**: El CUIT DEBE ir como celda de **texto** con formato `@`.
- **FR-100**: El nombre del archivo DEBE llevar proveedor y período.
- **FR-101**: El saldo del archivo y el de la pantalla DEBEN salir de la misma
  función.
- **FR-102**: La exportación DEBE exigir `proveedores.ver`.

#### Sucursal, gateo y observabilidad

- **FR-090**: `/proveedores` DEBE llevar `RouteGuard` con el módulo que
  `navegacion.js:34` ya declara, para que el gateo esté en los tres lados.
- **FR-103**: Con más de una sucursal, la recepción DEBE permitir elegir el
  destino, con la vigente preseleccionada; con una sola, no DEBE haber selector.
- **FR-104**: La sucursal DEBE seguir viajando por `resolverSucursal`. El
  parámetro `location` sigue sin ubicar nada.
- **FR-105**: Ninguna fila de `Stock` puede escribirse sin sucursal.
- **FR-106**: Ningún `catch` puede responder con `err.message`: se usa `fallo`,
  y `ErrorDeNegocio` para lo que sí es del usuario.
- **FR-107**: Las etiquetas de estado de orden DEBEN vivir en **un solo lugar**
  compartido por las dos pantallas, con un test que impida que se separen —el
  mismo problema que ya tuvieron los medios de pago
  (`exportVentas.js:37-40`)—. Hoy están copiadas en `Orders.jsx:44` y
  `PurchaseOrders.jsx:51`.

### Key Entities

| Entidad | Campos que importan acá |
|---|---|
| `Supplier` | `id`, `empresa_id`, `name`, `phone`, `email`, `address`, `cuit`. Único por `(empresa_id, name)` |
| `SupplierOrder` | `id`, `empresa_id`, `supplier_id`, `date`, `total`, `notes`, `detail` (JSONB con `product_id`, `product_name`, `quantity`, `unit_price`, `quantity_received`), `status` |
| `SupplierMovement` | `id`, `empresa_id`, `supplier_id`, `type` (`deuda`/`pago`), `date`, `amount`, `payment_method`, `notes`, `due_date` (existe y nadie la usa) |
| `SupplierDocument` | `id`, `empresa_id`, `supplier_id`, `name`, `type`, `url`, `date` |
| `Product` | `id`, `empresa_id`, `cost` — **solo si [PENDIENTE 1] decide tocarlo** |
| `ProductCostHistory` | `product_id`, `old_cost`, `new_cost`, `reason`, `usuario_id`, `empresa_id` — idem |
| `Stock` | `product_id`, `empresa_id`, `punto_de_venta_id`, `quantity`, `available` |
| `PuntoDeVenta` | `id`, `name`, `code`, `is_active`, `empresa_id` |

**Migraciones**: ninguna, salvo dos casos condicionales.

- Si **[PENDIENTE 3]** manda el saldo al servidor, hacen falta **índices por
  `empresa_id`** en `supplier_orders`, `supplier_movements` y
  `supplier_documents`, que hoy no existen (`models/Supplier.js:88`, `:136`,
  `:177`).
- Si **[PENDIENTE 7]** agrega «entrega estimada» y «condición de pago», son dos
  columnas nuevas en `supplier_orders`.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

1. Recibir mercadería de la segunda orden pendiente de un proveedor carga el
   stock y la deuda **de esa orden**. Verificable contra hoy, donde carga la
   primera con los precios de la primera.
2. Dos órdenes que piden el mismo producto tienen dos campos de cantidad
   independientes. Verificable contra hoy, donde comparten uno.
3. Una empresa no puede crear un pago ni una orden sobre un proveedor de otra:
   responde 404 y no queda ninguna fila. Verificable contra hoy, donde responde
   201 y le cambia el saldo al otro cliente.
4. Una consulta de órdenes sin empresa resuelta **falla**, en vez de devolver
   las de todas las empresas.
5. Existe una guardia estática que se pone en rojo si vuelve a aparecer un
   `create` de una fila hija bajo un padre sin validar.
6. El comportamiento del costo del producto al recibir está **escrito y
   verificado**, sea cual sea la decisión, y no hay ninguna comparación de
   importes con tolerancia de punto flotante en el código nuevo.
7. Elegir «Todos» en el filtro de proveedor devuelve todas las órdenes.
   Verificable contra hoy, donde rompe el listado sin avisar.
8. Un saldo compuesto por movimientos que en punto flotante dan
   `1234.5600000000002` se muestra `$1.234,56`, y un saldo que se compensa
   exactamente muestra `$0,00` y el badge «Saldado».
9. Un movimiento del 1 de agosto se ve como 01/08 en Argentina. Verificable
   contra hoy, donde se ve 31/07.
10. Todos los importes de las dos pantallas tienen dos decimales, siempre.
11. Se puede cargar el enlace de Drive de una factura, abrirlo y copiarlo, y un
    proveedor con órdenes y sin documentos se distingue en la lista.
12. Se puede exportar la cuenta de un proveedor a un archivo cuya columna de
    importes **suma** en la planilla y cuyo saldo coincide con la pantalla.
13. Un pago vacío, de cero o negativo no llega a la API.
14. Ninguna operación de las dos pantallas falla en silencio: los tres
    `console.error` mudos y los cuatro `toast.error(err.message)` desaparecen.
15. Las dos tablas usan `TablaGrid` con el encabezado y las filas compartiendo
    `grid-template-columns`, y ningún importe aparece bajo la etiqueta
    equivocada.
16. El detalle de una orden se abre en panel lateral y al cerrarlo el filtro, el
    segmento y el scroll quedan donde estaban.
17. `pages/Orders.jsx` y `pages/PurchaseOrders.jsx` no contienen hexadecimales,
    `dark:`, clases de la paleta de Tailwind ni `Table*`, y están en la lista de
    `guardiasDeDiseno.test.js`.
18. Las dos pantallas siguen adentro del marco de 1320px y el `<body>` no
    desborda a lo ancho a 1140px, verificado en navegador.
19. `/proveedores` tiene el mismo gateo de módulo que declara su ítem de menú.
20. `npm run test:api`, `npm run test:web` y `npm run build` pasan, y las
    guardias de aislamiento, observabilidad y diseño siguen limpias.
21. Cada criterio de aceptación tiene al menos un test que **falla** si se
    revierte el cambio que lo implementa.

---

## Fuera de alcance

Explícito, para que no se discuta después si estaba incluido.

- **Subir archivos a AdminApp.** Los documentos son **enlaces**. Ni el legacy
  guardaba el archivo, y almacenar facturas de terceros trae obligaciones que no
  están evaluadas.
- **Verificar que un enlace de Drive funcione o sea público.** AdminApp no puede
  saberlo sin permisos sobre la cuenta del usuario.
- **Extraer los ítems de una factura con IA.** El legacy lo tenía
  (`:7681`, `ccPdfExtraer`) y es un proyecto propio, no un renglón de este hito.
- **Enlace de factura por orden**, además del del proveedor. `SupplierDocument`
  cuelga del proveedor; asociarlo a una orden es una columna nueva. El legacy lo
  tenía (`:8182`) y queda anotado.
- **Badge de «sin factura» en la barra lateral** (`legacy:1445`, `:7889`). El
  badge por proveedor sí entra; el de la barra lateral es de la funcionalidad de
  navegación.
- **Estado de cuenta del proveedor por WhatsApp** (`legacy:8242`). El envío de
  la orden ya existe y se conserva; el estado de cuenta queda anotado.
- **«Descargar PDF» de la orden** (maqueta `:1147`). No existe nada de eso hoy y
  el PDF de inventario resolvió el problema con la vista de impresión, que es
  otro trabajo.
- **«Duplicar orden»** (maqueta `:1147`).
- **Editar una orden ya emitida.** El permiso `ordenes_compra.editar` existe y
  no lo usa ningún endpoint; sigue así.
- **Lock sobre la orden en la recepción concurrente.** Se anota como caso de
  borde conocido: dos recepciones simultáneas de la misma orden pueden pisarse
  las cantidades. El stock no se duplica.
- **Recibir una orden en varias sucursales a la vez.** Una recepción, una
  sucursal.
- **Órdenes de compra automáticas a partir de Faltantes.** Esa pantalla ya arma
  el pedido y lo manda por WhatsApp; convertirlo en una orden es otro hito.
- **Conciliación bancaria, cheques con fecha de cobro, órdenes de pago.**
  `due_date` sigue sin usarse.
- **Presupuestos y comparación de precios entre proveedores.** Es la pantalla
  Comparador, que ya existe y no se toca.
- **Impuestos y retenciones sobre las compras.** El módulo Impuestos está
  oculto para el cliente (plan, 4.12).
- **Que la deuda con proveedores impacte en Flujo de caja.** Ese módulo también
  está oculto.
- **Rediseñar Faltantes, Comparador, Gastos, Panel o Equipo.** Cada una en su
  hito.
- **Vista mobile o para tablet.** Las dos pantallas son de escritorio.
- **Migrar datos del legacy.** Ya existe `migrarLegacy` y no cambia acá.

---

## Lo que faltaba decidir · **resuelto**

Marcado tal cual se pide: lo que **cambia el resultado** y no estaba claro en el
pedido, en el plan ni en la maqueta. **Ninguno tuvo una respuesta inventada.**

Se conserva abajo el planteo completo de cada pregunta —con las opciones
descartadas— porque el motivo sigue valiendo cuando alguien pregunte, dentro de
un año, por qué el costo pide confirmación en vez de pisarse solo.

| # | Decisión | Quién decidió |
|---|---|---|
| 1 | **Sí, actualiza el costo, pero confirmando** (opción D). Al recibir, la pantalla muestra «Colágeno pasa de $900 a $1.200» y se puede aceptar o rechazar **línea por línea**. Se eligió sobre pisar el costo directo porque a veces se compra más caro por urgencia y eso no tiene que mover los precios de venta. Lo aceptado queda en `ProductCostHistory` con su motivo, igual que producción | Usuario |
| 2 | **La deuda es la mercadería recibida** (opción B, como AdminApp hoy). Una orden emitida y no entregada no genera deuda: si el proveedor nunca manda, no se debe nada. Difiere del sistema viejo, que contaba la orden al emitirse, así que la pantalla muestra **aparte** «pedido pendiente de recibir» para que el número que Comprafit venía leyendo siga estando a la vista | Usuario |
| 3 | **El saldo lo calcula el servidor.** No es una preferencia: hoy la pantalla suma `DECIMAL` que Sequelize devuelve como texto, en punto flotante, sobre todos los movimientos que le llegaron — y `GET /suppliers` no pagina. El cliente sumando plata es el mismo error que ya apareció en el total de una venta | Por defecto |
| 4 | **Exportación de movimientos, con la forma de la de ventas**: fecha, tipo, descripción, debe, haber y saldo, en xlsx. Reusa `filaDeExport`/`armarHoja`, incluido su manejo de importes argentinos. **No es un asiento contable formal** —eso necesita un plan de cuentas que el sistema no tiene—; si el contador de Comprafit pide otro formato, se ajusta entonces | Usuario |
| 5 | **Sí, se crean órdenes desde la pantalla.** El plan dice «solo diseño» pero la maqueta dibuja el botón «Nueva orden», y manda la maqueta — mismo criterio que en la funcionalidad 011 con `Enter` | Por defecto |

**Y una decisión de nombre**: la pantalla **sigue llamándose «Órdenes de compra»**,
aunque en Argentina ese término suele nombrar lo que manda un *cliente* para
comprarte, no lo que vos le pedís a un proveedor. Se conserva porque es el
término del sistema viejo y el que Comprafit ya conoce. Queda escrito porque la
ambigüedad es real —hizo tropezar a quien conoce el sistema— y si alguna vez se
renombra, éste es el motivo por el que hoy no se hizo.

### Bloqueaban

**[PENDIENTE DE DEFINIR 1] — ¿Recibir una orden actualiza el costo del
producto?**

Hoy **no pasa nada** (`purchaseService.js:56-175`). Comprar a $1.200 lo que está
costeado a $900 deja el costo en $900, y el margen del POS y el punto de
equilibrio del panel se calculan sobre eso.

La asimetría con producción es difícil de defender: la recepción de una orden de
producción **sí** actualiza el costo y lo registra
(`historialDeCostos.js:67`, `MOTIVOS.ORDEN_DE_PRODUCCION`).

Cuatro salidas, y cambian el servicio, el modelo del historial y la pantalla:

- **A — No tocar nada** (hoy). Barato, y el margen sigue calculándose sobre un
  costo viejo sin que nada avise.
- **B — Pisar el costo con el último precio de compra.** Simple y trazable. El
  riesgo es la compra puntual cara —una urgencia, un flete— que re-precia el
  catálogo entero.
- **C — Promedio ponderado con el stock existente.** Es lo contablemente
  correcto y es lo que menos se rompe con una compra atípica. Necesita el stock
  al momento de recibir y una definición de qué pasa con stock cero o negativo.
- **D — Proponer y que el usuario confirme.** El panel de recepción muestra
  «costo actual $900 → precio de esta compra $1.200» con una casilla. Es el que
  no decide por el usuario, y el que más interfaz cuesta.

**Bloquea** porque define si `receiveOrder` escribe en `Product` y en
`ProductCostHistory`, si hace falta un motivo nuevo en `MOTIVOS`, y qué muestra
el panel de recepción. Es también el punto donde reaparecería la comparación con
tolerancia de punto flotante si no se usa `esCambioSignificativo`.

**[PENDIENTE DE DEFINIR 2] — ¿Qué cuenta como deuda: la orden emitida o la
mercadería recibida?**

Las dos definiciones conviven hoy y **no dan el mismo número**:

- **AdminApp**: la deuda la crea la **recepción** (`purchaseService.js:162-171`).
  `createOrder` no genera ningún movimiento. Una orden emitida y no recibida
  **no** aparece en el saldo.
- **El legacy**: la deuda era la suma de **todos los pedidos**, recibidos o no
  (`legacy:7517-7521`). Una orden cargada ya contaba.

Comprafit leyó el número del legacy durante años. Si migra y su saldo baja
porque las órdenes en tránsito dejaron de contar, la conclusión va a ser que
AdminApp está mal.

- **A — Como AdminApp**: deuda = mercadería recibida. Es lo contablemente más
  defendible —se debe lo que llegó— y deja el saldo del legacy sin explicar.
- **B — Como el legacy**: deuda = órdenes emitidas. Hace falta crear el
  movimiento en `createOrder`, ajustarlo en cada recepción parcial y revertirlo
  en la anulación. Mucho más movimiento y mucho más para desincronizar.
- **C — Las dos, separadas**: el saldo es lo recibido, y aparte se muestra «en
  tránsito: $X». Es lo que más informa y agrega un número a la pantalla.

**Bloquea** porque define el badge de deuda, el saldo grande, el archivo
exportado y el asiento: los cuatro entregables de 4.4.

**[PENDIENTE DE DEFINIR 3] — ¿El saldo lo calcula el servidor?**

Hoy `GET /api/suppliers` trae **todos** los proveedores con **todos** sus
movimientos y **todos** sus documentos (`suppliers.js:57-64`), y el navegador
los suma (`Orders.jsx:93-98`). Con tres años de operación eso es la contabilidad
entera en cada carga de pantalla.

- **A — El listado devuelve `saldo`, `deuda` y `pagado` calculados**, y deja de
  traer los movimientos. Permite paginar y ordenar por saldo. Necesita índices
  por `empresa_id` que hoy no existen.
- **B — Un endpoint aparte de saldos**, y el listado queda como está.
- **C — Dejarlo en el navegador.** Es lo de hoy; no escala y hace imposible
  ordenar por saldo del lado del servidor.

**Bloquea** porque define el contrato que consume la pantalla, si hay paginación
(FR-059) y si hace falta una migración de índices.

**[PENDIENTE DE DEFINIR 4] — ¿Qué exporta «el asiento contable», en qué formato
y con qué alcance?**

El plan pide «exportar el asiento contable». El legacy tenía **dos cosas
distintas**: una vista DEBE / HABER en pantalla (`legacy:8268`) y una
exportación que copiaba texto plano al portapapeles (`:8432`). Ninguna de las
dos es un `.xlsx`.

Hay que decidir tres cosas:

1. **Formato**: `.xlsx` como el historial de ventas —que suma en la planilla y
   ya tiene el patrón resuelto—, texto al portapapeles como el legacy, o las
   dos.
2. **Alcance**: la cuenta de **un** proveedor, o **todos** con un período.
3. **Columnas**: un listado de movimientos (fecha, tipo, notas, debe, haber,
   saldo acumulado), o el par DEBE / HABER con cuentas contables
   —«Mercaderías», «Proveedores a pagar», «Caja»/«Banco»— como el legacy.
   La segunda supone un plan de cuentas que AdminApp no tiene.

**Bloquea** porque define las columnas, la función pura y sus tests, y si hay
que escribir una vista de asiento en pantalla además del archivo.

**[PENDIENTE DE DEFINIR 5] — ¿Se crean órdenes desde la pantalla de Órdenes de
compra?**

El plan dice de 4.5: «Función. Completa. **Solo diseño.**» La maqueta dibuja un
botón principal **«Nueva orden»** arriba a la derecha
(`AdminApp-Rediseno.dc.html:640`). Hoy una orden solo se crea desde la pantalla
de Proveedores (`Orders.jsx:513-580`), en un modal.

- **A — El botón no existe**, como dice el plan. La pantalla es de seguimiento y
  se crea desde Proveedores. Hay que sacar el botón del diseño y explicar por
  qué.
- **B — El botón existe y abre el alta**, como dibuja la maqueta. Es la
  ubicación natural —crear una orden de compra en la pantalla de órdenes de
  compra— y significa mover el formulario, no escribirlo de cero.
- **C — El botón existe y lleva a Proveedores** con el alta abierta. Resuelve el
  dibujo sin duplicar el formulario, y es un salto de pantalla que sorprende.

**Bloquea** porque es el botón principal de una de las dos pantallas y la regla
del sistema es **un botón principal por pantalla**.

### No bloqueaban

Tienen un valor por defecto propuesto. Si nadie dice lo contrario, se toma ese.

**[PENDIENTE 6] — ¿La barra de «Recepción» es porcentaje de unidades o de
importe?** La maqueta muestra un `pct` y no dice de qué. El modelo solo guarda
`quantity_received` por línea, así que las unidades salen directo y el importe
hay que calcularlo. Con precios unitarios muy distintos los dos números difieren
mucho. **Por defecto: unidades**, que es lo que está guardado, y la etiqueta lo
dice.

**[PENDIENTE 7] — ¿«Entrega estimada» y «Condición de pago»?** La maqueta las
dibuja en el panel (`:1136-1137`) y `supplier_orders` **no las tiene**.
**Por defecto: no se inventan columnas**; el panel muestra los datos que
existen. Si se quieren, son dos columnas nuevas y una migración.

**[PENDIENTE 8] — ¿Qué hace el botón de «más acciones» de la fila?** La maqueta
lo dibuja (`:678`) sin decir qué contiene. **Por defecto**: las acciones que ya
existen y no entran en la fila —WhatsApp con y sin precios— más «Anular» para no
obligar a abrir el panel.

**[PENDIENTE 9] — ¿Anular una orden parcialmente recibida?** Hoy se permite
(`purchaseService.js:180` solo rechaza `received`) y el movimiento de deuda por
lo ya recibido **queda vivo**. **Por defecto: es correcto y se explicita** —la
mercadería llegó y se debe—, la anulación cancela lo pendiente, y la pantalla lo
dice antes de confirmar. Lo que no puede quedar es sin escribir.

**[PENDIENTE 10] — ¿Se puede eliminar un proveedor con saldo distinto de cero?**
Hoy sí, y se lleva puestos pedidos, movimientos y documentos en una transacción
(`suppliers.js:112-132`). Es borrar el respaldo de una deuda. **Por defecto:
bloquearlo con saldo distinto de cero**, y con saldo cero pedir una confirmación
que diga cuántas órdenes y movimientos se van.

**[PENDIENTE 11] — ¿Los filtros del legacy que no están?** El legacy filtraba
por estado del proveedor y por mes (`:7539-7585`). **Por defecto: entra la
búsqueda por nombre (FR-059) y no los otros dos**, hasta que alguien los pida:
el badge de estado ya hace visible lo mismo que el filtro por estado.

**[PENDIENTE 12] — ¿Se replica la vista de asiento en pantalla, además del
archivo?** El legacy tenía una solapa que lo mostraba (`legacy:8268`).
**Por defecto: no en este hito.** Depende de lo que resuelva [PENDIENTE 4].

---

## Lo que se decidió construyendo

Tres decisiones que no estaban en el pedido, ni en el plan, ni en la maqueta:
salieron de implementar el hito y de la verificación adversarial que lo siguió, y
**hasta acá vivían solo en el código**. Se escriben por el mismo motivo que las
de arriba: una decisión que vive en un docstring es una decisión que el próximo
ciclo va a volver a tomar, y quizá distinto.

### 13 · Si el recosteo en cascada falla, la recepción vale y el fallo se avisa

Recibir mercadería recostea los elaborados que usan el insumo comprado
—`purchaseService.recostearDependientes` → `costService.recalculateCascadingCosts`—,
que es la decisión 1 propagada un nivel. **Si ese recosteo falla, la recepción se
guarda igual y el fallo viaja como aviso**, nombrando el elaborado que quedó sin
recostear, por la misma lista de `avisos` que la pantalla ya dibuja.

Se eligió sobre abortar la recepción, y es una decisión de producto, no el
resultado accidental de dónde cayó el `try`:

- **La mercadería entró y la deuda existe.** Son hechos del mundo, no
  conclusiones del sistema, y una receta mal cargada hace meses no los borra.
- **Abortar revierte la transacción entera** —stock, costo, historial y deuda—:
  deja al depósito sin poder registrar el camión hasta que alguien arregle una
  receta que quien recibe mercadería casi nunca puede tocar, y con un 500 que no
  nombra ni el producto ni la receta.
- **Lo que se revertía incluía el costo del insumo**, que es justamente lo que la
  decisión 1 vino a resolver. O sea: abortar dejaba el costo viejo, que es el
  defecto 3 de vuelta, y encima sin la mercadería cargada.

Lo que **no** se hace es callarlo —eso sería un `catch` vacío—: el aviso nombra
el elaborado y dice qué revisar, y el motivo real queda en el log del servidor.

⚠ **Lo que esta decisión deja abierto**: la cascada pudo haber escrito algunos
costos antes de fallar y eso **no se deshace**. Haría falta un SAVEPOINT, y está
anotado como **11e** en `docs/PROXIMOS-PROYECTOS.md` —con la trampa de que el
test que lo verificara pasaría con y sin él, porque el doble de `modelosFalsos`
no soporta `rollback`—.

### 14 · `type` no es un campo editable de un movimiento

La lista blanca de `PUT /api/suppliers/movements/:id` (`CAMPOS_DE_MOVIMIENTO`)
lleva `date`, `amount`, `payment_method`, `notes` y `due_date`. **`type` quedó
afuera, y es una decisión, no un olvido.**

Convertir una deuda en un pago editando el movimiento mueve el saldo por **el
doble** del importe —la fila deja de sumar y pasa a restar— y deja una fila que
miente: sus `notes` siguen diciendo «Recepción orden #118» mientras cuenta como
pago. Con FR-101 —el saldo del listado, el de la ficha, el que bloquea el borrado
y el `saldo_final` del archivo salen todos de la misma función— ese número mal
escrito se propaga a los cuatro lados a la vez.

El tipo no es un dato que se corrija: es **de dónde salió la fila**. Una deuda la
escribe `receiveOrder` cuando llega la mercadería; un pago lo escribe
`POST /:id/payments`. Ninguna pantalla manda `type` en la edición. Si alguien
cargó el movimiento equivocado, **el camino es borrarlo y volver a cargarlo**:
eso deja una cuenta coherente, y una conversión silenciosa deja un asiento que no
se corresponde con nada.

### 15 · La decisión 5 no era un botón: era mudar el formulario

La decisión 5 dice «sí, se crean órdenes desde la pantalla de Órdenes de compra»
y la maqueta dibuja el botón (`AdminApp-Rediseno.dc.html:640`). **Lo que costó
fue otra cosa.** Hasta este hito `createSupplierOrder` se llamaba desde **un solo
lugar de todo `apps/web`**: el modal de `/proveedores`. Cumplir la decisión no
fue agregar un botón, fue **mudar el formulario entero** a `/ordenes-compra` y
sumarle el desplegable de proveedor, que en Proveedores no hace falta porque la
pantalla ya tiene uno elegido.

**Y lo que importa que quede escrito es cómo se perdió, no que se hizo.** La
decisión está en la tabla de arriba desde que se escribió esta spec, y **el plan
no la bajó a ninguna de sus 54 tareas**. No la salteó nadie: la tarea no existía.
Apareció recién en la verificación adversarial del hito, y el síntoma era casi
invisible —`PageHeader` no dibuja el bloque de acciones cuando no le pasan
ninguna (`PageHeader.jsx:27`), así que `/ordenes-compra` no se veía rota, se veía
sin botón—.

Deja una regla para el próximo ciclo: **una decisión de la tabla que no aparece
en ninguna tarea es una decisión que no se va a construir**, y hoy nada lo
verifica. El plan se cruza contra la tabla de decisiones, una por una, antes de
empezar.

---

## Assumptions

1. **Las dos pantallas entran en el marco de 1320px** y ninguna necesita la
   excepción del POS. No hay dos zonas de scroll independientes ni nada que pida
   el alto completo. Las dos rutas ya están en la lista de
   `marcoDeLasPantallas.navegador.js:42`.
2. **La maqueta no dibuja Proveedores.** Es un stub (`:1282`). El diseño sale
   del texto del plan más los primitivos que la maqueta sí fijó, más la
   referencia viva (`pages/Comparador.jsx`). Cualquier cosa que `sdd-verify`
   quiera comparar contra la maqueta para esa pantalla no tiene contra qué.
3. **`receiveOrder` es la pieza más sólida de esta funcionalidad** y no se
   reescribe. Sus tres bugs corregidos —el JSONB que no se persistía, el estado
   que se marcaba completo con una línea de tres, y el stock que caía en la
   empresa 1— están documentados en el archivo y no pueden volver.
4. **La sucursal de la recepción sigue saliendo de `resolverSucursal`.** La
   decisión del hito 4 no se reabre; lo único que agrega US10 es poder elegir
   cuál.
5. **`SupplierOrder.detail` sigue siendo un JSONB.** Normalizarlo a una tabla de
   líneas es un cambio de modelo que ninguna de las dos secciones del plan pide.
6. **Los enlaces de documentos apuntan afuera y AdminApp no los valida.** Solo
   se verifica que empiecen con `http`, como el legacy.
7. **La deuda se sigue expresando en pesos.** No hay moneda por proveedor ni
   compras en dólares. Nada en el modelo lo contempla.
8. **`due_date` sigue sin usarse.** Existe en el modelo y ninguna de las dos
   secciones del plan menciona vencimientos.
9. **Los nueve permisos existentes alcanzan.** No hace falta ninguno nuevo;
   `ordenes_compra.editar` sigue sin usarse porque no hay edición de órdenes.
10. **Ninguna migración**, salvo lo condicional de [PENDIENTE 3] (índices por
    `empresa_id`) y [PENDIENTE 7] (dos columnas).
11. **El pedido dice que 4.5 es «solo diseño» y el relevamiento lo desmiente.**
    Los cuatro defectos que entran no son alcance agregado por gusto: tres son
    de plata o de aislamiento, y el cuarto rompe el filtro de la pantalla que se
    está rediseñando.
