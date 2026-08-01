# Implementation Plan: Historial de ventas — pasada fina

**Spec**: [spec.md](./spec.md) · **Rama**: `009-historial-de-ventas`
**Escrito**: 1 de agosto de 2026

---

## Summary

La pantalla `InvoicesList.jsx` se reescribe con el patrón de tabla en grid de la
maqueta y estrena el panel lateral de detalle de 520px. `GET /api/sales` pasa de
aceptar una fecha suelta a aceptar un rango, sucursal, tipo de comprobante y
búsqueda, todo resuelto en el servidor y paginado de a 25. `sales` gana dos
columnas —el último error de AFIP y la fecha del último intento— que son las que
hacen posible el quinto estado y el botón de reintento. `POST /:id/facturar`
toma la venta con lock y resuelve por sí mismo el tipo, el CUIT y el punto de
venta; `PUT /:id/void` deja de aceptar ventas con CAE. El export sale por un
endpoint propio, porque bajar 5.000 comprobantes de a 25 no es una opción.

---

## Technical Context

### Qué existe y se reusa tal cual

| Pieza | Dónde | Cómo entra |
|---|---|---|
| `findScoped` | `apps/api/src/utils/tenantScope.js` | Toda lectura y escritura por id. Ya soporta `transaction` y `lock`. |
| `ErrorDeNegocio` + `fallo` | `apps/api/src/utils/errores.js` | El bloqueo de anulación con CAE es un `ErrorDeNegocio`; `fallo` ya devuelve su `status` y su mensaje. |
| `fechaDelNegocio` | `apps/api/src/utils/fechas.js` | El «hoy» del rango por defecto. Es la misma función con la que se escribe `Sale.date`. |
| Lock sin `include` | `sales.js:274-277` | El patrón exacto que `/facturar` tiene que copiar, con el comentario que explica por qué el `include` rompe el `FOR UPDATE`. |
| Serializador de AFIP | `afipService.js:39-57` | Ya serializa por `(empresa, pv, tipo)`. El lock nuevo no lo reemplaza: resuelve otra carrera (facturar vs. anular). |
| Patrón de tabla en grid | `Comparador.jsx:281-353` | `overflow-x-auto` → `min-w-[…]` → encabezado `.eyebrow` en `surface-2` → filas. |
| `Sheet` | `apps/web/src/components/ui/sheet.jsx` | Base del panel: overlay, `Esc`, foco y bloqueo de scroll ya resueltos. |
| `xlsx` | dependencia de `apps/web` | Ya se usa en `Comparador.jsx:114` y `Faltantes.jsx:137`. |
| `.num`, `.eyebrow`, `anim-panel`, `shadow-nivel-3` | `apps/web/src/index.css:211-262` | Ya definidos. `anim-panel` y `shadow-nivel-3` no los usa todavía ninguna pantalla: esta es la primera. |

### Qué se relevó y cambia el diseño

- **`GET /api/sales` lo consume una sola pantalla.** El único llamador real es
  `InvoicesList.jsx:56`; `getSales` en `services/api.js:148` está exportado pero
  nadie lo importa. Eso habilita cambiar la forma de la respuesta sin romper
  otras pantallas.
- **`Sale.total` es `DECIMAL(12,2)`.** El driver de Postgres lo devuelve como
  **string**. `taxService.js` ya lo trata así (`parseFloat(await Sale.sum(...))`).
  Es exactamente la trampa de FR-094: un total exportado como texto no suma en
  Excel y el criterio 13 falla en silencio.
- **`PuntoDeVenta` no tiene punto de venta de AFIP.** Tiene `{ id, name, code,
  address, is_active }`. Ver «Lo que la spec pide y no se puede construir».
- **No hay tests de ruta contra base.** `src/tests/` cubre utilidades y guardias
  estáticas; `server.test.js` solo llega a `/ping`, `/health` y CORS. Los dobles
  de `tests/helpers/modelosFalsos.js` avisan de su propio límite: «un bug que
  solo aparece contra Postgres real (por ejemplo, DECIMAL devuelto como string)
  NO lo atrapan estos tests». Eso condiciona toda la estrategia de verificación.

### Módulos no liberados

Ninguno. El supuesto 9 de la spec dice que la pantalla es visible para el
cliente. No van gates de superadmin en la barra lateral, ni en `RouteGuard`, ni
en la API. Los permisos vigentes alcanzan (supuesto 3): `ventas.ver` para mirar y
exportar, `ventas.crear` para reintentar, `ventas.anular` para anular.

---

## Lo que la spec pide y no se puede construir como está

**Una sola cosa, y conviene decidirla ahora.**

### FR-044 — «El punto de venta de AFIP DEBE salir del `punto_de_venta_id` de la venta»

Ese dato no existe. `punto_de_venta_id` apunta a `puntos_de_venta`, cuya tabla
tiene `id`, `name`, `code`, `address` e `is_active`: **no hay ninguna columna con
el número de punto de venta de AFIP**. El número de AFIP vive en un único
`Setting` por empresa (`afip_pv`), y el POS ya factura todas las sucursales con
ese mismo valor (`Billing.jsx:243`).

Traducido: hoy una empresa con tres locales emite los tres con el mismo punto de
venta de ARCA. FR-044 describe una capacidad que el sistema no tiene.

**Lo que se hace en esta funcionalidad:** el punto de venta lo resuelve el
servidor, en este orden — `sale.afip_pv` (si la venta ya tenía uno) →
`settings.afip_pv`. La regla queda escrita en un solo lugar y con la forma que
FR-044 pide; hoy colapsa siempre en `settings.afip_pv`.

**Lo que NO se hace:** agregar `afip_pv` a `puntos_de_venta`. Sería una columna
que nadie puede completar, porque no hay pantalla donde cargarla, y una columna
sin forma de llenarse es una promesa que después hay que mantener. Queda como
proyecto aparte: **«Punto de venta de AFIP por sucursal»**, que necesita columna,
campo en Ajustes de sucursal y una migración que decida qué pasa con los
comprobantes ya emitidos.

**Consecuencia si no se hace nunca:** una empresa con dos locales que factura
desde los dos comparte numeración correlativa de ARCA entre ambos. Es el
comportamiento actual; esta funcionalidad no lo empeora ni lo arregla.

FR-099 (verificar contra AFIP con el `afip_pv` de la venta) **sí** se construye
completo: ahí el dato existe, porque `sales.afip_pv` se guarda desde la
migración `20260731-guardar-punto-de-venta-afip.js`.

---

## Decisiones

### 1. Las columnas nuevas de `sales`

**Se eligió:** `afip_ultimo_error` (`TEXT`, nulo) y `afip_ultimo_intento`
(`TIMESTAMP WITH TIME ZONE`, nulo), en una migración aditiva que además crea el
índice `(empresa_id, date)`. Los nombres son los que propone la spec.

**Alternativas descartadas:**

- `VARCHAR(255)` para el error, **porque** el mensaje que se guarda es el que
  produce `afipService` y ya viene con un `JSON.stringify` adentro
  (`afipService.js:286` y `:291`). A 255 caracteres se corta justo donde está el
  código de rechazo, que es el único pedazo accionable. FR-048 exige mostrar el
  mensaje de AFIP **tal cual**: truncarlo lo incumple.
- Una tabla `intentos_de_facturacion` con historial, **porque** la spec lo
  excluye explícitamente («Historial de intentos de facturación» está en Fuera
  de alcance) y FR-022 pide que un intento nuevo pise al anterior. Una tabla
  aparte para guardar siempre una sola fila es una junta más en cada consulta
  del listado.
- Una columna `estado` calculada y persistida, **porque** los cinco estados son
  una función pura de `status`, `afip_cae` y `afip_ultimo_error`. Persistirla
  crea un cuarto dato que puede contradecir a los otros tres, y la primera
  contradicción va a ser una venta que dice «Rechazada» y tiene CAE.

### 2. Dónde se decide cuál de los cinco estados es

**Se eligió:** una función pura en el servidor,
`apps/api/src/utils/estadoVenta.js`, que devuelve `{ codigo, etiqueta }`. El
código es `autorizada | registrada | rechazada | anulada | anulada_con_cae`. El
listado, el detalle y el export la usan; el frontend solo mapea `codigo` → trío
de tokens de color.

**Alternativas descartadas:**

- Derivarlo en el frontend, **porque** la columna «Estado» del `.xlsx` (FR-092)
  y el badge de la fila tienen que decir lo mismo (FR-024), y el Panel de control
  va a necesitar contar las Rechazadas del lado del servidor. Tres derivaciones
  separadas de la misma regla es el camino conocido a que dos digan una cosa y
  la tercera otra.
- Devolver también el color desde la API, **porque** el color es una decisión de
  diseño y `REGLAS-DISENO.md` es su fuente. Si la API devuelve `#`, el frontend
  deja de poder cambiar la paleta sin tocar el backend, y el archivo se llena de
  hex que FR-013 prohíbe. **El significado va en el servidor, el color en el
  frontend.**

Orden de evaluación, y no es intercambiable: `afip_cae` se mira **antes** que
`afip_ultimo_error`. Una venta con CAE es Autorizada aunque tenga un error viejo
guardado; si no, una venta que falló y después se facturó bien seguiría
mostrándose Rechazada.

### 3. El patrón de tabla en grid: componente compartido, pero solo el marco

**Se eligió:** un módulo `apps/web/src/components/TablaGrid.jsx` con cuatro
piezas de **marco** —`TablaGrid` (el contenedor con `overflow-x-auto` y ancho
mínimo), `Encabezado`, `Fila` y `BotonDeFila`— que reciben las
`gridTemplateColumns` como string y renderizan `children`. **No hay configuración
de columnas, ni renderers, ni objetos de definición.** Cada pantalla escribe sus
celdas como JSX, igual que hoy escribe Comparador.

**Alternativas descartadas:**

- **Una `<TablaDeDatos columnas={[…]} filas={…} />` que abstraiga las celdas,**
  **porque** con una sola pantalla construida no hay evidencia de qué necesitan
  las otras cinco, y esta ya pide: fila entera clickeable, opacidad al 55 % en
  dos de los cinco estados, una celda de dos líneas (número + CAE), otra alineada
  a la derecha, y botones de acción que tienen que frenar la propagación del
  clic. Cada una de esas se vuelve un prop, y para la sexta pantalla el
  componente tiene dieciocho props y nadie se anima a tocarlo. Como dice el
  encargo: un componente que abstrae de más sale tan caro como copiar y pegar
  mal.
- **Convención copiada, sin componente,** **porque** los criterios de aceptación
  son literales —`11px 20px` en el encabezado, `15px 20px` en las filas,
  `surface-2`, `.eyebrow`, `overflow-x-auto`, botones de 29px— y copiados a mano
  seis veces, al menos uno va a quedar en `py-3.5`. Nada lo detectaría: no hay
  test visual. Justo esas medidas son las que el componente fija.

El corte queda donde está la evidencia: **lo que tiene que ser idéntico en las
seis pantallas se comparte; lo que cambia en cada una —las columnas y las
celdas— se escribe en cada una.** `REGLAS-DISENO.md` se actualiza para apuntar al
componente además de a Comparador.

### 4. Filtros, búsqueda y paginado del lado del servidor

**Se eligió:** ampliar `GET /api/sales` con `desde`, `hasta`,
`punto_de_venta_id`, `tipo` y `q`, armando el `where` en una función pura
`apps/api/src/utils/filtroVentas.js`. `empresa_id` se agrega siempre y fuera de
esa función, en la ruta. El orden pasa a `date DESC, time DESC, id DESC`. La
página por defecto es 25.

**Alternativas descartadas:**

- **Traer el rango completo y filtrar en el navegador**, que es lo que hace hoy
  `filteredSales` (`InvoicesList.jsx:134`), **porque** es el defecto 3 del
  relevamiento: un CAE de la página 4 no aparece y la pantalla dice que no hay
  ventas. Es el bug, no una alternativa.
- **Un endpoint nuevo `/api/sales/buscar`,** **porque** el listado y la búsqueda
  devuelven exactamente las mismas filas con el mismo scoping y el mismo orden.
  Serían dos rutas que hay que mantener sincronizadas para siempre.
- **Cambiar el orden a DESC solo cuando hay rango,** para no tocar el
  comportamiento viejo, **porque** el único llamador de este endpoint es la
  pantalla que estamos reescribiendo. Dos órdenes distintos en una misma ruta,
  a cambio de compatibilidad con nadie, es deuda gratis.

Cuatro detalles que definen si esto funciona:

- **`id` como tercer criterio de orden.** Dos ventas de la misma sucursal en el
  mismo minuto tienen `date` y `time` iguales. Sin un tercer criterio
  determinístico, Postgres puede devolverlas en orden distinto entre dos
  consultas, y con paginación eso significa una fila repetida en la página 2 y
  otra que no aparece nunca. Es invisible hasta que alguien compara un export
  contra la pantalla.
- **`empresa_id` no lo pone `filtroVentas`.** Lo pone la ruta, con
  `scoped(where, req.empresaId)`. Que la función pura no pueda olvidarse de
  agregarlo es más débil que garantizar que la ruta siempre lo agregue.
- **Un `punto_de_venta_id` de otra empresa devuelve cero filas, no filas
  ajenas**, porque el `where` lleva las dos condiciones. No hace falta validar
  la pertenencia para leer; sí haría falta para escribir.
- **`X-Punto-De-Venta-Id` deja de pisar el parámetro** (FR-072): si la query
  trae `punto_de_venta_id` —incluido `todas`— manda la query; si no viene el
  parámetro, se sigue respetando la cabecera, que es el comportamiento actual
  (`sales.js:20-24`).

### 5. La lista deja de traer los ítems

**Se eligió:** `GET /api/sales` no incluye más `items`. Los ítems los trae el
detalle, `GET /api/sales/:id`, que es nuevo.

**Alternativas descartadas:** seguir con `include: [{ SaleItem }]`
(`sales.js:33`), **porque** ninguna de las siete columnas de FR-003 muestra
ítems, y ese `include` es un `hasMany`: con `limit` obliga a Sequelize a armar
una subconsulta y a contar con `COUNT(DISTINCT)`, que es justo el trabajo de más
que hace que el criterio 12 —primera página en menos de 1,5 s sobre 3.000
ventas— quede al borde. Se pagaba una junta y N filas por página para no mostrar
nada.

Efecto colateral que hay que atender: `handlePrint` usa hoy `sale.items`
(`InvoicesList.jsx:74`). El botón de imprimir de la fila pasa a pedir el detalle
antes de imprimir. Es una impresión por vez, así que el viaje extra no se nota, y
el panel —donde FR-036 pone «Imprimir»— ya tiene el detalle cargado.

### 6. El total del período incluye las anuladas

**Se eligió:** el número de FR-016 es la suma de **todas** las filas del filtro,
anuladas incluidas, y se calcula en el servidor con `Sale.sum` sobre el mismo
`where` (con `parseFloat`, porque `DECIMAL` vuelve como string). La etiqueta lo
dice: «Total del período (incluye anuladas)».

**Alternativas descartadas:** sumar solo las activas, que es lo intuitivo,
**porque** rompe el criterio de éxito 13. FR-091 obliga a exportar las anuladas
y FR-094 obliga a que la suma de la columna Total del `.xlsx` coincida con el
total del período de la pantalla. Las dos cosas juntas solo cierran si el total
de la pantalla también las incluye. Lo que queda por resolver es que el usuario
no lo lea mal, y eso se arregla con la etiqueta, no con el número.

### 7. El «hoy» del rango lo calcula el servidor

**Se eligió:** cuando no vienen `desde`/`hasta`, el servidor los completa con
`fechaDelNegocio(empresa.timezone)` y **devuelve el rango aplicado** en la
respuesta (`rango: { desde, hasta }`). La pantalla inicializa sus campos de fecha
con lo que le contestó la API.

**Alternativas descartadas:**

- `new Date().toISOString().split('T')[0]` en el navegador, que es lo que hace
  hoy `InvoicesList.jsx:39`, **porque** devuelve UTC: en Argentina, después de
  las 21:00, «hoy» pasa a ser mañana y una venta recién cobrada no aparece en su
  propio listado. Es el mismo bug que `fechas.js` vino a resolver del lado del
  servidor.
- Agregar `timezone` al payload de `/empresas` y calcularlo en el navegador con
  `Intl`, **porque** duplica `fechaDelNegocio` en el frontend. Dos
  implementaciones de la fecha del negocio se separan el día que una empresa
  cambie de zona.

### 8. El lock de `/facturar`

**Se eligió:** el patrón exacto de `/void` — transacción, `findScoped` con
`lock: t.LOCK.UPDATE` y **sin `include`**, revalidación de `status` y `afip_cae`
adentro, llamada a AFIP, escritura del CAE y commit. La transacción queda abierta
durante la llamada a AFIP.

**Alternativas descartadas:**

- **Marcar «en curso» en una transacción corta, llamar a AFIP fuera y escribir
  en una segunda,** para no tener la conexión tomada 30 s, **porque** necesita
  una columna de estado intermedio que la spec no pide y que queda trabada para
  siempre si el proceso se muere entre las dos transacciones. Vuelve más
  probable el problema que intenta evitar.
- **`FOR UPDATE NOWAIT`**, que le contestaría al segundo operador «hay un
  intento en curso» en vez de hacerlo esperar, **porque** FR-046 pide el mismo
  lock que `/void` y el escenario 8 de la historia 3 pide que dos reintentos
  simultáneos terminen con **un solo** CAE, no con un error. Esperar y encontrar
  el CAE ya emitido es la respuesta correcta.

Que la transacción abarque la llamada a AFIP es la decisión, y es la que cierra
las dos carreras:

- Si el reintento gana el lock, la anulación espera, y al entrar ve el CAE
  recién escrito: FR-055 la rechaza.
- Si la anulación gana, el reintento entra después, lee `status === 'voided'` y
  corta **antes** de llamar a AFIP.

Está acotada: el cliente SOAP tiene `TIMEOUT_AFIP_MS = 30000`
(`afipService.js:26`), así que el lock no puede quedar tomado indefinidamente.

**El error se guarda fuera de la transacción.** Si AFIP rechaza, se hace
`rollback` y recién ahí se escribe `afip_ultimo_error` y `afip_ultimo_intento`,
en un `UPDATE` propio y condicionado a `empresa_id = ? AND afip_cae IS NULL`. No
se puede escribir en una transacción que se va a revertir, y la condición evita
que una escritura tardía le pise el estado a una venta que mientras tanto se
facturó bien.

### 9. `/facturar` resuelve solo el tipo, el CUIT y el punto de venta

**Se eligió:** `type`, `customerCuit`, `customerVatCondition` y `pv` pasan a ser
**opcionales** en el body. Si no vienen, el servidor los resuelve: el tipo desde
`settings.tax_condition` (`RI` → 6, resto → 11, FR-042), el CUIT y la condición
de IVA desde el `customer` asociado a la venta o consumidor final —DocTipo 99,
condición 5— si no hay (FR-043), y el punto de venta según la decisión de
FR-044. Lo que venga en el body sigue mandando.

**Alternativas descartadas:** que el panel arme el body como hace hoy el POS
(`Billing.jsx:236-243`), **porque** obliga al frontend a traerse `settings` y la
ficha del cliente solo para reconstruir reglas fiscales que el servidor ya puede
deducir de la fila que tiene delante. Serían dos implementaciones de la misma
regla, y la del navegador es la que se puede editar desde la consola.

El body sigue aceptando los cuatro campos, así que **`Billing.jsx` no cambia su
llamada y el contrato del supuesto 4 se mantiene**. El único caso en que el panel
manda algo es FR-047: el CUIT que el usuario acaba de tipear después de un
`CUIT_REQUERIDO`.

### 10. El error de AFIP que se muestra es solo el de AFIP

**Se eligió:** el `try` se cierra alrededor de `afipService.createVoucher`. Un
fallo de ahí es el que se devuelve tal cual (FR-048) y el que se persiste. Un
fallo de cualquier otra cosa —leer settings, escribir la venta, la transacción—
sale por `fallo(req, res, err, …)` y no se guarda como «error de AFIP».

**Alternativas descartadas:** dejar el `catch` ancho de hoy
(`sales.js:431-442`), **porque** devuelve `err.message` al cliente sea cual sea
el origen: si falla el `sale.update`, el usuario recibe un mensaje de Sequelize
con nombres de tabla y de constraint. Es lo que `errores.js` existe para evitar,
y con FR-020 ese mismo texto pasaría además a quedar guardado y a mostrarse en el
panel para siempre. La guardia estática no lo ve porque no es un 500.

### 11. El export sale por un endpoint propio

**Se eligió:** `GET /api/sales/export`, con los mismos filtros que el listado,
sin paginar, con `attributes` acotados a las diez columnas de FR-092 y tope duro
de 5.000 filas. Si el filtro devuelve más, contesta `400 LIMITE_EXPORT_SUPERADO`
con el total, y no devuelve ni una fila. El `.xlsx` lo sigue armando el navegador
con `xlsx`.

**Alternativas descartadas:**

- **Recorrer las 200 páginas de 25 desde el navegador,** que es lo que sale si
  se reusa el listado tal cual, **porque** son 200 viajes, 200 `COUNT` y una
  ventana de varios segundos en la que una venta nueva puede correr las páginas y
  hacer que el archivo salga con una fila repetida y otra faltante.
- **Subirle el `limit` al listado (`?limit=5000`),** **porque** deja al endpoint
  del listado devolviendo entre 25 y 5.000 filas según quién llame, con la
  respuesta completa de `Sale` en cada una, y cualquier cliente puede pedir el
  máximo. El endpoint aparte permite acotar columnas —diez escalares contra la
  fila entera— y poner el tope en un solo lugar.
- **Generar el `.xlsx` en el servidor,** **porque** la spec lo excluye («Export
  del lado del servidor» está en Fuera de alcance) y metería la construcción del
  archivo y su memoria dentro del proceso de la API.

El aviso de FR-095 se da **antes** de pedir nada: la respuesta del listado ya
trae el `total` del filtro, así que la pantalla compara contra 5.000 y avisa sin
hacer el request. El tope del servidor es la red de abajo, no el camino normal.
Lo mismo con FR-096: `total === 0` se sabe sin llamar.

### 12. Los dos tipos del `.xlsx` que hay que forzar

**Se eligió:** el CAE se escribe como celda de texto explícita (`t: 's'`,
`z: '@'`) y el total como número (`Number(...)` sobre el string que devuelve
`DECIMAL`), en un armador propio `apps/web/src/utils/exportarVentas.js` con test
unitario sobre el objeto de hoja que produce.

**Alternativas descartadas:** pasar las filas a `XLSX.utils.json_to_sheet` y
confiar en la inferencia, que es lo que hacen hoy `Comparador.jsx:114` y
`Faltantes.jsx:137`, **porque** los dos casos de esta pantalla son justo los que
la inferencia arruina: un CAE de 14 dígitos se vuelve `7,54123E+13` y pierde
dígitos, y un total que llega como string se escribe como texto y la columna deja
de sumar. Ninguna de las dos cosas rompe nada visible: el archivo abre, se ve
bien, y está mal. Por eso el armador es una función pura testeada, y no tres
líneas dentro del `onClick`.

### 13. El panel se apoya en `Sheet`, y solo cambia la piel

**Se eligió:** `PanelVenta.jsx` usa `Sheet` / `SheetContent` de
`components/ui/sheet.jsx`, con `className` para `w-[520px] max-w-[92vw]
shadow-nivel-3 anim-panel`. El `sm:max-w-sm` y el `shadow-lg` que trae por
defecto se pisan.

**Alternativas descartadas:** un panel propio con `position: fixed` y un
`useEffect` para `Esc`, **porque** `Esc`, el clic en el overlay, la trampa de
foco, el bloqueo del scroll del body y el retorno del foco a la fila son trabajo
de accesibilidad que ya está hecho y que reescrito a mano queda a medias. Lo
nuestro es la medida, la sombra y la animación, y eso son tres clases.

---

## Project Structure

### Archivos nuevos

```
apps/api/src/
  migrations/20260803-intentos-de-facturacion.js   columnas + índice (empresa_id, date)
  utils/estadoVenta.js                             los cinco estados, función pura
  utils/filtroVentas.js                            query → where + orden + validación de rango
  tests/estadoVenta.test.js
  tests/filtroVentas.test.js

apps/web/src/
  components/TablaGrid.jsx                         el marco de la tabla en grid
  components/PanelVenta.jsx                        panel lateral de 520px
  utils/estadoVenta.js                             codigo de estado → trío de tokens
  utils/exportarVentas.js                          filas → hoja xlsx, con los tipos forzados
  utils/exportarVentas.test.js
```

### Archivos modificados

```
apps/api/src/
  models/Sale.js          +afip_ultimo_error, +afip_ultimo_intento, +índice compuesto
  routes/sales.js         GET / reescrito · GET /export y GET /:id nuevos ·
                          POST /:id/facturar con lock y resolución propia ·
                          PUT /:id/void rechaza con CAE · POST / guarda customer_name

apps/web/src/
  pages/InvoicesList.jsx  reescritura completa
  pages/Billing.jsx       customer_name siempre; sale de notes
  services/api.js         getSales con los parámetros nuevos, +getSale, +exportSales

docs/REGLAS-DISENO.md     el patrón «Tabla» apunta también a TablaGrid.jsx
```

### Orden de construcción

Sigue las prioridades de la spec y deja cada corte verificable solo:

1. **Migración + modelo + `estadoVenta.js`.** Nada visible todavía; base de todo
   lo demás.
2. **API: `GET /`, `GET /:id`, `GET /export`, `filtroVentas.js`.** Verificable
   con `curl` contra la base de desarrollo.
3. **API: lock de `/facturar`, bloqueo de `/void`, `customer_name` en `POST /`.**
   Los tres cambian comportamiento sin depender de la pantalla.
4. **`TablaGrid.jsx` + reescritura de la tabla** (historia 1).
5. **`PanelVenta.jsx`** (historia 2).
6. **Reintento desde el panel** (historia 3).
7. **Filtros y búsqueda en la pantalla** (historia 4).
8. **Export** (historia 5).
9. **`Billing.jsx`** — puede ir en cualquier momento después del paso 3.

---

## Cómo se verifica

El obstáculo está relevado y conviene decirlo antes de escribir tests: **no
existe infraestructura para probar las rutas contra una base**. Los dobles de
`tests/helpers/modelosFalsos.js` no entienden `Op.between`, ni `Op.iLike`, ni
`include`, ni `lock`, y su propio encabezado avisa que un bug que solo aparece
contra Postgres real no lo atrapan. Un test escrito sobre esos dobles para
«verificar» el orden `DESC` o el lock probaría el doble, no el sistema.

Entonces, tres niveles, explícitos:

**Lo que se testea con jest, porque es una función pura.** Se extrae a `utils/`
justamente para poder testearlo:

| Qué | Archivo | Cubre |
|---|---|---|
| Los cinco estados, incluida la precedencia de `afip_cae` sobre el error | `tests/estadoVenta.test.js` | FR-023, FR-024 |
| `where` y orden armados desde la query; rango invertido; rango > 1 año; `todas`; tipo «sin comprobante fiscal»; `q` numérico y no numérico | `tests/filtroVentas.test.js` | FR-070, FR-071, FR-074, FR-077, FR-078, FR-080 |
| La hoja del export: CAE como texto de 14 dígitos, total como número, columnas y orden | `utils/exportarVentas.test.js` | FR-092, FR-093, FR-094 |

**Lo que se verifica leyendo el archivo**, con la forma de las guardias
existentes: que `InvoicesList.jsx` no tenga hexadecimales, ni reglas `dark:`, ni
imports de `@/components/ui/table` (criterio de éxito 2, FR-001, FR-013). Es un
test de texto, es grosero, y es exactamente lo que hace falta.

**Lo que solo se puede verificar contra Postgres, y queda para `sdd-verify`**,
anotado como paso manual reproducible en vez de disfrazado de test:

- El `DECIMAL` que vuelve como string, en el total del período y en el export.
- El orden `date DESC, time DESC, id DESC` estable entre páginas.
- El lock: dos `/facturar` simultáneos dejan un CAE (criterio 6); `/facturar`
  contra `/void` simultáneo no deja un CAE sobre una venta anulada (criterio 8).
- El tiempo de la primera página con 3.000 ventas (criterio 12).

Si en algún momento se agrega una base de test, esos cuatro son los primeros
candidatos.

---

## Riesgos

**1. El lock de `/facturar` tiene tomada una conexión hasta 30 segundos.**
Es la consecuencia buscada de la decisión 8, pero si AFIP se pone lento y varios
operadores reintentan a la vez, el pool se agota y **otros endpoints** empiezan a
esperar. *Cómo se detecta:* latencia general subiendo con `sales: error al
facturar` en el log, o errores de timeout de conexión de Sequelize. *Techo:* el
timeout de 30 s del cliente SOAP. *Si aparece:* revisar el tamaño del pool antes
que el lock — el reintento es una acción de a una, no un flujo de alta
frecuencia.

**2. La búsqueda no es insensible a acentos.** `Op.iLike` resuelve mayúsculas y
minúsculas («Vega» / «vega»), pero no acentos: buscar «Perez» no encuentra
«Pérez». Quitarlos exige la extensión `unaccent` de Postgres, que necesita
permisos de superusuario en la base administrada y un índice funcional para no
degradar a scan completo. Los requisitos (FR-078, FR-104) piden cubrir número,
CAE y nombre, y eso se cumple; el caso borde de los acentos queda **fuera**.
*Cómo se detecta:* un usuario reporta que no encuentra un cliente que sí existe.
*Si aparece:* normalizar en el servidor con `unaccent` o guardar una columna de
nombre normalizado, decisión aparte.

**3. La búsqueda por CAE y por nombre recorre las filas del rango.** Un
`iLike '%…%'` no usa índice. Está acotado porque siempre corre después del filtro
por empresa y rango, pero un usuario que elija un año entero y escriba tres
letras hace un scan de todas sus ventas del año. *Cómo se detecta:* el criterio
12 medido sobre el rango máximo, no sobre un mes. *Si aparece:* exigir un mínimo
de tres caracteres antes de buscar, o índice `pg_trgm`.

**4. «Registrada» y «Anulada» comparten fondo y borde.** La tabla de los cinco
estados de la spec le da a B `surface-3 / fg-2 / border` y a D
`surface-3 / fg-3 / border`: se diferencian solo por el tono del texto. El
criterio de éxito 3 pide que los cinco se distingan **sin leer el texto del
badge**. En la fila alcanza, porque D va al 55 % de opacidad (FR-010) y B no;
mirando el badge aislado, no. *Propuesta:* que el badge de Anulada lleve además
un ícono (`Ban`, 12px, en `fg-3`), lo que cambia la forma y no la paleta. *Queda
para confirmar en la revisión de diseño;* si se rechaza, el criterio 3 se
verifica a nivel de fila y no de badge.

**5. La lista deja de traer `items` y algo puede depender de eso.** El relevo
dice que el único consumidor es `InvoicesList.jsx`, pero `services/api.js:148`
exporta `getSales`, y un import que aparezca después de este plan encontraría un
listado sin ítems. *Cómo se detecta:* `npm run build` no lo ve; una pantalla que
muestre `sale.items.map` sobre el listado tira en runtime. *Mitigación:*
`getSales` se actualiza en el mismo cambio y queda documentado en el contrato que
el listado no trae ítems.

**6. Sacar el nombre del cliente de `notes` corta una lectura existente.**
`InvoicesList.jsx:78` parsea `notes` buscando `'Cliente:'` para imprimir, y
`printInvoice` arma el `typeStr` con `notes.split('-')[0]`. Con FR-101, `notes`
pasa a ser solo `REMITO` o `RECIBO X`. El `split('-')[0]` sigue funcionando; el
parseo de `Cliente:` se reemplaza por `customer?.name || customer_name`. *Cómo se
detecta:* imprimir un remito nuevo y uno viejo y comparar. *Lo esperable:* los
comprobantes **viejos** siguen con el nombre adentro de `notes` y, por FR-105, no
se migran: van a imprimir «Consumidor Final». Es la consecuencia aceptada.

**7. `customer_name` es `VARCHAR(255)`.** Con FR-100 el campo pasa a llenarse
desde el POS sin ficha de cliente, o sea con texto libre de un operador. Un
nombre de más de 255 caracteres hace que Postgres rechace el `INSERT` y **la
venta no se registre**: un error de tipeo tumbando un cobro. *Mitigación:*
recortar y `trim` en `POST /api/sales` antes de armar `saleData`, y guardar
`null` si queda vacío. *Cómo se detecta:* test del caso borde con un nombre de
300 caracteres.

**8. `POST /api/sales` toca el camino más crítico del sistema.** El cambio de
`customer_name` es de tres líneas, pero está adentro del handler que registra la
venta y descuenta stock. *Cómo se detecta:* `is_credit` tiene que seguir
dependiendo de `customer_id` —una venta con nombre libre y sin ficha **no** puede
quedar como cuenta corriente (FR-102), porque sería una deuda sin deudor— y el
recálculo del total tiene que quedar intacto. Los dos con test propio.

**9. Nada garantiza que el `.xlsx` abra bien en Excel.** El test unitario
verifica el objeto de hoja que produce `xlsx`, no lo que Excel hace con él. El
criterio 13 (CAE de 14 dígitos completo, columna Total sumable) se comprueba
abriendo el archivo. *Queda como paso manual de `sdd-verify`.*

---

## Anexos

- Columnas, tipos, índices y qué pasa con lo existente: [data-model.md](./data-model.md)
- Parámetros, respuestas y códigos de error: [contracts/api-endpoints.md](./contracts/api-endpoints.md)
