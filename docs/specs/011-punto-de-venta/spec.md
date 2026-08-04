# Feature Specification: Punto de venta — pasada fina

**Feature Branch**: `011-punto-de-venta`
**Created**: 3 de agosto de 2026
**Status**: Draft — hay puntos abiertos, ver «Lo que falta decidir»
**Input**:

> Pasada fina de la pantalla **Punto de venta**. Es el hito 5 del plan
> (`docs/PLAN-COMPRAFIT.md`, 4.1).
>
> **Diseño.** Es la pantalla más lejos de la maqueta. Dos columnas: catálogo a la
> izquierda con búsqueda y filtros, ticket fijo a la derecha de 400px con su
> propio encabezado y el pie de cobro. Los botones de medio de pago como
> segmentos, no como tres botones sueltos.
>
> **Función.** Lo que tenía el sistema viejo ya está —precio manual por ítem,
> vuelto, medio de pago por ítem, factura AFIP—. Falta:
> - **Atajos de teclado**: buscar, cobrar y limpiar sin tocar el mouse. En un
>   mostrador con cola, el mouse es el cuello de botella.
> - **Foco automático** en la búsqueda al abrir y después de cada venta.
>
> Además: evaluar si entra la asimetría del hito 4 —la venta descuenta stock de
> la sucursal resuelta pero `Sale.punto_de_venta_id` se guarda como
> `req.puntoDeVentaId || null`—.

---

## Qué patrones ya están fijados, y cuáles de ellos aplican acá

Las funcionalidades 009 (Historial de ventas) y 010 (Inventario) dejaron el
patrón escrito en componentes compartidos. **Esta pantalla no inventa nada que
ya exista, y tampoco fuerza lo que no encaja.** Decirlo explícitamente es parte
del trabajo: sin esto, `sdd-verify` va a marcar como desvío cada cosa que la
maqueta dibuja distinta a propósito.

| Patrón | ¿Aplica en el POS? | Por qué |
|---|---|---|
| Tokens de `index.css`, cero hex, cero `dark:` | **Sí, sin excepción** | Es la regla del sistema. Hoy `Billing.jsx` la rompe en cuatro lugares (ver defecto 6) |
| `.eyebrow` para las etiquetas de columna | **Sí** | La maqueta lo usa en el encabezado del catálogo (`AdminApp-Rediseno.dc.html:361`) |
| `.num` para todo lo comparable | **Sí** | Precios, cantidades, total, vuelto, CUIT |
| `guardiasDeDiseno.test.js` | **Sí** | `pages/Billing.jsx` y los componentes nuevos entran a la lista (`guardiasDeDiseno.test.js:48`) **antes** de reescribir la pantalla |
| Estados vacíos con ícono apagado y dos líneas | **Sí** | La maqueta dibuja dos: catálogo sin resultados (`:384-390`) y ticket vacío (`:431-437`) |
| Encabezado de pantalla (`h1` + descripción + acciones) | **No** | La maqueta reemplaza el encabezado por la barra de búsqueda (`:339-358`). La miga de pan del `AppTopbar` ya dice «Punto de venta». Es la única pantalla del rediseño sin `h1`, y es a propósito: 60px de alto en la pantalla que se usa ocho horas por día valen más que un título que no informa nada |
| `TablaGrid` / `Encabezado` / `Fila` / `BotonDeFila` | **No** | La maqueta dibuja el catálogo como **tarjetas separadas** —`border-radius:11px`, `border`, `gap:8px` entre filas (`:364-366`)— y no como filas con `border-b`. En un listado se escanea; acá se apunta con la mano y se toca. `Fila` fija `border-b border-border px-5 py-[15px]` y `BotonDeFila` fija 29px, y la maqueta pide 32px (`:378`). Forzar el marco acá exige agregarle props, que es exactamente lo que `TablaGrid.jsx:20-30` dice que no se hace |
| La disciplina del `grid-template-columns` | **Sí** | Aunque las filas sean tarjetas, el encabezado y las filas comparten el **mismo string** (`minmax(0,1fr) 104px 104px 104px 44px`, `gap: 0 16px`). Es lo que evita leer un precio bajo la etiqueta equivocada |
| Panel lateral (`ui/sheet.jsx`, `PanelVenta.jsx`) | **No** | El ticket es una columna permanente, no un panel que entra y sale. No hay ningún detalle que abrir |
| El marco de 1320px del shell (`App.jsx:252-253`) | **No** | Ver abajo |

### El POS es la primera pantalla que no entra en el marco del shell

`App.jsx:252-253` envuelve todas las pantallas en
`max-w-[1320px] px-5 py-7` dentro de un `<main>` que scrollea entero.

La maqueta del POS es lo contrario: alto completo, `min-width:1080px`, sin tope
de ancho, y **dos zonas de scroll independientes** —el catálogo por un lado
(`:360`) y la lista del ticket por el otro (`:403`)— con el encabezado de
búsqueda y el pie de cobro siempre a la vista.

No es una preferencia estética. Un ticket que scrollea con la página deja de
estar visible justo cuando tiene ocho ítems, que es cuando hace falta mirarlo; y
un pie de cobro que hay que ir a buscar con la rueda del mouse anula lo que los
atajos vienen a resolver.

**El POS ocupa el alto completo de `<main>` y administra su propio scroll.** Cómo
se acomoda `App.jsx` para permitirlo lo decide `plan.md`; lo que esta spec fija
es el resultado: en el POS, el cuerpo de la página **no scrollea**.

`docs/REGLAS-DISENO.md` tiene que registrar la excepción. Una regla que dice
«todas las pantallas» y tiene una excepción no escrita deja de ser una regla.

---

## Contexto: qué existe hoy

Relevado antes de escribir. Sirve para no especificar de nuevo lo que ya está y
para no dar por hecho lo que está roto.

| Cosa | Dónde | Estado real |
|---|---|---|
| Pantalla | `apps/web/src/pages/Billing.jsx` | Una columna de tarjetas y una barra de carrito de **380px** (`:387`), no 400 |
| Carrito | `apps/web/src/store/useStore.js:187-277` | `addToCart`, `updateCartQty`, `updateCartMethod`, `updateCartPrice`, `clearCart`, `getCartTotal` |
| Precio manual por ítem | `useStore.js:256` (`updateCartPrice`) | **Existe y está resuelto**: sobrevive al cambio de medio de pago (`:235`) |
| Vuelto | `Billing.jsx:94-118`, `:719-774` | **Existe**, con sugerencias de billetes. Solo aparece si alguna línea es efectivo |
| Medio de pago por ítem | `Billing.jsx:565` | Existe, pero **solo tres opciones**: `ef`, `tc3`, `al`. Ver defecto 3 |
| Alta de venta | `POST /api/sales` (`apps/api/src/routes/sales.js:321`) | Recalcula el total, decide fecha y hora, descuenta stock con lock y avisa lo que no pudo descontar |
| Facturación | `POST /api/sales/:id/facturar` (`sales.js:819`) | Se pide **después** de guardar la venta. Toma la venta con lock, guarda el error del intento, devuelve el mensaje de AFIP tal cual en el 502 |
| Espera de AFIP | `afipService.js:26` | Timeout SOAP de **30 s**. El cliente del navegador espera hasta **60 s** (`services/api.js:14`) |
| Atajos de teclado | — | **No hay ninguno.** El sistema viejo tampoco: su único `keydown` global cierra modales con `Escape` (`legacy/index-legacy.html:3854-3856`) |
| Foco automático | — | **No hay.** Al abrir la pantalla el foco queda en el `<body>` |
| Impresión | `utils/printInvoice.js`, botón en `Billing.jsx:776-781` | Manual, y solo mientras `lastInvoice` esté en memoria |
| Factura de prueba de $1 | `Billing.jsx:316-376`, botón en `:792-796` | Emite un comprobante **fiscal real** en producción. Pide confirmación, pero está en el pie de cobro, a un clic del botón de cobrar |
| Guardia de diseño | `apps/web/src/tests/guardiasDeDiseno.test.js:48` | Siete archivos. `Billing.jsx` no está |
| Tests de render | `apps/web/vitest` + `src/tests/renderDeInventario.test.jsx` | **Ya existe el entorno** (proyecto 5d). Lo que se afirma acá sobre teclas y foco **se puede probar** |
| Permisos | `apps/api/src/seedPermissions.js:16` | `ventas.crear` ya existe y ya lo exigen `POST /api/sales` y `/facturar`. La pantalla no lo consulta |

---

## Los seis defectos: cuáles entran y cuáles no

### Entran

**1. Una empresa `Exento` no puede elegir ningún comprobante fiscal, y la
pantalla no lo dice.** El tipo inicial es `settings.tax_condition === 'RI' ?
'afip_b' : 'afip_c'` (`Billing.jsx:70`), pero la lista de opciones solo ofrece
Factura C cuando la condición es **exactamente** `'Monotributo'`
(`Billing.jsx:625-627`). Con `'Exento'` —una de las tres condiciones válidas
(`afip.js:27`), y la que la spec 009 ya resolvió como equivalente a Monotributo,
supuesto 6— el estado dice `afip_c` y el `<select>` no tiene esa opción: se ve
seleccionado «Remito / Presupuesto» y se emite una Factura C. Dos cosas
distintas en la misma pantalla, y la que manda es la que no se ve. → **FR-060**.

**2. El carrito sobrevive al cambio de empresa.** `setEmpresaActiva`
(`useStore.js:144-167`) limpia `sucursales` a propósito —«mostrar las columnas de
otro cliente en la tabla de este es justo lo que el aislamiento viene a
evitar»— y **no toca `cart`**. Un superadmin que cambia de empresa con el ticket
cargado se queda con productos de la empresa A adentro del ticket de la empresa
B. Al cobrar, `SaleItem` guarda esos `product_id`, la búsqueda de stock por
`empresa_id: B` no encuentra nada, y la venta queda registrada **con las líneas de
otro cliente y sin descontar nada**, con un aviso que se lee como un problema de
stock. Es una línea de código y es la clase de fuga que este proyecto ya pagó
dos veces. → **FR-062**.

**3. El «medio de pago por ítem» expone tres de los nueve medios que el negocio
usa.** El sistema viejo tenía nueve —efectivo, transferencia, QR, débito,
crédito 1 pago, Visa/Master/Naranja en 3 cuotas, alianza
(`legacy:6338-6344`)— y `Sale.payment_method` está documentado con esa misma
lista (`models/Sale.js:39`). La pantalla ofrece tres (`Billing.jsx:565`), que
son los tres **niveles de precio**, no los medios: una transferencia se registra
como efectivo, y entonces el vuelto aparece cuando no corresponde y el arqueo de
caja cuenta como billetes algo que entró por CBU. El pedido da esta función por
hecha; el relevamiento dice que no lo está. → **[PENDIENTE DE DEFINIR 1]**.

**4. Después de cada venta se recarga el catálogo entero.**
`handleRegisterSale` llama a `initialize()` (`Billing.jsx:297`, y otra vez en
`:261` cuando falla AFIP), que dispara tres pedidos, pone `loading: true`
global y vuelve a traer todos los productos con todas sus filas de stock
(`useStore.js:43-61`). En un mostrador con cola, entre una venta y la siguiente
la pantalla parpadea y el catálogo se vuelve a dibujar entero, para actualizar
el stock de dos o tres productos. La funcionalidad 010 ya dejó
`actualizarProducto` (`useStore.js:96`) justamente para esto. → **FR-047**.

**5. Un segundo disparo del cobro puede registrar dos ventas.** El guardia es
`disabled={cart.length === 0 || loading}` (`Billing.jsx:785`) y `loading` es
estado de React: se lee actualizado recién en el render siguiente. Dos eventos
en la misma tanda —doble clic, o el atajo repetido porque la tecla quedó
apretada— entran los dos al handler antes de que `disabled` llegue al DOM.
Cada uno genera su propio `id: sale_${Date.now()}` (`Billing.jsx:210`), así que
ni siquiera chocan contra la clave primaria: quedan **dos ventas y dos
descuentos de stock**. Con atajos de teclado esto deja de ser hipotético. →
**FR-042**, **FR-043**.

**6. La pantalla usa colores fuera del sistema, y la guardia no los ve.**
`text-blue-500` (`:460`), `border-orange-400` (`:588`), `border-green-500/30` y
`bg-green-50` (`:777`). No son hexadecimales, así que
`guardiasDeDiseno.test.js` los dejaría pasar aunque el archivo estuviera en la
lista. → **FR-005**, **FR-006**.

### Queda anotado, fuera de alcance

**El catálogo entero vive en el navegador.** `useStore.initialize()` pide
`GET /products?active=true` sin paginar (`useStore.js:47`), igual que en
Inventario. Es el proyecto **5e** de `docs/PROXIMOS-PROYECTOS.md` y no se
resuelve acá. **La consecuencia hay que decirla**: con un catálogo grande el POS
tarda en abrir, y es la pantalla donde eso más se nota, porque se abre al
empezar el día y se deja abierta. La búsqueda en sí es correcta: corre sobre
todo el catálogo cargado, no sobre una página.

---

## La asimetría del hito 4: **entra**, acotada

`POST /api/sales` resuelve la sucursal **dos veces y de dos maneras distintas**:

| Qué | Cómo la resuelve | Dónde |
|---|---|---|
| De dónde se descuenta el stock | `resolverSucursal({ puntoDeVentaId: req.puntoDeVentaId })`, que **nunca devuelve null**: cae al punto de venta por defecto de la empresa | `sales.js:442-446` |
| Qué sucursal queda asentada en la venta | `req.puntoDeVentaId \|\| null` | `sales.js:396` |

Cuando la cabecera `X-Punto-De-Venta-Id` viaja —el caso normal— las dos
coinciden. Cuando no viaja, el stock sale de una sucursal concreta y la venta
queda diciendo que no fue de ninguna.

**Por qué importa y no es teórico.** Al anular, `sucursalDeAnulacion`
(`sales.js:27-47`) resuelve en tres escalones: `sale.punto_de_venta_id` →
`sale.location` interpretado como código → el por defecto de la empresa. Con la
venta en `null`, se cae al segundo o al tercero. Y el tercero **no es estable**:
`sucursalPorDefecto` prefiere el de `code = 'principal'` y si no el activo de
menor id (`utils/sucursalDeStock.js:59-69`). Alcanza con que se cree una
sucursal `principal`, o con que se dé de baja la que era el default, para que la
devolución de stock de una venta vieja aterrice en **otro local**. No falla
nada, no avisa nada, y se descubre en un recuento físico.

**Entra acá por tres razones:**

1. **El POS es el único que crea ventas.** El endpoint que esta pantalla llama
   es el que tiene el defecto. Arreglarlo en cualquier otro hito significa
   volver a abrir este mismo handler.
2. **La corrección es mover una línea, no una migración.** El `sucursal` que
   hace falta ya se calcula en el mismo handler (`sales.js:442`); solo está
   adentro del `if (lineas.length)`. Se sube antes del `Sale.create` y se guarda
   `sucursal.id`.
3. **La ventana se abre justo ahora.** El hito 4 dejó `stock.punto_de_venta_id`
   en `NOT NULL`. Toda venta que se registre de acá en adelante con la sucursal
   en `null` es una fila que después nadie va a poder atribuir.

**Lo que NO entra**: migrar la tabla `sales` para completar el
`punto_de_venta_id` de las ventas viejas. Ese dato no existe y no se puede
inferir —`sale.location` es texto libre que escribía el cliente—, y por eso los
tres escalones de `sucursalDeAnulacion` **se conservan tal cual**. Lo que
cambia es que dejan de hacer falta para las ventas nuevas.

→ **FR-070** a **FR-074**.

---

## Vocabulario: qué significa cada palabra acá

| Palabra | Qué es exactamente |
|---|---|
| **Ticket** | El carrito. `useStore.cart`: una línea por producto, con `qty`, `price`, `method` y la marca `precio_manual`. Vive solo en memoria del navegador |
| **Línea** | Un ítem del ticket. Un producto agregado dos veces es **una** línea con `qty: 2`, no dos líneas |
| **Cobrar** | La operación completa: `POST /api/sales` y, si el comprobante es fiscal, `POST /api/sales/:id/facturar`. En ese orden y nunca al revés (`Billing.jsx:183-193`) |
| **Comprobante** | Qué se emite: Factura A / B / C ante ARCA, o Remito o Recibo X, que son internos |
| **Medio de pago** | Cómo paga el cliente. Es **por línea**, y de él sale el precio de esa línea |
| **Nivel de precio** | Efectivo / Tarjeta / Alianza. Lo calcula `calcularPrecios` (`utils/precios.js:98`). **Hoy se confunde con el medio de pago**, ver defecto 3 |
| **Vuelto** | `paga con − total`. Solo tiene sentido si alguna línea es efectivo |
| **Sucursal** | Una fila de `PuntoDeVenta`. La activa la fija el selector del encabezado y viaja en `X-Punto-De-Venta-Id` |

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — El mostrador en dos columnas, como la maqueta (Priority: P1)

Como persona que atiende el mostrador, quiero el catálogo a la izquierda y el
ticket siempre a la vista a la derecha, para no perder de vista lo que estoy
cobrando mientras busco el próximo producto.

**Why this priority**: es el hito 5 y es la mitad «diseño» del pedido. Es además
la condición de todo lo demás: los atajos y el foco automático solo tienen
sentido sobre una pantalla donde la búsqueda, el ticket y el botón de cobrar
están los tres visibles al mismo tiempo.

**Independent Test**: abrir la pantalla con veinte productos y tres líneas en el
ticket, y comparar contra el bloque `isPos` de la maqueta
(`AdminApp-Rediseno.dc.html:336-489`).

**Acceptance Scenarios**:

1. **Given** la pantalla abierta, **When** la miro, **Then** hay dos columnas:
   el catálogo ocupa el espacio restante y el ticket declara un ancho de
   **400px** —no 380 (`Billing.jsx:387`)—, con un borde entre las dos.
2. **Given** la pantalla, **When** miro el catálogo, **Then** la barra de
   búsqueda y los filtros están fijos arriba y **no** scrollean con la lista, y
   el pie de cobro está fijo abajo del ticket y **no** scrollea con las líneas.
3. **Given** una ventana angosta, **When** la achico, **Then** el cuerpo de la
   página **no** scrollea horizontal: el desbordamiento queda adentro de la zona
   que corresponda.
4. **Given** el encabezado del catálogo, **When** lo miro, **Then** dice
   `Producto · Efectivo · Tarjeta · Alianza` con `.eyebrow`, y el
   `grid-template-columns` es **el mismo string** en el encabezado y en cada
   fila del catálogo.
5. **Given** una fila del catálogo, **When** la miro, **Then** el nombre va
   arriba y debajo `marca · SKU · stock` en `fg-3`, con el SKU y el stock en
   `.num`; los tres precios van a la derecha en `.num`, el de efectivo con más
   peso que los otros dos.
6. **Given** un producto sin stock, **When** lo miro, **Then** la fila está
   atenuada y su botón de agregar está deshabilitado.
7. **Given** una búsqueda sin resultados, **When** la miro, **Then** veo el
   estado vacío con dos líneas y la sugerencia de quitar el filtro de stock, y
   **no** una lista en blanco.
8. **Given** el ticket, **When** lo miro, **Then** tiene su propio encabezado con
   el título, la cantidad de ítems en `.num` dentro de un chip, y **Vaciar** a la
   derecha.
9. **Given** el ticket vacío, **When** lo miro, **Then** dice qué hacer y
   **nombra el atajo** con un `<kbd>`, como la maqueta (`:435`).
10. **Given** una línea del ticket, **When** la miro, **Then** veo nombre,
    precio unitario, total de la línea en `.num`, el control de cantidad, el
    selector de medio de pago y el botón de quitar.
11. **Given** el pie de cobro, **When** miro el selector de comprobante,
    **Then** es un **control segmentado** —los botones se reparten el ancho y
    comparten borde y estados— y **no** un `<select>` (`Billing.jsx:614-630`).
12. **Given** el pie de cobro, **When** miro el selector de medio de pago de una
    línea, **Then** también es un control segmentado y no tres botones sueltos.
13. **Given** un comprobante fiscal elegido, **When** lo miro, **Then** aparecen
    Condición IVA y CUIT/DNI en dos columnas; con un comprobante interno, en su
    lugar aparece el nombre del cliente.
14. **Given** el pie de cobro, **When** miro el total, **Then** está en `.num`,
    a 24px, y es el elemento de más peso visual del bloque.
15. **Given** el archivo terminado, **When** lo reviso, **Then** no tiene ningún
    hexadecimal, ninguna regla `dark:` y **ninguna clase de la paleta de
    Tailwind** (`text-blue-500`, `bg-green-50`, `border-orange-400`), y
    `pages/Billing.jsx` **está en la lista de `guardiasDeDiseno.test.js`**.
16. **Given** el precio manual de una línea, **When** lo edito, **Then** sigue
    funcionando igual que hoy, con su marca de «precio a mano» y su forma de
    volver al de lista. La maqueta no lo dibuja porque se dibujó antes; **una
    función liberada no se pierde por seguir un dibujo** (mismo criterio que
    FR-009 de la funcionalidad 010).
17. **Given** el bloque de vuelto, **When** hay alguna línea en efectivo,
    **Then** sigue apareciendo con sus sugerencias de billetes, igual que hoy.

---

### User Story 2 — Cobrar sin tocar el mouse (Priority: P1)

Como persona que atiende el mostrador con cola, quiero buscar, agregar, cobrar y
limpiar desde el teclado, para no soltar el lector de código de barras ni ir a
buscar un botón con el mouse entre cliente y cliente.

**Why this priority**: es la mitad «función» del pedido y la razón de que este
hito exista. Es también lo que hace utilizable el lector de código de barras,
que escribe en el campo enfocado y termina con `Enter`.

**Independent Test**: con `@testing-library/user-event`, hacer una venta entera
sin disparar ni un solo evento de mouse: `/`, escribir, `Enter`, `Ctrl+Enter`.

#### La tabla de atajos

Es lo que hay que verificar tecla por tecla. **La columna del medio es la que
importa**: un atajo que cobra una venta mientras alguien escribe el nombre de un
cliente es peor que no tener atajos.

| Tecla | Qué hace | Con el foco en un campo de texto |
|---|---|---|
| `/` | Lleva el foco a la búsqueda y selecciona lo que haya escrito | **Escribe una barra.** No hace nada más |
| `Enter` | Nada | **En la búsqueda**: agrega el primer resultado al ticket, vacía la consulta y **deja el foco donde estaba**. **En cualquier otro campo** (precio manual, paga con, CUIT, nombre): confirma ese campo. **Nunca cobra** |
| `Ctrl+Enter` / `⌘+Enter` | Cobra | **Cobra igual**, desde cualquier campo |
| `Esc` | Vacía el ticket (con la salvaguarda de **[PENDIENTE 2]**) | **Limpia el campo y devuelve el foco a la búsqueda.** No vacía el ticket |

#### Por qué `Enter` no cobra, aunque el plan diga que sí

`PLAN-COMPRAFIT.md` 4.1 dice «cobrar con `Enter`». **No se puede**, y no es una
preferencia:

- Un lector de código de barras es un teclado: escribe el código en el campo
  enfocado y manda `Enter`. Si `Enter` cobrara, **cada escaneo cobraría la
  venta**. El escáner es el motivo principal de que la búsqueda tenga el foco.
- La maqueta ya resolvió el conflicto y es coherente consigo misma: dice «Enter
  agrega el primer resultado» al lado de la búsqueda (`:345`), lo repite en el
  estado vacío del ticket (`:435`), y pone `⌘↵` **adentro del botón de
  confirmar** (`:484`).

El plan es un boceto de una línea escrito antes de mirar la maqueta. Manda la
maqueta, y queda dicho acá para que la contradicción sea visible y no una
omisión.

**Acceptance Scenarios**:

1. **Given** el foco fuera de todo campo, **When** aprieto `/`, **Then** el foco
   pasa al campo de búsqueda y **no** se escribe ninguna barra en él.
2. **Given** el foco ya en la búsqueda con texto escrito, **When** aprieto `/`,
   **Then** se escribe una barra: el atajo no se roba una tecla que el usuario
   está tipeando.
3. **Given** el foco en el campo «Paga con», **When** aprieto `/`, **Then** se
   escribe una barra y el foco **no** se mueve.
4. **Given** una búsqueda con al menos un resultado, **When** aprieto `Enter`
   dentro de la búsqueda, **Then** el primer resultado se agrega al ticket, la
   consulta queda vacía, el foco sigue en la búsqueda, y **no** se cobra nada.
5. **Given** una búsqueda **sin** resultados, **When** aprieto `Enter`, **Then**
   no se agrega nada, se avisa, y la consulta **no** se borra: borrarla obliga a
   volver a tipear el código que justamente no existe.
6. **Given** un primer resultado **sin stock**, **When** aprieto `Enter`,
   **Then** no se agrega y se dice por qué. Lo que el botón no deja hacer, el
   atajo tampoco.
7. **Given** el ticket con al menos una línea, **When** aprieto `Ctrl+Enter`,
   **Then** se dispara el cobro **una sola vez**.
8. **Given** el foco dentro del campo de CUIT, **When** aprieto `Ctrl+Enter`,
   **Then** se cobra igual: es el atajo que tiene que funcionar desde donde sea.
9. **Given** el ticket vacío, **When** aprieto `Ctrl+Enter`, **Then** no pasa
   nada y no se manda ningún pedido.
10. **Given** un cobro en curso, **When** aprieto `Ctrl+Enter` de nuevo,
    **Then** **no** se manda un segundo pedido.
11. **Given** el foco en la búsqueda con texto, **When** aprieto `Esc`, **Then**
    se limpia la consulta, el foco queda en la búsqueda y el ticket **no** se
    toca.
12. **Given** el foco en la búsqueda ya vacía, **When** aprieto `Esc`, **Then**
    recién ahí se vacía el ticket, con la salvaguarda que defina el
    **[PENDIENTE 2]**.
13. **Given** un `<select>`, un menú o un diálogo abierto, **When** aprieto
    `Esc`, **Then** se cierra eso y el ticket **no** se toca: el atajo no le pisa
    la tecla al control que la está usando.
14. **Given** cualquiera de los atajos, **When** lo aprieto con `Alt` o con
    `Shift` además, **Then** no se dispara: una combinación del sistema
    operativo o del navegador no puede terminar cobrando una venta.
15. **Given** que salgo del punto de venta a otra pantalla, **When** aprieto `/`,
    **Then** no pasa nada: el escuchador vive y muere con la pantalla.
16. **Given** la pantalla, **When** la miro, **Then** los tres atajos están
    **escritos donde se usan** —en la búsqueda, en el ticket vacío y adentro del
    botón de cobrar—, con `<kbd>` sobre `surface-3`. Un atajo que no está escrito
    en ningún lado no lo usa nadie.
17. **Given** un usuario sin `ventas.crear`, **When** aprieto `Ctrl+Enter`,
    **Then** no se manda ningún pedido, y el botón de cobrar está
    **deshabilitado con su explicación**, no ausente.

---

### User Story 3 — El foco vuelve solo a la búsqueda (Priority: P1)

Como persona que atiende el mostrador, quiero que después de cada venta el
cursor ya esté en la búsqueda, para empezar la venta siguiente escribiendo o
escaneando, sin un clic en el medio.

**Why this priority**: es lo que convierte los atajos en un circuito cerrado. Sin
esto, la segunda venta de la fila arranca con un clic, que es exactamente el
gesto que el hito viene a sacar.

**Independent Test**: montar la pantalla, verificar `document.activeElement`;
cobrar; verificar `document.activeElement` de nuevo.

**Acceptance Scenarios**:

1. **Given** que abro el punto de venta, **When** termina de montarse, **Then**
   el foco está en el campo de búsqueda.
2. **Given** que llego desde «Nueva venta» del historial (FR-015 de la
   funcionalidad 009), **When** carga la pantalla, **Then** el foco está en la
   búsqueda igual.
3. **Given** una venta cobrada con éxito, **When** termina, **Then** el foco
   vuelve a la búsqueda y la consulta está vacía.
4. **Given** una venta que la API rechazó —total inconsistente, stock
   insuficiente—, **When** vuelve el error, **Then** el ticket queda **intacto**
   y el foco vuelve a la búsqueda: la corrección se hace sobre el ticket que
   sigue ahí.
5. **Given** una venta registrada que AFIP rechazó, **When** vuelve el error,
   **Then** el foco vuelve a la búsqueda **y** el aviso de que quedó sin
   comprobante sigue visible (historia 4).
6. **Given** que agrego un producto con el mouse, **When** lo agrego, **Then**
   el foco vuelve a la búsqueda: el circuito es el mismo con mouse o sin él.
7. **Given** que estoy escribiendo en el campo de CUIT, **When** llega la
   respuesta de un pedido que estaba en vuelo, **Then** el foco **no** se me
   mueve de donde estaba escribiendo.

---

### User Story 4 — Cobrar: la espera del CAE, lo que se limpia y lo que no (Priority: P1)

Como persona que atiende el mostrador, quiero saber qué está pasando mientras el
sistema habla con ARCA y qué quedó registrado si algo falla, para no cobrar dos
veces ni entregar mercadería sin comprobante.

**Why this priority**: es la operación que mueve plata y obligación fiscal, y es
donde los atajos de la historia 2 multiplican el riesgo: un botón que se puede
disparar dos veces con el teclado se dispara dos veces.

**Independent Test**: espiar `api.post`, cobrar, y verificar cuántos pedidos
salieron, en qué orden, y qué quedó en pantalla en cada uno de los tres finales
posibles (todo bien / AFIP rechaza / la red se cae).

**Acceptance Scenarios**:

1. **Given** el ticket con líneas, **When** cobro, **Then** sale **primero**
   `POST /api/sales` y **después** `POST /api/sales/:id/facturar`, nunca al
   revés.
2. **Given** el cobro en curso, **When** miro la pantalla, **Then** el botón
   está deshabilitado y dice **en qué paso está**: registrar la venta y pedir el
   CAE son dos esperas distintas y la segunda puede durar 30 s
   (`afipService.js:26`).
3. **Given** que el pedido del CAE lleva más de unos segundos, **When** sigo
   mirando, **Then** aparece una línea que explica que ARCA puede tardar y que
   **la venta ya quedó registrada**, para que nadie apriete de nuevo.
4. **Given** el cobro en curso, **When** intento tocar el ticket —cambiar una
   cantidad, un precio, un medio de pago, agregar un producto—, **Then** no
   puedo: lo que se está facturando no puede cambiar mientras se factura.
5. **Given** un comprobante **interno** (Remito o Recibo X), **When** cobro,
   **Then** sale **un solo** pedido y no se habla con AFIP.
6. **Given** una venta cobrada con éxito, **When** termina, **Then** se limpian:
   el ticket, «Paga con», el CUIT/DNI, el nombre del cliente, el cliente
   seleccionado y la consulta de búsqueda.
7. **Given** una venta cobrada con éxito, **When** termina, **Then** **se
   conservan**: el tipo de comprobante, los filtros de categoría y marca, el
   conmutador «Solo con stock» y la sucursal activa. En un mostrador se emite el
   mismo tipo de comprobante cincuenta veces seguidas; resetearlo obliga a
   volver a elegirlo cincuenta veces.
8. **Given** una venta cobrada, **When** termina, **Then** el stock de los
   productos vendidos ya está descontado en el catálogo **sin recargar la
   pantalla** y sin que la lista parpadee (defecto 4).
9. **Given** una venta cobrada, **When** termina, **Then** puedo **imprimir el
   comprobante** sin que eso bloquee la venta siguiente, y la opción sigue
   disponible hasta que empiece la próxima.
10. **Given** que aprieto cobrar dos veces seguidas muy rápido, **When**
    terminan, **Then** queda **una sola** venta y **un solo** descuento de
    stock: el pedido sale una vez (defecto 5).
11. **Given** que la venta se registró pero AFIP la rechazó, **When** vuelve el
    error, **Then** veo **el mensaje de AFIP tal cual**, se dice explícitamente
    que **la venta quedó registrada** y que el comprobante se reintenta desde el
    historial, y ese aviso **no desaparece solo**: un `toast` de cinco segundos
    no alcanza para «no se emitió la factura».
12. **Given** ese mismo caso, **When** miro el ticket, **Then** está vacío: el
    ticket quedó consumido por una venta que existe, y dejarlo cargado invita a
    cobrarla de nuevo.
13. **Given** que la red se cae **antes** de que salga `POST /api/sales`,
    **When** vuelve el error, **Then** no se registró nada y el ticket sigue
    completo para reintentar.
14. **Given** que la red se cae **después** de que la venta se guardó pero antes
    de que llegue la respuesta, **When** reintento el cobro con el mismo ticket,
    **Then** **no** se registra una segunda venta: el identificador de la
    operación se genera **una vez por ticket** y se reusa en el reintento, no se
    vuelve a generar con `Date.now()` (`Billing.jsx:210`).
15. **Given** una Factura A sin CUIT, **When** cobro, **Then** la API responde
    `CUIT_REQUERIDO` (`sales.js:887-893`) y la pantalla me deja cargarlo y
    reintentar **sin volver a registrar la venta**.
16. **Given** que el punto de venta de AFIP no está configurado, **When**
    elijo un comprobante fiscal, **Then** se dice antes de cobrar, no después de
    haber registrado la venta.

---

### User Story 5 — El ticket no miente: stock, medios de pago y vuelto (Priority: P2)

Como persona que atiende el mostrador, quiero que el ticket refleje lo que
realmente hay y lo que realmente se va a cobrar, para no prometer un producto
que no está ni entregar mal el vuelto.

**Why this priority**: no bloquea el circuito de cobro —por eso va después de las
cuatro anteriores— pero es donde viven los errores que se descubren tarde: un
producto que se vendió y no se descontó, una transferencia contada como
efectivo, un vuelto calculado sobre un total que cambió.

**Independent Test**: cargar un producto con 2 disponibles, agregarlo 3 veces,
cambiar el medio de pago de una línea después de escribir «Paga con», y
verificar avisos, precios y vuelto en cada paso.

**Acceptance Scenarios**:

1. **Given** un producto ya en el ticket, **When** lo agrego de nuevo, **Then**
   sube la cantidad de **la línea que ya existe** y no se crea una segunda
   línea.
2. **Given** una línea con precio puesto a mano, **When** agrego ese mismo
   producto de nuevo, **Then** la cantidad sube y **el precio a mano se
   respeta**: acordar $18.000 y que la segunda unidad vuelva al de lista es la
   clase de cosa que se descubre cuando el cliente ya se fue.
3. **Given** un producto con 2 disponibles, **When** llego a 3 en el ticket,
   **Then** se avisa que pasé el disponible **antes de cobrar**, y no cuando la
   API rechace la venta.
4. **Given** un producto **sin ninguna fila de stock** en la sucursal activa,
   **When** lo cobro, **Then** la venta se registra, no se descuenta nada y el
   aviso que ya devuelve la API (`sales.js:468-476`) **se muestra**, no se pierde
   entre los `toast` de éxito.
5. **Given** un producto que se quedó sin stock entre que lo agregué y que
   cobré —otra caja lo vendió—, **When** cobro, **Then** la venta **entera** se
   rechaza con el mensaje de la API y el ticket queda intacto para corregirlo.
6. **Given** una línea con precio de lista, **When** le cambio el medio de pago,
   **Then** el precio se recalcula al nivel que corresponde.
7. **Given** una línea con precio a mano, **When** le cambio el medio de pago,
   **Then** el precio **no** se toca (`useStore.js:235`).
8. **Given** «Paga con» ya escrito, **When** cambio el medio de pago de una
   línea y el total cambia, **Then** el vuelto se recalcula solo.
9. **Given** «Paga con» escrito, **When** ninguna línea queda en efectivo,
   **Then** el bloque de vuelto desaparece **y el importe escrito se descarta**:
   hoy queda guardado y reaparece con un valor viejo si se vuelve a efectivo.
10. **Given** un «Paga con» menor al total, **When** lo miro, **Then** dice
    cuánto **falta**, en `danger`, y no un vuelto negativo.
11. **Given** una empresa con condición `Exento`, **When** abro el pie de cobro,
    **Then** puedo elegir **Factura C** y lo que dice el selector es lo que se
    va a emitir (defecto 1).
12. **Given** un ticket cargado, **When** cambio de **empresa** en el
    encabezado, **Then** el ticket se vacía (defecto 2).
13. **Given** un ticket cargado, **When** cambio de **sucursal** en el
    encabezado, **Then** el ticket se conserva, el stock que muestra cada línea
    se revalida contra la sucursal nueva, y se avisa de lo que ya no alcanza.
14. **Given** la pantalla terminada, **When** la reviso, **Then** el botón
    «Emitir Factura de Prueba (1 ARS)» **ya no está en el pie de cobro**
    (`Billing.jsx:792-796`). Emite un comprobante fiscal real en producción y
    está a un clic del botón de cobrar. Su destino, en el **[PENDIENTE 5]**.

---

### User Story 6 — La venta queda asentada en la sucursal de la que salió (Priority: P2)

Como dueño de Comprafit, quiero que cada venta diga de qué local salió la
mercadería, para que anularla la devuelva ahí y no a otro lado.

**Why this priority**: no cambia nada de lo que se ve, y por eso va después de
las cinco anteriores. Pero cada día que pasa se registran ventas nuevas con la
sucursal en `null`, y ese dato no se puede reconstruir después.

**Independent Test**: registrar una venta con la cabecera `X-Punto-De-Venta-Id`
ausente, verificar que `Sale.punto_de_venta_id` quedó con el id de la sucursal
de la que efectivamente se descontó el stock, y que es la misma que devuelve la
anulación.

**Acceptance Scenarios**:

1. **Given** una venta con la cabecera presente, **When** se registra, **Then**
   `Sale.punto_de_venta_id` es esa sucursal, igual que hoy.
2. **Given** una venta **sin** la cabecera, **When** se registra, **Then**
   `Sale.punto_de_venta_id` es la sucursal por defecto de la empresa —**la
   misma** de la que se descontó el stock— y **no** `null`.
3. **Given** una venta sin líneas, **When** se registra, **Then** también queda
   con sucursal: la resolución no puede depender de que haya ítems.
4. **Given** una venta registrada con esta funcionalidad, **When** se anula,
   **Then** la mercadería vuelve a esa misma sucursal por el **primer** escalón
   de `sucursalDeAnulacion`, sin usar los otros dos.
5. **Given** una venta **anterior** a esta funcionalidad, con la sucursal en
   `null`, **When** se anula, **Then** sigue resolviéndose con los tres
   escalones de hoy (`sales.js:578-594`). Las ventas viejas **no se migran**.
6. **Given** una empresa sin ninguna sucursal cargada, **When** se intenta
   registrar una venta, **Then** el error dice que hay que crear una sucursal
   —el `ErrorDeNegocio` que ya tira `sucursalPorDefecto`
   (`sucursalDeStock.js:94-98`)— y no un 500.
7. **Given** una venta de otra empresa, **When** se intenta cualquier cosa con
   su id, **Then** la API responde 404 y ninguna guardia de
   `aislamientoEmpresas.test.js` empieza a fallar.

---

### Edge Cases

**El mostrador con cola**

- **Dos ventas seguidas muy rápido**: dos disparos del cobro antes de que
  `loading` llegue al DOM registran dos ventas, cada una con su `id` distinto
  generado con `Date.now()` (defecto 5). El guardia no puede ser estado de
  React.
- **Dos ventas en el mismo milisegundo desde la misma caja**: dos `id` iguales
  → conflicto de clave primaria. Con el identificador generado una vez por
  ticket, esto deja de poder pasar.
- **La tecla de cobrar que queda apretada** (autorepeat del teclado): es el mismo
  caso que el doble disparo, por otra puerta.
- **El lector de código de barras**: escribe en el campo enfocado y manda
  `Enter`. Es el motivo por el que `Enter` no puede cobrar, y por el que el foco
  tiene que volver solo.
- **Un código escaneado que no existe en el catálogo**: se avisa y **no** se
  borra la consulta.
- **El mismo producto agregado dos veces**: una línea con `qty: 2`, y el precio a
  mano se conserva.
- **Un producto sin stock**: no se puede agregar, ni con el botón ni con
  `Enter`.
- **Un producto sin fila de stock en la sucursal**: se vende y se avisa que no se
  descontó nada. Es distinto de «hay cero».
- **La red que se cae en el medio**: tres ventanas distintas —antes de guardar,
  entre guardar y la respuesta, y durante el pedido del CAE— con tres
  consecuencias distintas. La del medio es la única que puede duplicar una venta.
- **AFIP que responde después del timeout del cliente**: el navegador ya se dio
  por vencido a los 60 s (`services/api.js:14`) y ARCA a los 30 (`afipService.js:26`).
  La fuente de verdad es la venta guardada, nunca lo que quedó en pantalla.
- **El cliente que cambia de opinión sobre el medio de pago**: el precio de la
  línea se recalcula salvo que sea manual, el total cambia y el vuelto se
  recalcula con él.
- **La pestaña que se recarga con el ticket cargado**: el ticket se pierde. Vive
  en memoria y esta funcionalidad no lo persiste (ver Fuera de alcance).

**Datos raros**

- Ticket con total 0 (todo con precio manual en cero): se puede cobrar y queda
  registrado; el servidor ya valida que el total declarado cierre contra las
  líneas (`sales.js:354-367`).
- Precio manual negativo: `updateCartPrice` ya lo ignora (`useStore.js:267`).
- Cantidad bajada a cero: la línea se quita (`useStore.js:221`).
- Producto sin costo y sin precio manual: `calcularPrecios` devuelve `sinCosto`
  y la fila lo marca en vez de mostrar `$0` como si fuera un precio.
- Producto sin marca o sin SKU: la línea de metadatos dice «—» y no queda a
  medias.
- Nombre de producto largo: recorta con elipsis sin empujar las columnas de
  precio.
- Empresa sin AFIP configurado: los comprobantes fiscales no se ofrecen, o se
  ofrecen deshabilitados con la explicación, **antes** de cobrar.
- Empresa `Exento`: puede emitir Factura C (defecto 1).
- Empresa sin ningún punto de venta: la venta falla con un error de negocio en
  castellano.

**Presentación**

- Modo oscuro: la pantalla no necesita ni una regla `dark:`.
- `prefers-reduced-motion`: sin animaciones de entrada.
- Ventana angosta: el desbordamiento queda adentro de las zonas de scroll, nunca
  en el body.
- Pantalla táctil: `autofocus` abre el teclado en pantalla. La pantalla es de
  escritorio (ver Fuera de alcance).

---

## Requirements *(mandatory)*

### Functional Requirements

#### Estructura y diseño

- **FR-001**: La pantalla DEBE ser de **dos columnas**: el catálogo ocupando el
  ancho restante y el ticket con un ancho de **400px**, con un borde entre las
  dos. Hoy son 380px (`Billing.jsx:387`).
- **FR-002**: El POS DEBE ocupar el alto completo de `<main>` y administrar
  **sus propias zonas de scroll**: el catálogo por un lado, la lista del ticket
  por el otro. El cuerpo de la página NO DEBE scrollear, ni vertical ni
  horizontal. Es una excepción al marco de 1320px del shell
  (`App.jsx:252-253`) y DEBE quedar registrada en `docs/REGLAS-DISENO.md`.
- **FR-003**: La barra de búsqueda con sus filtros DEBE quedar fija arriba del
  catálogo, y el pie de cobro fijo abajo del ticket. Ninguno de los dos DEBE
  scrollear con su lista.
- **FR-004**: La pantalla NO DEBE tener `h1` ni descripción: la maqueta los
  reemplaza por la barra de búsqueda (`:339-358`) y la miga de pan del
  `AppTopbar` ya nombra la pantalla. Es la única excepción al encabezado de
  pantalla de `REGLAS-DISENO.md`, y DEBE quedar escrita ahí.
- **FR-005**: Todo color DEBE salir de los tokens de `index.css`. CERO
  hexadecimales, CERO reglas `dark:` y **CERO clases de la paleta de Tailwind**
  (`text-blue-500`, `bg-green-50`, `border-orange-400`, `border-green-500/30`),
  que es lo que la pantalla usa hoy.
- **FR-006**: `pages/Billing.jsx` y los componentes nuevos DEBEN agregarse a la
  lista de `guardiasDeDiseno.test.js:48` **antes** de reescribir la pantalla, y
  la guardia DEBE ampliarse para detectar también las clases de la paleta de
  Tailwind. Hoy detecta hexadecimales y `dark:`, y ninguno de los cuatro colores
  que la pantalla usa fuera del sistema es un hexadecimal.
- **FR-007**: El encabezado del catálogo y sus filas DEBEN compartir el **mismo
  string** de `grid-template-columns` (`minmax(0,1fr) 104px 104px 104px 44px`,
  `gap: 0 16px`, `AdminApp-Rediseno.dc.html:361`).
- **FR-008**: Las filas del catálogo DEBEN ser tarjetas separadas
  (`rounded-[11px]`, borde, `gap` de 8px), **no** filas de `TablaGrid`. El marco
  de tabla NO aplica en esta pantalla, y el motivo DEBE quedar escrito en el
  archivo.
- **FR-009**: Cada fila del catálogo DEBE mostrar el nombre arriba y
  `marca · SKU · stock` debajo en `fg-3`, con SKU y stock en `.num`; los tres
  precios a la derecha en `.num`, el de efectivo con más peso que los otros dos.
- **FR-010**: Un producto sin stock DEBE verse atenuado y con su botón de
  agregar deshabilitado.
- **FR-011**: El botón de agregar DEBE medir 32px, según la maqueta (`:378`).
  NO es `BotonDeFila`, que mide 29px.
- **FR-012**: Los filtros DEBEN ser los de la maqueta: categorías como chips de
  29px y un conmutador «Solo con stock» (`:347-357`).
- **FR-013**: DEBE haber un estado vacío para el catálogo sin resultados, con
  ícono apagado, qué pasa y qué hacer, incluida la sugerencia de quitar el
  filtro de stock.
- **FR-014**: El ticket DEBE tener su propio encabezado con título, la cantidad
  de ítems en `.num` dentro de un chip, y **Vaciar** a la derecha.
- **FR-015**: El ticket vacío DEBE decir qué hacer y **nombrar el atajo** con un
  `<kbd>` sobre `surface-3`.
- **FR-016**: Cada línea del ticket DEBE mostrar nombre, precio unitario, total
  de la línea en `.num`, control de cantidad, selector de medio de pago y botón
  de quitar.
- **FR-017**: El precio manual por línea DEBE conservarse, con su marca visible
  y su forma de volver al precio de lista. Es una función liberada y la maqueta
  se dibujó antes de que existiera.
- **FR-018**: El bloque de vuelto DEBE conservarse tal como está hoy, con sus
  sugerencias de billetes, y aparecer solo si alguna línea es en efectivo.
- **FR-019**: El selector de **comprobante** DEBE ser un control segmentado
  —botones que se reparten el ancho y comparten borde y estados
  (`:443-447`)— y NO un `<select>`.
- **FR-020**: El selector de **medio de pago por línea** DEBE ser un control
  segmentado, no botones sueltos. Es lo que pide el pedido explícitamente. La
  maqueta solo dibuja el primero como segmentos; los dos van con el mismo
  patrón.
- **FR-021**: El pie de cobro DEBE mostrar el total en `.num` a 24px como
  elemento de más peso del bloque, sobre `surface-2`, separado por un borde
  punteado (`:473-480`).
- **FR-022**: El desglose de **Subtotal / IVA** que dibuja la maqueta
  (`:474-475`) DEBE mostrarse **únicamente** cuando la empresa es `RI` y el
  comprobante elegido es Factura A o B, y DEBE calcularse igual que el servidor:
  neto = total / 1,21 (`afipService.js:263`), etiquetado como IVA **incluido**.
  Un Monotributista no discrimina IVA —`afipService` le manda `ImpIVA: 0`
  (`:250`)— y mostrarle una línea de IVA es decirle que cobró algo que no cobró.
- **FR-023**: Con un comprobante fiscal DEBEN aparecer Condición IVA y CUIT/DNI
  en dos columnas; con uno interno, el nombre del cliente en su lugar.
- **FR-024**: Un usuario sin `ventas.crear` DEBE ver el botón de cobrar
  **deshabilitado con su explicación**, no ausente.

#### Atajos de teclado

- **FR-030**: DEBE haber exactamente tres atajos, con este comportamiento:
  `/` lleva el foco a la búsqueda; `Enter` **dentro de la búsqueda** agrega el
  primer resultado; `Ctrl+Enter` (y `⌘+Enter` en Mac) cobra; `Esc` limpia.
- **FR-031**: `Enter` **NO DEBE cobrar nunca**, esté donde esté el foco. Un
  lector de código de barras termina cada lectura con `Enter`, y ese es el uso
  principal del campo de búsqueda. Contradice la línea de
  `PLAN-COMPRAFIT.md` 4.1 («cobrar con `Enter`») y el motivo está escrito en la
  historia 2.
- **FR-032**: Con el foco en cualquier campo de texto, `/` DEBE escribir una
  barra y NO DEBE mover el foco.
- **FR-033**: `Enter` en la búsqueda DEBE agregar el primer resultado, vaciar la
  consulta y **dejar el foco en la búsqueda**. Si no hay resultados, NO DEBE
  vaciar la consulta y DEBE avisar. Si el primer resultado no tiene stock, NO
  DEBE agregarlo y DEBE decir por qué.
- **FR-034**: `Enter` en cualquier otro campo DEBE confirmar ese campo y nada
  más.
- **FR-035**: `Ctrl+Enter` / `⌘+Enter` DEBE cobrar desde cualquier campo,
  incluidos los de texto.
- **FR-036**: `Esc` con el foco en un campo de texto DEBE limpiar ese campo y
  devolver el foco a la búsqueda, y NO DEBE tocar el ticket.
- **FR-037**: `Esc` con la búsqueda ya vacía DEBE vaciar el ticket, con la
  salvaguarda que resuelva el **[PENDIENTE 2]**.
- **FR-038**: Ningún atajo DEBE dispararse si hay un `<select>`, un menú, un
  popover o un diálogo abierto: esos controles ya usan `Esc` y las flechas.
- **FR-039**: Ningún atajo DEBE dispararse con `Alt` o `Shift` además del
  modificador que le corresponde.
- **FR-040**: El escuchador de teclado DEBE montarse y desmontarse **con la
  pantalla**. Fuera del punto de venta, `/` no puede hacer nada.
- **FR-041**: Los tres atajos DEBEN estar **escritos en la pantalla**, cada uno
  al lado de lo que dispara: en la búsqueda, en el ticket vacío y adentro del
  botón de cobrar, con `<kbd>`.

#### El cobro

- **FR-042**: El cobro DEBE ejecutarse **una sola vez** por disparo, aunque
  lleguen dos eventos en la misma tanda. El guardia NO DEBE ser estado de React:
  `loading` se lee actualizado recién en el render siguiente (defecto 5).
- **FR-043**: El identificador de la operación DEBE generarse **una vez por
  ticket** y reusarse en cualquier reintento del mismo ticket. Hoy se genera con
  `Date.now()` dentro del handler (`Billing.jsx:210`), así que un reintento tras
  una respuesta perdida registra una segunda venta.
- **FR-044**: El orden DEBE seguir siendo `POST /api/sales` y **después**
  `POST /api/sales/:id/facturar`. NO DEBE invertirse (`Billing.jsx:183-193`).
- **FR-045**: Durante el cobro el botón DEBE indicar **en qué paso está** —
  registrar la venta y pedir el CAE son dos esperas distintas— y pasado un
  umbral DEBE explicar que ARCA puede tardar y que la venta **ya quedó
  registrada**.
- **FR-046**: Durante el cobro el ticket DEBE quedar bloqueado: no se pueden
  cambiar cantidades, precios ni medios de pago, ni agregar productos.
- **FR-047**: Al terminar la venta el stock de los productos vendidos DEBE
  actualizarse **sin volver a pedir el catálogo entero**. `initialize()`
  (`Billing.jsx:297`) se reemplaza por una actualización acotada, con
  `actualizarProducto` (`useStore.js:96`), sobre las líneas que el servidor
  efectivamente descontó —las que **no** vinieron en `warnings`—.
- **FR-048**: Al terminar con éxito DEBEN limpiarse: ticket, «Paga con»,
  CUIT/DNI, nombre del cliente, cliente seleccionado y consulta de búsqueda.
- **FR-049**: Al terminar con éxito DEBEN **conservarse**: tipo de comprobante,
  filtros de categoría y marca, conmutador «Solo con stock» y sucursal activa.
- **FR-050**: Después de una venta DEBE poder imprimirse el comprobante sin
  bloquear la venta siguiente, y la opción DEBE seguir disponible hasta que
  empiece la próxima. NO DEBE ocupar el pie de cobro.
- **FR-051**: Si la venta se registró y AFIP la rechazó, DEBE mostrarse **el
  mensaje de AFIP tal cual**, decirse que la venta quedó registrada, ofrecerse
  el camino al historial para reintentar, y el aviso **NO DEBE desaparecer
  solo**.
- **FR-052**: En ese caso el ticket DEBE vaciarse igual: la operación existe, y
  un ticket cargado invita a cobrarla dos veces.
- **FR-053**: Un error de la API que **no** registró la venta —total
  inconsistente, ítem inválido, stock insuficiente— DEBE dejar el ticket
  **intacto**.
- **FR-054**: Ante `CUIT_REQUERIDO` (`sales.js:887-893`) la pantalla DEBE dejar
  cargar el CUIT y reintentar **solo la facturación**, sin volver a registrar la
  venta.
- **FR-055**: Con AFIP no configurado, los comprobantes fiscales NO DEBEN poder
  elegirse, o DEBEN aparecer deshabilitados con la explicación. El aviso va
  **antes** de cobrar, no después.

#### El ticket

- **FR-060**: El selector de comprobante DEBE ofrecer Factura C a las empresas
  con condición `Exento`, igual que a las `Monotributo`. Hoy la lista solo
  contempla `'Monotributo'` (`Billing.jsx:625-627`) mientras el estado inicial
  ya dice `afip_c` (`:70`): lo que se ve y lo que se emite son cosas distintas
  (defecto 1).
- **FR-061**: Lo que muestra el selector de comprobante y lo que se emite DEBEN
  ser siempre lo mismo. NO DEBE poder quedar seleccionado un valor que no está
  en la lista.
- **FR-062**: Cambiar de **empresa** DEBE vaciar el ticket. `setEmpresaActiva`
  (`useStore.js:144-167`) ya limpia `sucursales` por aislamiento y tiene que
  limpiar esto por lo mismo: cobrar con productos de otra empresa registra
  líneas que no le pertenecen y no descuenta nada (defecto 2).
- **FR-063**: Cambiar de **sucursal** DEBE conservar el ticket, revalidar el
  stock de cada línea contra la sucursal nueva y avisar de lo que ya no alcanza.
  El producto es el mismo; lo que cambia es de dónde sale.
- **FR-064**: Agregar un producto que ya está en el ticket DEBE subir la
  cantidad de esa línea, **conservando el precio a mano** si lo tiene.
- **FR-065**: Superar el disponible de la sucursal activa DEBE avisarse **en la
  pantalla**, antes de cobrar.
- **FR-066**: Un producto sin fila de stock en la sucursal DEBE poder venderse,
  y el aviso que ya devuelve la API (`sales.js:468-476`) DEBE mostrarse de forma
  que no se confunda con el mensaje de éxito.
- **FR-067**: Si ninguna línea queda en efectivo, el importe de «Paga con» DEBE
  descartarse, no solo ocultarse.
- **FR-068**: El botón «Emitir Factura de Prueba (1 ARS)»
  (`Billing.jsx:792-796`) DEBE salir del pie de cobro. Emite un comprobante
  fiscal real en producción y está a un clic del botón de cobrar. Su destino, en
  el **[PENDIENTE 5]**.

#### La sucursal de la venta

- **FR-070**: `POST /api/sales` DEBE guardar en `Sale.punto_de_venta_id` **la
  misma sucursal de la que descuenta el stock**: la que devuelve
  `resolverSucursal` (`sales.js:442-446`), no `req.puntoDeVentaId || null`
  (`sales.js:396`).
- **FR-071**: La sucursal DEBE resolverse **antes** de crear la venta, y no
  adentro del bloque que descuenta stock. Una venta sin líneas también tiene que
  quedar atribuida.
- **FR-072**: Una empresa sin ninguna sucursal DEBE recibir el `ErrorDeNegocio`
  que ya tira `sucursalPorDefecto` (`sucursalDeStock.js:94-98`), no un 500.
- **FR-073**: Las ventas **anteriores** a esta funcionalidad NO se migran, y los
  tres escalones de `sucursalDeAnulacion` (`sales.js:27-47`, `:578-594`) se
  conservan tal cual para ellas.
- **FR-074**: `Sale.location` sigue siendo texto histórico y NO DEBE usarse para
  decidir de dónde sale el stock de una venta nueva.

#### Aislamiento y observabilidad

- **FR-080**: Toda consulta nueva DEBE filtrar por `empresa_id` y usar
  `findScoped` cuando reciba un id del cliente. Ninguna guardia de
  `aislamientoEmpresas.test.js` ni de `observabilidad.test.js` puede empezar a
  fallar.
- **FR-081**: El total lo sigue calculando el servidor a partir de las líneas
  (`sales.js:354-367`). Esta pantalla lo muestra; no lo impone.

### Key Entities

| Entidad | Campos que importan acá |
|---|---|
| `Sale` | `id` (STRING(40), lo genera el cliente y actúa de clave de idempotencia), `date`, `time`, `total`, `payment_method`, `location`, **`punto_de_venta_id` (pasa a escribirse siempre)**, `notes`, `customer_id`, `customer_name`, `afip_cae`, `afip_nro`, `afip_vto`, `afip_type`, `afip_pv`, `afip_ultimo_error`, `afip_ultimo_intento`, `status`, `empresa_id` |
| `SaleItem` | `sale_id`, `product_id`, `product_name`, `quantity`, `unit_price`, `payment_method` |
| `Stock` | `product_id`, `punto_de_venta_id` (`NOT NULL` desde el hito 4), `quantity`, `available` |
| `StockMovement` | `tipo: 'sale'`, `referencia_id`, `punto_de_venta_id`, `usuario_id` |
| `PuntoDeVenta` | `id`, `name`, `code`, `is_active`, `empresa_id` |
| `Setting` | `tax_condition` (`Monotributo` / `RI` / `Exento`), `afip_pv`, `afip_cuit`, `afip_environment`, y los de `calcularPrecios` |

**Ninguna migración.** Esta funcionalidad no agrega ni cambia columnas.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

1. Se puede cobrar una venta completa —buscar, agregar, cobrar— **sin un solo
   evento de mouse**, y hay un test que lo hace.
2. `Enter` en la búsqueda agrega el primer resultado y **no** cobra, con
   cualquier foco y en cualquier estado del ticket.
3. `/` con el foco en un campo de texto escribe una barra y no mueve el foco.
4. `Esc` con texto en la búsqueda no toca el ticket.
5. Al abrir la pantalla y al terminar cada venta, `document.activeElement` es el
   campo de búsqueda.
6. Disparar el cobro dos veces seguidas registra **una** venta y **un**
   descuento de stock. Verificable contra hoy, donde registra dos.
7. Reintentar el cobro del mismo ticket después de una respuesta perdida no
   registra una segunda venta. Verificable contra hoy, donde sí.
8. Una empresa con condición `Exento` puede emitir Factura C, y lo que muestra
   el selector es lo que se emite. Verificable contra hoy, donde no coinciden.
9. Cambiar de empresa con el ticket cargado deja el ticket vacío. Verificable
   contra hoy, donde se puede cobrar con productos de otra empresa.
10. Después de una venta, la pantalla queda lista para la siguiente **sin
    recargar el catálogo**: no sale ningún `GET /products`. Verificable contra
    hoy, donde salen tres pedidos y la lista parpadea.
11. Una venta registrada sin la cabecera `X-Punto-De-Venta-Id` queda con la
    misma sucursal de la que se descontó el stock. Verificable contra hoy, donde
    queda en `null`.
12. `pages/Billing.jsx` no contiene ningún hexadecimal, ninguna regla `dark:` ni
    ninguna clase de la paleta de Tailwind, y **está en la lista de
    `guardiasDeDiseno.test.js`**, que ahora detecta las tres cosas.
13. El encabezado del catálogo y sus filas comparten el mismo
    `grid-template-columns`, y ningún precio aparece bajo la etiqueta
    equivocada.
14. Un Monotributista no ve ninguna línea de IVA en el pie de cobro.
15. Con el cobro en curso, ninguna interacción con el ticket lo modifica.
16. `npm run test:api`, `npm run test:web` y `npm run build` pasan, y las
    guardias estáticas de aislamiento, observabilidad y diseño siguen limpias.
17. Cada criterio de aceptación tiene al menos un test que **falla** si se
    revierte el cambio que lo implementa.

---

## Fuera de alcance

El POS es la pantalla más crítica del sistema y la que más fácil se agranda.
Explícito, para que no se discuta después si estaba incluido:

- **Apertura y cierre de caja, arqueo y cajón de dinero.** El módulo Caja está
  oculto para el cliente (`PLAN-COMPRAFIT.md`, 4.12).
- **Descuentos o recargos sobre el ticket entero.** El precio se negocia por
  línea, que es lo que ya existe.
- **Pago partido por importe** («$5.000 en efectivo y el resto con tarjeta»). El
  medio de pago es por línea, no por importe. El sistema ya detecta y loguea las
  ventas mixtas (`sales.js:414-421`) y no cambia acá.
- **Devoluciones, cambios y anulación desde el POS.** La anulación vive en el
  historial y bloquea los comprobantes con CAE (funcionalidad 009, FR-055).
- **Notas de crédito.** Proyecto 1 de `docs/PROXIMOS-PROYECTOS.md`.
- **Alícuotas de IVA distintas del 21 %.** Proyecto 3. **La consecuencia**: el
  desglose de FR-022 supone 21 % para todo el ticket, igual que
  `afipService.js:263`.
- **Punto de venta de AFIP por sucursal.** Proyecto 5b. Todas las sucursales
  siguen compartiendo numeración correlativa.
- **Paginar el catálogo contra el servidor.** Proyecto 5e. El catálogo entero
  sigue viniendo al navegador y el POS es donde más se nota.
- **Reservar stock mientras el ticket está abierto.** Dos cajas pueden vender la
  última unidad al mismo tiempo; gana la que cobra primero y la otra recibe el
  error de stock insuficiente.
- **Persistir el ticket entre recargas de la pestaña.** Se pierde, como hoy.
- **Vendedor por venta.** `Sale.seller` existe y el POS nunca lo completa. Queda
  anotado.
- **Impresión térmica automática, apertura de cajón, balanza.**
- **Atajos para cambiar el medio de pago, el comprobante o la cantidad.** Tres
  atajos, no dieciocho. Los que entran son los que el pedido nombra.
- **Vista mobile o para tablet.** La pantalla es de escritorio, con
  `min-width` propio (`AdminApp-Rediseno.dc.html:337`).
- **Migrar las ventas viejas para completarles la sucursal.** Ese dato no existe
  y no se puede inferir.
- **Rediseñar Proveedores, Órdenes de compra, Gastos, Panel o Equipo.** Cada una
  aplica el patrón en su propio hito.
- **Cambiar `calcularPrecios`.** Está testeada y la usa Inventario; acá se
  consume.

---

## Lo que faltaba decidir · **resuelto**

Marcado tal cual se pide: lo que cambia el resultado y no está claro en el
pedido, en el plan ni en la maqueta. **Ninguno tuvo una respuesta inventada.**

Las ocho preguntas están contestadas. Se conserva abajo el planteo completo de
cada una —con las opciones que se descartaron y por qué— porque dentro de seis
meses la pregunta «¿por qué el vuelto solo aparece con efectivo?» se contesta
acá y no leyendo el componente.

| # | Decisión | Quién decidió |
|---|---|---|
| 1 | **Segmentos de precio + medio exacto adentro** (opción B). Efectivo / Tarjeta / Alianza siguen siendo los tres segmentos; quien elige «Efectivo» puede precisar transferencia, QR o débito, que comparten precio. El vuelto aparece **solo con efectivo de verdad** | Usuario |
| 2 | **Confirmación antes de vaciar** (opción A). `Esc` con ticket cargado pide confirmar. Se eligió sobre el doble `Esc` y sobre el deshacer: en el mostrador, perder un ticket negociado a mano no se compensa con velocidad | Usuario |
| 3 | **Medio de pago del ticket, heredado** (opción B, como el sistema viejo). El pie de cobro lleva el medio vigente; las líneas nuevas lo heredan y cambiarlo por línea lo pisa solo para esa línea | Usuario |
| 4 | **Impresión manual**, como hoy. El pedido no la menciona y la impresión automática sin impresora configurada abre un diálogo del navegador que hay que cerrar en cada venta | Por defecto |
| 5 | **«Emitir Factura de Prueba» sale del pie de cobro** y se anota para Ajustes → Facturación AFIP (hito 8). Lo que esta funcionalidad necesita es que no esté acá | Por defecto |
| 6 | **Scroll con tope visible**, sin paginador: la maqueta manda, igual que en la contradicción de `Enter`. Con más resultados que el tope, una línea dice «N de M · afiná la búsqueda» | Por defecto |
| 7 | **Avisos de stock agrupados en un bloque fijo del ticket**, no en `toast`. Tres productos sin fila de stock hoy son cuatro `toast` compitiendo, y el que importa se va solo a los segundos | Por defecto |
| 8 | **Comprobantes fiscales deshabilitados con explicación** cuando la empresa no configuró AFIP, no ocultos. Un comprobante que no está no se puede pedir; uno deshabilitado que dice por qué, sí (FR-055) | Por defecto |

Las decisiones 1, 2 y 3 cambian requisitos de las historias 1 y 5; el plan las
toma de esta tabla, no del planteo de abajo.

### Bloqueaban

**[PENDIENTE DE DEFINIR 1] — ¿Qué son los tres segmentos de medio de pago?**

El pedido pide «los botones de medio de pago como segmentos» y da la función por
terminada. El relevamiento dice otra cosa: el sistema viejo manejaba **nueve**
medios (`legacy:6338-6344`) y `Sale.payment_method` está documentado con esa
lista (`models/Sale.js:39`), pero la pantalla ofrece **tres**
(`Billing.jsx:565`), que son los tres **niveles de precio**, no los medios.

Consecuencias de dejarlo como está: una transferencia se registra como
`ef`, el bloque de vuelto aparece cuando no corresponde, y el total de efectivo
del día incluye plata que entró por CBU.

Las dos salidas posibles cambian el diseño del control y lo que se guarda:

- **A — Tres segmentos = tres niveles de precio.** Es lo de hoy y lo que dibuja
  la maqueta. Se asume que Comprafit no necesita distinguir efectivo de
  transferencia en el registro. Barato, y deja el defecto vivo.
- **B — Tres segmentos de precio + el medio exacto adentro.** Los segmentos
  siguen siendo Efectivo / Tarjeta / Alianza, y el que elige «Efectivo» puede
  además precisar transferencia, QR o débito, que comparten precio. El vuelto
  aparece solo con efectivo de verdad.

**Bloquea** porque define qué es el control segmentado que el pedido pide, y
porque B toca el store y el registro de la venta.

**[PENDIENTE DE DEFINIR 2] — ¿Cómo se protege el vaciado del ticket con `Esc`?**

`Esc` vacía el ticket, y **no hay ninguna forma de recuperarlo**: `clearCart`
(`useStore.js:274`) tira el arreglo. Un ticket de quince líneas con precios
negociados a mano se pierde con una tecla, y en un mostrador `Esc` se aprieta
por reflejo para cerrar cualquier cosa.

Tres salidas, y cambian el resultado:

- **A — Confirmación.** Segura y lenta. Un diálogo en el medio de la cola es
  justo la fricción que los atajos vienen a sacar.
- **B — Doble `Esc`.** El primero avisa «volvé a apretar para vaciar», el
  segundo vacía. Sin mouse, sin diálogo, pero hay que aprender el gesto.
- **C — Vaciar y ofrecer deshacer** durante unos segundos, restaurando el ticket
  exacto. Rápido y reversible; exige guardar la última copia del ticket.

**Bloquea** porque `Esc` es uno de los tres atajos del pedido y cada opción tiene
criterios de aceptación distintos.

**[PENDIENTE DE DEFINIR 3] — ¿Qué medio de pago hereda una línea nueva?**

`addToCart` usa siempre `'ef'` (`useStore.js:188`). El sistema viejo hacía lo
contrario: la línea nueva heredaba **el método global vigente**
(`legacy:6237-6240`), de modo que elegir «Tarjeta» una vez alcanzaba para todo
el ticket.

Con el comportamiento de hoy, un ticket de ocho productos que se paga con
tarjeta exige ocho clics en «Tarjeta», uno por línea — y el precio de las
líneas que se olviden queda mal, porque cada nivel tiene otro precio.

- **A — Como hoy**: cada línea nace en efectivo.
- **B — Como el sistema viejo**: hay un medio de pago «del ticket» que heredan
  las líneas nuevas, y cambiarlo por línea lo pisa solo para esa línea.

**Bloquea** porque decide si el pie de cobro lleva un selector de medio de pago
del ticket, que es una pieza más del diseño de la historia 1.

### No bloqueaban

**[PENDIENTE DE DEFINIR 4] — ¿Se imprime el comprobante solo al cobrar?**

Hoy hay que apretar un botón (`Billing.jsx:776-781`). Con cola, imprimir
automático ahorra un gesto por venta; sin impresora configurada, abre un diálogo
del navegador que hay que cerrar. El pedido no lo menciona. Si no se decide,
queda manual, como hoy.

**[PENDIENTE DE DEFINIR 5] — ¿Adónde va «Emitir Factura de Prueba (1 ARS)»?**

Sale del POS (FR-068). Los destinos posibles son Ajustes → Facturación AFIP
(hito 8, `PLAN-COMPRAFIT.md` 4.9) o directamente eliminarlo, ya que emite un
comprobante fiscal real y el circuito de homologación nunca se probó (proyecto 2
de `PROXIMOS-PROYECTOS.md`). No bloquea: lo que esta funcionalidad necesita es
que **no esté en el pie de cobro**.

**[PENDIENTE DE DEFINIR 6] — ¿Cuántos productos muestra el catálogo?**

Hoy son 30 por página con paginador (`Billing.jsx:35`, `:474-507`). La maqueta
dibuja una lista que scrollea, **sin paginador** (`:360`). Con el catálogo
entero en memoria (proyecto 5e), dibujar todo de una es un problema de
rendimiento y no de datos. Las salidas: conservar el paginador, o scroll con un
tope de resultados visibles y una línea de «N de M, afiná la búsqueda». No
bloquea la función; sí cambia el dibujo.

**[PENDIENTE DE DEFINIR 7] — ¿Qué muestra el ticket cuando hay un aviso de
stock no descontado?**

`POST /api/sales` devuelve `warnings` (`sales.js:511`) y hoy salen como `toast`
amarillos que conviven con el `toast` verde de éxito (`Billing.jsx:235-237`). Con
tres productos sin fila de stock son cuatro `toast` a la vez. Falta decidir si
el aviso va agrupado, si queda fijo, y si bloquea o no la venta siguiente. No
bloquea: la venta ya se registra bien.

**[PENDIENTE DE DEFINIR 8] — ¿El comprobante interno también se puede elegir con
la empresa sin AFIP configurado?**

Hoy Remito y Recibo X están siempre disponibles y no dependen de AFIP, y eso
está bien. Lo que no está definido es si una empresa **sin** AFIP configurado
debería ver los comprobantes fiscales deshabilitados con explicación (que es lo
que pide FR-055) o directamente no verlos. Cambia lo que ve el usuario el primer
día, antes de configurar nada.

---

## Assumptions

Supuestos vigentes. Si alguno resulta falso, cambia el resultado.

1. El aislamiento por empresa se mantiene tal cual: toda consulta nueva filtra
   por `empresa_id` y usa `findScoped` cuando recibe un id del cliente.
2. El total de una venta lo sigue calculando el servidor a partir de las líneas
   (`sales.js:354-367`). Esta pantalla lo muestra, no lo impone.
3. La fecha y la hora las sigue decidiendo el servidor en la zona horaria de la
   empresa (`sales.js:369-385`). El navegador no manda ninguna de las dos.
4. `POST /api/sales/:id/facturar` conserva su contrato: idempotente, con lock,
   guarda el error del intento y devuelve el mensaje de AFIP tal cual en el 502.
   Esta funcionalidad lo consume; el que lo arregló fue el hito 3.
5. `calcularPrecios` (`utils/precios.js:98`) es la única fuente de los tres
   niveles de precio, y su bandera `sinCosto` es la que marca los productos sin
   costo.
6. Los permisos vigentes alcanzan y **no se crean permisos nuevos**:
   `ventas.crear` para cobrar, que es el que ya exigen los dos endpoints.
7. La pantalla es de **escritorio**, con teclado físico. El lector de código de
   barras se comporta como un teclado.
8. `Ctrl+Enter` y `⌘+Enter` son el mismo atajo, resuelto según el sistema
   operativo. La maqueta dibuja `⌘↵` (`:484`) porque se dibujó en Mac.
9. Comprafit tiene **una sola sucursal**. El selector de sucursal del encabezado
   existe igual y el ticket tiene que comportarse bien cuando cambia.
10. La condición fiscal de la empresa sale de `settings.tax_condition` y las tres
    válidas son `Monotributo`, `RI` y `Exento` (`afip.js:27`). `Exento` se
    comporta como `Monotributo` para el tipo de comprobante, igual que decidió la
    funcionalidad 009 (supuesto 6).
11. Los importes se muestran en formato argentino (`1.234,50`).
12. El módulo de clientes sigue liberado solo para superadmin
    (`Billing.jsx:55`), así que el buscador de fichas solo aparece para ellos y
    el nombre libre alcanza para el comprobante — que ya se persiste en
    `Sale.customer_name` exista o no la ficha (FR-100 de la funcionalidad 009).
13. El ticket vive en memoria y se pierde al recargar la pestaña. No se
    persiste.
14. Las ventas anteriores a esta funcionalidad quedan con `punto_de_venta_id` en
    `null` y se siguen anulando con los tres escalones de hoy.
