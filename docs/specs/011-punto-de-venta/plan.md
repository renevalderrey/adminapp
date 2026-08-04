# Implementation Plan: Punto de venta — pasada fina

**Spec**: [spec.md](./spec.md) · **Rama**: `011-punto-de-venta`
**Escrito**: 4 de agosto de 2026

---

## Summary

`Billing.jsx` se reescribe como las dos columnas de la maqueta —catálogo a la
izquierda, ticket de 400px a la derecha, cada uno con su propio scroll— y estrena
tres atajos de teclado, foco automático en la búsqueda y el medio de pago exacto
adentro de cada segmento de precio. Debajo del dibujo van los dos defectos que
hoy pierden plata: el carrito que sobrevive al cambio de empresa, y el cobro que
se puede disparar dos veces. Las cinco reglas que hoy viven adentro del
componente —qué medios de pago existen, qué precio le toca a una línea, qué
comprobantes puede emitir la empresa, el desglose de IVA y qué hace cada tecla—
salen a `utils/` con test propio, porque son exactamente las que `sdd-verify`
no puede romper si están adentro de un `<div>`. **No hay migración**:
`Sale.payment_method` ya es `STRING(20)` libre y ya está documentado con los nueve
medios. Lo que sí cambia de contrato es `POST /api/sales`, que pasa a ser
idempotente por `id` —sin eso FR-043 no evita nada— y a devolver el stock que
efectivamente descontó.

---

## Technical Context

### Qué existe y se reusa tal cual

| Pieza | Dónde | Cómo entra |
|---|---|---|
| `calcularPrecios` | `apps/web/src/utils/precios.js:98` | Los tres niveles de precio. **Se consume, no se toca** (Fuera de alcance). |
| `filaDeStock(producto, sucursalId)` | `apps/web/src/utils/inventario.js:57` | La fila de stock de la sucursal activa. Reemplaza al `getAvailableStock` local de `Billing.jsx:120`. |
| `actualizarProducto(producto)` | `apps/web/src/store/useStore.js:96` | FR-047. Ya existe y ya se hizo para esto en la 010. |
| `ETIQUETAS_DE_PAGO` | `apps/api/src/utils/exportVentas.js:22` | La lista canónica de medios. Hoy está **duplicada** en `components/PanelVenta.jsx:28`. |
| `resolverSucursal` / `sucursalPorDefecto` | `apps/api/src/utils/sucursalDeStock.js` | FR-070/FR-072. Ya se usa en el mismo handler, tres líneas más abajo del lugar donde falta. |
| `POST /:id/facturar` idempotente + lock | `apps/api/src/routes/sales.js:819-969` | Contrato intacto (supuesto 4). El POS le sigue mandando los cuatro campos. Su bloque `if (sale.afip_cae)` (`:858-870`) es **el molde exacto** de la idempotencia que le falta a `POST /`. |
| `resolverComprobante` | `apps/api/src/routes/sales.js:662-679` | El servidor ya resuelve `RI → 6`, resto → `11`. **`Exento` ya emite Factura C del lado del servidor**: el defecto 1 es solo del `<select>`. |
| `useConfirmDialog` | `apps/web/src/components/ConfirmDialog.jsx` | La confirmación de `Esc` (decisión 2 de la spec). Ya resuelve overlay, foco y `Esc` propio. |
| `Sheet`, `Pagination`, `TablaGrid` | `apps/web/src/components/` | **No se usan acá.** Ver la tabla de patrones de la spec. |
| Entorno de render | `apps/web/vite.config.js` + `src/tests/preparacion.js` | jsdom para toda la suite, `globals: true`, `cleanup()` entre pruebas. `renderDeInventario.test.jsx` es el molde. |
| `contratosDeApi.test.js` | `apps/web/src/tests/` | El molde para verificar qué URL y qué cuerpo sale de `services/api.js`. |

### Qué se relevó y cambia el diseño

Seis hallazgos que no estaban en la spec y que mueven decisiones.

**1. `POST /api/sales` no es idempotente, y sin eso FR-043 no evita nada.**
`Sale.create` con un `id` repetido tira `SequelizeUniqueConstraintError`, que cae
en el `catch` genérico y sale por `fallo()` (`sales.js:519`) como **500 «Error al
registrar la venta»**. O sea: el escenario 14 de la historia 4 —la red se corta
después de guardar, el operador reintenta con el mismo id— hoy termina en un
error rojo genérico. El operador no tiene forma de saber que la venta existe,
vacía y cobra de nuevo con un id nuevo, **y la duplica igual**. FR-043 es
necesario y no es suficiente. Ver decisión 3.

**2. `sale_${Date.now()}` no tiene entropía, y con idempotencia eso pasa de ser
un error visible a una venta perdida en silencio.** Hoy, dos cajas que cobran en
el mismo milisegundo chocan contra la clave primaria y una de las dos ve un
error (edge case 2 de la spec). Con `POST /` idempotente, la segunda recibiría
`200 { yaRegistrada: true }` con los datos de la venta **de la otra caja**: se
imprime un comprobante de otra operación y la venta propia nunca se registra. El
identificador tiene que ganar entropía en el mismo cambio, no después.

**3. El POS escribe hoy un medio de pago que no existe.** `Billing.jsx:565` usa
`tc3`, y `tc3` **no está** ni en la lista de nueve de `legacy:6338-6344` ni en
`ETIQUETAS_DE_PAGO` (`exportVentas.js:22-33`). Todas las ventas con tarjeta hechas
desde esta pantalla están guardadas como `tc3` y se exportan con el código crudo
(`exportVentas.js:69` cae al `|| venta.payment_method`), se ven crudas en
`PanelVenta.jsx:202`, y en el panel de control aparecen como una clave sin
etiqueta (`Dashboard.jsx:209` imprime la clave tal cual). Es un defecto vivo que
el relevamiento de la spec no vio. Ver decisión 4.

**4. `tc1` cotiza al precio de efectivo, no al de tarjeta.** `legacy:6118-6128`:
`ef`, `tr`, `qr`, `td` **y `tc1`** devuelven el precio de efectivo; solo `tc3v`,
`tc3m` y `tc3n` llevan el recargo. La decisión 1 de la spec nombra
«transferencia, QR o débito» y se olvida de `tc1`. El `priceMap` de
`useStore.js:193` tampoco lo conoce. Ver decisión 4 y el riesgo 4.

**5. La búsqueda difusa y el lector de código de barras se contradicen.** `Fuse`
está configurado con `threshold: 0.4` (`Billing.jsx:137`). Un EAN de 13 dígitos
que **no existe** en el catálogo casi siempre devuelve algún resultado difuso —los
SKU y los códigos de barras comparten dígitos—, así que FR-033 («`Enter` agrega
el primer resultado») más un escáner significa **agregar al ticket un producto
que nadie escaneó**. El escenario 2.5 pide justo lo contrario. Ver decisión 8.

**6. La respuesta de `POST /api/sales` no alcanza para FR-047.** Devuelve
`{ data: sale, warnings: [...] }`, y `warnings` son **frases en castellano con el
nombre del producto adentro** (`sales.js:470`). Actualizar el catálogo «sobre las
líneas que no vinieron en `warnings`» obliga a parsear esas frases para saber a
qué producto se refiere cada una: dos productos con el mismo nombre, o un nombre
con comillas, y el descuento se aplica al equivocado. Además el cliente tendría
que **recalcular el inventario por su cuenta** (`available - qty`), que es
exactamente lo que este repositorio no hace con los números que importan. Ver
decisión 7.

### Módulos no liberados

**El POS es para el cliente.** No van gates de superadmin ni en la barra lateral,
ni en `RouteGuard`, ni en la API. La única pieza que sí depende de un módulo no
liberado es el **buscador de fichas de cliente**, que ya está condicionado a
`usuario.es_superadmin` (`Billing.jsx:55`) y sigue igual (supuesto 12).

Los permisos vigentes alcanzan y **no se crea ninguno** (supuesto 6):
`ventas.crear` para cobrar, que es el que ya exigen `POST /api/sales` y
`POST /api/sales/:id/facturar`. Lo que se agrega es que **la pantalla lo consulte**
—hoy no lo hace— para FR-024.

---

## Lo que la spec pide y hay que ajustar

Cuatro cosas. Las dos primeras cambian requisitos; las dos últimas, cómo se
verifican.

### 1. FR-043 no evita la venta duplicada por sí solo

Está desarrollado en el hallazgo 1 y se resuelve en la decisión 3. El requisito
queda ampliado así:

| FR-043 dice | Queda |
|---|---|
| El id se genera una vez por ticket y se reusa en el reintento | Igual, **más**: el id lleva entropía además de la marca de tiempo |
| — | **`POST /api/sales` responde `200 { yaRegistrada: true }`** cuando recibe un id que ya existe en esa empresa, en vez de 500 |
| — | La pantalla distingue esa respuesta y la trata como éxito, sin volver a pedir el CAE si la venta ya lo tiene |

### 2. FR-047 necesita que el servidor diga qué descontó

Hallazgo 6. `POST /api/sales` gana un campo `stock` en la respuesta con las filas
que efectivamente tocó: `[{ product_id, quantity, available }]`. Es aditivo, no
rompe a nadie —el único llamador es esta pantalla— y saca al navegador del
negocio de recalcular inventario. El texto de FR-047 («sobre las líneas que
**no** vinieron en `warnings`») describe el mecanismo frágil; el requisito de
fondo —«sin volver a pedir el catálogo entero»— se cumple igual y mejor.

### 3. FR-002 y el escenario 1.3 no se pueden verificar con un test en este repositorio

jsdom no tiene motor de maquetado (`preparacion.js` lo dice en su propio
comentario). «El cuerpo de la página no scrollea horizontal» y «las dos zonas
scrollean por separado» son afirmaciones sobre layout: `scrollWidth`,
`clientWidth` y `getBoundingClientRect` devuelven cero siempre. Un test que los
mire pasa con y sin el cambio, que es la definición de test que no vale nada.
Van al paso manual reproducible. Ver «Cómo se verifica».

### 4. El escenario 3.7 y el 3.3 hablan del mismo momento y piden cosas opuestas

3.3: «venta cobrada con éxito → el foco vuelve a la búsqueda». 3.7: «estoy
escribiendo en el CUIT y llega la respuesta de un pedido en vuelo → el foco no se
me mueve». Son el mismo instante si el pedido en vuelo es el cobro.

**Se resuelve así**: el foco se fuerza **solo** al terminar la operación de cobro,
que es la que además limpia el CUIT (FR-048) — no hay nada que preservar. Los
demás pedidos en vuelo —la búsqueda de fichas de cliente, `getCustomers`— **nunca**
tocan el foco. La consecuencia práctica es que el `useEffect` no puede depender de
`loading`: un `useEffect(() => buscador.current?.focus(), [loading])` incumple 3.7
la primera vez que el operador tipea un CUIT mientras se resuelve cualquier otra
cosa. El foco se pide **imperativamente al final del handler de cobro**, no por
efecto.

---

## Decisiones

### 1. Cinco reglas salen de `Billing.jsx` a `utils/`, y el resto se queda

La convención del repositorio (CONVENCIONES, «Cuándo va un test de render y
cuándo una función pura») es que la regla sale y el componente dibuja. Acá el
criterio para decidir cuál sale fue uno solo: **¿se puede afirmar sin un DOM?**
Si sí, sale, porque un test de render que verifica una regla es diez veces más
lento y se pone en rojo cuando alguien mueve un `<div>`.

| Regla | Hoy | Va a | Por qué |
|---|---|---|---|
| Qué medios de pago existen, a qué segmento pertenece cada uno y cuál lleva vuelto | `Billing.jsx:96` (`i.method === 'ef'`) y `:565` (la lista de tres) | `utils/mediosDePago.js` | Es una **lista de valores del dominio duplicada tres veces**: acá, en `exportVentas.js:22` y en `PanelVenta.jsx:28`. Tres copias de un enum de nueve valores se separan solas, y ya lo hicieron: el POS escribe `tc3`, que no está en ninguna de las otras dos (hallazgo 3). Además `hayEfectivo` es hoy una comparación literal contra `'ef'` adentro del render: con nueve medios pasa a ser una pregunta —«¿este medio se paga con billetes?»— que tiene una respuesta y merece un test |
| Qué precio le toca a una línea según su medio | `useStore.js:193`, `:237` y `:262` — **el mismo `priceMap` escrito tres veces** | `utils/mediosDePago.js` (`precioDeLinea`) | Tres literales iguales empiezan iguales y terminan distintos; con nueve medios en vez de tres hay que tocar los tres a la vez. Y es plata: equivocar el mapa cobra el precio de efectivo por una compra con tarjeta y nada falla. `calcularPrecios` **no se toca** (Fuera de alcance): esto es medio → nivel, no costo → precio |
| Qué comprobantes puede emitir la empresa | `Billing.jsx:619-630`, adentro del `<select>` | `utils/comprobantes.js` | Es el defecto 1 entero. La regla «lo que muestra el selector es lo que se emite» (FR-061) es un **invariante entre dos valores** —el estado inicial de `:70` y la lista de `:625`— y un invariante se verifica exhaustivamente sobre las tres condiciones fiscales en tres líneas de test. Renderizado, harían falta tres montajes de la pantalla entera |
| El desglose de IVA | no existe | `utils/comprobantes.js` (`desglosarIva`) | Es un cálculo con plata, y CONVENCIONES obliga a testear esos con casos de borde. Tiene además **dos condiciones acopladas** —solo `RI`, solo Factura A o B (FR-022)— y la consecuencia de errar es mostrarle a un monotributista un IVA que no cobró |
| Qué hace cada tecla, y cuándo no hace nada | no existe | `utils/atajosDelPos.js` | FR-030 a FR-039 son una **tabla de decisión**: tecla × modificadores × dónde está el foco. Son ~40 combinaciones. Como función pura se prueban las 40 en un archivo; renderizadas, son 40 montajes. Lo que **sí** va a render es el efecto: que `Ctrl+Enter` dispare el cobro una vez y solo una |

**Lo que se queda adentro del componente, a propósito:**

- **El dibujo**: las dos columnas, el ancho de 400px, las zonas de scroll, el pie
  fijo, el estado vacío. No hay regla ahí; hay medidas de la maqueta.
- **El efecto de cada atajo** (mover el foco, agregar, cobrar, vaciar). La
  decisión de *si* se dispara es pura; *qué* dispara es la pantalla.
- **El foco.** `document.activeElement` es del DOM: es render o no es nada.
- **El circuito de cobro** (`handleRegisterSale`). Orquesta dos pedidos y estado
  local; extraerlo a `utils/` produciría una función que recibe ocho callbacks,
  que es peor que el `useEffect` que reemplaza.
- **`sugerenciasDeVuelto`** — **excepción**: esto sí sale, a
  `utils/vuelto.js`, junto con el cálculo del vuelto. Es aritmética con plata
  escrita en un `useMemo` (`Billing.jsx:106-118`) donde ningún test la alcanza, y
  FR-018 la da por conservada sin que exista nada que lo garantice.

**Alternativas descartadas:**

- **Dejar todo adentro y cubrirlo con tests de render**, que es lo de hoy,
  **porque** es literalmente el diagnóstico que abrió el entorno de render en la
  010: cuatro incumplimientos pasaron 274 tests sin ponerse en rojo. La respuesta
  de aquella vez no fue «renderizar más», fue «sacar la regla».
- **Un solo `utils/pos.js` con todo adentro**, **porque** los medios de pago los
  necesita también `PanelVenta.jsx`, que no es el POS, y un módulo llamado `pos`
  importado desde el historial de ventas es un módulo mal nombrado que en seis
  meses arrastra la mitad de la pantalla.

### 2. Los nueve medios de pago se declaran una vez del lado del navegador, y un test de contrato los ata a los del servidor

**Se eligió:** `apps/web/src/utils/mediosDePago.js` es la fuente única del lado
del navegador. `PanelVenta.jsx` borra su copia y lo importa. `exportVentas.js`
(API) **conserva la suya**, y un test nuevo verifica que las dos listas tengan
las mismas claves.

```js
export const SEGMENTOS = ['efectivo', 'tarjeta', 'alianza']   // los tres niveles de precio

export const MEDIOS = [
  { codigo: 'ef',   etiqueta: 'Efectivo',      segmento: 'efectivo', vuelto: true  },
  { codigo: 'tr',   etiqueta: 'Transferencia', segmento: 'efectivo', vuelto: false },
  { codigo: 'qr',   etiqueta: 'QR',            segmento: 'efectivo', vuelto: false },
  { codigo: 'td',   etiqueta: 'T. Débito',     segmento: 'efectivo', vuelto: false },
  { codigo: 'tc1',  etiqueta: 'Créd. 1 pago',  segmento: 'efectivo', vuelto: false },
  { codigo: 'tc3v', etiqueta: 'Visa 3c',       segmento: 'tarjeta',  vuelto: false },
  { codigo: 'tc3m', etiqueta: 'Master 3c',     segmento: 'tarjeta',  vuelto: false },
  { codigo: 'tc3n', etiqueta: 'Naranja 3c',    segmento: 'tarjeta',  vuelto: false },
  { codigo: 'al',   etiqueta: 'Alianza',       segmento: 'alianza',  vuelto: false },
]

segmentoDe(codigo)          // 'efectivo' | 'tarjeta' | 'alianza'
mediosDelSegmento(segmento) // los de ese segmento, en orden
medioPorDefecto(segmento)   // 'ef' | 'tc3v' | 'al'
llevaVuelto(codigo)         // solo 'ef'
precioDeLinea(codigo, linea)// base_cash | base_card | base_alliance
```

`segmento` y `vuelto` son dos ejes distintos **a propósito**, y ahí está la
decisión 1 de la spec entera: el segmento decide el **precio**, la bandera decide
si aparece el bloque de vuelto. Una transferencia cotiza como efectivo y **no**
lleva vuelto.

**Alternativas descartadas:**

- **Un paquete compartido `packages/dominio` que importen la API y la web,**
  **porque** el monorepo hoy no tiene ninguno: agregarlo obliga a tocar los dos
  `package.json`, el build de Vite y el de Node, y la resolución de módulos entre
  CommonJS y ESM. Es un proyecto propio para compartir un objeto de nueve
  entradas. Se paga el día que haya un tercer consumidor.
- **Copiar y pegar la lista una cuarta vez,** **porque** es exactamente cómo
  aparecieron `tc3` y el `tc1` faltante.
- **Que la API devuelva la lista por un endpoint,** **porque** son valores del
  dominio que no cambian por empresa ni por configuración, y un `GET` por carga
  de pantalla para traer nueve constantes agrega un punto de falla al arranque
  del POS, que es la pantalla que se abre primero cada mañana.

El test de contrato vive en `apps/web/src/tests/mediosDePago.test.js` y lee el
archivo de la API **como texto** —igual que hacen las guardias estáticas— y
compara las claves. Es grosero y es lo que hace falta: si alguien agrega un medio
de un lado y no del otro, el historial de ventas empieza a mostrar códigos
crudos, que es lo que ya pasa con `tc3` y nadie vio.

### 3. La guardia contra el doble cobro es un `useRef`, y el que cierra el agujero de verdad está en el servidor

**Se eligió:** dos piezas, y hacen falta las dos.

**(a) Del lado del navegador, un cerrojo en `useRef`:**

```js
const cobroEnCurso = useRef(false)

async function cobrar() {
  if (cobroEnCurso.current) return
  cobroEnCurso.current = true
  try { … } finally { cobroEnCurso.current = false }
}
```

**Por qué esto no tiene el mismo agujero que `loading`.** `loading` es estado de
React: cada render **captura una copia** del valor, y el handler que se ejecuta
cierra sobre la copia del render en el que se creó. Dos eventos de la misma tanda
—doble clic, o la tecla en autorrepetición— ejecutan **el mismo handler, de la
misma copia**, y los dos leen `false`. Recién el render siguiente produce un
handler que ve `true`, y para entonces los dos `POST` ya salieron. Un `useRef` no
es una copia: es **una celda mutable única** que sobrevive a los renders. La
escritura del primer disparo es visible para el segundo **en el mismo tick**, antes
de que React haya decidido siquiera si va a re-renderizar. El `disabled` del botón
sigue existiendo, pero para lo que sirve —que se vea que no hay que apretar—, no
como guardia.

**Alternativas descartadas para (a):**

- **`disabled={loading}` solo,** que es lo de hoy: es el defecto 5, no una
  alternativa.
- **`useTransition` / `isPending`,** **porque** `isPending` también es estado y se
  lee actualizado en el render siguiente. Mismo agujero con otro nombre.
- **Una variable a nivel de módulo,** **porque** es única para toda la aplicación
  y **sobrevive al desmontaje**: una excepción que escape del `try` —o un
  `beforeunload` en el medio— deja el POS trabado hasta recargar la pestaña, sin
  ninguna forma de destrabarlo desde la pantalla. El `ref` nace y muere con el
  componente.
- **Un `debounce` o un `throttle` de N milisegundos,** **porque** una ventana de
  tiempo es una adivinanza: 300 ms le come el segundo cobro a un cajero rápido, y
  no alcanza para una tecla trabada. El problema no es la velocidad, es la
  concurrencia.

**(b) Del lado del servidor, idempotencia por `id`.** El `ref` cubre **un** montaje
de **una** pestaña. No cubre el escenario 14: la red se corta después de que la
venta se guardó, el `finally` libera el cerrojo, y el reintento sale. Ahí lo único
que puede evitar la segunda venta es el servidor.

`POST /api/sales` busca la venta con `findScoped(Sale, id, req.empresaId)` **antes**
de crear; si existe, responde `200 { ok: true, yaRegistrada: true, data: sale }`.
Y además atrapa `SequelizeUniqueConstraintError` en el `catch` y responde lo mismo,
**porque el `findScoped` previo no es atómico**: dos requests en vuelo a la vez
pasan los dos por el `findOne` y el que pierde choca contra la clave primaria. La
guardia real es la restricción de la base; el `findOne` es el camino normal.

Es el mismo molde que `POST /:id/facturar` ya usa para el CAE
(`sales.js:854-870`), con el mismo motivo escrito ahí: «un reintento sobre una
venta ya facturada devuelve el CAE que tiene, en vez de pedir otro y duplicar el
comprobante».

**(c) El identificador gana entropía.** `sale_${Date.now()}` pasa a
`sale_${Date.now()}_${8 hex aleatorios}` — 27 caracteres, entra en el `STRING(40)`.
**Es obligatorio y va en el mismo cambio que (b)**, no después: sin entropía, la
idempotencia convierte el edge case 2 de la spec —dos cajas, mismo milisegundo—
de un error visible en una venta que **desaparece en silencio**, porque la segunda
caja recibiría `yaRegistrada: true` con los datos de la venta de la primera,
imprimiría un comprobante que no es suyo y no registraría nada. Es el riesgo 1.

**Alternativas descartadas para (b) y (c):**

- **Una cabecera `Idempotency-Key` aparte del `id`,** que es lo que hace Stripe,
  **porque** el `id` de la venta **ya es** una clave de idempotencia: lo genera el
  cliente, es la clave primaria, y ya tiene una restricción única en la base que
  hoy produce un 500. Agregar una segunda clave para lo mismo obliga a una tabla
  de claves usadas y a decidir cuándo caducan.
- **`crypto.randomUUID()` a secas,** **porque** son 36 caracteres y el prefijo
  `sale_` no entraría; y porque la marca de tiempo adelante hace que los ids
  ordenen cronológicamente, que es lo que permite leer un listado crudo de la
  base. `randomUUID().slice(0, 8)` da los 8 hex.
- **`Sale.upsert`,** **porque** actualizaría la venta existente con los datos
  nuevos: un reintento con el ticket editado pisaría el registro contable de una
  operación ya cerrada.

### 4. El medio de pago exacto entra por una columna que ya existe. **No hay migración.**

**Verificado, no supuesto:**

| Qué | Dónde | Estado |
|---|---|---|
| `Sale.payment_method` | `models/Sale.js:38-42` | `STRING(20)`, `allowNull: false`, default `'ef'`. El comentario documenta `ef, tr, td, tc1, tc3v, tc3m, tc3n, al, qr` |
| La columna real en Postgres | `migrations/20260531-initial-schema.js:344` | `Sequelize.STRING(20), allowNull: false, defaultValue: 'ef'`. **Sin `ENUM`, sin `CHECK`** |
| `SaleItem.payment_method` | `initial-schema.js:366` | `STRING(20)`, nullable. Igual |
| Índice | `initial-schema.js:564` | `addIndex('sales', ['payment_method'])`. Un valor nuevo entra sin tocarlo |

**Conclusión: ninguno de los nueve códigos necesita una columna nueva ni un
cambio de tipo. No se escribe `data-model.md`.** El más largo es `tc3v`, cuatro
caracteres sobre veinte.

**Lo que sí cambia es qué significan los datos, y hay que decirlo.**

**(a) `tc3` es un código inválido que ya está guardado.** Hallazgo 3. **Las ventas
viejas no se migran**: nada en la fila dice si esa tarjeta fue Visa, Master o
Naranja, y reescribir el registro contable de una operación cerrada a partir de
una adivinanza es peor que dejarlo. Lo que se hace es **agregar `tc3` al mapa de
etiquetas** en los dos lados, como `'T. Crédito 3c'`. Son dos líneas y hacen que
el historial y el export dejen de mostrar un código crudo. El valor sigue
significando lo que significaba: «tarjeta, sin decir cuál».

**(b) El resumen de caja y el panel de control se van a partir en más buckets.**
`GET /api/sales/summary` agrupa por `(date, payment_method)` (`sales.js:203`) y
`dashboardService._salesByMethod` agrupa por `payment_method` (`:106`). Hoy el POS
produce tres valores; a partir de acá produce hasta nueve. Consecuencia concreta:
**el «Efectivo» del día deja de incluir las transferencias.** Es lo que el defecto
3 viene a arreglar —el arqueo contaba como billetes plata que entró por CBU— pero
significa que **un número que el dueño mira todos los días cambia sin que se haya
roto nada**. Queda anotado en el riesgo 3.

**(c) `Dashboard.jsx:209` imprime la clave cruda.** Con tres valores eso ya era
feo; con nueve le muestra `tc3n` al usuario. Se le pasa el mapa compartido. Son
dos líneas y entran acá porque **este cambio es el que las hace visibles**;
cambiar lo que el panel *cuenta* no entra.

**(d) Más ventas van a quedar clasificadas como mixtas.** `metodoDePago(lineas)`
(`calculosVenta.js:105`) devuelve el método solo si **todas** las líneas coinciden.
Un ticket mitad efectivo mitad transferencia era unánime `ef` y ahora es mixto, así
que `saleData.payment_method` cae al declarado en el cuerpo (`sales.js:393`). Por
eso el POS pasa a mandar como `payment_method` **el medio de pago del ticket**
(decisión 3 de la spec) y no `cart[0]?.method` (`Billing.jsx:211`): el medio
vigente del pie de cobro es la respuesta correcta a «con qué se pagó esta venta»
cuando las líneas difieren, y es lo que hacía el sistema viejo.

**(e) `tc1` va en el segmento «Efectivo».** Hallazgo 4: en el sistema viejo
cotiza al precio de efectivo (`legacy:6122`). Es incómodo de leer —«Efectivo →
Crédito 1 pago»— y es correcto: **el segmento es un nivel de precio, no una forma
de pagar**, y el encabezado del catálogo (FR-007) fija los tres nombres como
literales. Queda dicho en el archivo y en el riesgo 4.

### 5. Los atajos se enganchan una vez en `window`, con el handler en un `ref`

**Se eligió:** un hook `useAtajosDelPos(acciones)` en `apps/web/src/hooks/`, con
dos efectos:

```js
const ultimo = useRef(acciones)
useEffect(() => { ultimo.current = acciones })          // sin deps: cada render

useEffect(() => {                                        // deps: []
  const alTeclear = (e) => {
    const atajo = atajoDe(e)                             // la función pura
    if (!atajo) return
    e.preventDefault()
    ultimo.current[atajo]()
  }
  window.addEventListener('keydown', alTeclear)
  return () => window.removeEventListener('keydown', alTeclear)
}, [])
```

**El array de dependencias vacío es la decisión, y es lo que hace verdadero a
FR-040.** Un handler que cierra sobre `cart`, `searchQuery` y `docType` obliga a
poner esas variables en las dependencias, y entonces el efecto **se desuscribe y
se vuelve a suscribir en cada tecla**. Alcanza con que una limpieza falle —o con
que alguien agregue una dependencia y olvide otra— para que quede un escuchador
huérfano con estado viejo. El patrón del `ref` al día suscribe **una vez** al
montar y desuscribe **una vez** al desmontar: hay exactamente un `addEventListener`
y exactamente un `removeEventListener` por vida de la pantalla, y eso se puede
contar en un test.

**En fase de burbuja, y con `defaultPrevented` como primer filtro.** El
escuchador va en `window` sin `capture`, así que cualquier control que ya haya
usado la tecla —el `Esc` de un `Dialog` de base-ui, el `Esc` o las flechas de un
`<select>` nativo— la procesó antes. `atajoDe` devuelve `null` si
`evento.defaultPrevented` es `true`. **Eso es FR-038 sin tener que enumerar
selectores del DOM**, que es lo que se rompe la primera vez que alguien cambia la
librería de diálogos. El chequeo por tipo de elemento queda solo para lo que
`defaultPrevented` no cubre: `/` y `Esc` **dentro de un campo de texto**, donde el
navegador no llama a `preventDefault` porque escribir es su comportamiento normal.

`atajoDe(evento)` es pura: recibe `{ key, ctrlKey, metaKey, altKey, shiftKey,
defaultPrevented, target: { tagName, isContentEditable, dataset } }` y devuelve
`'enfocarBusqueda' | 'agregarPrimero' | 'cobrar' | 'limpiar' | null`.

**Alternativas descartadas:**

- **Un `onKeyDown` en el `<div>` raíz de la pantalla,** **porque** solo recibe
  teclas cuando el foco está adentro. El escenario 2.1 arranca con «el foco fuera
  de todo campo», y al abrir la pantalla el foco está en el `<body>`
  (`Billing.jsx`, defecto de foco). Los eventos del `<body>` no burbujean hacia un
  hijo.
- **`document` en vez de `window`,** **porque** son equivalentes para `keydown` y
  `window` es lo que ya usa el único `keydown` global del sistema viejo
  (`legacy:3854`). No hay motivo para tener dos convenciones.
- **Fase de captura,** **porque** el atajo le ganaría la tecla al control que la
  está usando: `Esc` vaciaría el ticket **en vez** de cerrar el diálogo abierto,
  que es exactamente lo que el escenario 2.13 prohíbe.
- **Una librería de atajos (`react-hotkeys-hook` y compañía),** **porque** son tres
  atajos y la parte difícil —qué pasa con el foco en un campo, qué pasa con un
  diálogo abierto— es justamente la que ninguna librería decide por vos, y sobre la
  que hay diecisiete criterios de aceptación.

**Cómo se prueban en jsdom.** En dos niveles, y el segundo es el que atrapa la
fuga:

1. `utils/atajosDelPos.test.js` — la tabla completa con objetos planos. Las cuatro
   teclas × `Alt`/`Shift`/`Ctrl`/`Meta`/nada × foco en `INPUT` / `TEXTAREA` /
   `SELECT` / `BODY` × `defaultPrevented` en `true` y `false`. Sin render, sin DOM,
   milisegundos. Cubre FR-030 a FR-039.
2. `src/tests/renderDelPuntoDeVenta.test.jsx` — el efecto. Y **el test de FR-040
   tiene una forma concreta**: montar la pantalla con una línea en el ticket,
   espiar `api.post`, **desmontar**, disparar
   `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }))`
   y afirmar que `api.post` no se llamó. Si alguien borra el `return` del
   `useEffect`, el escuchador huérfano sigue viendo el store —que es global— y
   dispara el cobro: el test se pone en rojo. **Es el único test de este plan que
   verifica una ausencia**, y por eso hay que dejarlo escrito en el archivo.

### 6. La pantalla se sale del marco de 1320px con una excepción declarada en `App.jsx`

**Se eligió:** `App.jsx` deja de envolver **todas** las rutas en el mismo `<div>`.
El `<main>` pasa a `min-h-0 flex-1 overflow-hidden` y el contenedor de 1320px
—`mx-auto max-w-[1320px] px-5 py-7 lg:px-9 lg:py-8 overflow-y-auto h-full`— baja a
un componente `MarcoDePantalla` que envuelve **cada ruta menos `/pos`**. `/pos`
recibe `h-full` a secas y administra sus dos zonas de scroll.

**Alternativas descartadas:**

- **Que `Billing.jsx` se «escape» con `-mx-5 -my-7 h-[calc(100vh-60px)]`,**
  **porque** los márgenes negativos que compensan el padding del padre se rompen
  en el primer `lg:` —el padre tiene `px-5 py-7 lg:px-9 lg:py-8`, o sea cuatro
  valores distintos que habría que negar en dos breakpoints— y el `calc` de la
  altura duplica el alto del `AppTopbar` en un archivo que no lo conoce. Es la
  clase de valor que queda desfasado cuando alguien cambia el topbar a 64px y
  nadie relaciona las dos cosas.
- **Un `<Route>` fuera del shell para `/pos`,** **porque** el POS necesita el
  `AppTopbar` entero: la miga de pan que lo nombra (FR-004 se apoya en eso para no
  tener `h1`) y el selector de sucursal, que es lo que FR-063 hace cambiar.
- **Que cada pantalla ponga su propio marco,** **porque** son dieciocho rutas y
  REGLAS-DISENO dice explícitamente «una pantalla nueva no dibuja su propio
  marco». Se invierte solo para la que no entra, y se escribe ahí.

`docs/REGLAS-DISENO.md` gana la excepción en dos lugares: en «El shell» (el marco
de 1320px, con `/pos` como la única salvedad y el motivo) y en «Encabezado de
pantalla» (el POS es la única sin `h1`, FR-004). Una regla que dice «todas» y
tiene una excepción no escrita deja de ser una regla.

### 7. El catálogo se actualiza con lo que el servidor dice que descontó

**Se eligió:** `POST /api/sales` devuelve, además de `data` y `warnings`, un campo
`stock` con una fila por cada `Stock` que efectivamente actualizó:
`[{ product_id, quantity, available }]`. La pantalla recorre ese arreglo y llama a
`actualizarProducto` (`useStore.js:96`) reemplazando la fila de stock que
corresponde. **Ningún `GET /products`.**

**Alternativas descartadas:**

- **Deducirlo de `warnings`,** que es lo que FR-047 dice literalmente, **porque**
  `warnings` son frases (`sales.js:470`): hay que buscar el nombre del producto
  adentro de un texto en castellano para saber a cuál se refiere. Dos productos
  con el mismo nombre, o un nombre con comillas, y el descuento se aplica al
  equivocado. Un aviso es para leer, no para parsear.
- **Que el navegador reste `available - qty` por su cuenta,** **porque** es el
  cliente recalculando inventario: el mismo razonamiento por el que el total de la
  venta lo calcula el servidor. Además sería **mentira** en el caso que la spec
  nombra —el producto sin fila de stock, que no se descontó— y el catálogo
  mostraría un stock que no bajó.
- **Volver a pedir solo los productos vendidos (`GET /products?ids=…`),**
  **porque** es un viaje más justo en el instante entre dos clientes, que es el
  que este hito viene a acortar, y `POST /api/sales` ya tiene esos números en la
  mano dentro de la transacción.

### 8. La búsqueda resuelve el código exacto antes que el parecido

**Se eligió:** `apps/web/src/utils/busquedaDelPos.js` con
`buscarEnCatalogo(catalogo, consulta, fuse)` que resuelve en este orden:

1. **Coincidencia exacta** de `barcode` o `sku` (normalizado, sin espacios ni
   guiones). Si hay, devuelve **ese producto solo**, marcado `exacta: true`.
2. Si no, y la consulta **parece un código** —solo dígitos, 8 caracteres o más—,
   devuelve **lista vacía** con `codigoNoEncontrado: true`.
3. Si no, la búsqueda difusa de `Fuse` que ya está.

**Por qué.** Hallazgo 5: `Fuse` con `threshold: 0.4` sobre un EAN de 13 dígitos
inexistente casi siempre devuelve *algo* —los códigos comparten dígitos— y
`Enter` agregaría al ticket un producto que nadie escaneó. El escenario 2.5 pide
avisar y no borrar la consulta; sin el paso 2, `Enter` agrega el producto
equivocado, la consulta **sí** se borra y el operador no se entera hasta que
alguien cuenta la caja. Es un producto vendido que no salió del local.

**Alternativas descartadas:**

- **Bajar el `threshold` de `Fuse`,** **porque** un umbral más estricto empeora la
  búsqueda por nombre, que es el otro uso del mismo campo y el que usa el operador
  cuando el cliente le dice «traeme la creatina esa». Un solo número no puede
  servir para «Colageno» con typo y para un EAN.
- **Un campo de escaneo aparte del de búsqueda,** **porque** el escáner escribe en
  el campo enfocado y toda la historia 3 existe para que ese campo sea **uno**.
  Dos campos significa que el operador tiene que acordarse de en cuál está.
- **Detectar el escáner por la velocidad de tipeo,** **porque** es una heurística
  con un umbral inventado que falla con un escáner lento o con un operador rápido,
  y falla en silencio.

### 9. El medio exacto se elige adentro del segmento, con un popover

**Se eligió:** el control de la línea son **tres segmentos** (Efectivo · Tarjeta ·
Alianza) que se reparten el ancho y comparten borde, según FR-020. Un clic elige
el segmento y le pone su medio por defecto (`ef`, `tc3v`, `al`). Un **segundo clic
sobre el segmento ya activo** —o el chevron de 10px que aparece cuando el segmento
tiene más de un medio— abre un popover con los medios de ese segmento. Cuando el
medio elegido **no** es el por defecto, el segmento muestra su etiqueta corta
(«Transf.», «Master») en lugar del nombre del segmento.

**Por qué no entra de otra forma.** La columna del ticket mide 400px y la fila de
controles ya lleva el stepper de cantidad de 28px más los tres segmentos
(`maqueta:404-417`, botones de 26px). Cinco opciones inline debajo de «Efectivo»
no entran sin apilar el control en dos filas, y apilar duplica el alto de cada
línea del ticket: con ocho productos, el ticket deja de entrar en la pantalla, que
es justo lo que FR-002 viene a garantizar.

**Alternativas descartadas:**

- **Nueve segmentos,** **porque** nueve botones en 400px dan menos de 40px cada
  uno y porque el encabezado del catálogo (FR-007) fija **tres** columnas de
  precio: nueve controles sobre tres precios le dice al operador que hay nueve
  precios.
- **Un `<select>` con los nueve,** **porque** FR-020 pide explícitamente un control
  segmentado y no un `<select>`, y porque el 95 % de las ventas usa el medio por
  defecto de su segmento: obligar a abrir un desplegable para el caso normal es
  cambiar un clic por dos, en la pantalla donde se cuentan los clics.
- **El medio exacto solo en el pie de cobro, no por línea,** **porque** el pedido
  dice «medio de pago por ítem» y ya existe. Sacarlo es perder una función
  liberada.

### 10. `Esc` pide confirmación, y la confirmación devuelve el foco a mano

**Se eligió:** `useConfirmDialog` (`components/ConfirmDialog.jsx`), que ya existe y
ya resuelve overlay y trampa de foco. `Esc` con la búsqueda vacía y el ticket
cargado abre el diálogo; confirmar vacía; cancelar no toca nada. **En los dos
casos el `resolve` termina con `buscador.current?.focus()`.**

Ese `focus()` explícito no es adorno: `ui/dialog` (base-ui) devuelve el foco **al
elemento que lo abrió**, y acá no hay elemento —lo abrió una tecla—, así que el foco
vuelve al `<body>` y el atajo siguiente (`/`) tendría que usarse para volver a
donde el operador ya estaba. Rompería la historia 3 por un camino que ningún
criterio de aceptación nombra.

**Con el ticket vacío, `Esc` no abre nada**: no hay nada que perder y un diálogo
para confirmar que se borre lo que ya está borrado es ruido.

**Alternativas descartadas:** las dos de la spec —doble `Esc` y deshacer— quedan
descartadas por la decisión del usuario, que ya está tomada. Se anota igual que
el doble `Esc` habría necesitado un temporizador visible y el deshacer una copia
del ticket en el store, y que ninguna de las dos es más barata que reusar el
diálogo que ya está escrito.

### 11. `Billing.jsx` entra a la guardia de diseño **antes** de la reescritura, y la guardia aprende a ver la paleta de Tailwind

**Se eligió:** en el primer corte que toca la web, `pages/Billing.jsx` y los
componentes nuevos entran a la lista de `guardiasDeDiseno.test.js:48`, el
`toHaveLength(7)` se actualiza, y se agrega un cuarto patrón:

```js
const PALETA_TAILWIND =
  /\b(?:text|bg|border|ring|from|via|to|fill|stroke|divide|accent|caret|placeholder|outline|decoration|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|\d{3})\b/
```

**`white` y `black` quedan fuera del patrón a propósito**, y hay que escribir por
qué: `REGLAS-DISENO.md` fija el botón principal como `bg-brand text-white`, y la
maqueta pone `color:#fff` adentro del botón de confirmar (`maqueta:484`). Un
patrón que los incluyera fallaría contra el propio sistema de diseño el primer
día, y la salida barata sería comentar la guardia.

**La consecuencia es que la guardia queda EN ROJO** desde que se agrega el patrón
hasta que la pantalla está reescrita: `Billing.jsx` tiene hoy `text-blue-500`
(`:460`), `border-orange-400` (`:588`), `border-green-500/30` y `bg-green-50`
(`:777`). Es lo buscado y es lo mismo que hizo la 010 con `Inventory.jsx` — y por
eso va escrito en el comentario del archivo, porque un test rojo sin explicación
es un test que alguien comenta.

**Alternativas descartadas:** agregar los archivos **después** de escribirlos,
**porque** es el riesgo 8 del plan de la 010, textual: se descubren treinta
hexadecimales al final, cuando ya nadie sabe cuál vino de dónde.

### 12. La sucursal de la venta se resuelve antes de crearla

**Se eligió:** en `POST /api/sales`, el bloque `resolverSucursal(...)` que hoy está
dentro de `if (lineas.length)` (`sales.js:442-446`) **sube antes del
`Sale.create`**, y `saleData.punto_de_venta_id` pasa de `req.puntoDeVentaId || null`
(`:396`) a `sucursal.id`. Nada más se mueve: el bucle de stock sigue usando la
misma variable.

Con eso, los seis escenarios de la historia 6 salen solos:

- Con cabecera → esa sucursal (`resolverSucursal` la valida contra la empresa con
  `findScoped`, así que un id ajeno **no** resuelve).
- Sin cabecera → la por defecto, **la misma** de la que sale el stock, porque es
  la misma llamada.
- Venta sin líneas → también queda atribuida, que es todo el punto de subir la
  línea.
- Empresa sin sucursales → `sucursalPorDefecto` ya tira `ErrorDeNegocio`
  (`sucursalDeStock.js:94-98`) y `fallo()` ya lo responde con su status y su
  mensaje (`errores.js:61-73`). **No hace falta nada nuevo**: hoy no se ve porque
  la llamada está adentro del `if`.

**Alternativas descartadas:** dejar `req.puntoDeVentaId || null` y completar la
columna en un `afterCreate`, **porque** el hook no tiene `req` ni transacción y
volvería a resolver la sucursal por su cuenta, que es el mismo error de tener dos
respuestas para la misma pregunta que `sucursalDeStock.js` vino a cerrar.

**Las ventas viejas no se migran** (FR-073) y los tres escalones de
`sucursalDeAnulacion` (`sales.js:27-47`) quedan **intactos**: siguen siendo la
única forma de atribuir las ventas con la columna en `null`.

---

## Project Structure

### Archivos nuevos

```
apps/web/src/
  utils/mediosDePago.js              los nueve medios, su segmento, su vuelto y su precio
  utils/mediosDePago.test.js
  utils/comprobantes.js              qué comprobantes ofrece cada condición + desglose de IVA
  utils/comprobantes.test.js
  utils/atajosDelPos.js              la tabla de decisión de las cuatro teclas
  utils/atajosDelPos.test.js
  utils/vuelto.js                    sugerencias de billetes y el vuelto
  utils/vuelto.test.js
  utils/busquedaDelPos.js            código exacto → código inexistente → difusa
  utils/busquedaDelPos.test.js
  hooks/useAtajosDelPos.js           el escuchador de window, con el handler en un ref
  components/MarcoDePantalla.jsx     el contenedor de 1320px que App.jsx dejó de aplicar a todo
  components/pos/CatalogoDelPos.jsx  la columna izquierda
  components/pos/TicketDelPos.jsx    la columna derecha (encabezado + líneas + pie)
  components/pos/SegmentoDePago.jsx  el control segmentado con el popover del medio exacto
  tests/renderDelPuntoDeVenta.test.jsx   foco, atajos, doble cobro, ticket bloqueado
  tests/mediosDePago.test.js         el contrato contra la lista de la API
```

> **Los tres de `components/pos/` son una decisión de tamaño, no de arquitectura.**
> `Billing.jsx` tiene hoy 805 líneas y le entran dos columnas nuevas, un popover y
> los avisos agrupados. Se parten por **zona de la pantalla**, no por
> responsabilidad abstracta: cada uno recibe props explícitos y no toca el store
> por su cuenta, así que la pantalla sigue teniendo un solo dueño del estado.

### Archivos modificados

```
apps/api/src/
  routes/sales.js       POST / idempotente por id · +stock en la respuesta ·
                        la sucursal se resuelve antes del Sale.create (FR-070/071)
  utils/exportVentas.js +tc3 en ETIQUETAS_DE_PAGO (el código que el POS escribió mal)
  tests/exportVentas.test.js   +el caso de tc3

apps/web/src/
  pages/Billing.jsx     reescritura completa
  App.jsx               el marco de 1320px baja a MarcoDePantalla; /pos queda a alto completo
  store/useStore.js     setEmpresaActiva vacía el carrito (FR-062) ·
                        addToCart hereda el medio del ticket (decisión 3 de la spec) ·
                        los tres priceMap salen a utils/mediosDePago
  components/PanelVenta.jsx  borra su copia de ETIQUETAS_DE_PAGO e importa la compartida
  pages/Dashboard.jsx   by_method con etiquetas en vez de códigos crudos
  services/api.js       createSale con el id con entropía; el resto igual
  tests/guardiasDeDiseno.test.js   +Billing.jsx y los cuatro componentes nuevos,
                                   +el patrón de la paleta de Tailwind, toHaveLength(12)
  tests/storeDeInventario.test.js  +el carrito que se vacía al cambiar de empresa

docs/REGLAS-DISENO.md   la excepción del marco de 1320px y la del encabezado de pantalla
docs/PROXIMOS-PROYECTOS.md   «Emitir Factura de Prueba» → Ajustes → Facturación AFIP (hito 8)
```

### Orden de construcción

**Los dos defectos vivos van primero, y no es una preferencia.**

La reescritura de la pantalla son ocho o diez tareas. Cada día que dura, la fuga
del carrito y el doble cobro siguen produciendo datos que **no se pueden
reparar después**: una venta con las líneas de otra empresa cliente y sin
descuento de stock, y una venta duplicada con el inventario descontado dos veces,
las dos hay que deshacerlas a mano contra el registro contable. Todo lo demás de
este hito —los atajos, el foco, las dos columnas— es incomodidad, no daño.

Y hay un segundo motivo, más concreto: **los atajos multiplican el doble cobro**.
`Ctrl+Enter` con la tecla en autorrepetición dispara el handler tantas veces como
repeticiones haya. Entregar los atajos antes que la guardia es entregar un
acelerador para un defecto conocido.

| # | Corte | Qué deja verificable |
|---|---|---|
| 1 | **`POST /api/sales`: idempotencia + entropía en el id + la sucursal antes del `Sale.create`** | Historia 6 completa y el escenario 4.14. Es API pura, no depende de la pantalla, y es donde están las dos cosas irreversibles |
| 2 | **`useStore`: `clearCart` al cambiar de empresa** | FR-062 / escenario 5.12. Una línea, un test de store, cero conflicto con la reescritura |
| 3 | **Las cinco funciones puras + sus tests** (`mediosDePago`, `comprobantes`, `atajosDelPos`, `vuelto`, `busquedaDelPos`) | Nada visible. Es lo que hace que los cortes 5 a 9 se puedan verificar |
| 4 | **La guardia de diseño**: los archivos entran a la lista (vacíos) y se agrega el patrón de la paleta | Queda **en rojo a propósito** hasta el corte 7 |
| 5 | **`App.jsx` + `MarcoDePantalla`** | Las diecisiete pantallas restantes siguen viéndose igual. Se verifica **antes** de tocar el POS, porque toca a todas |
| 6 | **`useAtajosDelPos` + el foco automático** (historias 2 y 3), todavía sobre la pantalla vieja | Los atajos y el foco se prueban contra un dibujo que ya funciona. Si algo falla, se sabe que es el teclado y no el layout |
| 7 | **La reescritura de las dos columnas** (historia 1) | Acá la guardia del corte 4 se pone en verde |
| 8 | **El cobro**: cerrojo en `useRef`, los dos pasos del botón, el ticket bloqueado, `actualizarProducto` (historia 4) | FR-042 a FR-055 |
| 9 | **El medio de pago exacto y el ticket que no miente** (historia 5) | FR-060 a FR-068 |
| 10 | **`REGLAS-DISENO.md` y `PROXIMOS-PROYECTOS.md`** | La excepción escrita y el destino del botón de prueba |

El corte 6 antes del 7 es deliberado y va contra el orden de prioridades de la
spec (historia 1 es P1 y va primera). El motivo: los atajos y el foco son la parte
que **más fácil se rompe sin que se note** y la que tiene diecisiete criterios de
aceptación; probarlos sobre la pantalla vieja los aísla del riesgo de la
reescritura. La historia 1 no depende de ellos.

---

## Cómo se verifica

**Lo que se testea como función pura**, y se extrae a `utils/` justamente para eso:

| Qué | Archivo | Cubre |
|---|---|---|
| Los nueve medios: segmento de cada uno, cuál lleva vuelto, precio de línea con y sin precio manual, código desconocido | `utils/mediosDePago.test.js` | Decisión 1 de la spec, FR-018, FR-067 |
| Que la lista de la web y la de `exportVentas.js` tengan las mismas claves | `tests/mediosDePago.test.js` | El defecto de `tc3` (hallazgo 3) |
| Qué comprobantes ofrece cada una de las tres condiciones; que el valor inicial esté **siempre** en la lista; AFIP no configurado → fiscales deshabilitados con motivo | `utils/comprobantes.test.js` | FR-060, FR-061, FR-055 |
| El desglose: `RI` + A/B lo muestra; `RI` + remito no; `Monotributo` nunca; `Exento` nunca; total 0; que `neto + iva === total` | `utils/comprobantes.test.js` | FR-022, criterio 14 |
| Las cuatro teclas × cinco combinaciones de modificadores × cuatro tipos de foco × `defaultPrevented` | `utils/atajosDelPos.test.js` | FR-030 a FR-039 |
| Sugerencias de billetes con total 0, con total exacto de un escalón, con total de $47.300; vuelto negativo | `utils/vuelto.test.js` | FR-018, escenario 5.10 |
| Código exacto gana a la difusa; código de 13 dígitos inexistente devuelve vacío y no el mejor parecido; texto corto sí usa la difusa | `utils/busquedaDelPos.test.js` | Escenarios 2.5 y 2.6, hallazgo 5 |
| La sucursal por defecto y su `ErrorDeNegocio` | ya existe: `api/tests/sucursalDeStock.test.js` | FR-072 |

**Lo que se testea con render** (`tests/renderDelPuntoDeVenta.test.jsx`), porque lo
que se afirma es el dibujo o el efecto:

| Qué | Cubre |
|---|---|
| Al montar, `document.activeElement` es el campo de búsqueda | Escenario 3.1, criterio 5 |
| `/` con el foco en el `<body>` mueve el foco y **no** escribe una barra; `/` dentro de la búsqueda escribe la barra | Escenarios 2.1 a 2.3 |
| `Enter` en la búsqueda agrega el primer resultado, vacía la consulta, deja el foco, y **`api.post` no se llamó** | Escenario 2.4, criterio 2 |
| `Ctrl+Enter` dispara **un solo** `api.post('/sales', …)`; dos `Ctrl+Enter` seguidos, también uno solo | FR-042, criterio 6 |
| **Desmontada la pantalla**, `Ctrl+Enter` no llama a `api.post` | FR-040, escenario 2.15 |
| Con el cobro en curso, los botones de cantidad, el precio y los segmentos están `disabled` | FR-046, criterio 15 |
| Sin `ventas.crear`, el botón está deshabilitado **y su explicación está en el documento** | FR-024, escenario 2.17 |
| El encabezado del catálogo y una fila comparten el **mismo string** de `grid-template-columns` | FR-007, criterio 13 |
| El ticket vacío nombra el atajo dentro de un `<kbd>` | FR-015 |
| Un monotributista **no** tiene ninguna línea de IVA en el pie | Criterio 14 |
| Después de una venta, `api.get` no recibió ningún `/products` | FR-047, criterio 10 |

**Lo que se verifica leyendo el archivo**, con la forma de las guardias que ya
existen: `guardiasDeDiseno.test.js` con `Billing.jsx` y los cuatro componentes
nuevos en la lista, y el patrón de la paleta de Tailwind (criterio 12).

**Lo que jsdom no puede contestar, y queda como paso manual reproducible para
`sdd-verify`.** No es una excusa: `preparacion.js` lo dice en su propio
comentario —«un test NO puede afirmar nada sobre posiciones ni sobre tamaños»— y
un test que mira `scrollWidth` en jsdom lee cero y pasa siempre.

1. Abrir el POS a 1080px y a 1920px de ancho: **el `<body>` no tiene barra de
   scroll horizontal** (escenario 1.3, FR-002).
2. Con 40 resultados en el catálogo y 8 líneas en el ticket: la barra de búsqueda
   sigue visible mientras la lista scrollea, y el pie de cobro sigue visible
   mientras el ticket scrollea (escenario 1.2, FR-003).
3. Un nombre de producto de 80 caracteres recorta con elipsis y **no** corre las
   columnas de precio.
4. El total del pie es el elemento de más peso visual del bloque (FR-021).
5. Las otras diecisiete pantallas siguen centradas a 1320px después del corte 5.
6. Contra Postgres: dos `POST /api/sales` con el mismo `id` dejan **una** fila en
   `sales` y **un** movimiento en `stock_movements`; una venta sin la cabecera
   `X-Punto-De-Venta-Id` queda con `punto_de_venta_id` no nulo y la anulación
   devuelve el stock a esa misma sucursal (criterios 6, 7 y 11).
7. Imprimir un comprobante recién emitido y verificar que la opción sigue
   disponible hasta que empieza el ticket siguiente (FR-050).

El punto 6 va contra la base porque los dobles de `tests/helpers/modelosFalsos.js`
no entienden `lock` ni transacciones: un test de idempotencia escrito sobre ellos
probaría el doble. Es la misma advertencia que dejaron los planes de la 009 y la
010, y sigue siendo cierta.

---

## Riesgos

**1. La idempotencia de `POST /api/sales` puede tragarse una venta si el `id` no
tiene entropía.** Con `sale_${Date.now()}`, dos cajas que cobran en el mismo
milisegundo generan el mismo id: hoy chocan contra la clave primaria y una de las
dos ve un error; con idempotencia, la segunda recibiría `yaRegistrada: true` con
los datos de la venta de la primera, **imprimiría un comprobante ajeno y no
registraría nada**. *Cómo se detecta:* no se detecta solo — no falla nada, y por
eso es el riesgo 1. *Mitigación:* los 8 hex aleatorios del id van en **el mismo
corte** que la idempotencia, nunca después, y el test de `services/api.js` verifica
que dos llamadas seguidas produzcan ids distintos.

**2. El cerrojo en `useRef` puede quedar tomado si una excepción escapa del
`try`.** El `finally` lo libera, pero un error lanzado **antes** de entrar al `try`
—por ejemplo al leer el ticket— dejaría `cobroEnCurso.current` en `true` y el POS
no cobraría más hasta cambiar de pantalla. *Cómo se detecta:* el botón queda
habilitado (el `disabled` sigue atado a `loading`, que sí se liberó) y no pasa
nada al apretarlo, que es el peor síntoma posible en un mostrador. *Mitigación:*
la asignación `cobroEnCurso.current = true` es **la primera línea del `try`**, no
la de antes, y el `finally` está en el mismo bloque. Queda con un comentario que
lo diga, porque mover esa línea «para que quede más prolijo» reintroduce el
riesgo.

**3. El arqueo de caja va a mostrar números distintos a partir del día del
cambio.** El «Efectivo» del día deja de incluir transferencias, QR y débito, y el
panel de control pasa de tres buckets a hasta nueve. *Consecuencia buscada* —es el
defecto 3— pero significa que el dueño ve cambiar un número que mira todos los
días. *Cómo se detecta:* comparando el resumen de dos días consecutivos alrededor
del deploy. *Cómo se amortigua:* nada del histórico se toca, así que la
comparación año contra año sigue siendo válida para los códigos que ya existían.
*Lo que no se hace:* agrupar los medios en el panel de control para que el número
«no cambie» — eso sería volver a mezclar billetes con CBU, que es el defecto.

**4. `tc1` en el segmento «Efectivo» se lee mal.** Un crédito en un pago aparece
adentro del segmento que se llama «Efectivo», porque cotiza a ese precio
(`legacy:6122`). *Cómo se detecta:* alguien pregunta por qué. *Por qué se acepta:*
el segmento **es** un nivel de precio y el encabezado del catálogo lo fija como
literal (FR-007). Moverlo a «Tarjeta» le cambiaría el precio al cliente respecto
del sistema viejo, que es una decisión de negocio y no de este plan. *Si molesta:*
sacar `tc1` del control del POS y dejarlo solo como valor histórico cuesta una
línea; lo que no se puede es cambiarle el segmento sin cambiar el precio.

**5. El popover del medio exacto agrega un control que la maqueta no dibuja.**
FR-020 pide un segmentado y la decisión 1 pide nueve medios; la maqueta dibuja
tres botones de 26px (`:404-417`). *Consecuencia:* `sdd-verify` va a comparar
contra la maqueta y encontrar un chevron que no está ahí. *Mitigación:* está
escrito acá y en el archivo, con el motivo — la maqueta se dibujó cuando la
pregunta 1 todavía no estaba contestada, igual que se dibujó antes de que
existiera el precio manual (FR-017 tiene el mismo argumento).

**6. Partir `Billing.jsx` en tres componentes puede filtrar estado.** Los tres
reciben props y no leen el store por su cuenta, pero es una convención que nada
verifica: el primero que agregue un `useStore(...)` adentro de `TicketDelPos`
crea una segunda fuente para el mismo dato. *Cómo se detecta:* no se detecta
automáticamente. *Mitigación:* queda escrito en el encabezado de cada archivo.
*Alternativa descartada:* dejar los 1.100 líneas en un archivo — es peor, pero
conviene decir que el corte es por tamaño y no porque haya evidencia de reuso.

**7. `App.jsx` cambia el marco de las dieciocho pantallas para arreglar una.**
El corte 5 mueve `max-w-[1320px] px-5 py-7` de un lugar a otro; un error ahí no
rompe el POS, rompe **todo lo demás**. *Cómo se detecta:* `npm run build` no lo
ve; se ve abriendo cualquier otra pantalla. *Mitigación:* el corte 5 va **solo**,
antes de tocar el POS, y su verificación es abrir tres pantallas distintas y
comparar. *Por qué se hace igual:* las alternativas (márgenes negativos, ruta
fuera del shell) están en la decisión 6 y las dos son peores.

**8. `POST /api/sales` es el camino más crítico del sistema y este plan lo toca
en tres lugares.** Idempotencia, el campo `stock` en la respuesta, y la sucursal
antes del `Sale.create`. *Cómo se detecta:* el total lo tiene que seguir
recalculando el servidor (`verificarTotal`, `sales.js:354-367`), `is_credit` tiene
que seguir dependiendo solo de `customer_id` (`:406-412`), y ninguna guardia de
`aislamientoEmpresas.test.js` puede empezar a fallar — el `findScoped` de la
idempotencia lleva `req.empresaId`, así que un id de otra empresa **no** encuentra
nada y la venta se crea normalmente, que es lo correcto. *Mitigación:* los tres
cambios van en el corte 1, juntos y aislados de todo lo visual.

**9. La búsqueda exacta por código depende de que el catálogo tenga los códigos
cargados.** Si `barcode` está vacío en la mayoría de los productos, el paso 1 de
la decisión 8 no matchea nunca y el paso 2 —«parece un código, no existe»— empieza
a rechazar escaneos de productos que **sí** están en el catálogo pero sin código
cargado. *Cómo se detecta:* el operador escanea y le dice que no existe.
*Mitigación:* el aviso dice explícitamente «ningún producto tiene ese código de
barras o SKU», que apunta al dato faltante y no al producto; y el operador puede
seguir buscando por nombre en el mismo campo.

**10. El catálogo entero sigue viniendo al navegador.** Declarado Fuera de alcance
(proyecto 5e). *Consecuencia, que hay que decir:* el POS es la pantalla que más lo
sufre, porque se abre al empezar el día y se deja abierta, y ahora además dibuja
la lista con scroll y un tope visible en vez de paginar (decisión 6 de la spec) —
o sea que el trabajo de dibujado por render sube. *Cómo se detecta:* el tiempo de
la primera carga y la fluidez del tipeo en la búsqueda con más de 2.000 productos.
*Si aparece:* el tope de resultados visibles ya está en el diseño y se puede bajar
sin tocar nada más.

---

## Anexos

- Parámetros, respuestas y códigos de error de `POST /api/sales`:
  [contracts/api-endpoints.md](./contracts/api-endpoints.md)
- **No hay `data-model.md`**: esta funcionalidad no agrega ni cambia ninguna
  columna. El motivo verificado está en la decisión 4.
