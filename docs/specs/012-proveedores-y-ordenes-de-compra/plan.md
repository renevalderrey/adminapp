# Implementation Plan: Proveedores y Órdenes de compra — pasada fina

**Spec**: [spec.md](./spec.md) · **Rama**: `012-proveedores-y-ordenes-de-compra`
**Escrito**: 4 de agosto de 2026

---

## Summary

`PurchaseOrders.jsx` se reescribe con la tabla en grid de la maqueta y un panel
lateral de 520px que reemplaza a sus dos modales; `Orders.jsx` se reescribe como
las dos columnas de la spec, con badge de estado por proveedor y el historial de
cuenta en `TablaGrid`. Debajo del dibujo va el defecto que pierde plata y stock:
la recepción que se aplica a la orden equivocada. **Se arregla en los dos lados
—pantalla y contrato— porque ninguno alcanza solo**: la pantalla elige mal la
orden antes de que el contrato importe, y el contrato no tiene forma de decir
*qué línea* se está recibiendo. La recepción pasa a proponer el costo nuevo del
producto línea por línea, con la regla del umbral viviendo en el servidor
(`esCambioSignificativo`) y la pantalla dibujando la propuesta. El saldo del
proveedor deja de sumarse en el navegador: lo calcula el servidor sobre los
movimientos y lo devuelve ya hecho, junto con «pedido pendiente de recibir», que
es el número que Comprafit venía leyendo del sistema viejo. **Hay migración**:
cuatro índices, porque el saldo del lado del servidor convierte tres tablas sin
índice por `empresa_id` en tres barridos por carga de pantalla.

---

## Technical Context

### Qué ya se arregló y este plan NO toca

El commit `dfd7009` cerró los defectos 1 y 2 del relevamiento. **Verificado leyendo
el código, no supuesto:**

| Lo que la spec pide | Estado hoy |
|---|---|
| FR-060 · `POST /:id/payments` resuelve el proveedor antes de crear | Hecho, `suppliers.js:196-197` |
| FR-061 · `createOrder` con `assertEmpresaId` + proveedor scopeado | Hecho, `purchaseService.js:16-28` |
| FR-063 · los `include` de hijos filtran por `empresa_id` | Hecho, `suppliers.js:91-94` y `:110-114`, con `required: false` |
| FR-065 · `getOrders` con `assertEmpresaId` | Hecho, `purchaseService.js:218` |
| FR-066 · `cancelOrder` con `assertEmpresaId` | Hecho, `:197`. También `getOrderDetail`, `:256` |
| FR-064 · guardia estática del patrón nuevo | Hecha, y con anclas. Ver la decisión 6 |
| Listas blancas en `create`/`update` | Hechas, `suppliers.js:62-72` |
| El alias de `SupplierOrder.belongsTo(Supplier)` | Hecho, `models/Supplier.js:193` |

**Lo que quedó vivo y sí es de este plan**: FR-062 (los `product_id` del detalle
no se validan contra la empresa, `purchaseService.js:40`) y FR-067 (el `include`
de `Supplier` en `getOrders` no lleva filtro de empresa, `:234`).

### Qué existe y se reusa tal cual

| Pieza | Dónde | Cómo entra |
|---|---|---|
| `TablaGrid` / `Encabezado` / `Fila` / `BotonDeFila` | `apps/web/src/components/TablaGrid.jsx:47,63,86,114` | Las dos tablas. `columnas` es el string crudo de `grid-template-columns`; `BotonDeFila` ya hace `stopPropagation` (FR-007) |
| `Sheet` / `SheetContent` | `apps/web/src/components/ui/sheet.jsx` | El panel de la orden. El ancho va en `style={{ width: '520px', maxWidth: '92vw' }}`, **no en clases**, porque el `sm:max-w-sm` propio del sheet vive en una media query que gana por orden (`PanelVenta.jsx:101-104`) |
| `esCambioSignificativo` / `registrarCambioDeCosto` / `MOTIVOS` | `apps/api/src/utils/historialDeCostos.js:128,151,60` | El costo al recibir. Ver la decisión 2 |
| `resolverSucursal` / `ubicacionDeStock` | `apps/api/src/utils/sucursalDeStock.js:114,185` | Ya está en `receiveOrder`. Solo se saca del bucle y se le pasa la sucursal elegida (US10) |
| `findScoped` / `scoped` / `assertEmpresaId` | `apps/api/src/utils/tenantScope.js` | Todo lo nuevo del servidor |
| `fallo` / `ErrorDeNegocio` | `apps/api/src/utils/errores.js:60,38` | Ver la decisión 8 |
| `filaDeExport` + `armarHoja` | `apps/api/src/utils/exportVentas.js:76` + `apps/web/src/utils/exportarVentas.js:76` | El molde del export. El corte —servidor arma filas, navegador arma hoja— se copia; las columnas no |
| `GET /api/sales/export` | `apps/api/src/routes/sales.js:232-290` | El molde del endpoint, incluido `LIMITE_EXPORT` (`:219`) y el `count` antes del `findAll` |
| `fechaDelNegocio` | `apps/api/src/utils/fechas.js:25` | Las fechas del servidor. Ver la decisión 9 |
| `enviarPedidoPorWhatsapp` | `apps/web/src/utils/pedidoWhatsapp.js` | FR-018. Se conserva tal cual |
| `useConfirmDialog` | `apps/web/src/components/ConfirmDialog.jsx` | Anular, eliminar movimiento, pago mayor al saldo |
| `Can` / `usePermission` | `apps/web/src/components/Can.jsx:16`, `hooks/usePermission.js:3` | `codigo=`, nunca `permission=`. Hoy **ninguna de las dos pantallas consulta un permiso** |
| `Pagination` | `apps/web/src/components/Pagination.jsx` | FR-022. `{ page, totalPages, onPageChange }`, 1-indexado |
| `PageHeader` / `MarcoDePantalla` | `apps/web/src/components/` | Las dos rutas ya están envueltas (`App.jsx:283-284`) |
| El segmentado | `apps/web/src/pages/Inventory.jsx:758-773` | El patrón está escrito ahí y coincide con la maqueta (`bg-surface-3 p-[3px]`, botones de 28px). Se copia el patrón, **no se extrae un componente**: son dos usos |
| `tonoDeStock` | `apps/web/src/utils/inventario.js:221` | El **molde** del badge por tokens: devuelve las tres clases juntas (`border-… bg-…-soft text-…`). El badge de proveedor lo copia, no lo importa |

### Qué se relevó y cambia el diseño

Ocho hallazgos que la spec no tiene y que mueven decisiones.

**1. `PurchaseOrders.jsx` acierta la orden y falla la línea.** La spec culpa a
`Orders.jsx` (defecto 4) y tiene razón, pero **la otra pantalla tiene la mitad del
mismo defecto**: `receiveForm` se indexa por `item.product_id` (`:392-393`), el
`key` del `<div>` también (`:380`), y `handleReceive` manda
`{ product_id, quantity_received }` (`:168-171`). Una orden con dos líneas del
mismo producto tiene **un solo campo** y dos `key` de React repetidos. O sea que
FR-031 no es una corrección de `Orders.jsx`: es del contrato, y por eso la
decisión 1 lo cambia.

**2. Una línea sin `product_id` hace fallar la recepción entera con un 500.**
`createOrder` permite `product_id: null` (`purchaseService.js:40`) y la pantalla
lo produce al escribir un nombre libre (`Orders.jsx:172`). Al recibir,
`Stock.findOne({ where: { product_id: null, … } })` no encuentra nada —en SQL
`= NULL` no matchea— y cae al `Stock.create({ product_id: null, … })`, que choca
contra la columna. La transacción entera se revierte: **no entra nada, ni de las
otras líneas**, y el usuario ve «Error al recibir la orden de compra». La spec lo
anota como caso de borde ambiguo («podría matchear la primera de todas las líneas
sin producto»); lo que pasa de verdad es peor y es determinístico. Ver la
decisión 3.

**3. Los mensajes de `receiveOrder` y `cancelOrder` llegan como 500.** Los cinco
son `throw new Error(...)` (`purchaseService.js:80-82`, `:200-202`), sin
`ErrorDeNegocio`. `fallo()` solo respeta `err.status` cuando `err.publico` es
verdadero (`errores.js:60-73`), así que «La orden ya fue recibida completa» le
llega al usuario como **500 «Error al recibir la orden de compra»**. El caso de
borde de la spec —«tiene que llegar como mensaje legible y no como 500»— hoy no
se cumple ni siquiera con la corrección de la pantalla. Ver la decisión 8.

**4. La fecha de la deuda y la de la orden se calculan en UTC.**
`purchaseService.js:182` y `:51` usan `new Date().toISOString().split('T')[0]`.
Es exactamente lo que `utils/fechas.js` vino a cerrar para las ventas, con el
comentario escrito arriba: en Argentina, después de las 21:00 «hoy» ya es mañana.
Una recepción de las 21:30 del 31 de julio genera un movimiento de deuda fechado
el 1 de agosto, que cae en el mes siguiente del estado de cuenta. La spec no lo
tiene. Ver la decisión 9.

**5. `resolverSucursal` se llama una vez por línea, dentro de la transacción.**
`purchaseService.js:124-128` está adentro del `for`. Una orden de veinte líneas
son veinte resoluciones de la misma sucursal —cada una con su `findScoped` o su
`sucursalPorDefecto`— con la transacción abierta. Sube una vez, antes del bucle.
Es la misma corrección que la decisión 12 del plan de la 011.

**6. Las dos guardias nuevas de `dfd7009` tienen anclas numéricas, y este plan
mueve las dos.** `analizarIncludes` termina con `expect(deHijos.length).toBe(8)`
y el comentario dice «si sube, hay un include nuevo y hay que leerlo, no ajustar
el número». Este plan **baja** ese número a 4, porque saca cuatro `include` de
`suppliers.js`. `analizarCreates` ancla en
`arrayContaining(['routes/suppliers.js', 'services/purchaseService.js'])`, que
condiciona dónde pueden vivir los `create`. Ver la decisión 6.

**7. `PurchaseOrders.jsx:147` no formatea con dos decimales fijos.**
`toLocaleString('es-AR', { minimumFractionDigits: 2 })` sin
`maximumFractionDigits` deja el máximo en 3: `1234.567` sale «1.234,567». La spec
lo da por correcto («ya lo hace bien») y lo usa como referencia. El que está bien
de verdad es `pesos` de `PanelVenta.jsx:36`, que fija los dos extremos.

**8. `hoyDelNegocio` y `pesos`/`fechaCorta` son privados de un archivo que no es
el suyo.** `hoyDelNegocio` es una función local de `routes/sales.js:57`;
`pesos` y `fechaCorta` son constantes de módulo **no exportadas** de
`components/PanelVenta.jsx:36,48`. FR-052 pide literalmente «reutilizando
`fechaCorta`», y hoy eso no se puede hacer sin copiarla. Ver la decisión 5.

### Módulos no liberados

**Las dos pantallas son para el cliente.** No van gates de superadmin: no están
en la lista de CONVENCIONES («clientes, recetas, producción, caja, impuestos y
reportes»). El gateo es el de módulo, y va en los tres lados:

| Lado | Hoy | Queda |
|---|---|---|
| Barra lateral | `navegacion.js:34` y `:36` declaran `modulo` y `permission`; `app-sidebar.jsx:74` filtra por `enabled_modules` | igual |
| `RouteGuard` | `/ordenes-compra` sí (`App.jsx:284`), **`/proveedores` no** (`:283`) | `/proveedores` gana `requiredModule="proveedores"` (FR-090) |
| API | `checkPermission` en los once endpoints | igual, más los nuevos |

**No se crea ningún permiso** (supuesto 9). Los nueve alcanzan y
`ordenes_compra.editar` sigue sin usarse, porque sigue sin haber edición de
órdenes (Fuera de alcance).

---

## Lo que la spec pide y hay que ajustar

Seis cosas. Las tres primeras cambian requisitos; las tres últimas, el alcance.

### 1. FR-073 quedó sin objeto

«Si se decide **no** actualizar el costo, la pantalla DEBE avisar cuando el precio
de compra difiere.» La tabla de decisiones eligió D —actualizar confirmando—, así
que la rama no existe. **El requisito se cumple por vacuidad y no se implementa
nada por él.** Se anota para que `sdd-verify` no lo busque.

### 2. FR-031 no se puede cumplir sin cambiar el contrato

Hallazgo 1. «Los campos DEBEN indexarse por línea de la orden, no por
`product_id`» es una frase sobre la pantalla, pero el cuerpo que hoy manda la
pantalla —`[{ product_id, quantity_received }]`— **no puede expresar** cuál de dos
líneas del mismo producto se recibió. Un arreglo solo de pantalla dejaría dos
campos independientes que colapsan en uno al mandarse. El requisito queda ampliado:

| FR-031 dice | Queda |
|---|---|
| Los campos se indexan por línea | Igual, **más**: el cuerpo del request identifica la línea por su posición en `detail`, y el servidor aplica la cantidad a **esa** línea |
| — | El servidor **rechaza** un cuerpo que no identifique la línea cuando la orden es ambigua (dos líneas del mismo producto, o alguna sin producto) |

### 3. FR-101 se cumple de una forma más fuerte que la escrita

«El saldo del archivo y el de la pantalla DEBEN salir de la misma función.» Con la
decisión 3 —el saldo lo calcula el servidor— **la pantalla no calcula ningún
saldo**: lo recibe. El archivo y la pantalla no salen de la misma función: salen
del mismo número. Es lo que el requisito quería garantizar, por un camino donde no
hay dos implementaciones que puedan separarse.

### 4. El panel de la orden no puede tener el pie que dibuja la maqueta

La maqueta pone `sheetSecondary: 'Descargar PDF'` y, para una orden no recibible,
`sheetPrimary: 'Duplicar orden'` (`:1146-1147`). **Las dos están explícitamente
Fuera de alcance en la spec.** El pie queda: «Anular orden» destructiva a la
izquierda (FR-015), las dos de WhatsApp como secundarias (FR-018), y «Registrar
recepción» como principal. Una orden no recibible no tiene acción principal.
Queda escrito acá y en el archivo, porque `sdd-verify` compara contra la maqueta.

### 5. El bloque de seguimiento del panel pierde dos de sus cuatro filas

Mismo motivo: la maqueta dibuja «Entrega estimada» y «Condición de pago»
(`:1136-1137`) y `supplier_orders` no las tiene. [PENDIENTE 7] resolvió no
inventar columnas. El bloque queda con **Estado, Recibido (%), Fecha y Notas**,
que son las cuatro filas que el modelo puede llenar. Es una desviación declarada
de la maqueta, no un olvido.

### 6. Tres afirmaciones de la spec bajan de nivel de verificación

La tabla «Qué se verifica en qué nivel» manda tres cosas a prueba de navegador que
una función pura contesta mejor, y una a función pura que no puede serlo:

| La spec dice | Queda | Por qué |
|---|---|---|
| «El nombre de un proveedor largo no se mete en la columna de saldo» → navegador | **Sigue en navegador** | Correcto: es geometría, y `pruebas-de-navegador/preparacion.js:35` ya siembra un `NOMBRE_LARGO` de 80 caracteres |
| «El panel mide 520px de verdad» → navegador | **Sigue en navegador** | Correcto: el `max-w-[92vw]` y el `sm:max-w-sm` propio del sheet opinan después |
| «Las filas y los tipos de celda del archivo exportado» → `utils/exportarProveedores.js` | **Se parte**: qué dice cada celda es del servidor (`utils/cuentaDeProveedor.js`), qué **tipo** tiene cada celda es de la web (`utils/exportarProveedores.js`) | Es el corte de `filaDeExport`/`armarHoja` que la propia spec manda copiar |
| «El orden del historial DEBE salir de una función pura» (FR-053) | **Lo ordena el servidor** | El historial pagina (decisión 4) y un orden decidido en el navegador sobre una página es un orden sobre un subconjunto. Lo que sí queda de función pura es que la pantalla **no mute el estado** |

---

## Decisiones

### 1. El defecto 4 se arregla en los dos lados, y el contrato gana identidad de línea

**Se eligió:** las dos mitades, en el mismo hito y en cortes distintos.

**(a) Del lado del contrato**, `PUT /api/suppliers/orders/:id/receive` pasa a
recibir la **posición de la línea** en `detail`:

```json
{ "items": [ { "linea": 0, "cantidad": 10, "actualizar_costo": true } ] }
```

`receiveOrder` deja de hacer `detail.find(d => d.product_id === received.product_id)`
(`purchaseService.js:93`) y pasa a `detail[item.linea]`, validando que el índice
exista. Dos líneas del mismo producto son dos posiciones distintas; dos líneas sin
producto, también.

**(b) Del lado de la pantalla**, la orden que se recibe es **la que se abrió**: su
id vive en el estado (`ordenAbierta`), no se vuelve a buscar. Queda prohibido el
`find` sobre el estado de `Orders.jsx:612`, y hay una guardia estática que lo
verifica (ver «Cómo se verifica»).

**Por qué hacen falta las dos.** Solo (b) arregla las dos pantallas de hoy y deja
un endpoint cuyo contrato **no puede** expresar qué línea se recibió: la primera
orden con dos líneas del mismo producto vuelve a romper, y un request armado a mano
sigue teniendo el comportamiento viejo. Solo (a) no arregla nada, porque
`Orders.jsx` elige la orden equivocada **antes** de que el contrato entre en juego.

**Por qué el índice del arreglo y no un id de línea.**

**Alternativas descartadas:**

- **Darle un `linea_id` a cada línea del `detail` al crear la orden**, **porque**
  las órdenes que ya existen no lo tienen y el respaldo sería el índice igual:
  quedarían dos caminos de resolución donde uno alcanza, y el que menos se
  ejercita —el del id— sería el que se rompa sin que nadie lo note. El `detail` es
  un JSONB, así que el campo no cuesta una migración; cuesta la ambigüedad.
- **Normalizar `detail` a una tabla `supplier_order_items`**, **porque** el
  supuesto 5 de la spec lo declara fuera de alcance, y con razón: es un cambio de
  modelo con migración de datos que ninguna de las dos secciones del plan pide.
- **Mandar `product_id` y desambiguar en el servidor por orden de aparición**,
  **porque** «la primera línea que todavía tiene pendiente» es una regla inventada
  que el usuario no puede ver: escribe 10 en el segundo renglón y la cantidad
  aparece en el primero. Es el mismo defecto con otro nombre.

**Cómo se despliega sin romper la pantalla vieja.** Durante **un solo corte** (el
1), el servidor acepta también el cuerpo viejo `{ product_id, quantity_received }`,
y **solo si la orden no es ambigua**: ninguna línea sin `product_id` y ningún
`product_id` repetido. Si lo es, responde `400 LINEA_REQUERIDA` con el mensaje de
qué producto está repetido. El corte que reescribe la recepción de la pantalla
(el 9) **borra ese camino** y agrega el test de que el cuerpo viejo se rechaza.
La alternativa —dejar el respaldo para siempre— se descarta **porque** es
exactamente el camino ambiguo que este hito viene a cerrar, y un camino que nadie
usa es un camino que nadie mira cuando cambia.

### 2. La regla de «este costo cambió lo suficiente» vive en el servidor, y la pantalla solo dibuja la propuesta

**Se eligió:** `esCambioSignificativo` sirve **tal cual** y no se toca. Lo que se
agrega es de dónde salen sus dos argumentos y quién los mira.

1. `GET /api/suppliers/orders/:id` enriquece cada línea del detalle con
   `costo_actual` (el `Product.cost` de hoy, resuelto con `findScoped`) y
   `propone_costo` (booleano, calculado con `esCambioSignificativo(costo_actual,
   unit_price)`).
2. La pantalla dibuja una casilla **solo** en las líneas con `propone_costo`, con
   el texto «Colágeno: $900,00 → $1.200,00».
3. Al confirmar, cada línea manda `actualizar_costo: true|false`.
4. `receiveOrder`, dentro de la misma transacción, **vuelve a evaluar**
   `esCambioSignificativo` antes de escribir. La casilla del cliente es un pedido,
   no una orden.

**Por qué la regla vive en el servidor.** Es el único lado que escribe la fila de
`ProductCostHistory`, y `caminosDeCostos.test.js:294` ya tiene la guardia de que
nadie más escribe ahí. Poner una copia de `esCambioSignificativo` en la web
crearía **una cuarta implementación de la comparación de importes** —la que su
propio comentario documenta como la que se comía cambios reales según la
magnitud— y, peor, una que puede **discrepar** con la del servidor: una casilla
dibujada que al confirmar no hace nada, o una línea sin casilla que sí habría
cambiado el costo. El navegador no tiene por qué saber cuánto es «lo bastante».

**Alternativas descartadas:**

- **La opción B de la spec, pisar el costo con el último precio**, **porque** ya
  está descartada por el usuario, y el motivo escrito sigue valiendo: la compra
  cara por urgencia re-preciaría el catálogo.
- **Duplicar `esCambioSignificativo` en `apps/web/src/utils/`**, arriba.
- **Que la pantalla pida el costo actual con `GET /products`**, **porque** es un
  viaje más para un dato que el endpoint de la orden ya tiene en la mano, y en
  `Orders.jsx` significaría seguir trayendo 500 productos (`:88`) para leer un
  campo de tres.

**Las tres preguntas que la spec deja abiertas, contestadas:**

**¿Qué pasa si se recibe parcialmente dos veces a precios distintos?** No pasa:
el `unit_price` es **de la línea de la orden** y no cambia entre recepciones de la
misma orden. Precios distintos son órdenes distintas. Lo que sí puede pasar es que
la propuesta reaparezca: si en la primera recepción parcial se **acepta**, el
costo queda igual al `unit_price` y en la segunda `esCambioSignificativo` da falso
—la propuesta desaparece sola, sin ninguna bandera de «ya preguntamos»—. Si se
**rechaza**, vuelve a proponerse en la recepción siguiente. **Eso es lo buscado**:
cada camión es una oportunidad nueva de decidir, y una casilla que recuerda un
«no» de hace dos meses es una casilla que nadie sabe por qué no aparece.

**¿Y si el producto no tenía costo?** `Product.cost` es `0` por defecto.
`esCambioSignificativo(0, 1200)` da verdadero, así que se propone igual. Lo que
cambia es el texto: con costo cero la pantalla dice «sin costo cargado →
$1.200,00» y **la casilla viene marcada**, porque no hay nada que perder. En el
resto de los casos también viene marcada, y el motivo está en la decisión de la
spec al revés: lo que este hito viene a arreglar es que **hoy no pasa nada**, así
que el costo de olvidarse es el defecto 3 de nuevo. La casilla marcada con el
número a la vista deja el rechazo a un clic; la casilla vacía deja el olvido a
cero clics.

**¿Y la propagación a las recetas?** Va, y **la spec no la menciona**. Los cinco
caminos que cambian un costo llaman después a
`costService.recalculateCascadingCosts` (`productionService.js:263-275` es el
molde exacto). Sin eso, un producto elaborado que use el insumo comprado se queda
costeado con el precio viejo y el margen que muestra el POS es mentira —que es
justamente el daño que el defecto 3 describe, corrido un nivel—. Es trabajo real
que el requisito no dice y que hay que presupuestar.

**Un motivo nuevo en `MOTIVOS`** (FR-072):
`RECEPCION_DE_COMPRA: 'Actualización por recepción de compra'`. Ninguna cadena
escrita a mano: `caminosDeCostos.test.js:318` ya falla si aparece un
`reason: '…'` literal.

### 3. Una línea sin producto se recibe, genera deuda y no mueve stock

**Se eligió:** `receiveOrder` clasifica cada línea antes de tocar nada:

| Caso | Stock | Deuda | Costo | Qué ve el usuario |
|---|---|---|---|---|
| `product_id` de un producto de la empresa | Sube | Sí | Se propone | Normal |
| `product_id: null` (nombre libre) | **No se toca** | **Sí** | No aplica | Aviso: «"Fletes" no está en el catálogo: se registró la deuda y no se movió stock» |
| `product_id` de un producto que ya no existe | **No se toca** | **Sí** | No aplica | Aviso equivalente |
| `product_id` de otra empresa | **La recepción se rechaza entera** | — | — | `ErrorDeNegocio` |

**Por qué la deuda sí y el stock no.** La plata se debe: llegó una cosa y hay que
pagarla, tenga ficha de catálogo o no. El stock no se puede mover porque no hay
fila que mover. Hoy el mismo caso **revierte la transacción entera y no entra
nada** (hallazgo 2), así que las otras líneas de la misma orden tampoco se cargan
y el usuario ve un 500 sin explicación.

**Alternativas descartadas:**

- **Rechazar la recepción de una línea sin producto**, **porque** `createOrder`
  permite crearla y la pantalla de Proveedores la produce (`Orders.jsx:172`):
  prohibir recibir lo que se puede pedir deja órdenes que no se pueden cerrar
  nunca.
- **Crear el producto al vuelo**, **porque** un alta de catálogo disparada desde
  una recepción es un producto sin precio, sin categoría y sin unidad, que aparece
  en el POS al día siguiente.

El producto se resuelve con `findScoped(Product, linea.product_id, empresaId, {
transaction: t })`, no con `findByPk`: un `product_id` de otra empresa en el
`detail` de una orden vieja —posible, porque FR-062 recién ahora lo impide al
crear— no puede terminar sumándole stock a nadie.

### 4. El saldo, la deuda y lo pagado los calcula el servidor; el navegador no suma plata

**Se eligió:** `GET /api/suppliers` deja de traer los movimientos y devuelve los
números ya hechos, por proveedor:

```json
{ "id": 7, "name": "Nutrifit", "cuit": "30-…",
  "deuda": 184000.00, "pagado": 120000.00, "saldo": 64000.00,
  "pendiente_de_recibir": 38500.00,
  "movimientos": 23, "documentos": 0 }
```

Tres consultas, ninguna con `include`:

1. `Supplier.findAll({ where: { empresa_id } })` — con `q` y paginación.
2. `SupplierMovement.findAll({ attributes: ['supplier_id', 'type', [fn('SUM','amount'),'total']], where: { empresa_id }, group: ['supplier_id','type'] })` — devuelve dos filas por proveedor como mucho.
3. `SupplierOrder.findAll({ attributes: ['supplier_id','detail'], where: { empresa_id, status: ['pending','partial'] } })` — para `pendiente_de_recibir`.

Y **una función pura** que convierte esas filas en los cuatro números:
`resumenDeCuenta(filasAgregadas)` y `pendienteDeRecibir(ordenes)`, en
`apps/api/src/utils/cuentaDeProveedor.js`, **sumando en centavos enteros**
(FR-050).

**Por qué la agregación va en SQL y la aritmética en una función pura.** El
`GROUP BY` no lo pueden ejecutar los dobles de `tests/helpers/modelosFalsos.js`
—no soportan `group`, ni `Op.*`, ni `order`, ni `limit`— así que una suma escrita
adentro del handler no la alcanza ningún test unitario. Partido así, la parte que
decide plata se prueba con arreglos planos y la parte que solo trae filas se
verifica contra Postgres en el paso manual. Es el mismo corte que hizo
`exportVentas.js` y por el mismo motivo escrito ahí: «adentro de un handler no lo
alcanza ningún test».

**Por qué `pendiente_de_recibir` no va en SQL.** Es
`Σ (quantity − quantity_received) × unit_price` sobre un **JSONB**. En SQL sería
un `jsonb_array_elements` que ningún doble entiende y que nadie va a leer dos
veces; en JS es la misma función pura que ya hace falta para la barra de
recepción, y el conjunto está acotado a las órdenes abiertas de la empresa.

**Este es el número que contesta la decisión 2 de la spec**: la deuda sigue siendo
la mercadería recibida, y «pedido pendiente de recibir» va **al lado**, con su
etiqueta, para que el saldo que Comprafit leía del sistema viejo siga estando a la
vista.

**Alternativas descartadas:**

- **Dejarlo en el navegador** (opción C de [PENDIENTE 3]), **porque** es lo de hoy:
  `Orders.jsx:95-97` acumula `parseFloat` sobre `DECIMAL` que el driver devuelve
  como texto, sobre todos los movimientos que le llegaron, y `GET /suppliers` no
  pagina. Es el mismo error que el total de una venta calculado por el cliente.
- **Una columna `saldo` desnormalizada en `suppliers`**, **porque** es una segunda
  fuente de verdad para plata: el día que un movimiento se edite o se borre
  (FR-093) sin actualizarla, la lista y la cuenta dicen números distintos y nada
  falla.
- **Un endpoint aparte de saldos** (opción B), **porque** deja el listado trayendo
  la contabilidad entera —el hallazgo 7 de la spec— y obliga a la pantalla a
  cruzar dos respuestas para dibujar una fila.

**El historial de movimientos pagina, y cada página trae su saldo inicial.**
`GET /api/suppliers/:id/movimientos?page=N` devuelve los movimientos de la página
**con su saldo acumulado ya calculado**. El saldo al inicio de la página sale de un
`SUM` sobre los movimientos anteriores al corte, que es una consulta indexada y
barata. **Sin eso, un saldo acumulado calculado sobre una página es la suma de un
subconjunto**, y la última fila del archivo exportado no coincidiría con el saldo
grande de la pantalla (FR-101).

### 5. Cuatro piezas privadas suben a `utils/`, y ninguna es un componente nuevo

**Se eligió:** cuatro extracciones, todas de código que ya existe y que la spec
manda reusar.

| Qué | De dónde | A dónde | Por qué |
|---|---|---|---|
| `aCentavos` | privada en `apps/api/src/utils/historialDeCostos.js:104` | `apps/api/src/utils/centavos.js` | FR-050 pide sumar «con la misma disciplina que `esCambioSignificativo`». Hoy eso obliga a escribir un segundo `Math.round(n * 100)`, y dos implementaciones de la conversión a centavos son dos redondeos que se separan. `historialDeCostos` la importa y borra la suya |
| `pesos` | privada en `apps/web/src/components/PanelVenta.jsx:36` | `apps/web/src/utils/formato.js` | FR-051. Es la única del repositorio que fija **los dos** extremos de decimales; la de `PurchaseOrders.jsx:147` no (hallazgo 7) |
| `fechaCorta` | privada en `apps/web/src/components/PanelVenta.jsx:48` | `apps/web/src/utils/formato.js` | FR-052 dice literalmente «reutilizando `fechaCorta`», y hoy no se puede sin copiarla |
| `hoyDelNegocio` | local de `apps/api/src/routes/sales.js:57` | `apps/api/src/utils/fechas.js` | Decisión 9. Lee el `timezone` de la empresa; dejarla en una ruta obliga a `purchaseService` a repetir la consulta |

**Lo que NO se extrae, a propósito:**

- **El segmentado.** El patrón está escrito en `Inventory.jsx:758-773` y esta
  funcionalidad lo usa una vez. Extraerlo con dos usos es adivinar la interfaz del
  tercero. Se copia, con el comentario que dice de dónde.
- **El estado vacío.** No hay componente hoy y hacen falta cuatro instancias con
  textos distintos; el patrón son seis líneas de JSX.
- **El badge de estado del proveedor.** `tonoDeStock` es el **molde**, no la
  función: devuelve las clases del stock, que no son las del saldo. Se escribe
  `tonoDeProveedor` con la misma forma —tres clases juntas, salidas de tokens— en
  `utils/cuentaDeProveedor.js` de la web.

### 6. Las tres guardias con ancla se mueven, y cada número se mueve con su motivo

**Se eligió:** las tres anclas se actualizan **en el corte donde el cambio ocurre**,
nunca al final, y cada una lleva escrito por qué el número es el que es.

**(a) `analizarIncludes`: `toBe(8)` → `toBe(4)`.** El comentario del test dice «si
sube, hay un include nuevo de un hijo con `empresa_id` y hay que leerlo, no ajustar
el número». **Bajar es igual de sospechoso y merece la misma lectura**, así que
acá está la cuenta:

| Include | Dónde | Qué pasa |
|---|---|---|
| `SupplierMovement as 'movements'` | `suppliers.js:92` (listado) | **Se va**: los saldos salen del agregado (decisión 4) |
| `SupplierDocument as 'documents'` | `suppliers.js:93` (listado) | **Se va**: la lista solo necesita el conteo |
| `SupplierOrder as 'orders'` | `suppliers.js:111` (detalle) | **Se va**: las órdenes del proveedor salen de `GET /suppliers/orders?supplier_id=` |
| `SupplierMovement as 'movements'` | `suppliers.js:112` (detalle) | **Se va**: los movimientos paginan por su propio endpoint |
| `SupplierDocument as 'documents'` | `suppliers.js:113` (detalle) | **Se queda**, con su `where` de empresa |

Los otros tres del repositorio no se tocan. `SupplierOrder.belongsTo(Supplier)`
—el de FR-067— **no entra en la cuenta**: el detector solo clasifica `HasMany` y
`HasOne`, así que agregarle el `where: { empresa_id }` no mueve el número.

**(b) `analizarCreates`: el ancla de archivos condiciona dónde viven los `create`.**
`expect(porArchivo).toEqual(expect.arrayContaining(['routes/suppliers.js',
'services/purchaseService.js']))`. Consecuencia concreta: **el `create` del pago
se queda en `routes/suppliers.js`** y no se muda a un servicio. Se anota porque es
la clase de mudanza que alguien hace «para ordenar» y que pone el ancla en rojo
sin que se entienda por qué. Si algún día hay que moverlo, se mueve el ancla con
él y se escribe el motivo ahí.

**(c) `guardiasDeDiseno.test.js`: `toHaveLength(12)` → `toHaveLength(16)`.**
Entran cuatro: `pages/Orders.jsx` y `pages/PurchaseOrders.jsx` **antes** de
reescribirlas (FR-012, FR-069), y `components/PanelOrdenDeCompra.jsx` y
`components/BloqueDeDocumentos.jsx` vacíos —con el `toBeGreaterThan(60)` de
contenido mínimo que el propio test exige, o sea que nacen con su encabezado
escrito—. La consecuencia buscada es dejar la guardia **en rojo** hasta el corte
que reescribe las pantallas. Hoy chocan con tres de los cuatro
patrones: `border-green-500/30` (`Orders.jsx:320`, `:431`),
`border-green-600/30` (`:388`), `bg-green-600 hover:bg-green-700` (`:644`) contra
el de la paleta, y los `Table*` de las dos contra el de shadcn. El título del test
—«los doce archivos existen»— también cambia.

**Alternativas descartadas:** agregar los archivos **después** de reescribirlos,
**porque** es el riesgo 8 del plan de la 010 y la decisión 11 del de la 011,
textual: se descubren treinta hexadecimales al final, cuando ya nadie sabe cuál
vino de dónde.

**(d) Y una guardia nueva, la del defecto 4.** Un patrón estático en
`apps/web/src/tests/guardiasDeDiseno.test.js` que falla si en las dos pantallas
reaparece un `find(` sobre una colección de órdenes dentro de un `onClick`. Es
grosero y es lo que hace falta: la forma exacta del defecto es
`orders?.find(o => o.status === 'pending' …)` adentro del handler del botón
(`Orders.jsx:611-614`), y esa forma se puede leer del archivo. Va con sus dos
muestras sintéticas —con y sin el defecto— como las de `dfd7009`, porque una
guardia sin ancla es una guardia que nadie sabe si mira algo.

### 7. Un solo panel de orden, compartido por las dos pantallas; el proveedor no gana panel

**Se eligió:** `components/PanelOrdenDeCompra.jsx`, con dos modos —detalle y
recepción— y un solo dueño del estado de las cantidades. Lo abren las dos
pantallas: `/ordenes-compra` desde la fila y desde el botón «Recibir»,
`/proveedores` desde la lista de órdenes del proveedor.

**Eso es FR-034 exactamente**: «la recepción DEBE ser un solo componente usado por
las dos pantallas. Dos implementaciones es lo que dejó una de ellas rota».

**Y no contradice «Panel lateral en Proveedores: No»** de la tabla de patrones de
la spec. Esa fila dice que **el detalle del proveedor** no es un panel —es la
mitad derecha de la pantalla, como el POS—. Una orden abierta desde ahí sigue
siendo una orden, y su detalle es el mismo panel que en la otra pantalla. Queda
escrito porque `sdd-verify` va a leer esa fila y encontrar un `Sheet` en
`/proveedores`.

**El botón «Recibir» de la fila abre el panel en modo recepción**, no un diálogo
aparte. Es lo que dibuja la maqueta —el `onClick` del botón «Recibir» es
`{{ o.open }}`, el mismo de la fila (`:675`)— y es lo que hace que la orden que se
recibe sea, por construcción, la que se abrió.

**Alternativas descartadas:**

- **Un `PanelDeRecepcion.jsx` aparte del panel de detalle**, **porque** son dos
  componentes que necesitan la misma orden, las mismas líneas y los mismos
  permisos, y porque el usuario que abre una orden pendiente para mirarla y decide
  cargarla tendría que cerrar uno y abrir el otro.
- **Dejar la recepción de `/proveedores` como estaba y arreglar solo la de
  `/ordenes-compra`**, **porque** es literalmente lo que produjo el defecto: dos
  implementaciones, una rota.

### 8. Los cinco `throw new Error` de `purchaseService` pasan a `ErrorDeNegocio`

**Se eligió:** los cinco mensajes que hoy salen como 500 (hallazgo 3) pasan a
`new ErrorDeNegocio(mensaje, 404 | 409)`:

| Hoy | Status | Mensaje |
|---|---|---|
| `Orden no encontrada` (`:80`, `:200`, `:262`) | 404 | igual |
| `La orden ya fue recibida completa` (`:81`) | 409 | igual |
| `La orden está anulada` (`:82`) | 409 | igual |
| `No se puede anular una orden ya recibida` (`:201`) | 409 | igual |
| `La orden ya está anulada` (`:202`) | 409 | igual |

`fallo()` ya sabe qué hacer con ellos: `err.publico` verdadero → responde
`err.status` con el mensaje tal cual (`errores.js:60-73`). **No hace falta tocar
ninguna ruta.**

Y del lado de la pantalla, FR-095: los tres `console.error` mudos
(`PurchaseOrders.jsx:134`, `:180`, `:191`) y los cuatro
`toast.error(err.message)` (`Orders.jsx:107`, `:118`, `:133`, `:185`) se
reemplazan por un solo helper que lee `err.response?.data?.error` y cae al mensaje
genérico. `err.message` de axios es «Request failed with status code 500», que es
lo que el usuario ve hoy.

**Alternativa descartada:** mapear los códigos en la pantalla con un `switch`,
**porque** los mensajes ya están en castellano del lado del servidor y son los
únicos que saben el contexto («La orden ya fue recibida completa» sabe cuál).

### 9. Las fechas del servidor salen de la zona de la empresa, no de UTC

**Se eligió:** `createOrder` y `receiveOrder` reemplazan
`new Date().toISOString().split('T')[0]` por `await hoyDelNegocio(empresaId)`,
que sube de `routes/sales.js:57` a `utils/fechas.js` (decisión 5).

Es el hallazgo 4 y es el mismo defecto que `utils/fechas.js` ya documenta en su
encabezado. La consecuencia hoy: una recepción de las 21:30 del 31 de julio genera
un movimiento de deuda fechado el **1 de agosto**, que se va al mes siguiente del
estado de cuenta y del archivo exportado. No falla nada.

**Alternativa descartada:** que el navegador mande la fecha, **porque** es la misma
razón por la que `POST /api/sales` no la acepta (contrato de la 011): la fecha de
un asiento la decide el servidor.

### 10. Los cuatro estados de la orden viven en un archivo de la web, y una guardia impide que se separen

**Se eligió:** `apps/web/src/utils/ordenDeCompra.js` con

```js
export const ESTADOS = {
  pending:   { etiqueta: 'Pendiente',        tono: 'neutro', recibible: true,  anulable: true  },
  partial:   { etiqueta: 'Recibida parcial', tono: 'warn',   recibible: true,  anulable: true  },
  received:  { etiqueta: 'Recibida',         tono: 'ok',     recibible: false, anulable: false },
  cancelled: { etiqueta: 'Anulada',          tono: 'neutro', recibible: false, anulable: false },
}
```

y un test que compara sus cuatro claves contra el `ENUM` de
`apps/api/src/models/Supplier.js:82`, **leyendo el archivo como texto**, igual que
hace `tests/mediosDePago.test.js` con `exportVentas.js`. Es grosero y es lo que
hace falta: si mañana el modelo gana un quinto estado, la pantalla lo dibujaría
como código crudo y nadie lo vería, que es exactamente lo que pasó con `tc3`.

`Orders.jsx:44-49` y `PurchaseOrders.jsx:51-63` borran sus copias (FR-107).

**`anulable: true` para `partial`** confirma [PENDIENTE 9]: se puede anular una
orden parcialmente recibida, la deuda de lo ya recibido **queda viva**, y el
`ConfirmDialog` lo dice con el número antes de confirmar. Lo que no puede quedar es
sin escribir.

### 11. Eliminar un proveedor con saldo distinto de cero se bloquea

**Se eligió:** [PENDIENTE 10] por defecto. `DELETE /api/suppliers/:id` calcula el
saldo con la misma función de la decisión 4 y, si no es cero, responde
`ErrorDeNegocio` con el número: «Nutrifit tiene un saldo de $64.000,00. Saldá la
cuenta antes de eliminarlo». Con saldo cero pide confirmación diciendo cuántas
órdenes, movimientos y documentos se van.

**Cuidado con la guardia de observabilidad.** La excepción documentada de
`suppliers.js` (`observabilidad.test.js:182-191`) es un **match exacto sobre la
línea recortada**, y son los tres `destroy` de hijos. El chequeo del saldo va
**antes** de esas tres líneas y **no las reformatea**. Cualquier cambio de
espaciado en ellas rompe la exención y aparece como un hallazgo de aislamiento que
no lo es. FR-068 dice que la lista no puede crecer: no crece.

### 12. `/proveedores` gana `RouteGuard` y el paginado de órdenes usa el que ya existe

**Se eligió:** `App.jsx:283` pasa a
`<MarcoDePantalla><RouteGuard requiredModule="proveedores"><Orders /></RouteGuard></MarcoDePantalla>`,
con el mismo anidamiento que `/ordenes-compra` (marco afuera). Es FR-090 y es una
línea.

**Riesgo bajo, verificado:** `app-sidebar.jsx:74` ya filtra el menú por
`enabled_modules`, así que a una empresa sin el módulo el ítem ya no le aparecía.
Lo único que cierra el guard es la URL escrita a mano.

Y FR-022: `getOrders` **ya acepta `limit` y `offset`** y **ya devuelve `total`**
(`purchaseService.js:229-252`). Lo que falta es del lado de la pantalla:
`PurchaseOrders.jsx:128` manda `limit = 100` fijo y no manda `offset` nunca. Se
usa `components/Pagination.jsx`, que ya existe y es 1-indexado. **No hay trabajo de
servidor acá**, salvo un tope máximo de `limit` para que `?limit=999999` no pida
la tabla entera.

---

## Project Structure

### Archivos nuevos

```
apps/api/src/
  utils/centavos.js                    aCentavos / deCentavos / sumaEnCentavos
  utils/centavos.test.js
  utils/cuentaDeProveedor.js           resumenDeCuenta · pendienteDeRecibir ·
                                       conSaldoAcumulado · filaDeCuentaParaExport
  utils/cuentaDeProveedor.test.js
  utils/recepcionDeOrden.js            aplicarRecepcion(detail, items) puro:
                                       recorte a lo pendiente, estado resultante,
                                       total recibido, avisos por línea
  utils/recepcionDeOrden.test.js
  migrations/20260808-indices-de-empresa-en-proveedores.js
  tests/cuentaDeProveedor.test.js      el endpoint, con modelosFalsos
  tests/recepcionDeOrden.test.js       receiveOrder por línea, costo, ErrorDeNegocio

apps/web/src/
  utils/formato.js                     pesos + fechaCorta, lo que era privado de PanelVenta
  utils/formato.test.js
  utils/ordenDeCompra.js               ESTADOS · porcentajeRecibido · esRecibible ·
                                       esAnulable · filtrarOrdenes · contadores
  utils/ordenDeCompra.test.js
  utils/cuentaDeProveedor.js           estadoDeProveedor · tonoDeProveedor · ETIQUETAS
  utils/cuentaDeProveedor.test.js
  utils/documentosDeProveedor.js       nubeDelEnlace · esEnlaceAceptable · TIPOS
  utils/documentosDeProveedor.test.js
  utils/exportarProveedores.js         COLUMNAS · armarHoja · nombreDelArchivo
  utils/exportarProveedores.test.js
  utils/erroresDeApi.js                mensajeDeError(err) — lee response.data.error
  utils/erroresDeApi.test.js
  components/PanelOrdenDeCompra.jsx    el panel de 520px, detalle + recepción
  components/BloqueDeDocumentos.jsx    la lista de documentos del proveedor
  tests/renderDeOrdenesDeCompra.test.jsx
  tests/renderDeProveedores.test.jsx
  tests/estadosDeOrden.test.js         el contrato contra el ENUM del modelo

apps/web/pruebas-de-navegador/
  proveedoresYOrdenes.navegador.js
```

> **`PanelOrdenDeCompra.jsx` y `BloqueDeDocumentos.jsx` son una decisión de
> reuso, no de tamaño.** Los dos los usan las dos pantallas. Reciben props
> explícitos y **no leen el store por su cuenta**, igual que los tres de
> `components/pos/` — que tienen una guardia que lo verifica
> (`guardiasDeDiseno.test.js:274-293`). Acá no se agrega esa guardia: son dos
> archivos y la regla queda en el encabezado de cada uno.

### Archivos modificados

```
apps/api/src/
  services/purchaseService.js   recepción por línea · costo propuesto y su cascada ·
                                ErrorDeNegocio · fecha del negocio ·
                                resolverSucursal fuera del bucle ·
                                createOrder valida los product_id (FR-062) ·
                                getOrders acota el include de Supplier (FR-067) ·
                                getOrderDetail enriquece con costo_actual
  routes/suppliers.js           GET / con saldos y búsqueda · GET /:id sin movimientos ·
                                GET /:id/movimientos (nuevo) ·
                                GET /:id/movimientos/export (nuevo) ·
                                DELETE con saldo distinto de cero bloqueado ·
                                validación de amount en el pago (FR-088) ·
                                validación de filtros en /orders (FR-021)
  utils/historialDeCostos.js    +MOTIVOS.RECEPCION_DE_COMPRA · aCentavos sale a centavos.js
  utils/fechas.js               +hoyDelNegocio, que baja de routes/sales.js
  routes/sales.js               hoyDelNegocio se importa en vez de declararse
  models/Supplier.js            +los cuatro índices, para que el modelo y la
                                migración digan lo mismo (proyecto 0)
  tests/aislamientoEmpresas.test.js   el ancla de includes: 8 → 4, con la cuenta
  tests/caminosDeCostos.test.js       +services/purchaseService.js en ARCHIVOS
  tests/observabilidad.test.js        sin cambios — se verifica que no crezca

apps/web/src/
  pages/PurchaseOrders.jsx      reescritura completa
  pages/Orders.jsx              reescritura completa
  App.jsx                       RouteGuard en /proveedores (FR-090)
  components/PanelVenta.jsx     borra pesos y fechaCorta, los importa de utils/formato
  services/api.js               receivePurchaseOrder con el cuerpo nuevo ·
                                getSuppliers con params · getMovimientos ·
                                exportarCuenta
  tests/guardiasDeDiseno.test.js  +las dos pantallas y los dos componentes,
                                  toHaveLength(12) → (16) ·
                                  +el patrón del find() sobre órdenes en un onClick
  tests/contratosDeApi.test.js    +el cuerpo de la recepción

docs/REGLAS-DISENO.md           el badge de estado por tokens, con el ejemplo del saldo
docs/PROXIMOS-PROYECTOS.md      lo anotado: enlace de factura por orden, estado de
                                cuenta por WhatsApp, badge de la barra lateral,
                                lock sobre la orden en recepción concurrente
```

### Orden de construcción

**El defecto que pierde plata y stock va primero, y no es una preferencia.**

La reescritura de las dos pantallas son ocho o nueve cortes. Cada día que dura, la
recepción sigue cargando la orden equivocada con los precios de la orden
equivocada, y eso **no se puede reparar después**: hay que deshacer a mano el
stock, el movimiento de deuda y el estado de dos órdenes, contra un registro que
dice que todo salió bien. Todo lo demás de este hito —el grid, el panel, los
badges— es incomodidad, no daño.

Y hay un segundo motivo, más concreto: **el rediseño multiplica el defecto**. La
tabla nueva pone un botón «Recibir» en cada fila (FR-007) donde hoy hay que
expandir un acordeón. Entregar el acceso rápido antes que la corrección es
entregar un acelerador para un defecto conocido.

| # | Corte | Qué deja verificable |
|---|---|---|
| 1 | **API: la recepción por línea, los errores legibles y la fecha del negocio.** Incluye `utils/recepcionDeOrden.js`, el respaldo transitorio del cuerpo viejo, `resolverSucursal` fuera del bucle y las líneas sin producto | US3 escenarios 1-8 y 11, del lado del servidor. Es API pura, no depende de ninguna pantalla, y es donde está el daño irreversible |
| 2 | **API: el costo propuesto al recibir** (`MOTIVOS.RECEPCION_DE_COMPRA`, `costo_actual`/`propone_costo`, `actualizar_costo`, la cascada a recetas) | FR-070 a FR-072. Separado del 1 porque es comportamiento nuevo y porque es el que toca `Product` y `caminosDeCostos.test.js` |
| 3 | **API: el aislamiento que quedó y los filtros.** FR-062, FR-067, FR-021, el tope de `limit` | US4 escenarios 3 y 7, criterio 7. Chico y aislado |
| 4 | **API: la cuenta del lado del servidor.** `utils/centavos.js`, `utils/cuentaDeProveedor.js`, los tres endpoints, **la migración de índices**, el ancla de includes 8 → 4 | US6, criterio 8. Es el corte con migración y va solo |
| 5 | **API: el export de la cuenta** + el bloqueo del `DELETE` con saldo | US8 del lado del servidor, [PENDIENTE 10] |
| 6 | **Web: las siete funciones puras y sus tests** (`formato`, `ordenDeCompra`, `cuentaDeProveedor`, `documentosDeProveedor`, `exportarProveedores`, `erroresDeApi`, + el test de contrato de estados) | Nada visible. Es lo que hace que los cortes 8 a 13 se puedan verificar |
| 7 | **Web: las guardias.** Las dos pantallas y los dos componentes entran a `ARCHIVOS`; se agrega el patrón del `find()` en un `onClick` | Queda **en rojo a propósito** hasta el corte 9 |
| 8 | **`/proveedores` gana `RouteGuard`** | FR-090, criterio 19. Una línea, un corte, un revert si algo sale mal |
| 9 | **Web: `/ordenes-compra`, la lista.** `TablaGrid`, segmentos con contador, búsqueda, filtro de fechas, paginación, estados vacíos, opacidad de las anuladas | US1 entera. El detalle sigue abriendo los modales viejos |
| 10 | **Web: el panel de la orden**, detalle **y** recepción, compartido. Reemplaza los dos modales de `PurchaseOrders.jsx`. Se borra el respaldo del cuerpo viejo del corte 1 | US2 y US3 del lado de la pantalla. Acá la guardia del corte 7 se pone en verde para `PurchaseOrders.jsx` |
| 11 | **Web: `/proveedores`**, dos columnas, badges, saldo grande, historial en `TablaGrid`, buscador | US5 y US6. Acá la guardia se pone en verde del todo |
| 12 | **Web: documentos** (US7) y **pagos y movimientos** (US9) | FR-080 a FR-095 |
| 13 | **Web: la exportación** (US8) | FR-096 a FR-102 |
| 14 | **La sucursal de la recepción** (US10, P3) | FR-103 a FR-105. Último a propósito: se puede cortar sin romper nada |
| 15 | **Pruebas de navegador** y los dos documentos (`REGLAS-DISENO`, `PROXIMOS-PROYECTOS`) | Criterio 18 |

**El corte 8 antes del 9 es deliberado**, aunque sea de otra pantalla: es una línea
que puede dejar a alguien afuera de una ruta, y mezclada con una reescritura de
setecientas líneas nadie sabría cuál de las dos cosas la rompió.

**El corte 10 después del 9 también.** La lista y el panel se podrían escribir
juntos, y no se hace: la lista es dibujo puro y el panel lleva el defecto de plata.
Si el panel falla, tiene que saberse que es el panel.

---

## Cómo se verifica

**Lo que se testea como función pura**, y se extrae a `utils/` justamente para eso:

| Qué | Archivo | Cubre |
|---|---|---|
| El saldo, la deuda y lo pagado a partir de las filas agregadas: sumas que en punto flotante dan `1234.5600000000002`, compensación exacta a cero, saldo negativo por adelanto, proveedor sin movimientos | `api/utils/cuentaDeProveedor.test.js` | FR-050, US6 escenarios 1, 5 y 6, criterio 8 |
| `pendienteDeRecibir`: orden sin ítems, línea con cantidad cero, línea totalmente recibida, orden anulada que no cuenta | idem | Decisión 2 de la spec |
| El saldo acumulado de una página con su saldo inicial: primera página, página del medio, sin movimientos | idem | FR-101, US8 escenario 6 |
| Las filas del archivo: fecha, tipo, descripción, debe, haber, saldo; movimiento sin notas; proveedor sin movimientos | idem | FR-097, US8 escenario 7 |
| `aplicarRecepcion`: cantidad mayor a lo pendiente se recorta y **lo dice**; cantidad cero o negativa se saltea y **lo dice**; dos líneas del mismo producto son dos líneas; línea sin producto; `detail` vacío no marca `received`; línea de cantidad cero no marca `received` | `api/utils/recepcionDeOrden.test.js` | FR-030 a FR-033, FR-037, los seis primeros casos de borde de «Órdenes» |
| `aCentavos` / `sumaEnCentavos`: el caso de `esCambioSignificativo` (1200 → 1200.01), string de `DECIMAL`, `null`, `undefined` | `api/utils/centavos.test.js` | FR-050, US6 escenario 7 |
| Los cuatro estados del proveedor y su tono, con las cuatro combinaciones de la tabla de la spec | `web/utils/cuentaDeProveedor.test.js` | FR-055, FR-056, US5 escenarios 2 y 3 |
| `porcentajeRecibido`: cero ítems, todo recibido, mitad, más recibido que pedido | `web/utils/ordenDeCompra.test.js` | FR-005, [PENDIENTE 6] |
| Qué órdenes entran en cada segmento y con qué contador; la búsqueda por nombre **y** por número de orden | idem | FR-008, FR-009 |
| `esRecibible` / `esAnulable` para los cuatro estados | idem | FR-006, FR-017, [PENDIENTE 9] |
| Que las cuatro claves de `ESTADOS` sean las del `ENUM` del modelo, leyendo el archivo como texto | `web/tests/estadosDeOrden.test.js` | FR-107 |
| `pesos`: entero, un decimal, tres decimales, cero, `null`. `fechaCorta`: el primero de mes no se corre un día | `web/utils/formato.test.js` | FR-051, FR-052, US6 escenarios 2 y 3, criterios 9 y 10 |
| `nubeDelEnlace`: Drive, Dropbox, OneDrive, otro; `esEnlaceAceptable`: sin `http`, con espacios, vacío | `web/utils/documentosDeProveedor.test.js` | FR-082, FR-083 |
| Los tipos de celda del archivo: importe numérico, CUIT como texto con `z: '@'`, el nombre con proveedor y período | `web/utils/exportarProveedores.test.js` | FR-098, FR-099, FR-100, criterio 12 |
| `mensajeDeError`: `response.data.error`, `response.data.message`, axios sin respuesta, error sin nada | `web/utils/erroresDeApi.test.js` | FR-095, criterio 14 |

**Lo que se testea contra la API con `modelosFalsos`**, porque lo que se afirma es
el comportamiento del endpoint y no una cuenta:

| Qué | Archivo | Cubre |
|---|---|---|
| Recibir la orden #118 marca la #118 y no la #112; la deuda usa el `unit_price` de la #118 | `api/tests/recepcionDeOrden.test.js` | US3 escenarios 2 y 7, criterio 1 |
| Recibir una orden recibida o anulada devuelve **409 con el mensaje**, no 500 | idem | Caso de borde, hallazgo 3 |
| Una línea sin `product_id` genera deuda, no toca stock y devuelve su aviso | idem | Hallazgo 2, decisión 3 |
| Un `product_id` de otra empresa en el detalle rechaza la recepción entera | idem | Decisión 3 |
| El cuerpo viejo se rechaza con `LINEA_REQUERIDA` (a partir del corte 10) | idem | Decisión 1 |
| `createOrder` con un `product_id` de otra empresa devuelve `ErrorDeNegocio` y **no crea la orden** | `api/tests/aislamientoDeProveedores.test.js` | FR-062, US4 escenario 3 |
| `getOrders?supplier_id=' '` responde 400 y no un 500 de Postgres | idem | FR-021, criterio 7 |
| `GET /suppliers` devuelve saldos y **no** devuelve movimientos | `api/tests/cuentaDeProveedor.test.js` | Decisión 4, hallazgo 7 |
| `DELETE /suppliers/:id` con saldo distinto de cero responde 400 y no borra nada | idem | [PENDIENTE 10], US9 escenario 9 |
| Un pago de importe cero, negativo o `NaN` se rechaza del lado del servidor | idem | FR-088, US9 escenario 2 |

**Lo que se testea con render**, porque lo que se afirma es el dibujo o el efecto:

| Qué | Archivo | Cubre |
|---|---|---|
| El encabezado y las filas comparten el **mismo string** de `grid-template-columns` | `renderDeOrdenesDeCompra.test.jsx` | FR-002, criterio 15 |
| «Recibir» en la **segunda** orden abre el panel de la segunda | idem | US3 escenario 1, criterio 1. **Es el defecto 4 y es lo que hay que blindar** |
| Confirmar manda **una sola** `api.put`, con el id de esa orden y con `linea` en el cuerpo | idem | US3 escenario 2, FR-030 |
| Dos órdenes con el mismo producto: escribir en una no cambia el campo de la otra | idem | US3 escenario 3, criterio 2 |
| Una orden con dos líneas sin `product_id` tiene **dos** campos | idem | US3 escenario 4 |
| Una línea con 12 pedidas y 8 recibidas tiene máximo 4 y dice `Pedido: 12 · Recibido: 8` | idem | US3 escenario 5, FR-032 |
| Confirmar dos veces seguidas produce **una** llamada | idem | FR-036, US3 escenario 10 |
| Un error del servidor deja el panel abierto, con las cantidades escritas, y muestra el mensaje del servidor | idem | FR-035, US3 escenario 9, criterio 14 |
| Sin `ordenes_compra.recibir`, la acción está **deshabilitada con su explicación en el documento**, no ausente | idem | FR-019, US2 escenario 11 |
| Sin `ordenes_compra.anular`, «Anular orden» igual | idem | US2 escenario 12 |
| Una orden anulada no ofrece ninguna acción | idem | FR-006, US2 escenario 8 |
| El clic en la fila abre el panel; el clic en «Recibir» **no** dispara el de la fila dos veces | idem | FR-007, US1 escenario 7 |
| Los cuatro segmentos muestran su contador | idem | FR-008, US1 escenario 9 |
| La lista vacía distingue «no hay órdenes» de «el filtro no devolvió ninguna» | idem | FR-011, US1 escenario 12 |
| El badge de deuda está **en la fila del proveedor que corresponde** | `renderDeProveedores.test.jsx` | US5 escenario 2, FR-055 |
| El saldo grande del seleccionado es el mismo número que su columna en la lista | idem | US5 escenario 5 |
| El historial se dibuja descendente **sin** que el arreglo del store cambie de orden | idem | FR-053, US5 escenario 8 |
| Un enlace sin `http` no dispara ninguna llamada | idem | FR-082, US7 escenario 3 |
| Los enlaces llevan `rel="noopener noreferrer"` y `target="_blank"` | idem | FR-084 |
| Sin `proveedores.editar`, el bloque de documentos se lee y no se edita | idem | FR-087, US7 escenario 9 |
| Un pago vacío no dispara ninguna llamada | idem | FR-088, US9 escenario 1, criterio 13 |
| Un pago mayor al saldo abre la confirmación con **los dos números** | idem | FR-089, US9 escenario 3 |

**Lo que se verifica leyendo el archivo**, con la forma de las guardias que ya
existen: las dos pantallas y los dos componentes en `guardiasDeDiseno.test.js`
(criterio 17), el patrón nuevo del `find()` sobre órdenes en un `onClick`
(decisión 6d), el ancla de includes en `aislamientoEmpresas.test.js` (decisión 6a),
y que la lista de excepciones de `observabilidad.test.js` no crezca (FR-068).

**Lo que solo contesta un navegador** (`proveedoresYOrdenes.navegador.js`):

1. La tabla de órdenes scrollea **dentro de su tarjeta** y el `<body>` no desborda
   a 1140px ni a 1920px (FR-013, US1 escenario 13, criterio 18).
2. El panel mide **520px de verdad**, después de que opinen el `max-w-[92vw]` y el
   `sm:max-w-sm` que el propio `sheet.jsx` trae (US2 escenario 1).
3. El nombre de proveedor de 80 caracteres que
   `pruebas-de-navegador/preparacion.js:35` ya siembra **no se mete en la columna
   del saldo** (caso de borde de «Proveedores y cuenta»).
4. Las dos columnas de `/proveedores` no se solapan a 1140px (US5).

**Lo que NO baja al navegador**, aunque se pueda escribir: el color del badge, qué
órdenes entran en cada segmento, el porcentaje de la barra de recepción y el
redondeo de un importe. Los cuatro los contesta una función pura de la tabla de
arriba, y repetirlos en Chromium cuesta cincuenta veces más por caso.

**Lo que jsdom y `modelosFalsos` no pueden contestar, y queda como paso manual
reproducible para `sdd-verify`.** No es una excusa: `modelosFalsos.js:13-15` lo
dice en su propio encabezado —«un bug que solo aparece contra Postgres real (por
ejemplo, DECIMAL devuelto como string) NO lo atrapan estos tests»— y no soporta
`group`, ni `Op.*`, ni transacciones, ni locks.

1. **Contra Postgres:** un proveedor con movimientos que en punto flotante suman
   `1234.5600000000002` devuelve `1234.56` por el endpoint, y el `GROUP BY` de la
   decisión 4 devuelve las mismas dos filas por proveedor con `amount` como string.
2. **Contra Postgres:** recibir una orden con dos líneas del mismo producto deja
   **dos** `quantity_received` distintos en el JSONB después del `commit`. Es el
   bug del `changed('detail', true)` que ya se corrigió una vez y que los dobles no
   pueden ver.
3. **Contra Postgres:** recibir una línea con `product_id: null` deja el
   movimiento de deuda **y** deja las otras líneas cargadas, o sea que la
   transacción no se revirtió.
4. **Contra Postgres:** después de la migración del corte 4,
   `npm --prefix apps/api run verificar:esquema` pasa, y `EXPLAIN` sobre el
   `GROUP BY` de movimientos usa el índice nuevo.
5. **Con base recreada solo con migraciones:** el `down` de la migración deja el
   esquema como estaba y el `up` vuelve a correr sin error (proyecto 0).
6. Las dos rutas siguen centradas a 1320px después del corte 8, que es el que toca
   `App.jsx`.
7. Un archivo exportado se abre en una planilla y **la columna de importes suma**
   (criterio 12). Es lo único que el test del tipo de celda no puede afirmar.

---

## Riesgos

**1. El contrato de la recepción cambia y hay una ventana donde la pantalla vieja
convive con el servidor nuevo.** Entre el corte 1 y el corte 10, un navegador con
la pantalla abierta desde antes del deploy manda el cuerpo viejo. *Mitigación:* el
respaldo transitorio de la decisión 1 lo acepta **mientras la orden no sea
ambigua** y lo rechaza con un mensaje legible cuando lo es. *Cómo se detecta:* el
usuario ve «Esta orden tiene dos líneas de Colágeno: recargá la página». *Lo que
no se hace:* dejar el respaldo para siempre — es el camino ambiguo que este hito
viene a cerrar.

**2. El costo actualizado cambia números que el dueño mira todos los días.** El
margen del POS, el punto de equilibrio y el precio recomendado del Comparador se
calculan sobre `Product.cost`. A partir del corte 2, recibir mercadería más cara
los mueve. *Consecuencia buscada* —es el defecto 3— **pero el dueño va a ver bajar
un margen sin haber tocado ningún precio**. *Cómo se detecta:* comparando el panel
de dos días alrededor del deploy. *Cómo se amortigua:* cada cambio queda en
`ProductCostHistory` con `MOTIVOS.RECEPCION_DE_COMPRA` y el panel de historial ya
existe (`components/HistorialDeCostos.jsx`), así que la pregunta «¿por qué bajó?»
tiene respuesta en la pantalla. *Lo que no se hace:* dejar la casilla desmarcada
por defecto para que «no cambie nada» — eso es la opción A con más pasos.

**3. La cascada a recetas convierte una recepción en una escritura de N productos.**
`recalculateCascadingCosts` es recursiva y corre **dentro de la transacción de la
recepción**. Una orden de veinte insumos que participan en recetas anidadas puede
recostear decenas de productos con la transacción abierta. *Cómo se detecta:* la
recepción tarda, o choca contra un lock de otra operación de costos. *Mitigación:*
la cascada solo se dispara para las líneas cuya casilla se aceptó, y `visited` ya
corta los ciclos. *Por qué se acepta:* es exactamente lo que hace
`productionService.recibirOrden` desde siempre, sobre el mismo grafo. *Si aparece:*
sacarla de la transacción es un cambio de una línea y una decisión propia, porque
deja una ventana donde el insumo ya cambió y el elaborado no.

**4. El ancla de `analizarIncludes` baja de 8 a 4 y eso se puede leer como
«desactivar la guardia».** Alguien que vea el diff ve un número más chico en un
test de aislamiento. *Mitigación:* la cuenta de los cuatro `include` que se van
está en la decisión 6a y va **copiada en el comentario del test**, con el archivo y
la línea de cada uno. *Cómo se detecta:* si el número baja más de cuatro, se sacó
un include que este plan no nombra.

**5. `GET /api/suppliers` cambia de forma y es el endpoint que más pantallas
consumen.** Dejar de devolver `movements` y `documents` rompe a cualquiera que los
lea. *Cómo se detecta:* `getSuppliers()` se llama desde `Orders.jsx:75`,
`PurchaseOrders.jsx:142` y —hay que verificarlo antes del corte 4— posiblemente
desde Faltantes y Comparador. *Mitigación:* el corte 4 arranca con un `grep` de
todos los llamadores y el contrato nuevo mantiene los campos escalares del
proveedor tal cual; lo único que desaparece son los dos arreglos. *Por qué se hace
igual:* traer la contabilidad entera en cada carga es el hallazgo 7 y no tiene otra
salida.

**6. `/proveedores` con `RouteGuard` puede dejar afuera a alguien que hoy entra.**
Una empresa cuyo `enabled_modules` no incluya `proveedores` pierde la ruta.
*Cómo se detecta:* al abrir la URL, redirige a `/pos`. *Mitigación:* el ítem del
menú ya se le ocultaba (`app-sidebar.jsx:74` filtra por `enabled_modules`), así que
el único camino que se cierra es la URL escrita a mano; y el corte 8 va solo, con
un revert de una línea. *Lo que hay que hacer antes:* mirar en producción qué
empresas tienen `proveedores` en `enabled_modules`.

**7. Dos personas recibiendo la misma orden a la vez se pisan las cantidades.** El
`lock: t.LOCK.UPDATE` es sobre la fila de `Stock` (`purchaseService.js:137`), **no
sobre la orden**: las dos leen el mismo `detail` y la segunda pisa lo de la
primera. *Está declarado Fuera de alcance en la spec* y este plan **no lo
arregla**. Lo que sí hace es **empeorar la exposición**: el botón «Recibir» pasa a
estar en cada fila de la tabla, así que dos personas mirando la misma lista tienen
el mismo botón a un clic donde antes había que expandir un acordeón. *Cómo se
detecta:* la orden queda con menos recibido del que entró; el stock **no** se
duplica. *Mitigación mínima que sí entra:* agregar
`lock: t.LOCK.UPDATE` al `SupplierOrder.findOne` del corte 1 es una línea y cierra
el caso; queda anotado como lo primero a hacer si aparece. *Por qué no entra ahora:*
cambiar el locking de una transacción que ya bloquea filas de `Stock` en otro orden
es una decisión sobre deadlocks que merece su propia verificación contra Postgres.

**8. La migración toca dos tablas con el desajuste ENUM/VARCHAR abierto.**
`supplier_movements.type` y `supplier_orders.status` son dos de las ocho columnas
que el proyecto 0 de `PROXIMOS-PROYECTOS.md` dejó declaradas `ENUM` en el modelo y
creadas `VARCHAR` por las migraciones. *Consecuencia:* en una base recreada solo
con migraciones, `sync({ alter: true })` sigue muriendo en `products.unit_type`
antes de llegar acá. *Qué hace este plan:* **nada** — los índices son ortogonales
al tipo de la columna y se crean igual sobre las dos formas. *Qué no hace:*
aprovechar el viaje para convertir los dos ENUM, porque hay que contemplar los dos
estados posibles del esquema y eso es el proyecto 0, no este hito. *Cómo se
detecta:* `verificar:esquema` **no** lo ve, y está escrito así en su propio
comentario.

**9. El `SUM` agregado de la decisión 4 no lo puede probar ningún test unitario.**
`modelosFalsos` no soporta `group`. *Mitigación:* la aritmética vive en
`resumenDeCuenta`, que sí se prueba con arreglos planos; lo que queda sin test
automático es que la consulta traiga las filas correctas. *Cómo se detecta:* el
paso manual 1 contra Postgres, y el criterio 8 de la spec, que compara el saldo de
la pantalla con el del archivo. *Por qué se acepta:* la alternativa —traer todos
los movimientos y sumar en JS— es testeable y es el hallazgo 7 de la spec.

**10. `Orders.jsx` y `PurchaseOrders.jsx` no consultan hoy ningún permiso, y el
plan les agrega nueve.** No hay una sola llamada a `Can` ni a `usePermission` en
las 1.065 líneas de las dos. *Consecuencia:* un usuario que hoy ve botones que la
API le rechaza va a ver esos mismos botones deshabilitados, y **puede leerse como
una pérdida de función**. *Cómo se detecta:* alguien pregunta por qué no puede
recibir. *Mitigación:* FR-019 y FR-087 piden explícitamente deshabilitado **con su
explicación** y no ausente, y los tests de render verifican que la explicación esté
en el documento. *Lo que no cambia:* la API ya los exigía; lo que se agrega es que
la pantalla lo diga antes.

**11. Los importes del historial viejo pueden tener más de dos decimales.**
`SupplierMovement.amount` es `DECIMAL(14,2)`, así que no — pero `SupplierOrder.detail`
es **JSONB** y guarda `unit_price` como número de JavaScript sin redondear
(`purchaseService.js:37`: `parseFloat(item.unit_price) || 0`). Un precio unitario
de `10.333` está guardado tal cual, y `total` sí se redondea (`:52`). *Consecuencia:*
el subtotal de una línea del panel y el total de la orden pueden no cerrar por
centavos en órdenes viejas. *Cómo se detecta:* comparando el pie del panel con la
suma de sus líneas. *Mitigación:* el total que muestra el panel es el de la columna
`total`, que es el que se le debe al proveedor; los subtotales de línea se
redondean al dibujarse. *Lo que no se hace:* migrar el JSONB histórico.

**12. `/proveedores` deja de traer las órdenes en `GET /suppliers/:id` y pasa a
pedirlas por `GET /suppliers/orders?supplier_id=`, que exige `ordenes_compra.ver`.**
Un usuario con `proveedores.ver` y sin `ordenes_compra.ver` hoy ve las órdenes del
proveedor —porque vienen en el include, que solo mira `proveedores.ver`— y a partir
del corte 4 no. *Es lo correcto* y la spec lo pide en su caso de borde de permisos
(«ve la cuenta y **no** ve las órdenes»), pero **es una función que alguien puede
estar usando hoy**. *Cómo se detecta:* el bloque de órdenes muestra su estado vacío
con la explicación del permiso. *Mitigación:* el bloque dice «No tenés permiso para
ver las órdenes de compra», no «Sin órdenes», que son cosas distintas.

---

## Anexos

- Parámetros, respuestas y códigos de error de los siete endpoints:
  [contracts/api-endpoints.md](./contracts/api-endpoints.md)
- La migración de índices, con su reversa y el motivo de cada uno:
  [data-model.md](./data-model.md)
