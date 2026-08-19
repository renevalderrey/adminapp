# Feature Specification: Cantidades decimales en la cadena de stock y ventas

**Feature Branch**: `016-cantidades-decimales`
**Created**: 15 de agosto de 2026
**Status**: Draft
**Input**:

> Un posible cliente —una fiambrería— necesita vender fiambre **por peso** con una
> balanza comercial que pesa, calcula e imprime una etiqueta con código de barras.
>
> Pero el pedido real del dueño del producto es más amplio, y lo dijo así:
> *«la idea es que este software se ofrezca a distintos rubros. Comprafit no le
> sirve manejar decimales pero a otro tipo de rubro sí»*.
>
> **Corrección de alcance recibida durante la redacción**: el pedido original se
> parte en **tres** specs. Esta es la primera y cubre **solo la capa de
> capacidad**: migrar las cantidades de `INTEGER` a `DECIMAL`, corregir la
> aritmética que se rompe cuando el driver devuelve `DECIMAL` como texto,
> corregir la validación de `routes/sales.js:321-323` —que hoy acepta `0.4` y
> guarda `0`— y el formateador de cantidad, **solo en lo necesario para que nada
> se vea distinto**.
>
> El motivo de partirla, que es además su criterio de aceptación: **no cambió
> nada para nadie**. Esa afirmación se puede verificar sola, y una spec
> combinada no la puede enunciar — si en el mismo entregable se agrega la venta
> por peso, ya no se puede afirmar que nada cambió. Esta es la spec que cae
> sobre Comprafit, que no recibe ningún beneficio de ella; tiene que poder
> aprobarse y verificarse por separado.

---

## Un aviso antes de empezar: esto no es preparación, es una corrección

La versión anterior de este documento justificaba la migración como «el cimiento
que la venta por peso necesita». **Es la justificación equivocada, y además es
falsa.**

`docs/auditoria-frente2-hallazgos.json:335` documenta un defecto con veredicto
**CONFIRMADO** y severidad final **alta**, verificado línea por línea en el propio
archivo de auditoría:

> `recipe_items.quantity` es `DECIMAL(12,4)` y `production_orders.quantity_produced`
> es `DECIMAL(12,4)`, pero `stock.quantity` y `stock.available` son `INTEGER`. Se
> calcula `newQty = Math.max(0, currentQty - requiredQty)` con `requiredQty`
> fraccionario y se escribe en la columna entera: **PostgreSQL redondea al
> asignar.**

Los dos números, textuales del hallazgo:

| Caso | Cuenta | Lo que se guarda | Consecuencia |
|---|---|---|---|
| Stock 10 kg, consumo 0,4 | `10 - 0.4 = 9.6` | **10** | La harina **no baja nunca**. Se puede producir infinitas veces |
| Stock 10 kg, consumo 0,6 | `10 - 0.6 = 9.4` | **9** | Se descuenta **1 kg** habiendo usado 0,6. Se pierden 0,4 kg en cada orden |

Y la razón por la que nada avisa está verificada en el mismo hallazgo: **Sequelize
6.37.8 no tira `ValidationError`**. `INTEGER.validate` solo corre con
`options.typeValidation`, que `lib/sequelize.js:129` define en `false` por
defecto, y `_validateSchema` solo valida `allowNull` y `STRING`/`TEXT`. O sea que
el `9.6` llega a Postgres y el *cast* de asignación `numeric → int4` redondea, en
silencio, dentro de una transacción que termina bien.

Aplica en tres lugares del mismo servicio, verificados a mano con las líneas de
hoy —el archivo creció desde la auditoría—:

| Dónde | Qué escribe |
|---|---|
| `services/productionService.js:355-357` | El consumo del insumo: `newQty = Math.max(0, currentQty - requiredQty)` |
| `services/productionService.js:482-485` | La devolución del insumo al anular: `currentQty + qtyUsed` |
| `services/productionService.js:506` | La baja del terminado al anular: `Math.max(0, currentFinishedQty - producedQty)` |

**Esta spec corrige eso.** Que además habilite la venta por peso de la 017 es una
consecuencia, no el motivo. La diferencia importa para decidir si se hace: una
preparación se puede posponer; un descuento de stock que redondea, no.

> ⚠ **Honestidad sobre el alcance del daño.** Recetas y producción son módulos
> **liberados solo para superadmin** (`CONVENCIONES.md`, «Módulos no liberados»),
> así que el defecto probablemente no le esté corrompiendo el inventario a ningún
> cliente **hoy**. Lo que no se puede afirmar es que no vaya a hacerlo: el módulo
> existe, está escrito, tiene pantalla, y el día que se libere el defecto ya está
> adentro. Decir «no pasa nada porque nadie lo usa» es exactamente el argumento
> que dejó `sendEmail` devolviendo `ok: true` sin enviar.

---

## Qué es esta spec, y qué son la 017 y la 018

| Spec | Qué entrega | Se ve en pantalla |
|---|---|---|
| **016 · Cantidades decimales** *(esta)* | El esquema puede representar una fracción, la aritmética la respeta, la validación rechaza lo que no entra y **la pantalla se ve exactamente igual que hoy** | **Nada** |
| **017 · Venta fraccionada** | `products.se_vende_fraccionado`, la cantidad decimal en el carrito y en el ticket, el campo numérico en vez del *stepper* `+/−` para los productos fraccionados | Sí |
| **018 · Código de balanza etiquetadora** | La función que interpreta el EAN-13 con prefijo 20-29 y su configuración por marca de balanza | Sí |

**016 no tiene ninguna funcionalidad nueva para el usuario.** Es una spec de
corrección con un criterio de aceptación negativo: que nada haya cambiado. Se
puede desplegar, verificar y aprobar sin que exista la 017.

---

## El sistema viejo no aporta nada acá, y eso se verificó

Se revisó `legacy/index-legacy.html` (10.628 líneas) buscando «balanza», «peso»,
«kilo», «gramo», «fraccionado», «granel» y «kg». **No hay una sola aparición
relevante**: los únicos hits son la conversión de importes a letras
(«pesos con … centavos», `legacy:6694`, `:6859`) y una instrucción a un modelo de
lenguaje que menciona `kg` como una unidad posible en una lista de precios
(`legacy:9469`).

Los tres controles de cantidad del legacy son enteros:
`legacy:4611` — `parseInt(item.cantidad ?? item.stock ?? 0) || 0`; los
`<input type="number">` de `:2098` y `:6382` llevan `step="1"`.

**Comprafit nunca vendió por peso, y el sistema viejo nunca tuvo una cantidad
fraccionaria.** No hay «cómo lo resolvían antes» que consultar, y por eso el
argumento de esta spec no puede salir del legacy: sale de la auditoría.

---

## Contexto: qué existe hoy

Relevado archivo por archivo y línea por línea. **La spec no puede pedir lo que ya
existe ni dar por hecho lo que no.**

### La cadena de cantidades, tipo por tipo

| Dónde | Columna | Tipo hoy |
|---|---|---|
| `models/Sale.js:176` | `sale_items.quantity` | `INTEGER` |
| `migrations/20260531-initial-schema.js:270-272`, `models/Stock.js:44,49,54` | `stock.quantity`, `stock.available`, `stock.min_stock` | `INTEGER` |
| `models/StockMovement.js:31,35,39,43` | `cantidad_anterior`, `cantidad_nueva`, `disponible_anterior`, `disponible_nuevo` | `INTEGER` |
| `models/PedidoItem.js:34` | `pedido_items.cantidad` | `INTEGER` |

### La asimetría, en el mismo archivo de migración

| Dónde | Columna | Tipo hoy |
|---|---|---|
| `migrations/20260531-initial-schema.js:239` | `recipes.yield` | `DECIMAL(12,4)` |
| `migrations/20260531-initial-schema.js:246` | `recipe_items.quantity` | `DECIMAL(12,4)` |
| `migrations/20260531-initial-schema.js:377` | `production_orders.quantity_produced` | `DECIMAL(12,4)` |
| `migrations/20260531-initial-schema.js:396` | `production_order_items.quantity_used` | `DECIMAL(12,4)` |

El módulo de producción modela fracciones desde el día uno; el de venta y stock,
no. **El hueco no es que falte una capacidad: es que dos mitades del mismo sistema
no se pueden hablar sin redondear.**

### El bug latente del punto de venta

`routes/sales.js:321-323` valida sobre el valor de JavaScript:

```js
const invalida = lineas
  .map((item, i) => ({ i, ...normalizarItem(item) }))
  .find((l) => l.quantity <= 0 || l.unit_price < 0);
```

`normalizarItem` (`utils/calculosVenta.js:23-34`) hace
`Number(item.quantity ?? item.qty ?? 1)`, así que `0.4` llega como `0.4`, es mayor
que cero y **pasa la validación**. Después Postgres lo asigna a la columna
`INTEGER` y guarda **`0`**: una línea de venta con cantidad cero, que descuenta
cero de stock, con su `unit_price` y su importe intactos. El comentario de arriba
de esas líneas documenta el defecto **anterior** —la cantidad negativa que sumaba
inventario— y no este.

Este no necesita la balanza para existir. Hoy, en producción, un `POST /api/sales`
con `quantity: 0.4` se acepta.

### Lo que rompe cuando `DECIMAL` vuelve como texto

`pg` devuelve `DECIMAL`/`NUMERIC` como **string**, y este repositorio **no
registra ningún `setTypeParser`**: `config/database.js` solo declara
`dialectOptions` para SSL, y la única mención de `setTypeParser` en todo el
repositorio es un comentario que pide expresamente **no** registrarlo
(`tests/integracion/centavoDelSaldo.integracion.test.js:243`, que además
caracteriza el comportamiento con `expect(typeof filas[0].total).toBe('string')`).

**El operador que rompe es `+`, no `-`.** En JavaScript la resta fuerza a número:
`'100' - 0.25` es `99.75`. La suma concatena: `'100' + 0.25` es `'1000.25'`.

**Los cuatro sitios que rompen**, verificados a mano uno por uno:

| Dónde | Línea | Qué hace |
|---|---|---|
| `routes/sales.js:722-723` | `stock.quantity + item.quantity` | Reposición al **anular una venta**. Los dos operandos vienen de la base |
| `routes/stock.js:155-156` | `destStock.quantity += qty` | **Destino** de una transferencia entre sucursales |
| `services/purchaseService.js:496-497` | `stock.quantity + linea.recibido_ahora` | **Recepción** de una orden de compra |
| `routes/general.js:90` y `:181` | `Math.max(0, oldAvail + delta)` | **Edición manual** de stock |

Tres cosas que hay que decir con precisión, porque son las que hacen que este
listado no se pueda derivar de memoria:

1. **`routes/stock.js` tiene el defecto y la corrección en el mismo bucle.**
   `:145-146` es `sourceStock.quantity -= qty` —resta, segura— y diez líneas más
   abajo `:155-156` es `+=` —rota—. Una transferencia sacaría bien de origen y
   escribiría basura en destino, o sea que la mercadería **desaparece de una
   sucursal y no aparece en la otra**.

2. **`routes/general.js:90` es el peor de los cuatro, y es el que parece seguro.**
   `Math.max` convierte a número **después** de que `+` ya concatenó:
   `Math.max(0, "100" + 5)` es `1005`, no `105`, y no lanza nada. Un `Math.max`
   alrededor de una suma **da la impresión de estar coercionado y no lo está**.

3. **«Ya usa `parseFloat`» no significa «está a salvo».**
   `services/productionService.js` usa `parseFloat(stockRecord.quantity)` en `:355`
   y `:482`, así que **no** tiene el defecto de concatenación — y aun así es el
   servicio que la auditoría confirma corrompiendo inventario, porque el daño ahí
   no está en la aritmética sino en la **columna de destino**. Los dos defectos son
   independientes y hay que arreglar los dos.

Lo que **no** rompe, y por eso no se toca: `routes/sales.js:553-554` (el descuento
al vender, resta), `utils/calculosVenta.js:23-34` (`Number(...)` explícito) y
`utils/inventario.js` entero, que envuelve cada lectura en `Number(…) || 0` con el
motivo escrito arriba de cada función.

Aparte, `routes/import.js:406` y `:431` usan `parseInt(data.quantity, 10)` y
`parseInt(data.min_stock)`: no concatenan, **truncan**. Una planilla con `0,4`
importaría `0`.

### Los nueve puntos donde una cantidad se dibuja

Esto es el corazón de la spec, y la razón por la que la migración **no es solo una
migración**.

⚠ **La regresión no necesita una sola fila fraccionaria.** `pg` devuelve un
`DECIMAL(14,4)` con su escala completa: un stock de `12` guardado en esa columna
vuelve como la cadena **`"12.0000"`**. O sea que el día que corre la migración,
**sin que nadie venda nada por peso y sin que exista un solo decimal en toda la
base**, estos nueve lugares cambian solos:

| # | Dónde se dibuja | Archivo:línea | Hoy | Después de migrar, sin formateador |
|---|---|---|---|---|
| 1 | **Ticket impreso** de una venta | `InvoicesList.jsx:651` → `printInvoice.js:125` | `3 x Creatina` | `3.0000 x Creatina` |
| 2 | Baldosa del catálogo del POS | `CatalogoDelPos.jsx:200` ← `Billing.jsx:351` | `5 u.` | `5.0000 u.` |
| 3 | Aviso de stock del POS | `Billing.jsx:468` | `hay 5 en esta sucursal` | `hay 5.0000 en esta sucursal` |
| 4 | Panel del producto · disponible | `PanelProducto.jsx:1173` | `10` | `10.0000` |
| 5 | Panel del producto · campo cantidad | `PanelProducto.jsx:1158` (`value={fila.quantity}`) | `10` | `10.0000` **dentro del input** |
| 6 | Reporte de inventario | `Reports.jsx:345` ← `routes/reports.js:95,103` | `12` | `12.0000` |
| 7 | Panel del pedido online | `PanelDePedido.jsx:229` (`{l.cantidad}×`) | `2×` | `2.0000×` |
| 8 | Mensaje de stock insuficiente **al vender** | `routes/sales.js:548` (`${stock.available}`) | `disponible 5` | `disponible 5.0000` |
| 9 | Mensaje de stock insuficiente **al transferir** | `routes/stock.js:142` (`${sourceStock?.quantity \|\| 0}`) | `disponible: 0` | `disponible: 0.0000` |

⚠ Dos trampas dentro de esta tabla:

- **El punto 5 es un `<input>`, no un texto.** `PanelProducto.jsx:310` carga
  `quantity: existente?.quantity ?? 0` desde el servidor, y un `value="10.0000"`
  en un `<input type="number">` es válido: el navegador lo muestra tal cual. El
  usuario abre la ficha de un producto que nunca tuvo un decimal y ve `10.0000` en
  el campo que va a guardar.
- **El punto 9 no se arregla formateando.** `stock.js:142` escribe
  `sourceStock?.quantity || 0`: hoy, con el número `0`, el `||` cae al cero de la
  derecha y el mensaje dice «disponible: 0». Con la cadena `"0.0000"` —que es
  *truthy*— el `||` **ya no cae**. El cambio ocurre justo en el caso de stock
  cero, que es el único en el que ese mensaje se lee, así que lo que hay que
  corregir es que la expresión deje de depender de que el valor sea *falsy*.

**Y cinco lugares que parecen de esta lista y NO lo son.** Verificados uno por
uno, porque incluirlos llevaría a «corregir» código que está bien y a escribir
tests que pasan con y sin el cambio:

| Parece | Por qué no rompe |
|---|---|
| Ticket **en pantalla** del POS, `TicketDelPos.jsx:219` | `linea.qty` sale del carrito, que vive en el navegador y nunca pasó por la base |
| Movimientos de inventario, `Inventory.jsx:147` (`×${i.quantity}`) | Sale de `StockTransfer.items`, que es **`JSONB`** (`models/StockTransfer.js:33-34`): una foto escrita desde el cuerpo del request, no una columna `DECIMAL` |
| Reporte de **ventas**, `Reports.jsx:232` | `routes/reports.js:39` ya hace `parseFloat(i.quantity)` antes de responder |
| Stock insuficiente en producción, `productionService.js:252` | `:247` ya hace `parseFloat(stockRecord.quantity) \|\| 0` |
| Todo `utils/inventario.js` | Envuelve cada lectura en `Number(…) \|\| 0`, con el motivo escrito arriba de cada función |

⚠ Los tres del medio **sí** tienen que pasar por el formateador igual, pero por
otra razón y con otra urgencia: hoy devuelven un `number`, así que una cantidad
fraccionaria se dibujaría `9.6` —con punto— en vez de `9,6`. **No es una regresión
del día de la migración**; es formato argentino faltante, y se corrige en el mismo
cambio porque el formateador ya va a existir.

### Lo que ya existe del lado del formato

`apps/web/src/utils/formato.js` tiene `pesos`, `pesosRedondos`, `pesosDeLista`,
`importeOGuion`, `importeAbreviado` y cuatro funciones de fecha. **Ninguna formatea
una cantidad.** El helper sobre el que se apoyan todas es
`enEsAr(n, minimos, maximos)` (`:72-77`), con los dos extremos **obligatorios y
posicionales a propósito** — el encabezado del archivo explica que el defecto que
eso previene es fijar el mínimo y olvidarse el máximo, que dejaba `1.234,567` en
una columna de pesos.

El archivo tiene además una **guardia** al final de `utils/formato.test.js` que
recorre `pages/` y `components/` con recursión y **afirma cuántos archivos
revisó**, para que nadie vuelva a escribir un formateador adentro de una pantalla.

---

## Hallazgos del relevamiento

Lo que apareció al mirar el código y **no estaba en el pedido**. Cada uno dice si
entra, y por qué.

### H1 · La regresión visual ocurre el día de la migración, no el día de la primera venta por peso

**Entra, y reordena la spec entera.** La intuición es que mientras nadie cargue un
decimal no se ve nada. Es falsa: `DECIMAL(14,4)` vuelve del driver con la escala
puesta, así que los nueve puntos de arriba cambian con la base tal como está hoy.

Consecuencia: **el formateador no es «la capa de presentación de la 017»**. Es
parte inseparable de 016 y tiene que entrar en el mismo despliegue que la
migración.

⚠ **Corrección, medida al implementar la Fase 4: el ejemplo del ticket impreso
estaba MAL elegido.** Esta spec decía que separar las dos fases dejaba a
Comprafit imprimiendo `3.0000 x Creatina`. No es cierto:
`utils/printInvoice.js:59` pasa **todos** los items por `normalizarLinea`, que
en `comprobanteAfip.js:141` ya hace `Number(item.quantity ?? item.qty ?? 0)`.
Ese `"3.0000"` llega al ticket como el número `3` con y sin el formateador, así
que el ticket impreso **ya estaba cubierto** y no es una regresión del día de la
migración. Su tarea es FR-034a, no FR-037.

El hallazgo H1 **sigue en pie**: los otros puntos sí regresan, y está verificado
por mutación —revertir `cantidad()` en `CatalogoDelPos` pone tres casos en rojo,
y el aviso de stock de `Billing` pasaba a decir «hay 5.0000 en esta sucursal»—.
Lo que cae es el ejemplo, no la conclusión. Se deja anotado porque el criterio
de éxito 1 se apoyaba justamente en el punto que ya estaba cubierto.

### H2 · «Ya usa `parseFloat`» tapó cuatro sitios rotos

**Entra.** El brief original de esta funcionalidad afirmaba que solo rompía
`routes/sales.js:722-723` y que `stock.js` y `purchaseService.js` «ya usan
`parseFloat`». Verificado: usan `parseFloat` sobre el **input**, no sobre el valor
leído de la base. Son cuatro sitios, no uno.

Es un hallazgo de método además de de código: **la auditoría de una migración de
tipo no se puede hacer buscando `parseFloat`**. Hay que mirar de dónde viene cada
operando de cada `+`.

### H3 · `Math.max` no coerciona lo que parece

**Entra, con su propio test.** `routes/general.js:90` y `:181` son el caso donde un
lector atento se equivoca: hay una función numérica alrededor de la suma, y la
suma ya concatenó. Merece un test con el nombre escrito para que se entienda qué
protege — algo del orden de `it('Math.max(0, "100" + 5) NO es 105')`.

### H4 · La validación de `sales.js` queda mal aunque se migre

**Entra.** Migrar a `DECIMAL(14,4)` **no arregla** `routes/sales.js:321-323`: lo
corre un escalón para abajo. Hoy `0.4` se guarda como `0`; después, `0.4` se
guarda bien y **`0.00004` se guarda como `0.0000`**, o sea exactamente el mismo
defecto —una línea de venta con importe y cantidad cero— con cuatro ceros más.

Una validación que acepta lo que la columna no puede representar es el defecto, no
el tipo de la columna. Ver US3 y el PENDIENTE 1.

### H5 · `pedido_items.cantidad` se migra y nada escribe decimales ahí

**Entra como aclaración, no como trabajo.** La columna entra en la migración porque
es parte de la misma cadena, pero `apps/tienda/src/carrito.js:55` hace
`Math.floor(Number(cantidad))` sobre toda cantidad que el comprador escribe, y
`checkout.js:216` manda solo `product_id` y `cantidad`. **La tienda pública sigue
vendiendo por unidad**, y esta spec no lo cambia.

Lo que sí hay que hacer es el punto 7 de la tabla de los nueve:
`PanelDePedido.jsx:229` dibuja `{l.cantidad}×` crudo y pasaría a decir `2.0000×`.

### H6 · Un `setTypeParser` global arreglaría esto y rompería la plata

**Entra como prohibición explícita.** La solución de una línea —registrar
`pg.types.setTypeParser` para `NUMERIC` y que todo vuelva como `number`— es la
primera que aparece y **no se puede tomar**. El repositorio ya tiene escrito por
qué: `tests/integracion/centavoDelSaldo.integracion.test.js:243` explica que ahí
«los importes empezarían a llegar como `number`, con la pérdida de precisión que el
texto evita, y ningún otro test lo diría».

Ese test **caracteriza el driver** y se pondría en rojo si alguien lo registra. Es
la red que ya existe; esta spec la deja intacta y no la rodea.

### H7 · El `down` tiene que negarse, pero no siempre

**Entra, con un matiz que importa.** Bajar de `DECIMAL` a `INTEGER` **pierde las
fracciones**, y redondearlas en silencio al revertir sería el mismo defecto que la
migración vino a eliminar, en espejo.

Pero **no** puede negarse siempre: sin filas fraccionarias, revertir es limpio y
negarse sin motivo obliga a la próxima persona a editar el archivo de la migración.
La forma correcta es la **negativa condicional**, que este repositorio ya tiene de
precedente en `20260804-identidad-de-sucursal-en-stock.js` («se niega si le
borraron el archivo, en vez de revertir a medias»,
`reversibilidadDeMigraciones.test.js:121`).

⚠ Y por eso **no va en `SE_NIEGAN`**. Ese mapa
(`scripts/verificar-reversibilidad.js:110`) lista las que se niegan **siempre**
—hoy tiene una sola entrada, `20260806-esquema-de-permisos.js`— y el test `:184`
corre su `down` esperando que falle. Una migración que se niega condicionalmente
pasaría en verde sobre una base limpia por la razón equivocada. Ver US5.

### H8 · La migración toma un lock exclusivo sobre `sale_items`

**Entra como dependencia operativa, no como historia.** `ALTER TABLE … ALTER COLUMN
… TYPE` desde `INTEGER` a `NUMERIC` **reescribe la tabla** y toma un
`ACCESS EXCLUSIVE LOCK` mientras dura. Sobre `stock` y `stock_movements` es
probablemente instantáneo; sobre `sale_items` —una fila por línea de cada venta
desde que el sistema existe— depende de cuántas filas haya, y no se sabe.

Durante ese lock **el punto de venta no puede cobrar**. Ver el PENDIENTE 3.

---

## Vocabulario: qué significa cada palabra acá

| Palabra | Qué significa **acá** | Con qué se confunde |
|---|---|---|
| **Cantidad** | El número de unidades o de kilos de una línea de venta, de una fila de stock o de un movimiento. Es lo que esta spec migra | El **importe**, que ya es `DECIMAL(12,2)` en todos lados y **no se toca** |
| **Representable** | Que la columna puede guardar el valor **sin cambiarlo**. `0.4` es representable en `DECIMAL(14,4)` y no lo es en `INTEGER` | «Válido». Un valor puede ser representable y aun así rechazarse por regla de negocio |
| **Capacidad** | Lo que el esquema **permite** guardar. Es todo lo que entrega esta spec | «Funcionalidad». 016 no agrega ninguna: nadie puede hacer nada nuevo desde una pantalla |
| **Que nada cambie** | Que **ningún número que hoy se dibuja bien se dibuje distinto**. No es «que ningún número cambie»: los que hoy están redondeados mal (producción) **sí** cambian, y ese es el arreglo | «Que no se note». Se verifica carácter por carácter en los nueve puntos, no de vista |
| **`DECIMAL` como texto** | Lo que devuelve `pg` para una columna `NUMERIC`: la cadena `"12.0000"`, con la escala puesta | Un problema de precisión. Es un problema de **tipo**: `'100' + 5` y `'100' - 5` dan cosas distintas |

---

## Qué se verifica en qué nivel

`CONVENCIONES.md` fija la escalera —tres niveles en `apps/web`, cuatro en
`apps/api`—. Acá se aplica caso por caso.

**El cuarto nivel no es opcional en esta funcionalidad: es la única forma de ver el
defecto.** Los dobles de `tests/helpers/modelosFalsos.js` no saben de tipos —lo
dice su propio encabezado— así que un test con dobles devuelve el `number` que le
pusieron y **pasa en verde con la aritmética rota**.

| Afirmación | Nivel | Dónde |
|---|---|---|
| Cómo se escribe una cantidad: entera sin decimales, fraccionaria con los suyos, `null`, cadena, cero | **Función pura** | `apps/web/src/utils/formato.js` + su test en `utils/formato.test.js` |
| Que ninguna pantalla vuelva a formatear una cantidad por su cuenta | **Guardia estática** | La guardia que ya existe al final de `utils/formato.test.js`, extendida a cantidades |
| Que el ticket impreso diga `3 x Creatina` y **no** `3.0000 x Creatina` | **Test de render** | `apps/web/src/tests/` — es el criterio de éxito 1 |
| Que el modelo y la migración declaren el mismo tipo | **Guardia estática** | `verificacionDeTiposDelEsquema.test.js` + `scripts/verificar-esquema.js` |
| Que el `down` se niegue **con** filas fraccionarias y funcione **sin** ellas | **Integración** | Es un cambio de esquema condicionado por datos: no hay otro nivel donde exista |
| **Que `0.4` se guarde como `0.4` y no como `0`** | **Integración** | El único nivel donde Postgres asigna de verdad |
| **Que anular una venta devuelva el stock a su valor original y no a `1003`** | **Integración** | La concatenación **no existe** con un doble: el doble devuelve el `number` que le pusieron |
| Que una transferencia sume bien en el destino | **Integración** | idem, y el origen no sirve de control: la resta anda igual |
| Que `Math.max(0, oldAvail + delta)` dé el número y no la concatenación | **Integración**, y un test de unidad que documente el caso | `it('Math.max(0, "100" + 5) NO es 105')` |
| Que una recepción de compra sume bien | **Integración** | idem |
| Que una producción que consume 0,4 deje el stock en 9,6 | **Integración** | Es el hallazgo `auditoria-frente2-hallazgos.json:335` ejecutado |
| Que un `POST /api/sales` con una cantidad no representable se rechace **y no deje ninguna fila** | **Integración** | La validación se puede probar con un doble; que la fila **no quedó**, no |
| Que el aislamiento entre empresas siga cerrado en todo lo que se toque | **Guardia estática + integración** | `aislamientoEmpresas.test.js` y `src/tests/integracion/` |

**Advertencia sobre la fixture**, que es donde este proyecto más se equivocó
(`tests/integracion/fixtures.js:22-48`): la de esta funcionalidad necesita **una
fila de stock con un valor no redondo** —un stock de `10` cierra igual con y sin la
corrección de concatenación si la aserción es floja—, **una venta con más de una
línea**, **una cantidad que al concatenar dé un número mayor y no menor** (para que
el test no pase por un `toBeLessThan`), y **una fila con `available = 0`**, que es
el único caso donde el `|| 0` de `stock.js:142` cambia de rama.

---

## User Scenarios & Testing *(mandatory)*

Cinco historias. Las cuatro primeras son P1 y **ninguna se ve en una pantalla**.

---

### User Story 1 — Una cantidad fraccionaria se guarda como se mandó, y no redondeada (Priority: P1)

Como responsable del inventario, quiero que descontar 0,4 kg de harina deje 9,6 kg,
para que el stock que muestra el sistema sea el que hay en el depósito.

**Why this priority**: es el defecto confirmado por la auditoría con severidad
alta, y es la capacidad de la que cuelgan las otras cuatro historias. Sin la
columna, todo lo demás es cosmética sobre un redondeo.

**Independent Test**: registrar una orden de producción que consuma una cantidad
fraccionaria de un insumo y mirar la fila de `stock` en la base. Verificable contra
hoy, donde el hallazgo `auditoria-frente2-hallazgos.json:335` documenta que no
baja.

**Acceptance Scenarios**:

1. **Given** un insumo con `stock.quantity = 10` y una receta que consume 0,4,
   **When** se registra la producción, **Then** la fila queda en **9,6** y no en
   10. Es el escenario textual del hallazgo, ejecutado.
2. **Given** el mismo insumo en 10 y un consumo de 0,6, **When** se registra,
   **Then** queda en **9,4** y no en 9: no se descuenta 1 kg por 0,6.
3. **Given** una línea de venta con cantidad 0,4 escrita en la base, **When** se la
   lee, **Then** vale **0,4** y no 0. *(Que el endpoint `POST /api/sales` acepte o
   rechace esa cantidad es el PENDIENTE 2; este escenario afirma que la columna no
   la corrompe.)*
4. **Given** la base con todas sus cantidades enteras, **When** corre la migración,
   **Then** **ninguna fila cambió de valor**, verificado dentro de la misma
   transacción con un `COUNT(*)` de `quantity <> ROUND(quantity)` que tiene que dar
   cero.
5. **Given** el modelo de Sequelize y la base, **When** corre
   `scripts/verificar-esquema.js`, **Then** no reporta divergencia: modelo y
   migración cambiaron juntos.
6. **Given** una fila de stock existente con cantidad 12, **When** se la lee
   después de migrar, **Then** el valor sigue siendo doce —no once, no doce coma
   algo— aunque el driver lo entregue como la cadena `"12.0000"`.

---

### User Story 2 — El stock que vuelve es el stock que había (Priority: P1)

Como dueño, quiero que anular una venta, transferir entre sucursales, recibir una
compra o corregir el stock a mano den el número correcto, para que la mercadería no
aparezca ni desaparezca por un tipo de dato.

**Why this priority**: es el riesgo real del despliegue. La migración de US1, sola
y sin esto, **rompe cuatro caminos de escritura de inventario** que hoy funcionan.
Va en el mismo commit o no va.

**Independent Test**: para cada uno de los cuatro caminos, leer el stock, ejecutar
la operación y comparar el resultado con la cuenta hecha a mano. Contra un Postgres
real: con dobles, los cuatro pasan en verde rotos.

**Acceptance Scenarios**:

1. **Given** un producto con `stock.quantity = 100` y una venta de 3 unidades ya
   registrada, **When** se anula la venta (`routes/sales.js:722-723`), **Then** el
   stock queda en **103** y no en **`1003`** ni en `"1003.0000"`.
2. **Given** la misma anulación con una cantidad fraccionaria de 0,25, **When** se
   anula, **Then** el stock queda en **100,25** y no en `"100.00000.2500"`.
3. **Given** una transferencia de 5 unidades de la sucursal A a la B, con B en 20,
   **When** se ejecuta (`routes/stock.js:155-156`), **Then** B queda en **25**, y A
   bajó 5. **El origen no alcanza como verificación**: la resta anda con y sin la
   corrección, así que el test tiene que mirar el destino.
4. **Given** una orden de compra con 10 unidades pendientes sobre un stock de 7,
   **When** se recibe (`services/purchaseService.js:496-497`), **Then** el stock
   queda en **17**.
5. **Given** una fila de stock en `quantity = 100`, `available = 100`, **When** se
   edita la cantidad a 105 desde el panel (`routes/general.js:90`), **Then**
   `available` queda en **105** y no en **1005**. Es el caso del `Math.max`, que no
   lanza nada y devuelve un número creíble.
6. **Given** el mismo camino por `routes/general.js:181`, **When** se manda solo
   `quantity`, **Then** `available` se mueve el mismo delta y ninguno de los dos
   queda concatenado.
7. **Given** una importación de planilla con la columna cantidad en `0,4`, **When**
   se importa (`routes/import.js:406`), **Then** la fila guarda 0,4 y no 0:
   `parseInt` no trunca más.
8. **Given** cualquiera de los cuatro caminos, **When** se revierte la corrección de
   esa línea y se corre su test, **Then** el test **se pone en rojo**. Los cuatro
   tienen que poder demostrarlo por separado.

---

### User Story 3 — Lo que la base no puede guardar se rechaza antes, y no se redondea después (Priority: P1)

Como dueño, quiero que el sistema me diga que una cantidad es inválida en vez de
guardarme una línea de venta en cero, para no descubrir en un recuento físico que
vendí algo que nunca salió del inventario.

**Why this priority**: es el defecto de `routes/sales.js:321-323`, que existe hoy
en producción y que **la migración de US1 no arregla**: lo mueve un escalón para
abajo (H4). Una validación que acepta lo que la columna no representa es el defecto
en sí.

**Independent Test**: mandar un `POST /api/sales` con una cantidad de más decimales
que los que la columna admite y mirar si quedó una fila. Verificable contra hoy,
donde `quantity: 0.4` responde 200 y guarda 0.

**Acceptance Scenarios**:

1. **Given** una línea con `quantity: 0.00004` y la columna en `DECIMAL(14,4)`,
   **When** se manda, **Then** se **rechaza** con un mensaje que nombra el producto
   y la cantidad, y **no queda ninguna fila** — ni la venta, ni sus líneas, ni el
   movimiento de stock.
2. **Given** una línea con `quantity: 0`, **When** se manda, **Then** se rechaza,
   como hoy.
3. **Given** una línea con `quantity: -5`, **When** se manda, **Then** se rechaza,
   como hoy. El comentario de `sales.js:318-320` documenta ese defecto viejo y su
   test tiene que seguir pasando **sin modificarse**.
4. **Given** una línea con `quantity: 'tres'`, **When** se manda, **Then** se
   rechaza y no llega a la base como `NaN` ni como `null`.
5. **Given** el rechazo, **When** se lee el mensaje, **Then** dice qué está mal con
   la cantidad y **no** nombra la tabla, la columna ni la restricción
   (`CONVENCIONES.md`, «Errores»).
6. **Given** una venta normal de 3 unidades, **When** se manda, **Then** se registra
   exactamente como hoy: mismo total, mismo descuento de stock, mismo movimiento.

---

### User Story 4 — Para quien vende por unidad, nada se ve distinto (Priority: P1)

Como Comprafit, que vende suplementos por unidad y no recibe ningún beneficio de
esta funcionalidad, quiero que mi ticket, mi pantalla y mis reportes sigan diciendo
exactamente lo que dicen hoy.

**Why this priority**: **es el criterio que gobierna la spec entera.** Un
`3.0000 x Creatina` en un ticket impreso es un fallo de esta funcionalidad, no un
detalle de presentación: es el papel que le queda al cliente. Y por H1 la regresión
**no espera a que exista un decimal**: aparece el día de la migración, con la base
tal como está.

**Independent Test**: correr la migración sobre una copia de los datos reales, sin
cargar un solo decimal, y comparar los nueve puntos carácter por carácter contra
capturas de antes. Cualquiera de los nueve que cambie es un fallo.

**Acceptance Scenarios**:

1. **Given** una venta de 3 potes de Creatina ya registrada, **When** se imprime el
   ticket (`InvoicesList.jsx:651` → `printInvoice.js:125`), **Then** dice
   **`3 x Creatina`**. Ni `3.0000`, ni `3,000`, ni `3,0`.
2. **Given** un producto con 5 unidades disponibles, **When** se mira la baldosa
   del catálogo del POS (`CatalogoDelPos.jsx:200`), **Then** dice **`5 u.`**.
3. **Given** un ticket que supera el disponible, **When** aparece el aviso
   (`Billing.jsx:468`), **Then** dice **`hay 5 en esta sucursal`**.
4. **Given** la ficha de un producto con 10 unidades, **When** se abre el panel,
   **Then** el disponible dice **`10`** (`PanelProducto.jsx:1173`) **y el campo
   editable de cantidad muestra `10`** y no `10.0000` (`PanelProducto.jsx:1158`).
5. **Given** el reporte de inventario, **When** se lo abre (`Reports.jsx:345`),
   **Then** la columna de stock dice **`12`**.
6. **Given** un pedido online de 2 unidades, **When** se abre su panel
   (`PanelDePedido.jsx:229`), **Then** dice **`2×`**.
7. **Given** un intento de venta sobre stock insuficiente (`routes/sales.js:548`),
   **When** el servidor responde, **Then** el mensaje dice `disponible 5` y no
   `disponible 5.0000`.
8. **Given** un producto **sin stock**, **When** se intenta transferir
   (`routes/stock.js:142`), **Then** el mensaje dice **`disponible: 0`** y no
   `disponible: 0.0000`. Es el caso donde el `|| 0` cambia de rama al volverse
   *truthy* la cadena, y es el único en que ese mensaje se lee.
9. **Given** el formateador nuevo, **When** recibe `null`, `undefined`, `''`, `NaN`
   o la cadena `"12.0000"`, **Then** devuelve algo legible y **nunca** `NaN` ni
   `undefined` en la pantalla — la misma garantía que `pesos` ya da y que su test
   documenta.
10. **Given** una pantalla cualquiera, **When** se busca un formateo de cantidad
    escrito a mano, **Then** la guardia de `utils/formato.test.js` lo encuentra y
    falla. Sin eso, la próxima persona escribe `Number(x).toFixed(0)` adentro de un
    `.jsx` y la unificación dura un sprint.
11. **Given** el ticket en pantalla del POS (`TicketDelPos.jsx:219`), el resumen de
    transferencias (`Inventory.jsx:147`) y el reporte de ventas
    (`Reports.jsx:232`), **When** corre la migración, **Then** **siguen mostrando
    exactamente lo mismo** — y el test tiene que existir aunque esos tres valores
    no vengan de una columna `DECIMAL`, porque lo que se afirma es que no se los
    tocó de rebote al pasar por los otros.

**⚠ La excepción, escrita a propósito**: los números de **producción y recetas**
que hoy están redondeados mal **sí cambian**, y ese es el arreglo de US1. «Nada
cambia» significa «ningún número que hoy se dibuja bien se dibuja distinto», y no
«ningún número cambia». La diferencia está en el Vocabulario y en el PENDIENTE 4.

---

### User Story 5 — La migración se puede revertir mientras no haya nada que perder (Priority: P2)

Como quien opera el despliegue, quiero poder revertir esta migración si algo sale
mal, y que se niegue en vez de redondearme el inventario si ya hay fracciones
cargadas.

**Why this priority**: P2 porque no afecta al usuario final, y no P3 porque es lo
que hace que US1 se pueda desplegar sin apostar. Una migración de tipo sobre la
tabla de stock sin salida de emergencia es una decisión irreversible disfrazada de
commit.

**Independent Test**: correr `down` dos veces —una sobre una base con todas las
cantidades enteras, otra con una fila fraccionaria— y verificar que la primera
funciona y la segunda se niega nombrando la tabla y cuántas filas.

**Acceptance Scenarios**:

1. **Given** una base donde toda cantidad es entera, **When** se revierte, **Then**
   las columnas vuelven a `INTEGER` sin perder ningún valor.
2. **Given** una base con al menos una fila fraccionaria en cualquiera de las
   cuatro tablas, **When** se revierte, **Then** **se niega**, y el mensaje dice
   **qué tabla** y **cuántas filas** se perderían.
3. **Given** ese mensaje, **When** lo lee quien corrió el `undo` por reflejo después
   de un deploy raro, **Then** entiende por qué no se puede y qué hacer si igual
   hace falta — la exigencia que `verificar-reversibilidad.js:103-109` ya le pone a
   las que se niegan.
4. **Given** el mapa `SE_NIEGAN` de `scripts/verificar-reversibilidad.js:110`,
   **When** se agrega esta migración, **Then** **no se agrega**: se niega
   condicionalmente y no siempre, y meterla ahí haría que su test pasara en verde
   sobre una base limpia por la razón equivocada (H7).
5. **Given** `reversibilidadDeMigraciones.test.js`, **When** corre, **Then** sigue
   encontrando la migración nueva en el rango que recorre y verifica que exporta
   `up` y `down`.

---

### Edge Cases

Lo que pasa cuando los datos son raros. **Es la mitad del valor de esta spec**,
porque el 100 % de lo que 016 toca es el camino por donde se cuentan la mercadería
y la plata.

#### La cantidad

- **Cantidad cero** en una línea de venta → se rechaza, como hoy.
- **Cantidad negativa** → se rechaza, como hoy. El test que protege ese defecto
  viejo sigue pasando **sin cambiarse**.
- **Cantidad con más decimales de los que la columna admite** (`0.00004`) → se
  rechaza. **No se redondea y se guarda**: eso es el defecto de H4 corrido un
  escalón.
- **Cantidad no numérica** (`'tres'`, `null`, `{}`) → se rechaza antes de llegar a
  la base.
- **Cantidad enorme** (`999999999999999`) → se rechaza por exceder la precisión de
  `DECIMAL(14,4)`, con un mensaje legible y no un 500 de Postgres.
- **El mismo producto dos veces en la misma venta** → sigue comportándose como hoy.
  Esta spec **no cambia** la consolidación de líneas.
- **Cantidad `0.1 + 0.2`** calculada en el navegador → llega como
  `0.30000000000000004`. La columna la trunca a `0.3000`, que es correcto, pero el
  redondeo **tiene que ser explícito y no un efecto del cast**: un valor que la
  aplicación no verificó no puede depender de cómo lo asigne el motor.

#### El stock

- **Stock que queda en `9,6`** después de una producción → se guarda 9,6, y esa es
  la corrección. La pantalla lo muestra con la cantidad de decimales que tenga y no
  con cuatro ceros.
- **`available` negativo** → se sigue tratando como hoy. Esta spec **no** cambia el
  `Math.max(0, …)` de `general.js`: solo arregla que la suma de adentro sea una
  suma.
- **Stock exactamente en cero** → el mensaje de `stock.js:142` dice
  `disponible: 0`. Es el único caso donde el `|| 0` de esa línea cambia de rama al
  volverse *truthy* la cadena `"0.0000"`.
- **`min_stock` fraccionario** → representable a partir de esta migración. El
  cálculo de «stock bajo» (`utils/inventario.js`) ya envuelve todo en
  `Number(…) || 0` y sigue andando.
- **Una fila de stock sin `punto_de_venta_id`** → fuera de alcance: no lo cambia
  esta spec.
- **Dos transferencias simultáneas sobre la misma fila** → sigue como hoy. El `lock`
  que falta en `productionService` está anotado en otro hallazgo de la auditoría
  (`:353`) y **no lo arregla 016**.

#### La migración

- **La migración corre dos veces** → es idempotente: `ALTER … TYPE` a un tipo que ya
  está no cambia nada.
- **La migración corre con la aplicación arriba** → durante el
  `ACCESS EXCLUSIVE LOCK` de `sale_items` el punto de venta **no puede cobrar**. Ver
  el PENDIENTE 3.
- **La migración corre sobre una base vacía** (CI, desarrollo) → el `COUNT(*)` de
  verificación da cero y pasa. **Y ese es el riesgo**: una verificación que sobre
  una base vacía pasa siempre no verifica nada, así que el test tiene que sembrar
  filas antes.
- **Alguien revierte después de una venta fraccionaria** → se niega (US5).
- **Alguien revierte después de una producción con consumo fraccionario** → se
  niega igual: el hallazgo de la auditoría dice que ese es justamente el dato que
  hoy se pierde.
- **Las cantidades que ya se corrompieron antes de la migración** → **no se
  recuperan**. El `9.6` que se guardó como `10` en marzo es indistinguible de un
  `10` legítimo, y la migración **no intenta repararlo**: inventar el dato sería
  peor que no tenerlo.

#### Lo que el driver devuelve

- **`"12.0000" == 12`** es `true`; **`"12.0000" === 12`** es `false`. Cualquier
  comparación estricta contra un número que hoy funcione, deja de funcionar.
- **`"0.0000"` es *truthy*.** Todo `||` y todo `if (cantidad)` sobre una cantidad
  leída de la base cambia de rama en el caso de cero.
- **`"100" - 5`** es `95` y **`"100" + 5`** es `"1005"`. El operador decide, no el
  valor.
- **`Math.max(0, "100" + 5)`** es `1005`. La función numérica de afuera convierte
  **después** de que ya se concatenó.
- **`JSON.stringify`** de una fila de stock devuelve `"quantity": "12.0000"` —con
  comillas— donde antes devolvía `"quantity": 12`. Cualquier cliente que compare
  tipos en la respuesta lo ve.
- **`parseInt("12.0000")`** es `12` y **`parseInt("0.4")`** es `0`. Truncar no
  avisa.

---

## Requirements *(mandatory)*

### Functional Requirements

#### El esquema

- **FR-001**: El sistema DEBE guardar las cantidades de `sale_items.quantity`,
  `stock.quantity`, `stock.available`, `stock.min_stock`, las cuatro columnas de
  `stock_movements` (`cantidad_anterior`, `cantidad_nueva`, `disponible_anterior`,
  `disponible_nuevo`) y `pedido_items.cantidad` en un tipo que admita fracciones.
- **FR-002**: Ese tipo DEBE ser **`DECIMAL(14,4)`**. Cuatro decimales, no tres:
  `recipe_items.quantity` y `production_orders.quantity_produced` ya son
  `DECIMAL(12,4)` (`20260531-initial-schema.js:246`, `:377`), y con tres decimales
  una producción de 1,2345 se redondearía — **el mismo defecto que esta
  funcionalidad viene a eliminar, en espejo**. Cuántos decimales admite una línea de
  venta lo impone un **validador**, no el tipo de la columna (FR-020).
- **FR-003**: El cambio DEBE ir en **una sola migración**, con el formato de
  `apps/api/src/migrations/` (`module.exports = { up, down }`, nombre
  `YYYYMMDD-descripcion-en-kebab-case.js`). La última hoy es `20260819-pedidos.js`.
- **FR-004**: La migración DEBE correr **entera dentro de una transacción**, sobre
  el molde de `20260814-productos-publicables.js`.
- **FR-005**: La migración DEBE **verificar su promesa adentro de esa misma
  transacción**: un `COUNT(*)` de filas con `quantity <> ROUND(quantity)` que tiene
  que dar **cero** después del `ALTER`, porque antes eran todas enteras. Si da
  distinto, corta y no queda nada aplicado.
- **FR-006**: Los **modelos** (`Sale.js`, `Stock.js`, `StockMovement.js`,
  `PedidoItem.js`) DEBEN declarar el mismo tipo que la migración, o
  `scripts/verificar-esquema.js` y `verificacionDeTiposDelEsquema.test.js` lo
  reportan. **Modelo y migración cambian en el mismo commit.**
- **FR-007**: El job «API — la imagen arranca y migra» del CI DEBE seguir pasando.
- **FR-008**: Ninguna otra columna cambia de tipo. En particular **los importes no
  se tocan**: `unit_price`, `total`, `cost` y todos los `DECIMAL(12,2)` quedan como
  están.

#### El `down`

- **FR-010**: El `down` DEBE **revertir limpio** cuando no haya ninguna fila
  fraccionaria en ninguna de las cuatro tablas.
- **FR-011**: El `down` DEBE **negarse** cuando exista al menos una, y el mensaje
  DEBE nombrar **la tabla** y **cuántas filas** se perderían. Redondear en silencio
  al revertir sería el mismo defecto que la migración elimina.
- **FR-012**: Esta migración **NO** DEBE agregarse a `SE_NIEGAN`
  (`scripts/verificar-reversibilidad.js:110`): ese mapa es de las que se niegan
  **siempre**, y su test corre el `down` esperando que falle. Una negativa
  condicional metida ahí pasaría en verde sobre una base limpia por la razón
  equivocada (H7). El precedente correcto es
  `20260804-identidad-de-sucursal-en-stock.js`.
- **FR-013**: La negativa condicional DEBE tener su propio test de integración, que
  **siembra** una fila fraccionaria antes de intentar el `down`.

#### La aritmética

- **FR-020**: `POST /api/sales` DEBE **rechazar** toda línea cuya cantidad no sea
  representable en la columna, en vez de dejar que Postgres la redondee al
  insertar. Hoy `routes/sales.js:321-323` valida `quantity <= 0` sobre el valor de
  JavaScript y `0.4` pasa. *(Cuántos decimales admite exactamente una línea de
  venta: PENDIENTE 1.)*
- **FR-021**: El mensaje de ese rechazo DEBE nombrar el producto y la cantidad, y
  **no** la tabla ni la restricción (`CONVENCIONES.md`, «Errores»).
- **FR-022**: `routes/sales.js:722-723` —reposición al anular— DEBE sumar
  numéricamente y no concatenar.
- **FR-023**: `routes/stock.js:155-156` —destino de una transferencia— DEBE sumar
  numéricamente. ⚠ Su gemela de `:145-146` es una **resta** y es segura: en el mismo
  bucle conviven un lado que anda y otro que no, así que el test tiene que mirar
  **el destino** y no el origen.
- **FR-024**: `services/purchaseService.js:496-497` —recepción de compra— DEBE sumar
  numéricamente.
- **FR-025**: `routes/general.js:90` y `:181` —edición manual de stock— DEBEN sumar
  numéricamente. ⚠ Es el peor de los cuatro: `Math.max` convierte **después** de
  concatenar, así que `Math.max(0, "100" + 5)` da `1005` y no lanza nada.
- **FR-026**: `routes/import.js:406` y `:431` DEBEN dejar de usar `parseInt` para
  cantidades, que **trunca**: una planilla con `0,4` importa `0`. La nota sobre la
  columna del CSV (`import.js:96`) se actualiza en el mismo cambio.
- **FR-027**: NO DEBE registrarse ningún `pg.types.setTypeParser` global para
  `NUMERIC`. La conversión se hace en el punto de uso. Registrarlo haría que los
  importes empezaran a llegar como `number`, con la pérdida de precisión que el
  texto evita — está escrito en
  `tests/integracion/centavoDelSaldo.integracion.test.js:243`, y ese test se pondría
  en rojo.
- **FR-028**: Cada una de las cinco correcciones (FR-022 a FR-026) DEBE tener **su
  propio** test que se ponga en rojo al revertir esa línea sola. Un test que cubra
  las cinco a la vez no dice cuál se rompió.

#### El formato

- **FR-030**: DEBE existir **una** función de formato de cantidad en
  `apps/web/src/utils/formato.js`, construida sobre el `enEsAr(n, min, max)` que ya
  existe (`:72-77`) y no sobre `toLocaleString` suelto.
- **FR-031**: Esa función DEBE escribir una cantidad entera **sin decimales**: `12`,
  `"12.0000"` y `12.0` los tres se escriben **`12`**.
- **FR-032**: DEBE escribir una cantidad fraccionaria con sus decimales
  significativos y sin ceros de relleno inútiles, en formato argentino —coma
  decimal—. *(Cuántos decimales como máximo: PENDIENTE 4.)*
- **FR-033**: DEBE devolver algo legible ante `null`, `undefined`, `''`, `NaN` y una
  cadena no numérica, y **nunca** dejar llegar `NaN` ni `undefined` a la pantalla.
- **FR-034**: Los **siete puntos de la web** de la tabla de los nueve DEBEN pasar
  por esa función: `printInvoice.js:125` (vía `InvoicesList.jsx:651`),
  `CatalogoDelPos.jsx:200`, `Billing.jsx:468`, `PanelProducto.jsx:1173`,
  `PanelProducto.jsx:1158`, `Reports.jsx:345` y `PanelDePedido.jsx:229`.
- **FR-034a**: Los **tres lugares que hoy ya devuelven un `number`** —
  `TicketDelPos.jsx:219`, `Inventory.jsx:147` y `Reports.jsx:232`— DEBEN pasar por
  la misma función, **por otra razón**: no son una regresión del día de la
  migración, pero dibujarían `9.6` con punto en vez de `9,6`. Se corrigen en el
  mismo cambio porque el formateador ya existe, y **el motivo se escribe al lado**
  para que nadie los confunda con los siete de arriba.
- **FR-035**: Los **dos mensajes del servidor** —`routes/sales.js:548` y
  `routes/stock.js:142`— DEBEN escribir la cantidad sin la escala cruda. ⚠ En
  `stock.js:142` la corrección **no es formatear el resultado**: la expresión es
  `sourceStock?.quantity || 0` y con la cadena `"0.0000"` —*truthy*— el `||` deja de
  caer al cero. Lo que hay que sacar es la dependencia de que el valor sea *falsy*.
- **FR-035a**: `productionService.js:252` **no** entra en FR-035: `:247` ya hace
  `parseFloat`. Se lo nombra para que nadie «lo arregle» y escriba un test que pasa
  con y sin el cambio.
- **FR-036**: La guardia que ya existe al final de `utils/formato.test.js` DEBE
  extenderse a los formateos de cantidad escritos a mano, y DEBE seguir
  **afirmando cuántos archivos revisó**: este repositorio ya tuvo dos guardias que
  pasaban por vacío.
- **FR-037**: El formateador DEBE tener su test con el caso que protege escrito en
  el nombre, del orden de `it('NO imprime «3.0000 x Creatina»')`.

#### Lo que no se toca

- **FR-040**: `packages/precios` **NO** se toca. Está testeado, su `Math.round()`
  (`index.js:139-147`) opera sobre el precio **unitario** y no sobre la cantidad, y
  esta spec no lo necesita.
- **FR-041**: `products.unit_type` y `products.unit_size` **NO** cambian de
  significado ni de tipo. Hoy `unit_type: 'kg'` significa «este bulto se mide en kg»
  —una bolsa de harina de 25 kg es 1 unidad— y hay fixtures que lo usan así
  (`tests/integracion/fixtures.js:145,198`).
- **FR-042**: `empresas.rubro` **no se puebla, no se valida y no gobierna nada**.
- **FR-043**: `apps/tienda` **no cambia**. `carrito.js:55` sigue haciendo
  `Math.floor` y la tienda pública sigue vendiendo por unidad (H5).
- **FR-044**: **No se agrega ninguna funcionalidad visible.** Ningún control nuevo,
  ningún campo nuevo en ningún formulario, ninguna pantalla nueva.

#### Aislamiento y guardias

- **FR-050**: Toda consulta que se toque DEBE seguir filtrando por `empresa_id` y
  usando `findScoped` (`utils/tenantScope.js`). Ninguna de las cinco correcciones de
  aritmética introduce una lectura nueva, y esto es la verificación de que siguió
  siendo así.
- **FR-051**: `aislamientoEmpresas.test.js` y `observabilidad.test.js` DEBEN seguir
  limpias, sin hallazgos nuevos.
- **FR-052**: `npm run test:api`, `npm run test:web`,
  `npm --prefix apps/api run test:integracion` y `npm run build` DEBEN pasar.
  ⚠ **`npm run test:api` no levanta los de integración**: son otra suite y hay que
  pedirla, y en esta funcionalidad **son el único nivel que ve el defecto**.

---

### Key Entities

No se crea ninguna tabla y no se crea ninguna columna. **Cambian ocho columnas de
tipo, en cuatro tablas.**

| Tabla | Columnas | De | A |
|---|---|---|---|
| `sale_items` | `quantity` | `INTEGER` | `DECIMAL(14,4)` |
| `stock` | `quantity`, `available`, `min_stock` | `INTEGER` | `DECIMAL(14,4)` |
| `stock_movements` | `cantidad_anterior`, `cantidad_nueva`, `disponible_anterior`, `disponible_nuevo` | `INTEGER` | `DECIMAL(14,4)` |
| `pedido_items` | `cantidad` | `INTEGER` | `DECIMAL(14,4)` |

**Lo que explícitamente NO cambia:**

| Qué | Por qué |
|---|---|
| `products.se_vende_fraccionado` | **No se crea.** Es de la spec 017 |
| `empresas.settings.balanza` | **No se crea.** Es de la spec 018 |
| `products.unit_type` / `unit_size` | Ya significan otra cosa (FR-041) |
| Cualquier columna de importe | Los `DECIMAL(12,2)` quedan como están (FR-008) |
| `recipe_items.quantity`, `production_orders.quantity_produced` | Ya son `DECIMAL(12,4)`. Esta migración las beneficia; no las modifica |
| `stock_transfers.items` | Es `JSONB` (`models/StockTransfer.js:33-34`), no una columna de cantidad |

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

1. **El ticket impreso de una venta de 3 unidades dice `3 x Creatina`** después de
   la migración, verificado con un test de render que se pone en rojo si se saca el
   formateador. Es el criterio más importante de esta spec.
2. **Los nueve puntos donde se dibuja una cantidad se ven idénticos a antes**,
   comparados carácter por carácter sobre una copia de los datos reales **sin cargar
   un solo decimal**. Verificable contra la migración sola, que los cambia los
   nueve.
3. **Un consumo de producción de 0,4 kg sobre un stock de 10 deja 9,6**, y uno de
   0,6 deja 9,4. Verificable contra hoy, donde
   `auditoria-frente2-hallazgos.json:335` documenta 10 y 9 respectivamente, con
   veredicto CONFIRMADO.
4. **Anular una venta devuelve el stock a su valor original**, y un test lo afirma
   comparando contra el valor leído antes, no contra un número escrito a mano.
   Verificable contra la migración sola, donde da `1003`.
5. **Los cuatro caminos de suma de stock dan el número correcto**: anulación,
   transferencia (mirando el **destino**), recepción de compra y edición manual.
   Cada uno con su test, y **cada test se pone en rojo al revertir su línea sola**.
6. **`Math.max(0, "100" + 5)` tiene un test con nombre propio** que documenta por
   qué esa línea parecía coercionada y no lo estaba.
7. **Un `POST /api/sales` con una cantidad no representable se rechaza y no deja
   ninguna fila** —ni venta, ni línea, ni movimiento de stock—. Verificable contra
   hoy, donde `quantity: 0.4` responde 200 y guarda una línea en cero.
8. **La migración no cambió el valor de ninguna fila existente**, verificado adentro
   de su propia transacción con un `COUNT(*)` que da cero, y el test que lo cubre
   **siembra filas primero**: sobre una base vacía esa verificación pasa siempre y
   no verifica nada.
9. **El `down` revierte limpio sin fracciones y se niega con ellas**, nombrando la
   tabla y la cantidad de filas, y **no está en `SE_NIEGAN`**.
10. **`scripts/verificar-esquema.js` no reporta divergencia**: los cuatro modelos y
    la migración declaran el mismo tipo.
11. **No hay ningún `setTypeParser` global**, y
    `centavoDelSaldo.integracion.test.js:243` sigue pasando con
    `expect(typeof filas[0].total).toBe('string')`.
12. **Ninguna pantalla formatea una cantidad por su cuenta**, y la guardia de
    `utils/formato.test.js` lo verifica **diciendo cuántos archivos revisó**.
13. **Ningún control, campo ni pantalla nueva aparece en la interfaz.** Un recorrido
    por el POS, Inventario, la ficha de producto y el historial de ventas no
    encuentra nada que no estuviera antes.
14. `npm run test:api`, `npm run test:web`,
    `npm --prefix apps/api run test:integracion` y `npm run build` pasan, y las
    guardias de aislamiento, observabilidad, esquema y reversibilidad siguen
    limpias.
15. **Cada criterio de aceptación tiene al menos un test que falla si se revierte el
    cambio que lo implementa**, comprobado revirtiendo.

---

## Fuera de alcance

Explícito, para que no se discuta después si estaba incluido.

### Lo que es de la spec 017 · Venta fraccionada

- **`products.se_vende_fraccionado`**, la columna que decide si **ese** artículo se
  vende por peso. No se crea acá.
- **La cantidad decimal en el carrito y en el ticket del POS.** `addToCart` sigue
  sumando de a uno.
- **El campo numérico en vez del *stepper* `+/−`** para los productos fraccionados.
  `TicketDelPos.jsx:211-228` no se toca.
- **El default por empresa en `empresas.settings`** para el alta de un producto.
- **El precio por kilo, y qué dice la ficha del producto sobre él.**

### Lo que es de la spec 018 · Código de balanza

- **`apps/web/src/utils/codigoDeBalanza.js`** y la interpretación del EAN-13 con
  prefijo 20-29.
- **`empresas.settings.balanza`** y su configuración por marca (Systel, Kretz,
  Moretti, Gama).
- Cualquier cambio a `buscarEnCatalogo` (`utils/busquedaDelPos.js:60`), que **no se
  toca en ninguna de las tres specs**: la interpretación del código de balanza va
  **antes**, en una función nueva, y si devuelve `null` el flujo actual sigue
  intacto.

### Lo que no entra en ninguna de las tres

- **El celular como lector de código de barras.** Es una funcionalidad separada, con
  superficie pública nueva, emparejamiento por QR y su propio transporte. Tiene su
  propia spec.
- **La balanza de conexión directa por puerto serie.** Requiere un agente local
  instalado en la PC del comercio; el navegador no alcanza —`WebSerial` es solo
  Chrome y exige un gesto del usuario por sesión—. Es otro producto: un instalador,
  actualizaciones y soporte presencial.
- **Poblar o validar `empresas.rubro`.** Vale `null` en toda empresa real porque la
  web nunca lo escribe, y arreglarlo significa validarlo, poblarlo y migrar las
  filas existentes.
- **Cambiar `packages/precios`** (FR-040).
- **Reparar las cantidades que ya se corrompieron** por el redondeo de producción. El
  `9.6` que se guardó como `10` es indistinguible de un `10` legítimo, y
  reconstruirlo sería inventar el dato.
- **El `lock` que le falta a `productionService`** en su
  lectura-modificación-escritura de stock. Está en otro hallazgo de la misma
  auditoría (`auditoria-frente2-hallazgos.json:353`) y es un defecto de
  concurrencia, no de tipos. Meterlo acá mezclaría dos correcciones que se verifican
  distinto.
- **Los otros tres hallazgos de `recetas-costos`** que la auditoría lista alrededor
  del 335 —el uso ambiguo de `quantity_produced`, el stock insuficiente que solo
  genera *warning*, la merma del 100 % que deja el costo en cero—. Son del mismo
  módulo y **no** son de tipos.
- **La venta fraccionada en la tienda pública** (`apps/tienda`). La columna
  `pedido_items.cantidad` queda capaz; nada escribe decimales ahí (H5).

---

## Dependencias

Cosas que **no dependen de esta spec** y sin las cuales no se puede desplegar.
Separadas de «Fuera de alcance» a propósito: aquello son cosas que decidimos no
hacer; esto son cosas que hay que hacer y no las hace esta funcionalidad.

| Dependencia | Estado hoy | Bloquea |
|---|---|---|
| **Un Postgres real para la suite de integración** | Existe: `npm --prefix apps/api run test:db:levantar` | **Toda la verificación.** Los dobles de `tests/helpers/modelosFalsos.js` no saben de tipos: la suite rápida pasa en verde con la aritmética rota |
| **Saber cuántas filas tiene `sale_items` en producción** | Desconocido | Estimar cuánto dura el `ACCESS EXCLUSIVE LOCK` del `ALTER TABLE`, y por lo tanto cuánto tiempo el punto de venta no puede cobrar (H8, PENDIENTE 3) |
| **Un respaldo verificado inmediatamente antes de migrar** | `deploy/respaldo.sh` existe; que el cron esté puesto **no lo verifica nada**, y la copia queda en el mismo disco que la base (`:22-23`) | **Correr la migración en producción.** Es un `ALTER TABLE` sobre la tabla de stock; el `down` se niega justamente cuando más falta haría |
| **Una copia de los datos reales para comparar los nueve puntos** | No existe un procedimiento escrito | El criterio de éxito 2. Comparar contra una base sembrada a mano no prueba que nada cambió **para Comprafit** |

---

## Assumptions

Lo que se da por cierto sin haberlo preguntado, porque el pedido, la auditoría o el
código ya lo fijan. **Si alguno es falso, cambia la funcionalidad.**

1. **El esquema es capaz para todas las empresas, no por cliente.** `DECIMAL` es un
   superconjunto de `INTEGER` —un pote de creatina es `1,0000`— y la alternativa
   —dos esquemas, o una rama por rubro— significa **dos caminos de código a través
   de la caja registradora**, que es el peor lugar del sistema para tener dos
   verdades. **No existe un «modo decimales» por empresa**, y esta spec no crea
   ninguno.
2. **La conversión `INTEGER → NUMERIC` de Postgres es sin pérdida.** Todo entero
   existente entra en `DECIMAL(14,4)` sin cambiar de valor, y FR-005 lo verifica en
   vez de darlo por hecho.
3. ⚠ **El hallazgo `auditoria-frente2-hallazgos.json:335` describe MAL el modo de
   falla.** Esta suposición decía que el hallazgo era correcto y que la spec no lo
   volvería a derivar. **Se derivó, y no se sostiene.** El hallazgo afirma que «los
   consumos fraccionarios se redondean y el stock nunca baja», con `10 - 0.4 → 10`.
   Medido contra Postgres, lo que pasa depende de **cómo escribe Sequelize**:

   | Camino | Quién lo usa | Con 9,6 en una columna `INTEGER` |
   |---|---|---|
   | Literal en el SQL | `bulkCreate` | **redondea a 10**, en silencio |
   | Parámetro bindeado | `instance.update()` | **error**: `invalid input syntax for type integer: "9.6"` |

   Producción descuenta stock con `instance.update()`, así que un consumo
   fraccionario **no redondea: falla con 500 y revierte la orden entera**. El
   módulo es inutilizable con recetas fraccionarias — un defecto peor en
   disponibilidad y mejor en silencio que el que el hallazgo describe.

   Lo que **sí** es mudo es el defecto de la línea de venta en cero, porque
   `sale_items` se escribe con `bulkCreate`. Esa asimetría es la que el hallazgo
   no distingue, y es la que explica por qué los dos defectos se ven tan distinto.

   Los criterios de aceptación que hablan de «dejar el stock en 9,6» siguen
   valiendo: describen lo que tiene que pasar **después** de migrar, y eso no
   cambia. Lo que cambia es contra qué defecto se los está comparando.
4. **Recetas y producción son módulos solo para superadmin**, así que el daño
   probablemente no le esté ocurriendo a ningún cliente hoy. **Eso no lo vuelve
   aceptable**: el código existe y el defecto está adentro.
5. **AFIP no recibe cantidades.** Se buscó `quantity` en los servicios y rutas de
   AFIP y no hay ninguna: el comprobante electrónico viaja con importes. Una
   cantidad fraccionaria **no** cambia nada de la facturación electrónica.
6. **El ticket en pantalla del POS no viene de la base.** `TicketDelPos.jsx:219`
   dibuja `linea.qty`, que sale del carrito del navegador. Es el motivo por el que
   no está entre los nueve puntos que rompen.
7. **La tienda pública sigue vendiendo por unidad.**
   `apps/tienda/src/carrito.js:55` hace `Math.floor(Number(cantidad))` y esta spec
   no lo cambia.
8. **Las cantidades ya corrompidas no se recuperan**, y la migración **no lo
   intenta**. Es una decisión, no un olvido: el dato perdido no existe en ningún
   lado.
9. **El formateador vive en `apps/web` y no en un paquete compartido.** Los siete
   puntos de la web son todos de ahí; los dos mensajes del servidor (FR-035) se
   resuelven en el servidor. Crear un paquete compartido para esto sería trabajo de
   otra funcionalidad — y `packages/` ya existe desde la spec 015, así que mudarlo
   después es aditivo.
10. **Esta spec se despliega sola, antes que la 017.** Es lo que hace que «no cambió
    nada» se pueda afirmar. Si se despliegan juntas, el criterio de aceptación de
    016 deja de ser verificable.

---

## Lo que faltaba decidir · **resuelto**

Los cuatro se resolvieron con el dueño del producto el 15/8/2026, antes de pasar al
plan. **Ninguno tuvo una respuesta inventada.** La resolución de cada uno está al
final de su bloque; el razonamiento se conserva porque explica por qué la pregunta
existía.

### PENDIENTE 1 · Cuántos decimales admite una **línea de venta**

La columna es `DECIMAL(14,4)` (FR-002), pero eso es lo que la base **puede
guardar**. Lo que una venta **debe aceptar** es otra pregunta, y FR-020 no se puede
escribir sin la respuesta.

Tres opciones, y no son equivalentes:

| Opción | Qué pasa con `0.00004` | Qué pasa con `0.2505` |
|---|---|---|
| **A · Rechazar todo lo que exceda 3 decimales** | Se rechaza | Se rechaza |
| **B · Rechazar todo lo que exceda 4 decimales** (la columna) | Se rechaza | Se acepta y se guarda `0.2505` |
| **C · Redondear a 3 e informar** | Se convierte en `0.000` → hay que rechazarlo igual | Se guarda `0.251` |

*Propuesta*: **B**, y dejar la validación de 3 decimales para la 017, junto con la
pantalla que la necesita. Un gramo es la unidad más chica que informa una balanza
comercial, así que 3 decimales alcanzan para vender; pero fijar el límite en 3
**hoy**, cuando nada vende fraccionado, es escribir una regla que nadie puede probar
contra un caso real.

**Por qué no se puede inventar**: si la respuesta es A y se implementa B, la 017
tiene que endurecer una validación que ya está desplegada, sobre datos que ya pueden
tener 4 decimales.

> ### ✔ RESUELTO · **Opción A — 3 decimales**, contra la propuesta.
>
> Un gramo es la unidad más chica que informa una balanza comercial, y el límite se
> fija ahora para que la 017 no tenga que endurecer nada ya desplegado.
>
> **Interacción con el PENDIENTE 2, que hay que leer junto:** como la 016 deja el
> endpoint cerrado a toda fracción, en la 016 esta regla **no tiene nada que
> validar** — el endpoint acepta cero decimales. El límite de 3 queda registrado
> como la regla que aplica la **017**, cuando la puerta se abra. FR-020 se escribe
> para la 016 como «solo enteros», con la regla de 3 anotada como decidida.
>
> **La columna sigue siendo `DECIMAL(14,4)` y eso no se toca**: los 4 decimales son
> para que `recipe_items` y `production_orders` —que ya son `DECIMAL(12,4)`— no se
> degraden. El límite de 3 es de la **línea de venta**, no del esquema. Es la regla
> de negocio en un validador y la capacidad en la columna, que es exactamente la
> separación que pide la arquitectura de capas.

### PENDIENTE 2 · ¿016 deja que `POST /api/sales` acepte una cantidad fraccionaria?

Después de la migración la columna la admite. La pregunta es si el **endpoint** la
admite, y las dos respuestas son defendibles:

- **Sí**: es lo natural una vez que la columna es capaz, y el formateador de US4 ya
  la sabe dibujar. Pero significa que **una venta fraccionaria es posible sin que
  exista ninguna pantalla diseñada para venderla**, y la afirmación «nada cambió» se
  vuelve más difícil de defender: alguien con `curl` puede crear un estado que
  ninguna pantalla produce.
- **No**: 016 sigue rechazando toda cantidad no entera en `POST /api/sales`, y la
  017 levanta esa restricción junto con la pantalla que la necesita. **La capacidad
  queda en el esquema y la puerta sigue cerrada.**

*Propuesta*: **No.** Es lo que hace que el criterio de aceptación de 016 sea
literalmente cierto —ninguna venta puede tener una cantidad que no tenía antes— y el
costo es una línea de validación que la 017 borra.

⚠ **Efecto cruzado que hay que ver antes de elegir**: con «No», el escenario 3 de
US1 no se puede alcanzar por el endpoint y hay que verificarlo escribiendo directo
en el modelo. Con «Sí», el escenario 1 de US3 cambia de umbral.

> ### ✔ RESUELTO · **No.** La 016 sigue rechazando toda cantidad no entera.
>
> Es lo que hace que el criterio de aceptación de la 016 sea literalmente cierto:
> ninguna venta puede tener una cantidad que no podía tener antes. La capacidad
> queda en el esquema y la puerta sigue cerrada; la 017 la abre junto con la
> pantalla que la necesita.
>
> **Consecuencia a aplicar**: el escenario 3 de US1 se verifica escribiendo directo
> en el modelo, no por el endpoint.

### PENDIENTE 3 · Cuánto puede durar la ventana de migración, y si el comercio puede estar sin cobrar

`ALTER TABLE … ALTER COLUMN … TYPE` reescribe la tabla y toma un
`ACCESS EXCLUSIVE LOCK`. Sobre `sale_items` —una fila por línea de cada venta desde
que el sistema existe— **no se sabe cuánto tarda porque no se sabe cuántas filas
hay**, y durante ese lock el punto de venta no puede cobrar.

Hay que definir:

1. **Cuántas filas tiene `sale_items` en producción hoy.** Es una consulta.
2. **Cuál es la ventana aceptable.** ¿Se migra un domingo a la mañana? ¿Hay una hora
   en que el comercio esté cerrado?
3. **Si hace falta un plan alternativo** —columna nueva, copia en lotes, cambio de
   nombre— o si con la ventana alcanza.

*Propuesta*: medir primero. Con las magnitudes de un comercio chico es casi seguro
que el `ALTER` directo tarde segundos y no haga falta nada más; pero **«casi seguro»
sobre la tabla de ventas no es una respuesta**, y la diferencia entre las dos
estrategias es la mitad del plan técnico.

> ### ✔ RESUELTO · **Medido. No hace falta ventana ni copia en lotes.**
>
> Consultado contra la base de Neon el 15/8/2026:
>
> | Tabla | Filas |
> |---|---|
> | `sale_items` | **4** |
> | `sales` | 2 |
> | `stock` | 42 |
> | `stock_movements` | 5 |
> | `pedido_items` | 2 |
> | `products` | 477 |
>
> Un `ALTER TABLE … TYPE` sobre 4 filas es instantáneo. **El `ALTER` directo alcanza
> y no hace falta el plan alternativo**: ni columna nueva, ni copia en lotes, ni
> cambio de nombre. Esto elimina la mitad del plan técnico que este pendiente ponía
> en duda.
>
> ✔ **Salvedad resuelta.** Se planteó si el despliegue en VPS
> (`docker-compose.produccion.yml`, `docs/DESPLIEGUE-HOSTINGER.md`) tenía su propia
> base con datos reales, en cuyo caso habría que medirla también. **El dueño del
> producto confirmó el 17/8/2026 que la producción es Neon**, así que estas cifras
> son las de producción y no hay una segunda base que medir. El riesgo «la medición
> del VPS puede ser otra» que `plan.md` anota primero queda cerrado.

### PENDIENTE 4 · Cómo se escribe una cantidad fraccionaria, y a quién se le avisa que sus números van a cambiar

FR-031 fija que un entero se escribe `12`. Falta lo otro, y toca dos preguntas
distintas:

**(a) El formato.** Una cantidad de 9,6 kg, ¿se escribe `9,6`, `9,60` o `9,600`? Y
una de 0,2505, ¿`0,25` o `0,2505`? El repositorio ya tiene el precedente de que esto
**no** es cosmético: `pesosDeLista` y `pesos` son dos funciones distintas justamente
porque «los centavos solo si el precio los tiene» y «siempre dos decimales» son dos
decisiones de producto, no dos estilos.

**(b) Lo que cambia en pantalla, y es lo que hay que avisar.** Hoy, en el módulo de
producción, un stock que debería estar en 9,6 se dibuja como **`10`** porque la
columna lo redondeó. Después de 016 se va a dibujar **`9,6`**. O sea que **«nada
cambia» tiene una excepción**, y hay que decidir si:

- se acepta en silencio (el número pasa a estar bien, que es el punto), o
- se avisa a quien use producción de que sus cantidades de stock van a empezar a
  mostrar decimales que antes no mostraban.

*Propuesta*: máximo 3 decimales, sin ceros de relleno —`9,6` y no `9,600`—, y **se
avisa**: son módulos de superadmin, son pocas personas, y descubrir solo que un
stock «cambió» de 10 a 9,6 sin que nadie tocara nada es exactamente el tipo de
sorpresa que hace que alguien abra un ticket urgente por un arreglo.

**Por qué no se puede inventar**: el formato entra en un ticket impreso, y el
alcance del aviso depende de a quién le importe.

> ### ✔ RESUELTO · **Sin ceros de relleno, máximo 3 decimales, y se avisa.**
>
> | Valor | Se escribe |
> |---|---|
> | `12` | `12` |
> | `9,6` | `9,6` — **no** `9,600` |
> | `0,25` | `0,25` |
> | `0,2505` | `0,251` (máximo 3 decimales) |
>
> En el ticket: `0,25 kg × Jamón cocido` y `3 × Creatina`. El relleno fijo se
> descarta justamente porque `3,000 × Creatina` rompería US4 — para Comprafit **sí**
> se vería distinto, que es lo único que la 016 promete que no pasa.
>
> **Y se avisa.** Un stock que hoy se dibuja `10` porque la columna lo redondeó va a
> empezar a mostrar decimales. Descubrir solo que un número cambió sin que nadie
> tocara nada es exactamente lo que hace que alguien abra un ticket urgente por un
> arreglo. El aviso entra como entregable de la 016.
