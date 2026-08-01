# Feature Specification: Historial de ventas — pasada fina

**Feature Branch**: `009-historial-de-ventas`
**Created**: 31 de julio de 2026
**Decisiones cerradas**: 1 de agosto de 2026
**Status**: Ready for plan
**Input**:

> Pasada fina de la pantalla **Historial de ventas** de AdminApp. Es el hito 3
> del plan (`docs/PLAN-COMPRAFIT.md`, 4.2). Dos partes.
>
> **Diseño.** Llevar la pantalla a la maqueta del rediseño. Es la pantalla que la
> maqueta dibuja completa, así que además fija el patrón de tabla que van a
> copiar las demás: tabla en grid (no `<table>`), encabezado en `surface-2`, hora
> y CAE en monoespaciada, tipo y estado como badges, acciones de 29px al final,
> fila clickeable que abre un panel lateral con el detalle.
>
> **Función.** Cerrar lo que falta: filtros de fecha, sucursal y tipo de
> comprobante (hoy solo hay fecha); exportar el listado; reintentar la
> facturación de una venta que quedó sin CAE — el endpoint
> `POST /api/sales/:id/facturar` ya existe, el botón no.

Los veintinueve puntos abiertos de la primera versión de esta spec fueron
resueltos el 1/8/2026 y están incorporados como requisitos o como supuestos. No
queda nada marcado como pendiente.

---

## Contexto: qué existe hoy

Relevado antes de escribir. Sirve para no especificar de nuevo lo que ya está y
para no dar por hecho lo que está roto.

| Cosa | Dónde | Estado real |
|---|---|---|
| Pantalla | `apps/web/src/pages/InvoicesList.jsx` | Usa `<Table>` de shadcn, no grid |
| Listado | `GET /api/sales` (`apps/api/src/routes/sales.js:15`) | Acepta **una** `date`, no un rango. Acepta `location`, `customer_id`, `page`, `limit` |
| Anular | `PUT /api/sales/:id/void` | Existe, con lock y restauración de stock. **Hoy deja anular comprobantes con CAE** |
| Facturar / reintentar | `POST /api/sales/:id/facturar` | **Existe y es idempotente.** No hay ningún botón que lo llame |
| Verificar contra AFIP | `GET /api/afip/invoice/:type/:pv/:number/data` | Existe y hay botón, pero consulta con el punto de venta equivocado |
| Exportar | `apps/web/src/pages/Reports.jsx` (XLSX/CSV con `xlsx`) | Existe **solo en Reportes**, que el plan deja oculto para el cliente |
| Estados de venta | `Sale.status` (`apps/api/src/models/Sale.js:100`) | Solo `'active'` y `'voided'` |
| Desvío ya medido | `taxService.js:154` (`anuladas_con_cae_sin_nc`) | El sistema **ya cuenta** las anuladas con CAE sin nota de crédito |

### Los tres defectos que esta funcionalidad tiene que cerrar

Los tres cambian el resultado. Entran como requisitos con test propio, no como
notas al pie.

1. **El filtro de sucursal no filtra nada.** `InvoicesList.jsx:36` arma las
   opciones con `pv.location`, y `PuntoDeVenta` no tiene columna `location`: la
   API devuelve `{ id, name, code, address }`
   (`apps/api/src/routes/empresas.js:242`). El valor viaja `undefined` y nunca
   coincide con nada. → **FR-071**.

2. **Las columnas Estado y Total están cruzadas.** El encabezado declara
   `… ESTADO, TOTAL, ACCIONES` (`InvoicesList.jsx:199-205`) pero las celdas
   renderizan el total antes que el estado (`:240-247`). Se lee un importe bajo
   la etiqueta «Estado». → **FR-004**.

3. **La búsqueda solo mira la página cargada.** `filteredSales`
   (`InvoicesList.jsx:134`) filtra sobre las 20 filas que ya están en memoria.
   Buscar un CAE que está en la página 3 no devuelve nada y la pantalla dice
   «no hay ventas». → **FR-078**.

---

## Qué es «el mismo comprobante» para el usuario

Esta sección es la base del resto. Sin este vocabulario, «reintentar», «anular» y
«exportar» significan cosas distintas según quién las lea.

### Dos identidades, no una

| Identidad | Quién la asigna | Campos | Cuándo existe |
|---|---|---|---|
| **La operación** | AdminApp | `Sale.id` | Siempre, desde que se cobra |
| **El comprobante fiscal** | ARCA/AFIP | `afip_type` + `afip_pv` + `afip_nro` | Solo si se emitió y hay CAE |

La numeración de AFIP es **correlativa por punto de venta y por tipo**: un
`afip_nro` suelto no identifica nada. Los tres campos juntos, sí.

Consecuencia práctica: **una venta puede cambiar de identidad fiscal sin dejar de
ser la misma operación.** Al reintentar con éxito, la fila deja de mostrar «—» y
pasa a mostrar `0005-00014882`. Es la misma venta, el mismo total, el mismo stock
ya descontado. La pantalla tiene que dejar eso claro o el usuario va a creer que
se duplicó.

Una venta sin comprobante fiscal **no tiene número de comprobante**, y la pantalla
lo dice con un «—». El identificador corto de la operación va debajo, como dato
secundario. Hoy se imprime `sale.id.split('-')[0]` (`InvoicesList.jsx:237`) en el
lugar del número: un pedazo de UUID, que no es correlativo, no se dicta por
teléfono y no sirve para buscar. Se saca de ahí.

### Los cinco estados

`status`, `afip_cae` y el registro del último intento fallido dan cinco estados.
Son estados distintos para el usuario y se ven distintos:

| # | `status` | `afip_cae` | Último intento | Etiqueta | Color |
|---|---|---|---|---|---|
| **A** | `active` | presente | — | **Autorizada** | `ok` |
| **B** | `active` | `null` | sin intento fallido | **Registrada** | neutro (`surface-3` / `fg-2` / `border`) |
| **C** | `active` | `null` | con intento fallido | **Rechazada** | `danger` |
| **D** | `voided` | `null` | — | **Anulada** | gris (`surface-3` / `fg-3` / `border`) |
| **E** | `voided` | presente | — | **Anulada · vigente ante ARCA** | `warn` (ámbar) |

**C es la que hay que reintentar.** Es la única que ofrece el botón de reintento
como acción principal por defecto, la que cuenta el Panel de control en «Requiere
tu atención», y la razón de que se guarde el error de AFIP: hoy ese error se
loguea (`sales.js:432`) y se devuelve en la respuesta HTTP, pero no se persiste.
Si el operador cierra la pestaña, se perdió, y la venta queda indistinguible de
una venta interna hecha a propósito.

**E es dato que ya existe y no se puede fabricar más.** De acá en adelante anular
un comprobante con CAE está bloqueado (ver más abajo), así que E no se puede
crear. Pero hasta hoy se permitía, y `taxService` ya cuenta esas ventas
(`anuladas_con_cae_sin_nc`) justamente porque es un desvío conocido. Mostrarlas
como una anulada común sería mentirle al usuario: ese comprobante sigue
declarado, sigue en la base imponible y solo se revierte con una nota de crédito
que el sistema todavía no emite. Por eso llevan etiqueta y color propios.

### Anular un comprobante con CAE queda bloqueado

Anular en AdminApp no anula nada ante ARCA. Mientras no existan las notas de
crédito, **la pantalla y la API rechazan anular una venta que tiene CAE**, y el
mensaje explica por qué: el comprobante sigue vigente ante ARCA y hace falta una
nota de crédito, que el sistema todavía no emite.

Es la decisión del 1/8/2026 y ya está anotada en `docs/PROXIMOS-PROYECTOS.md`,
punto 1. Dejar anular sin emitir la nota de crédito es fabricar el problema en
silencio.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Ver el historial con el patrón de tabla de la maqueta (Priority: P1)

Como dueño de Comprafit, quiero ver mis ventas en una tabla densa y escaneable,
para encontrar un comprobante de un vistazo sin leer fila por fila.

**Why this priority**: es el hito 3 del plan y la razón de que esta pantalla vaya
primero. Lo que se decida acá —anchos, badges, tipografía de los números,
acciones— lo copian Inventario, Órdenes de compra, Gastos y Equipo. Si sale mal,
sale mal cinco veces.

**Independent Test**: cargar la pantalla con ventas de los cinco estados y
comparar contra el bloque `isVentas` de la maqueta
(`AdminApp-Rediseno.dc.html:491-556`).

**Acceptance Scenarios**:

1. **Given** ventas cargadas, **When** abro la pantalla, **Then** la tabla es un
   `grid` con `grid-template-columns: 80px 116px 132px minmax(0,1fr) 116px 128px
   128px` y `gap: 0 16px`, idéntico en el encabezado y en cada fila, y en el
   archivo no queda ningún `<table>` ni ningún componente `Table*` de shadcn.
2. **Given** la tabla, **When** miro el encabezado, **Then** dice
   `Hora · Tipo · Comprobante · Cliente · Estado · Total · Acciones`, está sobre
   `surface-2`, con `.eyebrow` y padding `11px 20px`.
3. **Given** una fila, **When** la miro, **Then** hora, número de comprobante,
   CAE y total van con `.num`; el cliente y las etiquetas, no.
4. **Given** una fila, **When** miro la columna Estado, **Then** hay un badge de
   estado y **no un importe**: ninguna fila muestra el total bajo la etiqueta
   «Estado» (defecto 2 del relevamiento).
5. **Given** ventas en los cinco estados, **When** las miro juntas, **Then** las
   cinco se distinguen entre sí sin leer el texto del badge, y «Anulada» se
   distingue de «Anulada · vigente ante ARCA».
6. **Given** una venta anulada, **When** la miro, **Then** la fila entera está al
   55 % de opacidad.
7. **Given** la fila, **When** paso el mouse, **Then** el fondo pasa a
   `surface-2` y el cursor es `pointer`; las acciones son botones de 29px,
   `rounded-lg`, en `fg-3`, que se oscurecen al hover.
8. **Given** una venta sin comprobante fiscal, **When** miro la columna
   Comprobante, **Then** dice «—» con el identificador corto debajo como dato
   secundario, y **no** un pedazo de UUID en el lugar del número.
9. **Given** el archivo terminado, **When** lo reviso, **Then** no tiene ningún
   valor hexadecimal ni ninguna regla `dark:`.
10. **Given** una ventana angosta, **When** la achico, **Then** la tabla scrollea
    horizontal dentro de su tarjeta y el cuerpo de la página **no** scrollea
    horizontal, igual que en `Comparador.jsx:281-282`.
11. **Given** que no hubo ventas en el período, **When** miro la tarjeta,
    **Then** veo el estado vacío del sistema, distinto del mensaje de «ninguna
    coincide con los filtros».

---

### User Story 2 — Abrir el detalle sin perder la lista (Priority: P1)

Como usuario, quiero hacer clic en una fila y ver el comprobante completo en un
panel lateral, para revisarlo sin salir del listado ni perder mis filtros.

**Why this priority**: es donde vive lo que la fila no entra a mostrar (ítems,
CUIT, medio de pago, sucursal, vencimiento del CAE) y es la casa de las acciones
sobre un comprobante, incluido el reintento de la historia 3.

**Independent Test**: hacer clic en una fila de cada uno de los cinco estados y
verificar contenido, acciones del pie, y que al cerrar la lista siga igual.

**Acceptance Scenarios**:

1. **Given** el listado, **When** hago clic en la fila fuera de los botones de
   acción, **Then** entra un panel de 520px (`max-w-[92vw]`, `shadow-nivel-3`,
   `anim-panel`) con overlay.
2. **Given** un botón de acción de la fila, **When** lo toco, **Then** ejecuta su
   acción y **no** abre el panel.
3. **Given** el panel abierto, **When** miro el encabezado, **Then** veo el
   kicker «Comprobante», el número como título y `tipo · fecha y hora ·
   sucursal` debajo.
4. **Given** el panel, **When** miro los datos, **Then** están Cliente, CUIT/DNI,
   Condición IVA, Medio de pago, Sucursal, CAE con su vencimiento, y Estado con
   su color.
5. **Given** el panel, **When** miro los ítems, **Then** hay una tabla
   `Detalle · Cant. · Unitario · Subtotal` con el total abajo, todo lo numérico
   en mono.
6. **Given** una venta **Rechazada**, **When** abro el panel, **Then** veo el
   mensaje de AFIP que quedó guardado del último intento y la fecha de ese
   intento, y la acción principal es **Reintentar facturación**.
7. **Given** una venta **Registrada**, **When** abro el panel, **Then** la acción
   principal es **Reintentar facturación** — una venta interna también se puede
   facturar después.
8. **Given** una venta **Autorizada**, **When** abro el panel, **Then** la acción
   principal es **Verificar en AFIP** y **no** aparece el reintento.
9. **Given** una venta **Autorizada**, **When** miro el pie, **Then** «Anular
   venta» aparece deshabilitada con la explicación de por qué, no ausente.
10. **Given** una venta anulada (D o E), **When** abro el panel, **Then** no hay
    ni reintento ni anulación, y en el caso E se explica que el comprobante sigue
    vigente ante ARCA.
11. **Given** el panel abierto, **When** aprieto `Esc` o clic en el overlay,
    **Then** se cierra y el listado conserva página, filtros, orden y scroll.
12. **Given** una venta sin ítems cargados, **When** abro el panel, **Then** la
    sección de ítems dice que no hay detalle en vez de mostrar una tabla vacía.

---

### User Story 3 — Reintentar la facturación de una venta sin CAE (Priority: P1)

Como dueño de Comprafit, quiero pedir de nuevo el CAE de una venta que quedó sin
facturar, para no tener que anularla y volver a cargar el ticket entero.

**Why this priority**: es la única de las tres funciones que involucra plata y
obligación fiscal. El endpoint ya está escrito y es idempotente
(`sales.js:358`); falta la puerta. Hasta que exista, la única salida del operador
es rehacer la venta, que descuenta stock dos veces.

**Independent Test**: dejar una venta `active` sin CAE, reintentar desde la
pantalla, y verificar que queda Autorizada con CAE, número y punto de venta, sin
tocar el stock.

**Acceptance Scenarios**:

1. **Given** una venta activa sin CAE, **When** abro su panel, **Then** existe
   **Reintentar facturación** como acción principal.
2. **Given** una venta con CAE, o anulada, o un usuario sin `ventas.crear`,
   **When** abro el panel, **Then** el botón no se ofrece.
3. **Given** una empresa con `tax_condition` en `RI`, **When** reintento sin
   elegir tipo, **Then** se emite **Factura B** (tipo 6); con `Monotributo` o
   `Exento`, **Factura C** (tipo 11) — el mismo criterio que ya usa el POS
   (`Billing.jsx:70`).
4. **Given** una venta con cliente asociado, **When** reintento, **Then** el CUIT
   y la condición de IVA salen de ese cliente; sin cliente asociado, sale como
   consumidor final (DocTipo 99, condición 5).
5. **Given** una venta con `punto_de_venta_id`, **When** reintento, **Then** el
   punto de venta de AFIP sale de ahí; si la venta no lo tiene, de
   `settings.afip_pv`.
6. **Given** el reintento en curso, **When** miro el botón, **Then** está
   deshabilitado y muestra que está trabajando; un segundo clic no dispara un
   segundo pedido.
7. **Given** que AFIP autoriza, **When** termina, **Then** la fila pasa a
   **Autorizada**, muestra número y CAE, y el aviso del panel desaparece — sin
   recargar la pantalla ni perder los filtros.
8. **Given** dos operadores que reintentan la misma venta a la vez, **When**
   terminan, **Then** la venta tiene **un solo** CAE.
9. **Given** que un usuario reintenta mientras otro anula la misma venta,
   **When** terminan las dos operaciones, **Then** **no** queda un CAE emitido
   contra una venta anulada: `/facturar` toma la venta con lock, igual que
   `/void`.
10. **Given** una Factura A sin CUIT del comprador, **When** la API responde
    `CUIT_REQUERIDO`, **Then** la pantalla pide el CUIT y deja reintentar en el
    mismo paso, sin mostrar el error crudo.
11. **Given** que AFIP rechaza (502), **When** llega el error, **Then** se
    muestra **el mensaje de AFIP tal cual**, la venta pasa a **Rechazada**, el
    error y la fecha del intento quedan guardados, el stock sigue descontado y el
    botón vuelve a estar disponible.
12. **Given** que la respuesta nunca llega (timeout o red caída), **When** el
    usuario vuelve a la pantalla, **Then** el estado que ve es el de la base, no
    el que quedó en el navegador.
13. **Given** una venta de otra empresa, **When** se intenta reintentar con su
    id, **Then** la API responde 404.

---

### User Story 4 — Filtrar por fecha, sucursal y tipo de comprobante (Priority: P2)

Como dueño de Comprafit, quiero acotar el listado por período, por local y por
tipo de comprobante, para responder «cuánto facturó Ortiz la semana pasada» sin
abrir siete días de a uno.

**Why this priority**: hoy la pantalla es de un día por vez, igual que el legacy.
Es la limitación que más se nota, pero no rompe nada. Va después de las dos
anteriores porque obliga a tocar la API —`GET /api/sales` acepta una sola
`date`— y ese cambio se hace mejor con el vocabulario de estados ya cerrado.

**Independent Test**: cargar ventas de tres días, dos sucursales y los cuatro
tipos, y verificar que cada combinación devuelve exactamente lo que corresponde,
con el contador y el total del pie coherentes.

**Acceptance Scenarios**:

1. **Given** que abro la pantalla sin tocar nada, **When** carga, **Then** el
   rango es el día de hoy.
2. **Given** ventas en varios días, **When** elijo un rango desde/hasta,
   **Then** veo las de todo el rango ordenadas por **fecha y hora
   descendente**, lo más nuevo arriba (hoy la API ordena `time ASC`, que con más
   de un día mezcla los días).
3. **Given** un rango con `desde` posterior a `hasta`, **When** lo elijo,
   **Then** se avisa que está invertido y **no se consulta**.
4. **Given** un rango de más de un año, **When** lo elijo, **Then** se avisa y no
   se consulta.
5. **Given** varias sucursales, **When** elijo una, **Then** veo solo sus ventas
   —el filtro funciona de verdad (defecto 1 del relevamiento)— y el filtrado es
   por `punto_de_venta_id`.
6. **Given** una sucursal activa en el selector del encabezado, **When** abro la
   pantalla, **Then** el filtro arranca en esa sucursal; **When** elijo «Todas
   las sucursales», **Then** veo **todas**, y el encabezado ya no pisa el filtro
   en silencio (`sales.js:20-24`).
7. **Given** ventas de una sucursal dada de baja, **When** están dentro del
   rango, **Then** aparecen en el listado, y la sucursal aparece como opción del
   filtro marcada «(inactiva)». Una sucursal cerrada no hace desaparecer sus
   ventas.
8. **Given** el filtro de tipo, **When** lo abro, **Then** las opciones son
   Factura A, Factura B, Factura C y «Sin comprobante fiscal»; **When** elijo
   una, **Then** veo solo esos comprobantes.
9. **Given** cualquier combinación de filtros, **When** la aplico, **Then** el
   listado vuelve a la página 1, el pie dice «Mostrando N de M comprobantes» con
   la M del resultado **filtrado**, y el total del período de arriba también.
10. **Given** filtros que no dejan pasar nada, **When** se aplican, **Then** el
    mensaje dice que no hay resultados **con esos filtros** y ofrece limpiarlos.
11. **Given** un CAE que está en la página 4 del rango, **When** lo busco,
    **Then** lo encuentro: la búsqueda corre en el servidor sobre el resultado
    completo (defecto 3 del relevamiento). Busca por número de comprobante, CAE y
    nombre de cliente.
12. **Given** un rango de un mes con 3.000 ventas, **When** lo consulto, **Then**
    la primera página (25 filas) aparece en menos de 1,5 s.

---

### User Story 5 — Exportar el listado (Priority: P3)

Como dueño de Comprafit, quiero bajarme el listado que estoy viendo, para
mandárselo al contador sin pedirle a nadie que lo copie a mano.

**Why this priority**: la exportación ya existe en Reportes, que el plan deja
oculto para el cliente (`PLAN-COMPRAFIT.md`, 4.12). Es una función de fin de mes.
Va última porque depende de que los filtros ya definan qué es «el listado que
estoy viendo».

**Independent Test**: filtrar por un rango y una sucursal, exportar, abrir el
`.xlsx` y verificar fila por fila contra la pantalla.

**Acceptance Scenarios**:

1. **Given** filtros aplicados, **When** exporto, **Then** bajo un `.xlsx` con
   **todo el resultado filtrado**, no las 25 filas de la página visible.
2. **Given** el archivo, **When** lo abro, **Then** las columnas son
   `Fecha · Hora · Tipo · Comprobante · CAE · Cliente · Sucursal · Estado ·
   Medio de pago · Total`, una fila por venta.
3. **Given** un CAE de 14 dígitos, **When** miro su celda, **Then** se lee entero
   (`75412339018264`), como texto, sin notación científica ni dígitos perdidos.
4. **Given** la columna Total, **When** la sumo en la planilla, **Then** suma: va
   como número, no como el texto `1.234,50`.
5. **Given** ventas anuladas y no fiscales en el rango, **When** exporto,
   **Then** **están todas**, cada una con su estado en la columna Estado. El
   archivo no oculta nada; quien lo recibe decide.
6. **Given** un total exportado, **When** lo comparo con el total del período que
   muestra la pantalla, **Then** coinciden.
7. **Given** un filtro que devuelve más de 5.000 comprobantes, **When** intento
   exportar, **Then** se avisa y se pide acotar el filtro, en vez de colgar la
   pestaña.
8. **Given** un rango sin resultados, **When** exporto, **Then** se avisa que no
   hay nada que exportar y no se descarga un archivo vacío.
9. **Given** una exportación, **When** miro el nombre del archivo, **Then**
   identifica período y sucursal, para que dos exportaciones no se pisen en la
   carpeta de descargas.
10. **Given** un usuario con `ventas.ver`, **When** abre la pantalla, **Then**
    puede exportar.

---

### Edge Cases

**Estados y fiscalidad**

- Venta anulada **con** CAE (estado E): dato histórico que ya existe y que
  `taxService` ya cuenta. Se muestra en ámbar con etiqueta propia. No se puede
  crear una nueva.
- Venta activa sin CAE por decisión (Registrada) vs. porque AFIP la rechazó
  (Rechazada): se distinguen por el registro del último intento fallido.
- Venta Rechazada que después se reintenta con éxito: pasa a Autorizada y el
  error guardado deja de mostrarse.
- Venta Rechazada que se reintenta y vuelve a fallar: el error guardado se pisa
  con el nuevo, no se acumula.
- CAE presente pero `afip_pv` en `null` (ventas anteriores a que se guardara ese
  campo): «Verificar en AFIP» cae a `settings.afip_pv` solo en ese caso, no
  siempre como hoy (`InvoicesList.jsx:105`).
- Reintentar mientras otro usuario anula la misma venta: resuelto con lock.
- AFIP responde después del timeout del cliente: la fuente de verdad es un
  refresco contra la base, nunca el estado local.

**Filtros y datos**

- Rango invertido (`desde > hasta`): se avisa y no se consulta.
- Rango de más de un año: se avisa y no se consulta.
- Rango calculado con `toISOString()` en el navegador: devuelve UTC y en
  Argentina (UTC−3) corre un día. `Sale.date` se escribe con la fecha **del
  negocio** (`sales.js:149`, `fechaDelNegocio`); el filtro tiene que hablar el
  mismo idioma o las ventas de después de las 21:00 caen en el día equivocado.
- Sucursal dada de baja: sigue apareciendo como opción marcada «(inactiva)».
- Ventas viejas con `punto_de_venta_id` en `null`, anteriores a multi-sucursal:
  no pueden desaparecer del listado cuando el filtro está en «Todas».
- Empresa sin ningún punto de venta cargado: el filtro no ofrece opciones y no
  rompe.
- Cero resultados por filtros vs. cero ventas en el período: dos mensajes
  distintos.
- Estar en la página 5 y aplicar un filtro cuyo resultado tiene 2 páginas.
- Búsqueda con acentos y mayúsculas («Vega» vs. «vega»).
- Nombre de cliente largo: la columna es `minmax(0,1fr)` y recorta con elipsis
  sin empujar las demás.

**Datos raros de la venta**

- Venta sin ítems (`SaleItem` vacío).
- Ítem cuyo producto fue borrado (`product_id: null`): el nombre sobrevive en
  `product_name`.
- Total en 0.
- Venta con líneas de distinto medio de pago (el sistema ya lo detecta y loguea,
  `sales.js:172`): qué muestra «Medio de pago» en el panel y en el export.
- Venta sin cliente asociado y sin `customer_name`: la columna Cliente dice
  «Consumidor final».
- Venta de otra empresa: no aparece nunca. Ninguna consulta nueva puede quedar
  sin `empresa_id`.

**Presentación**

- Modo oscuro: la pantalla no necesita ni una regla `dark:`.
- `prefers-reduced-motion`: `anim-panel` se desactiva.
- Ventana angosta: scroll horizontal dentro de la tarjeta, nunca en el body.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Tabla y patrón visual

- **FR-001**: La tabla DEBE ser un `grid` con
  `80px 116px 132px minmax(0,1fr) 116px 128px 128px` y `gap: 0 16px`, con las
  mismas columnas en el encabezado y en las filas. NO DEBE usar `<table>` ni los
  componentes `Table*` de shadcn.
- **FR-002**: El encabezado DEBE ir sobre `surface-2`, con `.eyebrow` y padding
  `11px 20px`; las filas con padding `15px 20px` y `border-b border-border`.
- **FR-003**: Las columnas DEBEN ser, en orden: Hora, Tipo, Comprobante, Cliente,
  Estado, Total (a la derecha), Acciones (a la derecha). Sucursal **sale** de la
  tabla: queda como filtro y como dato del panel.
- **FR-004**: Cada celda DEBE renderizarse bajo su propia etiqueta. En
  particular, la columna Estado muestra el badge de estado y la columna Total el
  importe (corrige el defecto 2).
- **FR-005**: Hora, número de comprobante, CAE y total DEBEN llevar `.num`
  (monoespaciada + `tabular-nums`). El cliente y las etiquetas, no.
- **FR-006**: El tipo DEBE mostrarse como badge con ícono: fiscal en
  `brand-soft`/`brand-line`/`brand`; sin comprobante fiscal en
  `surface-3`/`border`/`fg-2`.
- **FR-007**: El estado DEBE mostrarse como badge según la tabla de los cinco
  estados, usando los tríos de tokens (`texto`/`soft`/`line`). NO DEBE usarse un
  color de estado suelto sin fondo ni línea.
- **FR-008**: Las acciones DEBEN ser botones de ícono de 29px, `rounded-lg`, en
  `fg-3`, que pasan a `surface-3`/`foreground` al hover, alineadas a la derecha.
- **FR-009**: La fila entera DEBE ser clickeable y abrir el panel lateral. Los
  botones de acción DEBEN detener la propagación del clic.
- **FR-010**: Una fila anulada (D o E) DEBE renderizarse al 55 % de opacidad.
- **FR-011**: Una venta sin comprobante fiscal DEBE mostrar «—» en la columna
  Comprobante, con el identificador corto de la operación debajo como dato
  secundario. NO DEBE mostrarse un fragmento de UUID como número de comprobante.
- **FR-012**: La columna Cliente DEBE mostrar el nombre del cliente asociado si
  la venta lo tiene; si no, el nombre libre guardado en la venta; si no hay
  ninguno, «Consumidor final».
- **FR-013**: Todo color DEBE salir de los tokens de `index.css`. CERO
  hexadecimales y CERO reglas `dark:` en el archivo.
- **FR-014**: La tabla DEBE scrollear horizontal dentro de su tarjeta
  (`overflow-x-auto` + ancho mínimo interno), como `Comparador.jsx:281-282`. El
  body de la página NO DEBE scrollear horizontal. NO se copia el
  `min-width: 1140px` de la maqueta al contenedor de la página.
- **FR-015**: El encabezado de pantalla DEBE tener título, descripción de una
  línea (`max-w-[60ch]`) y a la derecha **Exportar** (secundario) y **Nueva
  venta** (principal, lleva al POS). Un solo botón principal.
- **FR-016**: Arriba de la tabla DEBE mostrarse el **total del período filtrado**
  y la cantidad de comprobantes, en mono.
- **FR-017**: El pie del listado DEBE mostrar «Mostrando N de M comprobantes» y
  la paginación, con **25 filas por página**, consistente con Inventario.
- **FR-018**: DEBE haber dos estados vacíos distintos: «no hubo ventas en el
  período» y «ninguna venta coincide con los filtros», el segundo con la opción
  de limpiarlos.

#### Estados

- **FR-020**: El sistema DEBE persistir, por venta, **el último error de AFIP** y
  **la fecha del último intento de facturación**. La migración es aditiva y no
  toca datos existentes.
- **FR-021**: Un intento de facturación fallido DEBE guardar el mensaje de AFIP y
  la fecha; un intento exitoso DEBE dejar la venta como Autorizada.
- **FR-022**: Un intento fallido posterior DEBE pisar el anterior. No se lleva
  historial de intentos.
- **FR-023**: El estado que se muestra DEBE derivarse de `status`, `afip_cae` y
  el registro del último intento, según la tabla de los cinco estados, y DEBE
  calcularse en un solo lugar reutilizable por listado, panel y export.
- **FR-024**: Las ventas anuladas **con** CAE DEBEN mostrarse como «Anulada ·
  vigente ante ARCA» en `warn`, distinguibles de una anulada común, en el
  listado, en el panel y en el export.

#### Panel lateral

- **FR-030**: El panel DEBE ser de 520px, `max-w-[92vw]`, `shadow-nivel-3`, con
  overlay, entrada `anim-panel`, y cerrarse con `Esc`, con el botón de cerrar y
  con clic en el overlay.
- **FR-031**: DEBE mostrar kicker «Comprobante», el número como título, y
  `tipo · fecha y hora · sucursal` como subtítulo.
- **FR-032**: DEBE mostrar Cliente, CUIT/DNI, Condición IVA, Medio de pago,
  Sucursal, CAE con vencimiento y Estado.
- **FR-033**: DEBE mostrar los ítems (`Detalle`, `Cant.`, `Unitario`,
  `Subtotal`) y el total, todo lo numérico en mono. Sin ítems, DEBE decirlo en
  vez de dibujar una tabla vacía.
- **FR-034**: Para una venta **Rechazada** DEBE mostrar el mensaje de AFIP
  guardado y la fecha del intento.
- **FR-035**: Para una venta **Anulada · vigente ante ARCA** DEBE explicar que el
  comprobante sigue vigente ante ARCA y que hace falta una nota de crédito.
- **FR-036**: El pie DEBE tener «Imprimir» como acción secundaria y, como
  principal, «Reintentar facturación» (ventas activas sin CAE) o «Verificar en
  AFIP» (ventas con CAE).
- **FR-037**: Cerrar el panel NO DEBE recargar el listado ni perder filtros,
  página, orden ni scroll.

#### Reintento de facturación

- **FR-040**: El botón DEBE aparecer únicamente si `afip_cae` es `null`,
  `status === 'active'` y el usuario tiene `ventas.crear`.
- **FR-041**: DEBE llamar a `POST /api/sales/:id/facturar`.
- **FR-042**: El tipo de comprobante por defecto DEBE salir de
  `settings.tax_condition`: `RI` → Factura B (6); `Monotributo` y `Exento` →
  Factura C (11).
- **FR-043**: El CUIT y la condición de IVA DEBEN salir del cliente asociado a la
  venta. Sin cliente asociado, DEBE emitirse a consumidor final (DocTipo 99,
  condición 5).
- **FR-044**: El punto de venta de AFIP DEBE salir del `punto_de_venta_id` de la
  venta. Si la venta no lo tiene, de `settings.afip_pv`.
- **FR-045**: Mientras el pedido está en vuelo el botón DEBE estar deshabilitado
  y mostrarlo. Un segundo clic NO DEBE disparar un segundo pedido.
- **FR-046**: `POST /api/sales/:id/facturar` DEBE tomar la venta **con lock**,
  igual que `/void`, y volver a evaluar `status` y `afip_cae` dentro de la
  transacción. NO DEBE poder emitirse un CAE contra una venta que se anuló en el
  intervalo.
- **FR-047**: Ante `CUIT_REQUERIDO` la pantalla DEBE permitir cargar el CUIT y
  reintentar en el mismo paso.
- **FR-048**: Ante 502 DEBE mostrarse el mensaje de AFIP **tal cual**, la venta
  DEBE quedar como Rechazada con el error guardado, y el botón DEBE volver a
  estar disponible.
- **FR-049**: Después de un reintento exitoso DEBEN actualizarse la fila y el
  panel con lo que devolvió la API, sin recargar la pantalla.
- **FR-050**: El reintento NO DEBE tocar el stock: la venta ya lo descontó.
- **FR-051**: NO DEBE poder emitirse un segundo CAE para la misma venta bajo
  ninguna secuencia de clics ni de pedidos concurrentes. La respuesta idempotente
  de la API (`yaFacturada`) se mantiene como red de seguridad, no como camino
  normal: el botón no se ofrece sobre una venta ya facturada.

#### Anulación

- **FR-055**: `PUT /api/sales/:id/void` DEBE rechazar la anulación de una venta
  que tenga `afip_cae`, con un error de negocio que explique que el comprobante
  sigue vigente ante ARCA y que hace falta una nota de crédito, que el sistema
  todavía no emite.
- **FR-056**: La pantalla DEBE mostrar «Anular venta» **deshabilitada con la
  explicación** sobre una venta con CAE, no ausente: ausente deja al usuario sin
  entender por qué en unas filas está y en otras no.
- **FR-057**: El bloqueo DEBE estar en la API, no solo en la pantalla.
- **FR-058**: Anular una venta **sin** CAE DEBE seguir funcionando exactamente
  como hoy, restaurando stock.

#### Filtros y búsqueda

- **FR-070**: El listado DEBE poder consultarse por **rango** de fechas
  (desde/hasta). El rango por defecto es el día de hoy y el máximo es un año.
- **FR-071**: El filtro de sucursal DEBE filtrar por `punto_de_venta_id`
  (corrige el defecto 1). `Sale.location` queda como texto histórico y NO se usa
  para filtrar.
- **FR-072**: El selector de sucursal del encabezado DEBE definir el **valor
  inicial** del filtro, y el filtro de la pantalla DEBE mandar sobre él. Con
  «Todas las sucursales» elegido, DEBEN verse todas. `X-Punto-De-Venta-Id` NO
  DEBE seguir pisando el parámetro en silencio.
- **FR-073**: El filtro de sucursal DEBE listar las sucursales activas más las
  que aparezcan en el resultado aunque estén dadas de baja, marcadas
  «(inactiva)». Una sucursal cerrada NO DEBE hacer desaparecer sus ventas.
- **FR-074**: El filtro de tipo de comprobante DEBE ofrecer Factura A, Factura B,
  Factura C y «Sin comprobante fiscal».
- **FR-075**: Los filtros DEBEN ser combinables entre sí y con la búsqueda.
- **FR-076**: Cambiar cualquier filtro DEBE volver a la página 1.
- **FR-077**: El orden DEBE ser por **fecha y hora descendente**.
- **FR-078**: El filtrado y la búsqueda DEBEN resolverse en el servidor, sobre el
  resultado completo, no sobre la página cargada (corrige el defecto 3). La
  búsqueda DEBE cubrir número de comprobante, CAE y nombre de cliente.
- **FR-079**: El contador y el total del período DEBEN corresponder al resultado
  filtrado, no al total del día.
- **FR-080**: Un rango invertido o de más de un año DEBE avisarse y NO DEBE
  consultarse.
- **FR-081**: Las fechas del filtro DEBEN interpretarse en la zona horaria de la
  empresa, la misma que usa `fechaDelNegocio`. NO DEBEN calcularse con
  `toISOString()` del navegador.
- **FR-082**: Toda consulta nueva DEBE filtrar por `empresa_id`. Ninguna guardia
  estática de `aislamientoEmpresas.test.js` puede empezar a fallar.

#### Exportación

- **FR-090**: DEBE exportarse un `.xlsx` con la biblioteca `xlsx` que ya usa el
  resto de la aplicación.
- **FR-091**: DEBE exportarse **exactamente el resultado de los filtros
  aplicados**, incluidas anuladas y no fiscales, con una fila por venta.
- **FR-092**: Las columnas DEBEN ser `Fecha`, `Hora`, `Tipo`, `Comprobante`,
  `CAE`, `Cliente`, `Sucursal`, `Estado`, `Medio de pago`, `Total`.
- **FR-093**: El CAE DEBE escribirse como **texto**, para que Excel no lo
  convierta a notación científica ni pierda dígitos.
- **FR-094**: El Total DEBE escribirse como **número**, para que la columna sea
  sumable, y su suma DEBE coincidir con el total del período de la pantalla.
- **FR-095**: El archivo se arma en el navegador sobre el resultado del filtro.
  Si el filtro devuelve **más de 5.000 comprobantes**, DEBE avisarse y pedirse
  acotar en vez de intentar la descarga.
- **FR-096**: Exportar con cero resultados DEBE avisar en vez de descargar un
  archivo vacío.
- **FR-097**: El nombre del archivo DEBE identificar período y sucursal.
- **FR-098**: Exportar DEBE requerir `ventas.ver`.

#### Corrección de la verificación contra AFIP

- **FR-099**: «Verificar en AFIP» DEBE consultar con el `afip_pv` **de la venta**
  y no con `settings.afip_pv` (`InvoicesList.jsx:105`). Solo si la venta no tiene
  `afip_pv` guardado —comprobantes anteriores a que existiera el campo— DEBE
  caerse a `settings.afip_pv`.

#### El nombre del cliente sin ficha

> Incorporado el 1/8/2026 por decisión del usuario. Estaba como supuesto 8
> —«la columna Cliente va a decir Consumidor final aunque el operador haya
> escrito el nombre»— y pasa a resolverse dentro de esta funcionalidad: una
> columna nueva que sale mal desde el primer día es peor que no tenerla.

- **FR-100**: `POST /api/sales` DEBE persistir `customer_name` **exista o no**
  `customer_id`. Hoy solo lo guarda cuando hay ficha de cliente
  (`sales.js:164-167`), con lo cual el nombre que escribe el operador en un
  remito o en un recibo X se pierde.
- **FR-101**: El punto de venta DEBE mandar el nombre libre en `customer_name` y
  NO DEBE seguir metiéndolo dentro de `notes` (`Billing.jsx:215`). `notes` queda
  para observaciones, que es para lo que existe.
- **FR-102**: Guardar `customer_name` sin `customer_id` NO DEBE crear una ficha
  de cliente ni habilitar cuenta corriente: son cosas distintas. Sin ficha no
  hay a quién cobrarle después.
- **FR-103**: La columna Cliente DEBE mostrar el nombre de la ficha si la venta
  tiene `customer_id`; si no, `customer_name`; y solo si no hay ninguno de los
  dos, «Consumidor final».
- **FR-104**: La búsqueda DEBE encontrar las ventas por `customer_name`, no solo
  por el nombre de las fichas.
- **FR-105**: Las ventas **ya registradas** con el nombre dentro de `notes` NO se
  migran. Van a seguir mostrando «Consumidor final». Reconstruirlo exigiría
  parsear texto libre y adivinar, que es peor que no hacerlo.

### Key Entities

| Entidad | Campos que importan acá |
|---|---|
| `Sale` | `id`, `date`, `time`, `total`, `payment_method`, `location`, `punto_de_venta_id`, `seller`, `notes`, `customer_id`, `customer_name`, `afip_cae`, `afip_nro`, `afip_vto`, `afip_type`, `afip_pv`, `status`, `voided_at`, `voided_by`, `empresa_id` |
| `Sale` **(nuevo)** | El último error de AFIP (texto) y la fecha del último intento de facturación. Migración aditiva, ambos nulos para todo lo existente. Nombres propuestos, a fijar en el plan: `afip_ultimo_error`, `afip_ultimo_intento` |
| `SaleItem` | `sale_id`, `product_name`, `product_id`, `quantity`, `unit_price`, `payment_method` |
| `PuntoDeVenta` | `id`, `name`, `code`, `is_active`, `empresa_id`. **No tiene `location`** |
| `Customer` | `tax_condition` y CUIT — origen de los datos del receptor al reintentar |
| `Setting` | `tax_condition` (`Monotributo` / `RI` / `Exento`), `afip_pv` |

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

1. Las siete columnas coinciden con la maqueta en orden y ancho, y ningún importe
   aparece bajo la etiqueta «Estado».
2. `InvoicesList.jsx` no contiene ningún valor hexadecimal, ninguna regla
   `dark:`, ni ningún import de `@/components/ui/table`.
3. Los cinco estados producen cinco presentaciones distinguibles a simple vista,
   sin leer el texto del badge. En particular, «Anulada» y «Anulada · vigente
   ante ARCA» no se confunden.
4. Una venta Rechazada pasa a Autorizada en 3 clics o menos, sin salir de la
   pantalla y sin recargarla.
5. Una venta que AFIP rechaza sigue apareciendo como Rechazada después de
   recargar la pantalla: el error sobrevive al cierre de la pestaña. Verificable
   contra hoy, donde se pierde.
6. Reintentar dos veces seguidas la misma venta deja **exactamente un** CAE.
7. Anular una venta con CAE falla desde la API con un error de negocio en
   castellano, y ninguna venta con CAE puede pasar a `voided`. Verificable contra
   hoy, donde se puede.
8. Un reintento que corre contra una anulación concurrente no deja un CAE emitido
   sobre una venta anulada.
9. Un CAE que está en la última página del rango se encuentra buscándolo.
   Verificable contra hoy, donde no se encuentra.
10. Filtrar por una sucursal devuelve solo ventas de esa sucursal. Verificable
    contra hoy, donde el filtro no cambia el resultado.
11. Con una sucursal activa en el encabezado, elegir «Todas las sucursales»
    devuelve ventas de más de una sucursal. Verificable contra hoy, donde no.
12. Un rango de un mes con 3.000 ventas devuelve la primera página en menos de
    1,5 s.
13. Un export de 1.000 comprobantes abre en Excel con los CAE de 14 dígitos
    completos, y la suma de la columna Total coincide con el total del período
    que muestra la pantalla.
14. Un filtro de más de 5.000 comprobantes avisa en vez de intentar la descarga.
15. `npm run test:api`, `npm run test:web` y `npm run build` pasan, y las
    guardias estáticas de aislamiento y observabilidad siguen limpias.
16. Cada criterio de aceptación tiene al menos un test que **falla** si se
    revierte el cambio que lo implementa.

---

## Fuera de alcance

Explícito, para que no se discuta después si estaba incluido:

- **Emitir notas de crédito ante AFIP.** Es el proyecto 1 de
  `docs/PROXIMOS-PROYECTOS.md`. Esta funcionalidad **bloquea** anular con CAE
  justamente porque las notas de crédito todavía no existen.
- **El botón «Columnas»** que la maqueta dibuja (`AdminApp-Rediseno.dc.html:517`).
  Queda para el repaso de coherencia.
- **Cambiar el circuito de emisión del POS.** Esta pantalla reintenta; no factura
  por primera vez.
- **Editar una venta ya registrada** (ítems, importes, fecha).
- **Historial de intentos de facturación.** Se guarda el último, no la serie.
- **Reconstruir hacia atrás qué ventas viejas habían fallado.** Ese dato no
  existe y no se puede inferir.
- **Exportar a CSV o PDF.** Solo `.xlsx`.
- **Export del lado del servidor.** Se arma en el navegador, con el tope de 5.000
  comprobantes como límite explícito.
- **Migrar los datos de Comprafit.** Bloqueado por el acceso al hosting viejo.
- **Rediseñar Inventario, POS, Órdenes de compra, Gastos o Equipo.** Esta spec
  fija el patrón de tabla; cada pantalla lo aplica en su propio hito.
- **Reportes.** Queda oculto para el cliente; el export de esta pantalla no lo
  reemplaza ni lo modifica.
- **Anular, reintentar o imprimir en lote.**
- **Adjuntar el PDF del comprobante o mandarlo por mail/WhatsApp.**
- **Vista mobile en tarjetas** como la del legacy. La pantalla es de escritorio y
  la tabla scrollea horizontal.

---

## Assumptions

Supuestos vigentes. Si alguno resulta falso, cambia el resultado.

1. El aislamiento por empresa se mantiene tal cual: toda consulta nueva filtra
   por `empresa_id` y usa `findScoped` cuando recibe un id del cliente.
2. El total de una venta lo sigue calculando el servidor. Esta pantalla solo lee.
3. Los permisos vigentes alcanzan: `ventas.ver` para mirar y **exportar**,
   `ventas.crear` para reintentar (es el que ya exige el endpoint),
   `ventas.anular` para anular. No se crean permisos nuevos.
4. `POST /api/sales/:id/facturar` conserva su contrato: sigue siendo idempotente
   y sigue devolviendo el mensaje de AFIP tal cual en el 502. Lo que cambia es
   que ahora toma la venta con lock y guarda el error del intento.
5. `PUT /api/sales/:id/void` conserva su contrato para ventas sin CAE: sigue
   restaurando stock. Lo que cambia es que rechaza las ventas con CAE.
6. `Exento` se comporta como `Monotributo` a los efectos del tipo de comprobante
   por defecto (Factura C), que es lo que ya hace el POS: cualquier condición que
   no sea `RI` cae en `afip_c` (`Billing.jsx:70`). Las tres condiciones válidas
   son `Monotributo`, `RI` y `Exento` (`afip.js:27`).
7. Los códigos de AFIP son los que ya usa el POS: Factura A = 1, Factura B = 6,
   Factura C = 11 (`Billing.jsx:234`). La condición de IVA del receptor es 1 para
   Factura A y 5 para B y C (`Billing.jsx:79-80`).
8. **El «nombre libre» del cliente es `Sale.customer_name`.** Hoy ese campo se
   persiste **solo si la venta tiene `customer_id`** (`sales.js:164-170`), y el
   POS guarda el nombre de un cliente sin ficha dentro de `notes`
   (`Billing.jsx:215`). Con lo cual, para esas ventas, la columna Cliente va a
   decir «Consumidor final» y la búsqueda por nombre no las va a encontrar. Se
   asume aceptable en esta funcionalidad; si no lo es, hay que persistir
   `customer_name` sin `customer_id`, y eso toca el POS.
9. La pantalla es visible para el cliente, no solo para superadmin.
10. Los importes se muestran en formato argentino (`1.234,50`) en pantalla. En el
    archivo exportado el Total va como número.
11. La zona horaria de referencia es la de la empresa (`Empresa.timezone`), la
    misma que usa `fechaDelNegocio`.
12. Las ventas anteriores a esta funcionalidad quedan con el error y la fecha de
    intento en nulo, y por lo tanto se muestran como **Registradas** si no tienen
    CAE.
13. El tope de 5.000 comprobantes del export es un límite de la pantalla, no del
    dato: un período más grande se consulta, se ve y se pagina; lo que no se
    puede es bajarlo en un solo archivo. Con página de 25, armar el archivo
    implica recorrer hasta 200 páginas del resultado — el plan decide cómo.
