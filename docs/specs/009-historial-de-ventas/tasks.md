# Tasks: Historial de ventas — pasada fina

**Input**: documentos de diseño en `docs/specs/009-historial-de-ventas/`
(`spec.md`, `plan.md`, `data-model.md`, `contracts/api-endpoints.md`)

Treinta y una tareas en nueve fases, más cinco de la fase 10 —los cuatro
incumplimientos que encontró `sdd-verify`, agregadas después de la verificación—.
El orden sale de «Orden de construcción» del plan y no es arbitrario: nada de la
pantalla se puede escribir antes de que la API tenga contra qué contestar.

`[P]` marca las que se pueden hacer en paralelo porque tocan archivos distintos.

---

## Antes de empezar: tres cosas que no son tareas

**1. Cómo se verifica, en tres niveles.** El plan lo relevó y hay que respetarlo:
**no existe infraestructura para probar una ruta contra Postgres.** Los dobles de
`apps/api/src/tests/helpers/modelosFalsos.js` no entienden `Op.between`, ni
`Op.iLike`, ni `include`, ni `lock`. Un test de ruta escrito sobre esos dobles
probaría el doble, no el sistema.

| Nivel | Qué cubre | Dónde |
|---|---|---|
| Test unitario, jest/vitest | Lo que se extrae a `utils/` porque es una función pura: los cinco estados, el armador del `where`, el armador de la hoja del export, el recorte del nombre del cliente | `tests/*.test.js` (api) · `utils/*.test.js` (web) |
| Guardia estática | Que el archivo no tenga hex, ni `dark:`, ni `<table>`, ni `findByPk` | `tests/guardiasDeDiseno.test.js` (web) · las de aislamiento y observabilidad que ya existen |
| Paso manual reproducible | Todo lo que solo aparece contra Postgres real: `DECIMAL` como string, orden estable entre páginas, el lock, el tiempo de la primera página, el `.xlsx` abierto en Excel | Sección final de este archivo, para `sdd-verify` |

**Ninguna tarea de acá abajo pide un test de integración**, y ninguna llama
«test» a algo que en realidad se mira a mano.

**2. Lo que ya está y no lleva tarea.**

- `server.js:339` ya monta `app.use('/api/sales', ...authEmpresa, require('./routes/sales'))`.
  **No hay router nuevo que montar**: `/export` y `/:id` cuelgan del router que
  ya está montado. Lo que sí hay que respetar es el **orden de declaración
  dentro de `sales.js`** — es la verificación de T907.
- `navegacion.js:23` ya tiene «Historial de ventas» apuntando a `/ventas` con
  permiso `ventas.ver`. **No hay ítem de menú que agregar.**
- `models/index.js` ya registra `Sale` y ya declara las dos asociaciones que
  necesitan las consultas nuevas: `Sale.belongsTo(Customer, { as: 'customer' })`
  (`:79`) y `Sale.belongsTo(PuntoDeVenta, { as: 'puntoDeVenta' })` (`:122`).
  **No hay modelo nuevo que registrar.**
- `PROXIMOS-PROYECTOS.md` ya tiene anotados «5b · Punto de venta de AFIP por
  sucursal» y «5c · Tests de integración contra una base real». **No hay que
  volver a anotarlos.**
- No van gates de superadmin en ningún lado: la pantalla es visible para el
  cliente (supuesto 9) y los permisos vigentes alcanzan (supuesto 3).

**3. Un hueco que el plan no vio, y que bloquea FR-073.** Está marcado ⚠ en T905
y en T924. Leerlo antes de empezar la fase 2, porque cambia el contrato.

---

## Phase 1: Base de datos y los cinco estados

**Purpose**: la base guarda por qué falló un intento de facturación, y hay un
solo lugar donde se decide cuál de los cinco estados es una venta. Nada visible
todavía.

- [x] **T901** Crear `apps/api/src/migrations/20260803-intentos-de-facturacion.js`:
      `addColumn('sales', 'afip_ultimo_error', TEXT null)`,
      `addColumn('sales', 'afip_ultimo_intento', DATE null)` y
      `addIndex('sales', ['empresa_id','date'], { name: 'sales_empresa_date_idx' })`,
      con su `down` en orden inverso. Aditiva: ninguna fila existente se toca.
      **Verificación**: `npm --prefix apps/api run db:migrate` corre limpio contra
      la base de desarrollo; `\d sales` muestra las dos columnas nulables y el
      índice; `SELECT count(*) FROM sales WHERE afip_ultimo_error IS NOT NULL` da
      0; el `down` deja la tabla como estaba. Sin `addConstraint`, así que la
      trampa de `{ model, key }` no aplica.

- [x] **T902** Sumar a `apps/api/src/models/Sale.js` los dos campos
      (`afip_ultimo_error: TEXT`, `afip_ultimo_intento: DATE`, ambos
      `allowNull: true`) y el índice compuesto
      `{ name: 'sales_empresa_date_idx', fields: ['empresa_id','date'] }`. Los
      índices sueltos de `date` y `empresa_id` (`Sale.js:115-122`) **se dejan**:
      sacarlos es una migración destructiva sobre una tabla caliente.
      **Verificación**: `npm run test:api` con `asociaciones.test.js` en verde; el
      modelo declara exactamente las columnas que creó T901 (si el nombre o el
      tipo no coinciden, Sequelize consulta una columna que no existe y el
      listado tira en runtime, no en build).

- [x] **T903** Crear `apps/api/src/utils/estadoVenta.js` — función pura que
      recibe `{ status, afip_cae, afip_ultimo_error }` y devuelve
      `{ codigo, etiqueta }` con los cinco códigos
      (`autorizada | registrada | rechazada | anulada | anulada_con_cae`). Sin
      colores: el significado va en el servidor, el color en el frontend
      (decisión 2). Test en `apps/api/src/tests/estadoVenta.test.js`.
      **Verificación**: el test cubre los cinco casos de la tabla de
      `data-model.md` y **dos casos de precedencia que fallan si se invierte el
      orden de las comparaciones**: `voided` + CAE da `anulada_con_cae` y no
      `autorizada`; `active` + CAE + error viejo guardado da `autorizada` y no
      `rechazada`. Sin ese segundo test, una venta que falló y después se facturó
      bien se muestra Rechazada para siempre y nada lo detecta.

**Checkpoint**: la migración corre y revierte; `estadoVenta.js` clasifica las
cinco combinaciones con la precedencia probada. `npm run test:api` pasa.

---

## Phase 2: API de lectura

**Purpose**: el listado se puede filtrar, buscar y paginar contra la base de
desarrollo con `curl`, sin tocar una línea de la pantalla.

- [x] **T904** Crear `apps/api/src/utils/filtroVentas.js` — función pura
      `query → { where, order, limit, offset, rango }` con `desde`/`hasta`,
      `punto_de_venta_id` (incluido `todas`), `tipo` (`1|6|11|sin_cae`), `q`,
      `customer_id`, el alias de compatibilidad `date` y `location` solo si no
      vino `punto_de_venta_id`. Orden fijo `date DESC, time DESC, id DESC`. Tira
      `ErrorDeNegocio` con `RANGO_INVERTIDO` y `RANGO_DEMASIADO_LARGO`. Test en
      `apps/api/src/tests/filtroVentas.test.js`.
      **Verificación**: el test cubre rango invertido, rango de más de un año,
      `todas` (que **no** agrega condición de sucursal ni aunque venga la
      cabecera), `sin_cae` → `afip_type IS NULL`, `q` con dígitos → incluye
      `afip_nro = <dígitos>` descartando separadores (`0005-00014882` busca
      `14882`), `q` sin dígitos → solo los tres `iLike`, y el tercer criterio de
      orden. Un test explícito verifica que **la función NO agrega `empresa_id`**
      — lo pone la ruta, y esa separación es la decisión 4.

- [x] **T905** Reescribir `GET /api/sales` en `apps/api/src/routes/sales.js`
      usando `filtroVentas` + `scoped(where, req.empresaId)`, con `include` de
      `Customer` (`as: 'customer'`, `required: false`) y **sin** el `include` de
      `SaleItem` (decisión 5), `limit` 25 por defecto acotado a 100,
      `total_periodo` con `parseFloat(await Sale.sum('total', { where }))`,
      `rango` aplicado y `estado` derivado con `estadoVenta` en cada fila. La
      query manda sobre `X-Punto-De-Venta-Id` (FR-072): la cabecera solo se usa
      si no vino el parámetro. Sumar `Customer` y `PuntoDeVenta` al `require` de
      `../models`, que hoy no los trae (`sales.js:3`).
      ⚠ **Además**, devolver `sucursales: [{ id, name, is_active }]` con las
      sucursales presentes en el resultado filtrado. **Esto extiende el contrato**
      y hay que anotarlo en `contracts/api-endpoints.md` en la misma tarea: sin
      eso FR-073 no se puede cumplir (ver la nota de T924).
      **Verificación**: `curl` con y sin filtros contra la base de desarrollo
      devuelve `data`, `total`, `total_periodo`, `page`, `totalPages`, `rango` y
      `sucursales`; `data[].items` **ya no viene**; `total_periodo` es número y no
      string; una venta de otra empresa no aparece con ningún juego de
      parámetros; `aislamientoEmpresas.test.js` y `observabilidad.test.js` siguen
      limpias sin sumar excepciones. El orden estable y el `DECIMAL` quedan como
      pasos manuales (ver el final).

- [x] **T906** Agregar `GET /api/sales/:id` en `sales.js` con
      `findScoped(Sale, req.params.id, req.empresaId, { include: [items, customer,
      puntoDeVenta] })`, devolviendo también `afip_ultimo_error`,
      `afip_ultimo_intento` y `estado`. 404 con «Venta no encontrada» cuando no
      existe **o es de otra empresa**, sin distinguir los dos casos.
      **Verificación**: `curl` del id de una venta propia devuelve los `items` y
      `customer`/`puntoDeVenta` en `null` cuando no los tiene; el id de una venta
      de otra empresa devuelve 404 y **no** 403 (un 403 confirmaría que el id
      existe en otro cliente); `aislamientoEmpresas.test.js` sigue limpia porque
      no se usó `findByPk`.

- [x] **T907** Agregar `GET /api/sales/export` en `sales.js`, **declarado antes
      que `GET /:id`**, con los mismos filtros del listado menos `page`/`limit`,
      `COUNT` previo con tope duro de 5.000 → `400 LIMITE_EXPORT_SUPERADO` con
      `{ total, limite: 5000 }` y ni una fila, y `attributes` acotados a lo que
      arman las diez claves de FR-092 en orden.
      **Verificación**: `curl /api/sales/export` devuelve las diez claves
      (`fecha … total`) con `total` como **número**; con un filtro de más de 5.000
      devuelve el 400 sin traer filas; y —la verificación que importa— **pedir
      `/api/sales/export` no devuelve 404**: si `:id` quedó declarado antes, `:id`
      se come `"export"`. Es el error más fácil de cometer en este cambio.

**Checkpoint**: con `curl` se puede listar un rango de tres días, filtrar por
sucursal y tipo, buscar un CAE, pedir el detalle de una venta y bajar el
resultado completo del export. La pantalla todavía es la vieja.

---

## Phase 3: API de escritura

**Purpose**: reintentar es seguro, anular con CAE es imposible desde cualquier
cliente, y el nombre libre del cliente deja de perderse. Los tres cambian
comportamiento sin depender de la pantalla.

- [x] **T908** Reescribir `POST /api/sales/:id/facturar` en `sales.js` con el
      patrón de `/void`: transacción, `findScoped` con `lock: t.LOCK.UPDATE` y
      **sin `include`** (con `include`, Sequelize arma un `LEFT OUTER JOIN … FOR
      UPDATE` que Postgres rechaza — el comentario de `sales.js:268-273` lo
      explica), revalidación de `status` y `afip_cae` **dentro** de la
      transacción, la llamada a AFIP con la transacción abierta, y el `try`
      cerrado **solo alrededor de `afipService.createVoucher`** (decisión 10).
      En el fallo de AFIP: `rollback` y después un `UPDATE` propio de
      `afip_ultimo_error` + `afip_ultimo_intento` condicionado a
      `id = ? AND empresa_id = ? AND afip_cae IS NULL`. En el éxito:
      `afip_ultimo_error = null`, `afip_ultimo_intento = ahora` y commit.
      **Verificación**: leyendo el diff, el `catch` ancho de hoy
      (`sales.js:431-442`) ya no devuelve `err.message` de cualquier origen — un
      fallo del `sale.update` sale por `fallo(req, res, err, …)` como 500 con
      `requestId`, no como 502 con nombres de tabla; `observabilidad.test.js`
      sigue limpia. Que el lock haga su trabajo son dos pasos manuales (criterios
      6 y 8), anotados al final: probarlo con los dobles sería probar el doble.

- [x] **T909** Hacer que `POST /api/sales/:id/facturar` resuelva por sí mismo
      `type`, `customerCuit`, `customerVatCondition` y `pv` cuando el body no los
      trae: tipo desde `settings.tax_condition` (`RI` → 6, `Monotributo` y
      `Exento` → 11), CUIT y condición de IVA desde la ficha del cliente de la
      venta o consumidor final (DocTipo 99, condición 5) si no hay, y punto de
      venta `sale.afip_pv → settings.afip_pv`. Lo que venga en el body sigue
      mandando.
      **Verificación**: un `curl` con **body vacío** sobre una venta activa sin
      CAE emite el comprobante que corresponde a la condición fiscal de la
      empresa; `Billing.jsx` sigue mandando los cuatro campos y **no cambia**
      (supuesto 4). La regla de `pv` queda escrita en un solo lugar con la forma
      que pide FR-044 aunque hoy colapse siempre en `settings.afip_pv`: no se
      agrega `afip_pv` a `puntos_de_venta` — sería una columna que ninguna
      pantalla puede completar (ver `plan.md`, «Lo que la spec pide y no se puede
      construir»).

- [x] **T910** En `PUT /api/sales/:id/void` (`sales.js:262`), después de tomar la
      venta con lock y **antes** de tocar el stock, tirar `ErrorDeNegocio` si
      `sale.afip_cae` está presente, con el mensaje de
      `contracts/api-endpoints.md` (el comprobante sigue vigente ante ARCA y hace
      falta una nota de crédito, que el sistema todavía no emite).
      **Verificación**: `curl -X PUT` sobre una venta con CAE devuelve 400 con ese
      mensaje en castellano y la venta **sigue** en `active` con su stock intacto;
      sobre una venta sin CAE anula y restaura stock exactamente como hoy
      (FR-058). El bloqueo tiene que estar acá y no solo en la pantalla: sin él,
      un `curl` sigue pudiendo anular (FR-057).

- [x] **T911** Persistir `customer_name` en `POST /api/sales` exista o no
      `customer_id` (`sales.js:164-170`), con el recorte y el `trim` que pide el
      riesgo 7. Extraer la normalización a
      `normalizarNombreDeCliente(customer_name)` en
      `apps/api/src/utils/calculosVenta.js` —junto a `verificarTotal`,
      `normalizarItem` y `metodoDePago`, que ya viven ahí— y testearla en
      `apps/api/src/tests/calculosVenta.test.js`. `is_credit` **queda atado a
      `customer_id`**: un nombre libre sin ficha no puede generar cuenta
      corriente, porque sería una deuda sin deudor (FR-102).
      **Verificación**: el test cubre el nombre de 300 caracteres (queda en 255 y
      el `INSERT` no falla — un error de tipeo no puede tumbar un cobro), el
      nombre con espacios de sobra, y el string vacío → `null`. En el diff se
      lee que el recálculo del total, el descuento de stock y los movimientos
      quedaron intactos. Que un nombre libre sin ficha **no** genere cuenta
      corriente es paso manual (riesgo 8, anotado al final).

- [x] **T912** En `apps/web/src/pages/Billing.jsx`, mandar el nombre libre en
      `customer_name` y dejar de meterlo dentro de `notes` (`Billing.jsx:215`):
      `notes` pasa a ser `''`, `'REMITO'` o `'RECIBO X'`, que es para lo que
      existe (FR-101).
      **Verificación**: una venta nueva sin ficha de cliente guarda el nombre en
      `sales.customer_name` y `notes` no lo contiene; `printInvoice` arma el
      `typeStr` con `notes.split('-')[0].trim()` y con `'REMITO'` sigue
      devolviendo lo mismo. Las ventas **ya registradas** conservan el
      `"… - Cliente: X"` viejo y **no se migran** (FR-105): van a imprimir
      «Consumidor Final», y es la consecuencia aceptada del riesgo 6.

**Checkpoint**: se puede reintentar una venta desde `curl` con body vacío, anular
una venta con CAE falla con un mensaje en castellano, y una venta nueva sin ficha
guarda el nombre donde corresponde. La API está terminada.

---

## Phase 4: El patrón de tabla y el listado

**Purpose**: la pantalla queda como la maqueta y **queda fijado el patrón que van
a copiar las otras cinco pantallas**.

- [x] **T913** [P] Actualizar `apps/web/src/services/api.js`: `getSales` pasa de
      cuatro posicionales `(date, location, page, limit)` a un objeto
      (`api.get('/sales', { params })`), y se suman
      `getSale = (id) => api.get('/sales/' + id)` y
      `exportSales = (params) => api.get('/sales/export', { params })`. Dejar
      escrito en el comentario de `getSales` que **el listado ya no trae
      `items`** y que los ítems salen de `getSale`.
      **Verificación**: `npm run build` pasa; ningún archivo importa `getSales`
      hoy (`services/api.js:148` está exportado y nadie lo usa), así que el cambio
      de firma no rompe nada. El comentario es la mitigación del riesgo 5: un
      import que aparezca después encuentra el aviso, porque `build` no lo ve y
      un `sale.items.map` sobre el listado tira recién en runtime.

- [x] **T914** [P] **Crear `apps/web/src/components/TablaGrid.jsx` — solo el
      marco.** Cuatro piezas: `TablaGrid` (contenedor con `overflow-x-auto` y
      ancho mínimo interno), `Encabezado`, `Fila` y `BotonDeFila`. Reciben las
      `gridTemplateColumns` como string y renderizan `children`. **No hay
      configuración de columnas, ni renderers, ni objetos de definición**: cada
      pantalla escribe sus celdas como JSX.
      **Verificación**: el componente fija las medidas literales que ninguna de
      las seis pantallas puede escribir distinto —encabezado `surface-2` con
      `.eyebrow` y padding `11px 20px`, filas `15px 20px` con
      `border-b border-border`, hover a `surface-2` con `cursor-pointer`, botones
      de 29px `rounded-lg` en `fg-3` que pasan a `surface-3`/`foreground`— y
      **ninguna** de las cosas que cambian por pantalla. Cero hex, cero `dark:`.
      Es **la tarea que fija el patrón**: si acá entra un prop de columnas, para
      la sexta pantalla el componente tiene dieciocho props y nadie se anima a
      tocarlo.

- [x] **T915** [P] Crear `apps/web/src/utils/estadoVenta.js` — mapa
      `codigo → { texto, fondo, linea, icono }` con los cinco tríos de tokens de
      `data-model.md`, **y el ícono `Ban` de lucide en `anulada`**, que toma el
      color del estado como cualquier ícono del sistema
      (`REGLAS-DISENO.md`, «Íconos»). Test en
      `apps/web/src/utils/estadoVenta.test.js`.
      **Verificación**: el test comprueba los cinco códigos, que ningún valor sea
      hexadecimal, y que `anulada` sea el único con ícono. **Esto cierra el riesgo
      4 del plan**: «Registrada» y «Anulada» comparten fondo (`surface-3`) y borde
      (`border`) y solo cambian el gris del texto; en la fila alcanza porque
      Anulada va al 55 % de opacidad, pero mirando el badge aislado no se
      distinguen sin leer. El ícono cambia la forma sin tocar la paleta, y el
      criterio de éxito 3 pasa a verificarse a nivel de badge y no solo de fila.

- [x] **T916** Reescribir la tabla de `apps/web/src/pages/InvoicesList.jsx` sobre
      `TablaGrid`: siete columnas
      `80px 116px 132px minmax(0,1fr) 116px 128px 128px` con `gap: 0 16px`,
      idénticas en encabezado y filas; `Hora · Tipo · Comprobante · Cliente ·
      Estado · Total · Acciones`; `.num` en hora, número, CAE y total; badges de
      tipo y de estado; fila anulada al 55 %; «—» + identificador corto en las
      ventas sin comprobante fiscal; Cliente = ficha → `customer_name` →
      «Consumidor final»; los dos estados vacíos distintos; encabezado de pantalla
      con **un solo** botón principal («Nueva venta») y «Exportar» como
      secundario; total del período con la etiqueta «(incluye anuladas)»; pie
      «Mostrando N de M comprobantes» con 25 por página. Sacar Sucursal de la
      tabla: queda como filtro y como dato del panel.
      **Verificación**: la columna Estado muestra el badge y la columna Total el
      importe —**ninguna fila muestra un importe bajo la etiqueta «Estado»**, que
      es el defecto 2 del relevamiento (`InvoicesList.jsx:199-205` contra
      `:240-247`)—; no queda ningún `<table>` ni ningún `Table*` de shadcn ni el
      import de `@/components/ui/table`; no queda ningún `sale.id.split('-')[0]`
      en el lugar del número de comprobante; achicando la ventana la tabla
      scrollea dentro de su tarjeta y el body **no**; comparación visual contra
      el bloque `isVentas` de `docs/maqueta/AdminApp-Rediseno.dc.html:491-556`.
      El `min-width: 1140px` de la maqueta **no** se copia al contenedor de la
      página.

- [x] **T917** Arreglar la impresión en `InvoicesList.jsx`: `handlePrint`
      (`:74`) usa hoy `sale.items`, que el listado ya no trae — pasa a pedir
      `getSale(id)` antes de imprimir. Y el nombre del cliente deja de salir de
      parsear `notes` buscando `'Cliente:'` (`:78`): sale de
      `customer?.name || customer_name`.
      **Verificación**: imprimir desde una fila abre el comprobante con sus
      ítems; imprimir una venta **vieja** (con el nombre adentro de `notes`)
      imprime «Consumidor Final», que es la consecuencia aceptada de FR-105.
      Es una impresión por vez, así que el viaje extra no se nota. **Esta tarea
      va acá y no con el panel**: el botón de imprimir de la fila se rompe en el
      momento en que el listado deja de traer ítems, que es T905.

**Checkpoint**: la pantalla se ve como la maqueta, las cinco presentaciones de
estado se distinguen sin leer, la paginación y el total del período andan, y se
puede imprimir. Todavía no hay panel, ni filtros nuevos, ni export.

---

## Phase 5: El panel lateral

**Purpose**: se puede abrir el detalle de un comprobante sin perder la lista.

- [x] **T918** Crear `apps/web/src/components/PanelVenta.jsx` sobre `Sheet` /
      `SheetContent` de `@/components/ui/sheet`, pisando el `sm:max-w-sm` y el
      `shadow-lg` que trae por defecto con
      `w-[520px] max-w-[92vw] shadow-nivel-3 anim-panel`, y engancharlo al clic
      de la fila en `InvoicesList.jsx`. Contenido: kicker «Comprobante», el
      número como título, `tipo · fecha y hora · sucursal` como subtítulo;
      Cliente, CUIT/DNI, Condición IVA, Medio de pago, Sucursal, CAE con
      vencimiento y Estado; tabla de ítems `Detalle · Cant. · Unitario ·
      Subtotal` con el total abajo y todo lo numérico en mono; el aviso de AFIP
      guardado con su fecha cuando el estado es `rechazada`; y la explicación de
      que el comprobante sigue vigente ante ARCA cuando es `anulada_con_cae`.
      **Verificación**: los botones de acción de la fila **detienen la
      propagación** y no abren el panel; `Esc`, el clic en el overlay y el botón
      de cerrar cierran; al cerrar, el listado conserva página, filtros, orden y
      scroll —no se recarga—; una venta sin ítems **dice que no hay detalle** en
      vez de dibujar una tabla vacía; `prefers-reduced-motion` desactiva
      `anim-panel`. Esta es la primera pantalla que usa `anim-panel` y
      `shadow-nivel-3` (`index.css:211-262`).

- [x] **T919** Corregir «Verificar en AFIP» para que consulte con el `afip_pv`
      **de la venta** y caiga a `settings.afip_pv` **solo** si la venta no lo
      tiene (`InvoicesList.jsx:105` usa siempre el configurado hoy).
      **Verificación**: una venta con `afip_pv = 5` consulta con 5 aunque
      `settings.afip_pv` diga otra cosa; una venta anterior a la migración
      `20260731-guardar-punto-de-venta-afip` (con `afip_pv` en `null`) sigue
      cayendo a `settings.afip_pv`. Es la única de las dos reglas de punto de
      venta que se puede construir completa, porque acá el dato existe.

- [x] **T920** Mostrar «Anular venta» en el pie del panel **deshabilitada con la
      explicación** sobre una venta con CAE, no ausente (FR-056), y manejar el
      400 de T910 mostrando su mensaje. Sobre ventas anuladas (D o E) no aparece
      ni anulación ni reintento.
      **Verificación**: ausente dejaría al usuario sin entender por qué en unas
      filas está y en otras no; deshabilitada con el motivo, lo entiende. El
      bloqueo real sigue estando en la API (T910): la pantalla es la cortesía, no
      la barrera.

**Checkpoint**: clic en una fila de cada uno de los cinco estados muestra el
detalle correcto, con las acciones correctas, y al cerrar la lista quedó igual.

---

## Phase 6: Reintentar la facturación

**Purpose**: una venta Rechazada pasa a Autorizada en tres clics, sin salir de la
pantalla.

- [x] **T921** Agregar «Reintentar facturación» como acción principal del pie del
      panel, llamando a `POST /api/sales/:id/facturar` con **body vacío**. Se
      ofrece solo si `afip_cae` es `null`, `status === 'active'` y el usuario
      tiene `ventas.crear` (`Can` / `usePermission`). Mientras el pedido está en
      vuelo el botón queda deshabilitado y lo muestra. Al volver, la fila y el
      panel se actualizan con lo que devolvió la API.
      **Verificación**: un segundo clic durante el pedido **no** dispara un
      segundo pedido; después del éxito la fila pasa a Autorizada con número y
      CAE y el aviso desaparece, **sin recargar la pantalla ni perder los
      filtros**; el botón no se ofrece sobre una venta que ya tiene CAE —la
      respuesta idempotente `yaFacturada` queda como red de seguridad, no como
      camino normal (FR-051)—; una venta Registrada (sin error guardado) también
      lo ofrece, porque una venta interna también se puede facturar después.

- [x] **T922** Manejar en el panel los dos errores que tienen camino propio:
      `400 CUIT_REQUERIDO` → pedir el CUIT y reintentar **en el mismo paso**,
      mandando solo `customerCuit`; `502` → mostrar el mensaje de AFIP **tal
      cual**, dejar la venta como Rechazada y volver a habilitar el botón.
      **Verificación**: el `CUIT_REQUERIDO` no se muestra como error crudo sino
      como un campo que se completa; después de un 502 la venta sigue Rechazada
      **al recargar la pantalla** —el error sobrevive al cierre de la pestaña,
      que es el criterio de éxito 5 y lo que hoy se pierde—; el stock sigue
      descontado; y ante un timeout, lo que se ve al volver a la pantalla es el
      estado de la base y nunca el que quedó en el navegador.

**Checkpoint**: una venta sin CAE se factura desde la pantalla, un rechazo queda
guardado y visible después de recargar, y un CUIT faltante se resuelve sin salir
del panel.

---

## Phase 7: Filtros y búsqueda

**Purpose**: se puede responder «cuánto facturó Ortiz la semana pasada» sin abrir
siete días de a uno.

- [x] **T923** Reemplazar el campo de fecha única de `InvoicesList.jsx:39` por un
      rango desde/hasta, inicializado con el `rango` que devolvió la API —**no**
      con `new Date().toISOString().split('T')[0]`—, y validar antes de consultar:
      rango invertido y rango de más de un año avisan y **no consultan**.
      **Verificación**: después de las 21:00 en Argentina (UTC−3), una venta
      recién cobrada **aparece en su propio listado** — con `toISOString()` no
      aparece, porque «hoy» pasa a ser mañana; es el mismo bug que `fechas.js`
      resolvió del lado del servidor. El listado sale ordenado por fecha y hora
      descendente, lo más nuevo arriba.

- [x] **T924** Reescribir el filtro de sucursal para que mande
      `punto_de_venta_id` (no `pv.location`), con «Todas las sucursales» y con las
      sucursales inactivas presentes en el resultado marcadas «(inactiva)». El
      valor inicial sale del selector del encabezado, pero **el filtro de la
      pantalla manda sobre él**.
      **Verificación**: elegir una sucursal cambia el resultado —hoy no lo cambia:
      `InvoicesList.jsx:36` arma las opciones con `pv.location` y `PuntoDeVenta`
      **no tiene** columna `location`, así que el valor viaja `undefined` y nunca
      coincide con nada, que es el defecto 1—; con una sucursal activa en el
      encabezado, elegir «Todas» devuelve ventas de más de una sucursal; las
      ventas viejas con `punto_de_venta_id` en `null` no desaparecen con «Todas»;
      una empresa sin ningún punto de venta no rompe.
      ⚠ **Depende de la extensión de contrato de T905.** El único origen de
      sucursales del frontend es `empresaActiva.puntosDeVenta`, y la API lo filtra
      con `is_active: true` en los tres lugares donde lo arma
      (`empresas.js:195`, `:220`, `:371`), igual que
      `GET /:empresaId/puntos-de-venta` (`:561`). Con los contratos como estaban
      escritos, la pantalla recibe un `punto_de_venta_id` que **no puede nombrar**
      y FR-073 no se puede cumplir. Por eso T905 devuelve `sucursales` con las del
      resultado.

- [x] **T925** Agregar el filtro de tipo de comprobante con las cuatro opciones
      —Factura A, Factura B, Factura C y «Sin comprobante fiscal»— mandando
      `tipo` a la API, y hacer que **cambiar cualquier filtro vuelva a la página
      1**.
      **Verificación**: «Sin comprobante fiscal» devuelve solo las de
      `afip_type IS NULL`; estando en la página 5, aplicar un filtro cuyo
      resultado tiene 2 páginas deja la pantalla en la 1 y no en una página que
      no existe; el contador «de M» y el total del período de arriba corresponden
      al resultado **filtrado** y no al total del día.

- [x] **T926** Mover la búsqueda al servidor: sacar `filteredSales`
      (`InvoicesList.jsx:134`) y mandar `q`, con el mensaje de vacío que dice que
      no hay resultados **con esos filtros** y ofrece limpiarlos.
      **Verificación**: **un CAE que está en la página 4 del rango se encuentra**
      —hoy `filteredSales` filtra sobre las 20 filas que ya están en memoria, así
      que no aparece y la pantalla dice «no hay ventas», que es el defecto 3—; la
      búsqueda encuentra por número de comprobante, por CAE, por nombre de ficha y
      por `customer_name` (FR-104); «Vega» y «vega» dan lo mismo. **«Perez» no
      encuentra «Pérez»**: es el riesgo 2 del plan, queda fuera a propósito, y
      `unaccent` es una decisión aparte.

**Checkpoint**: cualquier combinación de rango, sucursal, tipo y búsqueda
devuelve exactamente lo que corresponde, con el contador y el total del pie
coherentes. Los tres defectos del relevamiento están cerrados.

---

## Phase 8: Exportar

**Purpose**: el listado que se está viendo se baja en `.xlsx` y se le manda al
contador.

- [x] **T927** Crear `apps/web/src/utils/exportarVentas.js` — función pura
      `filas → hoja xlsx` que escribe el CAE como celda de **texto** explícita
      (`t: 's'`, `z: '@'`) y el total como **número** (`Number()` sobre el string
      que devuelve `DECIMAL`), con las diez columnas de FR-092 en orden, y arma
      el nombre del archivo con período y sucursal. Test en
      `apps/web/src/utils/exportarVentas.test.js`.
      **Verificación**: el test comprueba que un CAE de 14 dígitos queda como
      `'75412339018264'` y no como número, que el total es `number` y no
      `string`, y las diez claves en orden. **No** se usa
      `XLSX.utils.json_to_sheet` con inferencia, que es lo que hacen
      `Comparador.jsx:114` y `Faltantes.jsx:137`: los dos casos de esta pantalla
      son justo los que la inferencia arruina —el CAE se vuelve `7,54123E+13` y
      el total deja de sumar—, y ninguna de las dos cosas rompe nada visible: el
      archivo abre, se ve bien, y está mal. Que Excel lo abra bien es paso
      manual (riesgo 9).

- [x] **T928** Enganchar el botón «Exportar» del encabezado de
      `InvoicesList.jsx`: pide `exportSales(params)` con los filtros vigentes y
      arma el archivo con `exportarVentas`. Los dos avisos se dan **antes** de
      pedir nada, comparando contra el `total` que ya trajo el listado: más de
      5.000 comprobantes → avisar y pedir acotar; cero resultados → avisar y no
      descargar un archivo vacío. Requiere `ventas.ver`.
      **Verificación**: el archivo trae **todo el resultado filtrado** y no las 25
      filas de la página visible; están las anuladas y las no fiscales, cada una
      con su estado; la suma de la columna Total coincide con el total del período
      de la pantalla —por eso ese total incluye las anuladas (decisión 6)—; dos
      exportaciones con filtros distintos no se pisan en la carpeta de descargas;
      un usuario con `ventas.ver` puede exportar.

**Checkpoint**: se filtra por un rango y una sucursal, se exporta, y el `.xlsx`
coincide fila por fila con la pantalla. La funcionalidad está completa.

---

## Phase 9: Guardias y documentación

**Purpose**: el patrón no se puede repetir mal, y quien opera se entera de lo que
cambió para él.

- [x] **T929** Crear `apps/web/src/tests/guardiasDeDiseno.test.js` — guardia
      estática con la forma de `aislamientoEmpresas.test.js`: lee
      `InvoicesList.jsx`, `TablaGrid.jsx` y `PanelVenta.jsx` como texto y falla si
      aparece un valor hexadecimal, una regla `dark:`, un `<table` o un import de
      `@/components/ui/table`.
      **Verificación**: el test **falla** si se le agrega a mano un `#fff` o un
      `dark:bg-…` a cualquiera de los tres archivos, y pasa con los archivos como
      quedaron. Es grosero a propósito, igual que las guardias que ya existen: lo
      que se busca es que el error sea visible en la revisión. La carpeta nueva
      `src/tests/` es para que las otras cinco pantallas se sumen a la misma
      guardia cuando apliquen el patrón.

- [x] **T930** [P] Actualizar `docs/REGLAS-DISENO.md`: la sección «Tabla»
      (`:255-277`) pasa a apuntar a `apps/web/src/components/TablaGrid.jsx`
      además de a `Comparador.jsx`, con el ejemplo de las cuatro piezas y la
      línea de qué se comparte y qué escribe cada pantalla.
      **Verificación**: alguien que va a rediseñar Inventario lee «Tabla» y sabe
      que las medidas salen del componente y que las columnas las escribe él. Sin
      esto, la próxima pantalla copia a mano `15px 20px` y alguna queda en
      `py-3.5`, y nada lo detectaría porque no hay test visual.

- [x] **T931** [P] Actualizar `docs/OPERACION.md` con lo único que cambia para
      quien opera: sumar `20260803-intentos-de-facturacion` a «Migraciones
      pendientes de correr» (`:247`, aditiva, sin `UPDATE` de histórico —las dos
      columnas quedan en `NULL` y toda venta activa sin CAE anterior se muestra
      como «Registrada»); reescribir «Una venta quedó sin comprobante» (`:104`)
      para decir que ahora hay un botón en el Historial de ventas y que el
      `curl` queda como salida de emergencia; y reescribir «Se anuló una venta
      que ya tenía CAE» (`:119`) para decir que **de acá en adelante la API lo
      rechaza**, que las que hay son histórico, y que
      `GET /api/taxes/monotributo → anuladas_con_cae_sin_nc` sigue siendo la forma
      de contarlas.
      **Verificación**: quien atiende un «no puedo facturar» encuentra el botón
      antes que el `curl`, y quien busca por qué no puede anular encuentra el
      motivo y no un bug.

**Checkpoint**: `npm run test:api`, `npm run test:web` y `npm run build` pasan;
las guardias de aislamiento y observabilidad siguen limpias sin excepciones
nuevas; y la documentación dice lo que cambió.

---

## Phase 10: Los cuatro incumplimientos que encontró `sdd-verify`

**Purpose**: cerrar lo que la verificación encontró. Tres son código y uno es la
spec diciendo algo que el sistema no puede hacer. El hallazgo transversal es el
tercero: diez mutaciones que revertían requisitos concretos y **las 684 pruebas
seguían pasando**.

- [x] **T932** Corregir el error fiscal de la condición de IVA del receptor
      (hallazgo 2). `resolverComprobante` (`sales.js`) consultaba la ficha del
      cliente pidiendo solo `['id', 'tax_id']` y derivaba la condición del TIPO
      de comprobante: una venta a un Responsable Inscripto se declaraba ante ARCA
      como **Consumidor Final con el CUIT del RI adjunto**. Ahora la ficha se lee
      con `tax_condition` y la condición sale de ahí. Orden: `body` → ficha →
      regla vieja por tipo, que queda como respaldo para las ventas sin ficha.
      El mapeo texto → código de ARCA se extrajo a
      `apps/api/src/utils/condicionIvaAfip.js` como función pura, y devuelve
      `null` ante un valor desconocido para poder caer al respaldo en vez de
      inventar un 5.
      **Tests**: `tests/condicionIvaAfip.test.js` (cada valor, las tres formas de
      escribirlo, y lo desconocido) y las cuatro guardias de
      `tests/rutasDeVentas.test.js` que fijan que la ruta lea `tax_condition`,
      use el mapeo, deje la regla vieja después y lea la ficha acotada por
      empresa.
      **Verificación**: leer `tax_condition` de nuevo sin ella, o traducir `ri`
      como consumidor final, o devolver 5 ante lo desconocido, hace fallar tests.

- [x] **T933** Corregir el supuesto 7 de `spec.md`, que decía que la condición de
      IVA es «1 para Factura A y 5 para B y C» y contradecía a FR-043 y al
      AC 3.4. Mandan los criterios de aceptación: el supuesto ahora describe el
      mapeo desde la ficha y deja la regla por tipo como respaldo declarado.

- [x] **T934** Corregir FR-044 y el AC 3.5 de `spec.md` (hallazgo 1). Pedían que
      el punto de venta de AFIP saliera del `punto_de_venta_id` de la venta, y
      esa columna con el número de ARCA **no existe** en `puntos_de_venta`.
      Ahora dicen la cadena que el sistema sí puede hacer —`body.pv` →
      `sale.afip_pv` → `settings.afip_pv`— con la consecuencia vigente escrita
      (dos locales comparten numeración correlativa) y la remisión al proyecto
      **5b · Punto de venta de AFIP por sucursal**.
      **No se agregó la columna**: sería una columna que ninguna pantalla puede
      completar.

- [x] **T935** Corregir la desincronización de la sucursal en
      `pages/InvoicesList.jsx` (hallazgo 4). `fetchSales` dependía solo de
      `consulta`, y la sucursal del encabezado viaja como cabecera
      `X-Punto-De-Venta-Id`: cambiarla actualizaba el `<select>` de la pantalla y
      el `.xlsx`, pero no la tabla ni el total de arriba. Se agregó
      `sucursalDeLaCabecera` como dependencia, con valor `null` en cuanto el
      usuario elige una sucursal explícita en el filtro de la pantalla — ahí
      manda el filtro (FR-072) y la cabecera ya no cambia el resultado.
      **Test**: `apps/web/src/tests/historialDeVentas.test.js`, guardia estática
      sobre el archivo.

- [x] **T936** Sacar del handler del export las funciones puras que ningún test
      alcanzaba (hallazgo 3). `filaDeExport`, `numeroDeComprobanteFormateado`,
      las dos tablas de etiquetas y el `parseFloat` del total del período pasaron
      a `apps/api/src/utils/exportVentas.js`.
      **Tests**: `tests/exportVentas.test.js` (el total como número, el CAE como
      texto de 14 dígitos, la etiqueta de estado contra los cinco casos, el tipo,
      el número de comprobante, las diez columnas en orden) más las guardias de
      `tests/rutasDeVentas.test.js` para lo que no es una función pura: que el
      export ordene con `filtro.order` igual que el listado, y que la suma del
      período vaya con el mismo `where`.
      **Verificación**: las **diez** mutaciones de la API se aplicaron una por
      una y cada una hace fallar al menos un test.

**Checkpoint**: 613 pruebas en la API y 156 en la web, todas pasando;
`npm run build` pasa; las guardias de aislamiento y observabilidad siguen limpias
sin excepciones nuevas.

**Lo que queda abierto**: las cinco mutaciones del **frontend** que encontró
`sdd-verify` siguen sin cobertura. Necesitan tests de render y `apps/web` no
tiene infraestructura para eso —ni jsdom ni testing-library—. Montarla es un
proyecto aparte y no se inventó acá.

---

## Lo que NO se verifica acá: los pasos manuales de `sdd-verify`

**Esto no son tareas.** Son las verificaciones que solo se pueden hacer contra
Postgres real y contra Excel real, y están escritas como pasos reproducibles
justamente para no disfrazarlas de test. El plan las relevó una por una.

1. **`DECIMAL` que vuelve como string.** Pedir el listado de un rango con varias
   ventas y comprobar que `total_periodo` llega como número en el JSON, y que la
   columna Total del `.xlsx` **suma** en la planilla. Cubre FR-094 y el criterio
   de éxito 13. Falla en silencio: el archivo abre y se ve bien.
2. **Orden estable entre páginas.** Cargar dos ventas de la misma sucursal en el
   mismo minuto, pedir la página 1 y la 2 dos veces, y comprobar que ninguna fila
   se repite ni falta. Es lo que compra el tercer criterio de orden (`id DESC`).
3. **El lock de `/facturar`, dos escenarios.** (a) Dos `POST /facturar`
   simultáneos sobre la misma venta dejan **un solo** CAE (criterio 6). (b) Un
   `/facturar` y un `/void` simultáneos no dejan un CAE emitido sobre una venta
   anulada (criterio 8). Ninguno de los dos se puede probar con los dobles.
4. **Tiempo de la primera página.** Un rango de un mes con 3.000 ventas devuelve
   25 filas en menos de 1,5 s (criterio 12). Si no se cumple, se **mide** antes
   de ensanchar el índice.
5. **El `.xlsx` abierto en Excel.** CAE de 14 dígitos completo, sin notación
   científica, y columna Total sumable (riesgo 9). El test unitario verifica el
   objeto de hoja que produce `xlsx`, no lo que Excel hace con él.
6. **`is_credit` no se contagia del nombre libre.** Registrar desde el POS una
   venta con nombre de cliente y **sin** ficha, y comprobar en la base que
   `is_credit` quedó en `false`: un nombre libre no puede generar una deuda sin
   deudor (FR-102, riesgo 8).

---

## Resumen

| Fase | Tareas | Qué queda funcionando |
|---|---|---|
| 1 · Base de datos y estados | T901–T903 (3) | La base guarda el intento fallido; los cinco estados se deciden en un solo lugar |
| 2 · API de lectura | T904–T907 (4) | Listado, detalle y export consultables con `curl` |
| 3 · API de escritura | T908–T912 (5) | Reintento con lock, anulación bloqueada con CAE, nombre del cliente persistido |
| 4 · Tabla y listado | T913–T917 (5) | La pantalla como la maqueta, y el patrón fijado para las otras cinco |
| 5 · Panel lateral | T918–T920 (3) | El detalle sin perder la lista |
| 6 · Reintento | T921–T922 (2) | Rechazada → Autorizada en tres clics |
| 7 · Filtros y búsqueda | T923–T926 (4) | Los tres defectos del relevamiento cerrados |
| 8 · Export | T927–T928 (2) | El listado filtrado en `.xlsx` |
| 9 · Guardias y documentación | T929–T931 (3) | El patrón no se repite mal; el operador se entera |
| 10 · Los cuatro incumplimientos de `sdd-verify` | T932–T936 (5) | La condición de IVA sale del cliente; la spec dice lo que el sistema puede hacer; la pantalla no se desincroniza; y revertir la API hace fallar tests |

**Total: 36 tareas.**

**La primera es T901**: la migración de `afip_ultimo_error` y `afip_ultimo_intento`
con el índice `(empresa_id, date)`. Sin esas dos columnas no existe la diferencia
entre «Registrada» y «Rechazada», y sin esa diferencia no hay estado C, no hay
botón de reintento y no hay nada que mostrar en el panel.
