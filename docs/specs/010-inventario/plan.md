# Implementation Plan: Inventario — pasada fina

**Spec**: [spec.md](./spec.md) · **Rama**: `010-inventario`
**Escrito**: 1 de agosto de 2026

---

## Summary

`Inventory.jsx` se reescribe con el patrón de tabla de 009 y estrena panel
lateral de producto, comparación de sucursales lado a lado, importación pegando
texto, historial de costos, transferencia multi-ítem, export a Excel y vista de
impresión. Debajo de todo eso va el cambio que manda: **`Stock.punto_de_venta_id`
pasa a ser la identidad de la sucursal**, con una migración que crea el punto de
venta que falte, mapea, consolida duplicados **archivando cada fila que fusiona**,
reescribe `location` como espejo y recién ahí aplica `NOT NULL` y el índice único
—que hoy **no existe en la base**, aunque el modelo diga que sí—. Los diez sitios
que escriben `Stock` pasan por una única función que resuelve la sucursal, y una
guardia estática impide que vuelva a aparecer una escritura sin ella.
`ProductCostHistory` gana `empresa_id` y autor, y toda escritura que cambie un
costo lo registra.

---

## Technical Context

### Qué existe y se reusa tal cual

| Pieza | Dónde | Cómo entra |
|---|---|---|
| `TablaGrid`, `Encabezado`, `Fila`, `BotonDeFila` | `apps/web/src/components/TablaGrid.jsx` | El marco entero. Inventario no define medidas propias. |
| `InvoicesList.jsx` | `apps/web/src/pages/InvoicesList.jsx` | El ejemplo completo: `COLUMNAS` como constante, `ANCHO_MINIMO`, `BOTON_PRINCIPAL`/`BOTON_SECUNDARIO`, pie «Mostrando N de M», `Pagination`. |
| `Sheet` | `apps/web/src/components/ui/sheet.jsx` | Base de los dos paneles nuevos. `PanelVenta.jsx:114-120` tiene el detalle de por qué el ancho va en `style` y no en clases. |
| `exportarVentas.js` | `apps/web/src/utils/exportarVentas.js` | El molde del export: `COLUMNAS`, `celda()` con `t`/`z` forzados, `armarHoja`, `nombreDelArchivo`, test propio. |
| `calcularPrecios` | `apps/web/src/utils/precios.js:98` | Devuelve `{ cashPrice, cardPrice, alliancePrice, sinCosto, usaPrecioManual }`. Se consume, no se toca. |
| `aNumero` | `apps/api/src/services/comparadorService.js:142` | El lector de importes argentinos, **ya exportado y ya testeado** (`comparador.test.js:75-90`). |
| `findScoped` / `scoped` | `apps/api/src/utils/tenantScope.js` | Toda lectura y escritura por id. |
| `ErrorDeNegocio` + `fallo` | `apps/api/src/utils/errores.js` | «Stock insuficiente…» ya es `ErrorDeNegocio`; la sucursal que no resuelve también. |
| `POST /api/stock/transfer` | `apps/api/src/routes/stock.js:10` | Ya es transaccional y ya acepta `items[]`. La pantalla nueva usa lo que ya está. |
| `ImportWizard` pasos 2 y 3 | `apps/web/src/components/ImportWizard.jsx:461-658` | Mapeo, vista previa y errores por fila: agnósticos del origen. Solo el paso 1 cambia. |
| `PreciosMasivos` | `apps/web/src/components/PreciosMasivos.jsx:64` | Contrato: `{ open, onOpenChange, productIds: number[], onAplicado }`. Se preserva entero. |
| `scripts/migrar.js` | `apps/api/scripts/migrar.js` | Advisory lock de Postgres. La migración 14 entra por acá como las trece anteriores. |

### Qué se relevó y cambia el diseño

Cinco hallazgos que no estaban en la spec y que mueven decisiones:

**1. El índice único de `Stock` no es el que dice el modelo.** `Stock.js:66`
declara `{ unique: true, fields: ['product_id', 'punto_de_venta_id'] }`, pero esa
lista solo la aplica `sync()`, que este proyecto no usa. Lo que hay en Postgres
es `20260531-initial-schema.js:544`:

```js
await queryInterface.addIndex('stock', ['product_id', 'location'], { unique: true });
```

O sea: **el único índice único de `stock` es `(product_id, location)`**, sobre la
columna que esta funcionalidad degrada a espejo. FR-042 dice «hoy no separa nada
porque en PostgreSQL dos nulos no chocan»; el motivo real es más simple: **ese
índice no existe**. La migración tiene que crearlo, y tiene que sacar el otro
(decisión 6).

**2. Por lo mismo, el diagnóstico de `seedPuntosDeVenta` es incorrecto en su
mecanismo.** La spec dice que el seeder «se corta a la mitad en silencio» porque
el segundo `update` viola el índice único. No puede: `mapLocationField` escribe
**solo `punto_de_venta_id`** (`seedPuntosDeVenta.js:92`) y el índice real es sobre
`location`. Lo que el seeder sí hace mal es lo otro que la spec dice —dejar en
`null` para siempre las filas sin `code` coincidente, sin aviso— y tener un
`catch` de 70 líneas de alcance que se traga **cualquier** error del seeder
entero. Las dos cosas se corrigen (decisión 7). Conviene decirlo porque cambia
qué hay que verificar: no hay un `updated` que se detiene a la mitad, hay filas
que nunca se tocan.

**3. Las sucursales inactivas no llegan al navegador.**
`GET /api/empresas/mi-contexto` incluye los puntos de venta con
`where: { is_active: true }` (`empresas.js:195`), y el otro endpoint que los
lista (`empresas.js:558`) filtra igual **y pide `sucursales.ver`**, un permiso que
el supuesto 3 de la spec no le exige a esta pantalla. FR-066 («la sucursal dada
de baja con stock sigue apareciendo, marcada (inactiva)») y FR-115 («el origen sí
ofrece inactivas») **no se pueden construir con los datos que hoy tiene la
pantalla**. Sale un endpoint nuevo (decisión 12).

**4. Después de la migración, dos módulos dejan de descontar stock si no se los
toca.** `sales.js:404-412` busca la fila con
`punto_de_venta_id: req.puntoDeVentaId || null`, y `tiendanubeService.js:122-128`
hace lo mismo. Sin cabecera `X-Punto-De-Venta-Id` eso es `WHERE punto_de_venta_id
IS NULL`, que después de la migración **no matchea ninguna fila jamás**. El
efecto no es un error: es que la venta se registra y el inventario no baja, con
la advertencia de `sales.js:421` disparándose en cada línea. Lo mismo en
`PUT /api/sales/:id/void`, que usa `sale.punto_de_venta_id` —columna que esta
funcionalidad **no** migra (está en Fuera de alcance) y que en las ventas viejas
es `null`—: anular una venta vieja dejaría de devolver la mercadería. Es el
riesgo 1.

**5. `productionService` escribe stock sin `empresa_id`.** Las tres
`Stock.findOrCreate` de `productionService.js:167`, `:184` y `:272` tienen el
`where` sin `empresa_id`, y la de `:272` además tiene los `defaults` sin
`empresa_id` y sin `location`: una fila creada ahí cae en la empresa 1 por el
default de la columna. Es una fuga entre empresas cliente que ya existe; el
módulo es de superadmin y por eso no se vio. Como esos tres puntos hay que
tocarlos igual (FR-049), se corrigen en el mismo cambio.

### Módulos no liberados

**La pantalla es para el cliente** (supuesto 11): no van gates de superadmin ni en
la barra lateral, ni en `RouteGuard`, ni en la API. Los permisos vigentes
alcanzan (supuesto 3): `products.ver` mirar/exportar/imprimir, `products.editar`
editar, `products.crear` crear e importar, `stock.editar` ajustar,
`stock.transferir` transferir. **No se crea ningún permiso.**

Sí toca dos módulos que **están** detrás de superadmin —`productionService` y el
recosteo de recetas—, pero solo para que usen la función compartida de sucursal y
para registrar el autor del cambio de costo. Su gate no se toca.

---

## Lo que la spec pide y hay que ajustar

Cuatro cosas. La primera es la importante y es la que el encargo pidió revisar.

### 1. La regla de consolidación: sumar puede estar mal, y la migración no puede saberlo

**Qué dice la spec.** FR-045: se suman `quantity` y `available`, `min_stock` toma
el máximo, y `expiration_date`, `current_batch` y `purchase_date` salen de la fila
con más cantidad. El motivo escrito: «cada fila es mercadería que alguien contó en
algún lado».

**El caso en que ese motivo no se sostiene.** Dos filas del mismo producto que
caen en la misma sucursal pueden ser dos cosas distintas:

- **Dos pilas.** Una fila `location='deposito'` y otra `location='mostrador'`, sin
  `code` que coincida, las dos al punto de venta por defecto. Son 40 unidades
  atrás y 12 adelante. **Sumar es correcto.**
- **Una pila anotada dos veces.** Y este caso lo produce **el propio defecto que
  la spec describe**. Una empresa creada por `POST /api/empresas` tiene un solo
  punto de venta, `code = 'principal'`. El operador carga 100 unidades desde la
  pantalla: `POST /api/stock` escribe `location='principal'`,
  `punto_de_venta_id=X`. Después importa la lista del proveedor, que trae una
  columna de stock con las mismas 100: `import.js:303` usa
  `data.location || defaultLocation`, y `defaultLocation` es el string
  `'principal'`… salvo en las empresas que sembró `seedPuntosDeVenta`, cuyos
  códigos son `general`/`ortiz`/`mayo` y donde **`'principal'` no coincide con
  nada**. Ahí queda una segunda fila, `location='principal'`,
  `punto_de_venta_id=null`, con las **mismas 100 unidades**. Después del backfill
  las dos caen en el mismo punto de venta. Sumar da 200 sobre una estantería que
  tiene 100.

Y no es una hipótesis rebuscada: es literalmente el defecto 2 de la spec —«el
usuario importa 300 productos, la pantalla sigue mostrando los stocks viejos, y no
falla nada»—. Esa frase describe una pila anotada dos veces, no dos pilas.

**El punto que hace esto decidible o no.** `POST /api/stock`, `POST /api/stock/bulk`,
`POST /api/import/products` y `POST /api/products/bulk` escriben la cantidad
**en absoluto** (`stock.update({ quantity: qty })`). `purchaseService`,
`productionService`, `sales.js` y la transferencia escriben **deltas**. Una fila
escrita en absoluto por un camino y otra escrita en absoluto por otro camino, para
el mismo producto y la misma sucursal, es casi siempre **la misma pila**: los dos
caminos creían estar escribiendo la fila autoritativa. Dos filas donde al menos
una se armó con deltas es casi siempre **movimiento real que se acumuló aparte**.
Pero eso es una probabilidad, no un dato: **en la fila de `stock` no queda
registrado quién la escribió**, así que la migración no puede distinguirlas.

**Qué se hace, entonces.** Tres cambios sobre FR-045/FR-047, ninguno de los cuales
contradice «ningún dato se pierde» — lo hace literal en vez de aritmético:

**(a) Se suma, pero no se borra: se archiva.** Cada fila que se fusiona se copia
entera a `stock_migracion_sucursal` antes de desaparecer. Sumar mal deja de ser
irreversible: el operador tiene las filas originales para reconstruir y elegir, y
elegir cuál sobrevive es una decisión de negocio, no de una migración —el mismo
argumento que ya escribió `20260730-settings-pk-por-empresa.js` en su `down`—.
Además es lo que hace reversibles los pasos 2 a 4 (decisión 5), y es la forma
durable del informe que pide FR-046: un `logger.info` en un contenedor que se
recicla no es un rastro.

**(b) La migración no se corre a ciegas.** El plan de consolidación es una
función pura que se puede ejecutar **en modo informe** antes de escribir
(decisión 4). El informe marca cada fusión con las señales que hay: si las dos
filas tienen `current_batch` distinto y no nulo, son casi seguro dos pilas; si
las dos tienen la misma cantidad, o el mismo `updated_at` a menos de un día, o
las dos vienen de caminos que escriben en absoluto, la fusión queda marcada
**«revisar»**. Con datos de un cliente real, esa lista se mira antes de aplicar.

**(c) `expiration_date` cambia de criterio: la más próxima, no la de la fila
mayor.** Este es un error de la spec contra su propio razonamiento. Para
`min_stock` la spec elige el máximo y lo justifica: «el criterio conservador:
avisa antes de más, no de menos». Para el vencimiento elige el de la fila con más
cantidad, que es el criterio contrario. Si la fila de 100 unidades vence en enero
y la de 5 vence el mes que viene, la fila fusionada dice enero y **esas 5 unidades
desaparecen de la alerta de vencimientos** (`general.js:360-366`, que mira los
próximos 30 días). Perder un vencimiento cercano es plata, y en rubro alimenticio
es más que plata. Se toma **el mínimo de los `expiration_date` no nulos**.
`purchase_date`, por simetría y porque no alimenta ninguna alerta, también toma el
más antiguo. `current_batch` **sí** queda el de la fila con más cantidad —un lote
es una identidad, no una magnitud, y no hay forma de fusionar dos— pero los
descartados quedan en el archivo y en el informe: un lote que se pierde en
silencio es lo que rompe un retiro de producto.

**Resumen del cambio pedido a la spec:**

| Campo | FR-045 dice | Queda |
|---|---|---|
| `quantity`, `available` | la suma | **la suma**, con la fila original archivada |
| `min_stock` | el máximo | **el máximo** |
| `expiration_date` | el de la fila con más cantidad | **el más próximo de los no nulos** |
| `purchase_date` | el de la fila con más cantidad | **el más antiguo de los no nulos** |
| `current_batch` | el de la fila con más cantidad | igual, **y los descartados van al informe** |
| — | — | **cada fusión se marca «revisar» si hay señales de doble registro** |

### 2. FR-002 y FR-004 no dicen lo mismo sobre las columnas

FR-002 fija el string `minmax(0,1.6fr) 116px 116px 104px 104px` + una por
sucursal + `56px`, copiado de la maqueta (`AdminApp-Rediseno.dc.html:599`).
FR-004 dice que las columnas son «selección, Producto, Marca, Categoría, Costo,
Precio, una por sucursal, Acciones» — ocho grupos, nueve con tres sucursales. La
maqueta se dibujó antes de que existiera la selección para precios masivos, que
es justo lo que FR-009 obliga a conservar.

**Se resuelve a favor de FR-004 y FR-009**: la columna de selección existe y el
string arranca con `32px`. Queda:

```js
const COLUMNAS = (n) =>
  `32px minmax(0,1.6fr) 116px 116px 104px 104px ${'92px '.repeat(n)}56px`
const ANCHO_MINIMO = (n) => 848 + 108 * n   // 956 / 1064 / 1172
```

`92px` por sucursal sale de la maqueta; el `108` del ancho mínimo es esos 92 más
los 16 de separación que agrega cada columna.

### 3. FR-062 no entra en 92 píxeles

FR-062 pide cantidad, mínimo y valorizado por sucursal; el escenario 3 de la
historia 3 dice «mirándola con más atención». En 92px entran una cantidad y nada
más. **La celda es el badge con la cantidad; el mínimo y el valorizado salen en un
`Tooltip`** (`components/ui/tooltip.jsx`, ya está) y **están completos en el panel
del producto y en el `.xlsx`**. Lo que no se hace es apilar tres números en la
celda: la tabla es para escanear el catálogo, y tres cifras por sucursal por fila
la vuelven ilegible justo cuando hay tres sucursales, que es cuando importa.

### 4. FR-044 no cubre la empresa con todos los puntos de venta inactivos

«El de `code = 'principal'` si existe, y si no, el activo de menor `id`.» Una
empresa que cerró todos sus locales y todavía tiene stock cargado no tiene ningún
activo, y la migración se quedaría sin destino justo en el caso en que hay
mercadería que rescatar. **Se agrega un tercer escalón: el de menor `id`, activo o
no.** Y si no hay ninguno, ahí sí entra el paso 1 y se le crea `principal`.

---

## Decisiones

### 1. `punto_de_venta_id` manda y `location` es un espejo que escribe el servidor

**Se eligió:** `Stock.punto_de_venta_id` es la identidad. `location` se conserva
como `NOT NULL` y lo escribe siempre el servidor con el `code` del punto de venta
resuelto (o su `name` si el `code` es nulo, que es lo que ya hace
`general.js:117`). **Ninguna ruta acepta `location` del cliente para decidir dónde
va el stock**: `PUT /api/stock/:id` deja de copiarlo del body
(`general.js:65`).

**Alternativas descartadas:**

- **Borrar `location`,** que es lo más limpio, **porque** la leen todavía
  `GET /api/stock` (`general.js:26`), `GET /api/alerts` (`:377`),
  `StockTransfer.from_location`/`to_location`, `reports.js:81` y la pantalla de
  Reportes. Sacarla es una migración destructiva sobre una columna `NOT NULL` que
  además obliga a tocar seis lugares que esta funcionalidad no viene a rediseñar.
  Se degrada ahora y se saca cuando no la lea nadie.
- **Dejar que el cliente siga mandando `location` y sincronizarlo,** **porque** es
  exactamente el estado actual: dos entradas para el mismo dato, y ocho módulos
  eligiendo cuál. Un espejo que el cliente puede escribir no es un espejo.

### 2. Una sola función resuelve la sucursal, y una guardia estática lo mantiene

**Se eligió:** `apps/api/src/utils/sucursalDeStock.js`, con tres funciones:

```js
resolverSucursal({ empresaId, puntoDeVentaId, code, transaction })  // → PuntoDeVenta | throw ErrorDeNegocio
sucursalPorDefecto(empresaId, { transaction })                      // → PuntoDeVenta (FR-044, con el tercer escalón)
ubicacionDeStock(pv)                                                // → { punto_de_venta_id, location }
```

`resolverSucursal` prueba, en orden: el `punto_de_venta_id` recibido —validado
contra la empresa con `findScoped`—, el `code` recibido, y el por defecto. Un
`code` que no resuelve **tira `ErrorDeNegocio`**, no cae al por defecto: es la
diferencia entre FR-050 («la fila se informa como error, no se inventa una
sucursal») y el comportamiento de hoy. Los diez sitios que escriben `Stock`
piden el par `{ punto_de_venta_id, location }` a `ubicacionDeStock` y lo escriben
entero.

La guardia (FR-052) va en `aislamientoEmpresas.test.js`, con la forma del bloque
de AFIP: por cada `Stock.create(` / `Stock.findOrCreate(` en `routes/` y
`services/`, las 6 líneas siguientes tienen que mencionar `punto_de_venta_id` y
**no** puede aparecer `punto_de_venta_id: null` ni `|| null`.

**Alternativas descartadas:**

- **Un hook `beforeValidate` en el modelo `Stock`** que complete la sucursal,
  **porque** el modelo no tiene `req` y por lo tanto no sabe cuál es el punto de
  venta activo ni puede validar que el recibido sea de la empresa. Terminaría
  poniendo el por defecto en casos donde el usuario eligió otro, en silencio, que
  es la clase de magia que produjo este problema.
- **Una guardia genérica sobre `punto_de_venta_id: null` en todo el código,**
  **porque** `StockMovement.punto_de_venta_id` sigue siendo nullable a propósito
  y `sales.js:446` y `general.js:85` lo escriben así legítimamente. Una guardia
  que empieza con seis excepciones no se lee. Se acota a los bloques de escritura
  de `Stock`.

### 3. La migración no usa los modelos de Sequelize

**Se eligió:** todo con `queryInterface.sequelize.query` y SQL crudo.

**Alternativas descartadas:** usar `Stock`, `PuntoDeVenta` y compañía, que es más
cómodo, **porque** un modelo describe el esquema de **hoy** y una migración tiene
que seguir funcionando dentro de un año, cuando el modelo tenga tres columnas más
y dos menos. `20260730-settings-pk-por-empresa.js` ya lo hace así. Además el
modelo `Stock` declara un índice que la base no tiene (hallazgo 1): confiar en él
adentro de la migración sería confiar en metadatos muertos.

### 4. El plan de consolidación es una función pura, y por eso se puede ver antes de aplicarlo

**Se eligió:** `apps/api/src/utils/consolidacionDeStock.js` exporta
`planificar({ filas, puntosDeVenta })` → `{ asignaciones, fusiones, avisos }`.
**No toca la base**: recibe las filas ya leídas y devuelve qué habría que hacer.
Dos consumidores:

- `apps/api/scripts/informe-stock-sucursal.js` — lee, planifica, **imprime y no
  escribe nada**.
- La migración 14 — lee, planifica, aplica.

Los dos corren **el mismo código**, así que el informe es una vista previa de
verdad y no una segunda implementación que dice otra cosa.

**Alternativas descartadas:**

- **Un flag `--dry-run` en la migración,** **porque** una migración con modos es
  una migración que alguien va a correr en el modo equivocado, y porque
  `sequelize-cli db:migrate` no le pasa argumentos.
- **Escribir el informe consultando la base con SQL a mano, aparte de la
  migración,** **porque** son dos implementaciones de la misma regla y la que
  importa —la que escribe— es la que nadie miró. La spec ya cuenta cómo termina
  eso: el sistema viejo tenía dos parsers en el mismo archivo.
- **Verificarlo solo después, comparando sumas,** **porque** después de correr ya
  se fusionó. La suma total puede coincidir y la fusión estar mal igual: 100+100
  sobre una pila de 100 da 200 antes y 200 después.

### 5. Las filas fusionadas se archivan; eso es lo que hace reversible la migración

**Se eligió:** una tabla `stock_migracion_sucursal` que la migración crea y
llena con **una fila por cada fila de `stock` que tocó**: la que solo cambió de
sucursal (guardando `punto_de_venta_id` y `location` anteriores) y la que
desapareció fusionada (guardando además el `JSONB` completo). También guarda los
puntos de venta que la migración creó. `down()` restaura desde ahí.

**Alternativas descartadas:**

- **Borrar las fusionadas y confiar en que la suma es correcta,** que es lo que
  FR-047 permite literalmente («no borra ninguna fila sin haber sumado su
  cantidad»), **porque** deja el caso «una pila anotada dos veces» sin ninguna
  salida: el operador ve 200, sabe que hay 100, y no tiene con qué reconstruir de
  dónde salió cada mitad. Y porque sin archivo los pasos 2, 3 y 4 son
  irreversibles y el `down` sería una mentira.
- **Un backup de la tabla `stock` antes de migrar,** **porque** el backup vive
  fuera del repositorio y del deploy: no está garantizado que exista, no se
  versiona, y restaurarlo pisa además todo lo que se escribió después. El archivo
  es parte de la migración y viaja con ella.
- **Solo archivar las fusionadas y declarar irreversible el backfill,**
  **porque** el paso 4 reescribe `location` y ahí se pierde el texto que el
  operador había puesto («deposito», «mostrador»). Es información real y cuesta
  una columna guardarla.

`down()` restaura exactamente lo archivado y **pisa lo que se haya escrito
después**. Es para volver atrás minutos después de un deploy, no semanas después;
queda dicho en el encabezado del archivo.

### 6. La migración también saca el índice único viejo

**Se eligió:** `DROP` de `stock_product_id_location` (único sobre
`(product_id, location)`, el que realmente existe) y alta de
`stock_product_id_punto_de_venta_id` único, en el último paso.

**Alternativas descartadas:** dejar el viejo como red de seguridad extra,
**porque** después de esta funcionalidad `location` es una columna derivada, y
una restricción única sobre una columna derivada produce fallas que no se
entienden: el día que cambie cómo se calcula el espejo —por ejemplo, dos puntos
de venta de la misma empresa con `code` nulo, que el índice `(empresa_id, code)`
**sí** permite— empiezan a saltar violaciones de unicidad desde una columna que
nadie considera autoritativa. Y porque el orden lo obliga igual: el paso que
reescribe `location` con el `code` asignado colisionaría con él si quedaran
duplicados, así que ya hay que razonarlo.

El `down` lo vuelve a crear, y **falla a propósito** si en el medio quedaron dos
filas con el mismo `(product_id, location)`.

### 7. `seedPuntosDeVenta.js` pierde el mapeo de `Stock` y el `catch` que tapaba todo

**Se eligió:** se saca la línea `await mapLocationField(Stock, …)`
(`seedPuntosDeVenta.js:45`) con un comentario que diga que `Stock` lo resuelve la
migración; se dejan los de `Sale`, `ProductionOrder` y `StockTransfer`, que siguen
sin migrar (Fuera de alcance de la spec); y el `catch` de
`seedPuntosDeVenta.js:74-76` deja de tragarse el error: loguea **y relanza**.

**Alternativas descartadas:**

- **Borrar el seeder entero,** **porque** `Sale`, `ProductionOrder` y
  `StockTransfer` todavía dependen de él para tener su `punto_de_venta_id`
  poblado, y las tres están fuera de alcance.
- **Dejarlo y documentar que no colisiona,** **porque** después de la migración
  `punto_de_venta_id` es `NOT NULL`: la consulta `where: { punto_de_venta_id:
  null }` sobre `stock` no puede devolver nada, así que es una consulta por boot
  cuyo único efecto es sugerirle al que lea el archivo que el seeder sigue
  siendo el dueño del mapeo de stock. Un no-op que miente sobre quién manda es
  peor que no estar.
- **Dejar el `catch` como está,** **porque** su alcance son las 70 líneas del
  seeder entero: hoy un error en el mapeo de `Sale` deja sin mapear
  `ProductionOrder` y `StockTransfer` y el arranque sigue como si nada. Es
  literalmente el defecto que la spec le atribuye —fallar en silencio— aunque el
  mecanismo sea otro.

### 8. Los diez sitios que escriben `Stock`, uno por uno

La spec habla de ocho módulos; son diez puntos de escritura, más uno que solo
lee. Todos pasan por `sucursalDeStock.js`.

| Módulo | Dónde | Qué cambia |
|---|---|---|
| `general.js` `POST /stock` | `:103-153` | Resuelve la sucursal (body → cabecera → por defecto). **Valida `quantity`/`available` negativos (FR-036)**. `findOrCreate` con `punto_de_venta_id` real; `location` sale del punto de venta, no del body. Manda `available` aunque el cliente no lo mande. |
| `general.js` `POST /stock/bulk` | `:156-183` | Se cae la rama que busca por `location`. Misma resolución. |
| `general.js` `PUT /stock/:id` | `:42-100` | Deja de aceptar `location` del body (`:65`). Lo demás queda: las validaciones de negativo y el `StockMovement` ya están bien. |
| `import.js` | `:300-311` | La columna Sucursal se resuelve contra el `code` **de esa empresa**; si no resuelve, error de fila con su número (FR-050) y sigue con las demás. Sin columna, el por defecto —no el string `'principal'`—. Además registra historial de costos (decisión 10) y lee importes con `aNumero` (decisión 11). |
| `products.js` `POST /bulk` | `:218-231` | Misma resolución. Además historial de costos. |
| `stock.js` `POST /transfer` | `:10-114` | Acepta `from_punto_de_venta_id`/`to_punto_de_venta_id` y sigue aceptando los `code` (FR-051). Un ítem con cantidad ≤ 0 **falla** en vez de `continue` (`:39`), que es lo que hoy puede dejar una transferencia sin ítems. Destino inactivo rechazado (FR-115); origen inactivo permitido. La fila de destino se crea siempre con sucursal. |
| `sales.js` `POST /` | `:404-412` | **Obligatorio, no opcional**: resuelve la sucursal por defecto cuando no hay cabecera. Sin esto la venta deja de descontar (hallazgo 4). |
| `sales.js` `PUT /:id/void` | `:530-538` | Resuelve `sale.punto_de_venta_id` → `sale.location` → por defecto. Las ventas anteriores a la migración tienen la columna en `null`. |
| `purchaseService` | `:97-118` | Se cae la rama por `location`. Misma resolución. |
| `productionService` | `:83`, `:161-188`, `:269-292` | Misma resolución **y se agrega `empresa_id` a los `where` y a los `defaults`** (hallazgo 5). |
| `tiendanubeService` | `:122-128` | Resuelve por defecto cuando el webhook no trae punto de venta. Sin esto el pedido de la tienda deja de descontar. |
| `controllers/tiendanube.js` | `:183` | **No cambia**: solo lee, y su `where` ya lleva `empresa_id`. |

### 9. El historial de costos guarda el id interno del usuario, no el `sub` de Auth0

**Se eligió:** `product_cost_history.usuario_id` `INTEGER` nulo, apuntando a
`usuarios.id`, más `empresa_id` `INTEGER` nulo con backfill desde el producto. La
pantalla muestra `usuario.nombre || usuario.email`; para las filas viejas,
vacío (FR-108, supuesto 16).

**Alternativas descartadas:**

- **Copiar la forma de `StockMovement.usuario_id`,** que es `STRING(255)` con el
  `sub` de Auth0 (`middleware/auth.js:15`), **porque** esa columna ya tiene
  guardado el literal `'tiendanube'` (`tiendanubeService.js:150`). Una columna que
  significa «id de usuario, o lo que sea» no se puede juntar con `usuarios` y no
  puede contestar «quién», que es la única pregunta que FR-102 hace. El `sub`
  además es del proveedor de identidad: el día que se cambie, el histórico queda
  huérfano.
- **Guardar el nombre desnormalizado,** para no juntar, **porque** duplica un dato
  que ya está y que puede cambiar. La junta es contra `usuarios` por clave
  primaria, en un panel que muestra diez filas.
- **`empresa_id` `NOT NULL`,** **porque** el backfill puede dejar filas sin empresa
  si un producto fue borrado duro alguna vez. Nula y con la guardia de aislamiento
  del lado de la consulta es honesto; `NOT NULL` obligaría a inventar un valor.

### 10. Un solo lugar escribe el historial de costos

**Se eligió:** `apps/api/src/utils/historialDeCostos.js` con
`registrarCambioDeCosto({ producto, costoAnterior, costoNuevo, motivo, usuarioId, transaction })`,
que decide si el cambio es significativo (`>= 0.01`, el umbral que ya usa
`products.js:135`) y escribe con `empresa_id` y autor. Lo usan `PUT /products/:id`,
`POST /products/bulk`, `POST /import/products`, `preciosService` (masivo y
deshacer) y `productionService` (recosteo). Los motivos quedan tipados como
constantes, que es lo que FR-105 pide distinguir.

**Alternativas descartadas:** un hook `afterUpdate` en `Product`, **porque** el
hook no sabe quién ni por qué —los dos datos que la funcionalidad viene a
agregar— y porque `costService.recalculateCascadingCosts` actualiza costos en
cascada dentro de la misma transacción: un hook los registraría todos como
ediciones manuales del usuario que tocó el insumo.

### 11. Pegar texto se normaliza en el navegador y viaja como el archivo que ya sabe recibir la API

**Se eligió:** el paso 1 del asistente gana un segundo origen. El texto pegado se
separa en el navegador —tabulación, `;` o dos o más espacios; salto de línea entre
filas (FR-091)—, se detecta si la primera fila es encabezado (FR-092) o se
sintetizan `Columna 1`, `Columna 2`… (FR-093), y **la matriz resultante se
serializa como un CSV canónico y se sube por `POST /api/import/products` tal como
se sube un archivo**. Los pasos 2 y 3 no se enteran. El endpoint no cambia.

**Alternativas descartadas:**

- **Un endpoint nuevo que reciba el texto o las filas en JSON,** **porque**
  duplica el bucle de importación de `import.js:209-320` —110 líneas con el
  manejo de errores por fila, la marca/proveedor `findOrCreate`, el `toNum` que
  no pisa costos y el stock— o exige refactorizarlo en el mismo cambio que ya
  toca ocho módulos.
- **Mandar el texto crudo y parsearlo en el servidor,** **porque** la vista previa
  del paso 2 la arma el navegador: serían dos parsers sobre el mismo texto, y el
  usuario confirmaría mirando uno mientras se importa el otro. Es exactamente el
  `bulkParseTxt` / `parsePaste` que la spec cita como el error del sistema viejo.

Dos detalles que definen si funciona:

- **La numeración de líneas.** El servidor informa `fila: i + 2`, contando desde
  el archivo. Como el navegador descarta líneas vacías y puede haber agregado un
  encabezado sintético, el asistente guarda la correspondencia fila-de-matriz →
  **línea original pegada** y traduce cada error antes de mostrarlo (FR-098). Sin
  esto, «error en la línea 14» apunta a otra línea.
- **El tope de 2.000** (FR-100) se aplica en el navegador, antes de armar nada.

### 12. La comparación de sucursales sale de un endpoint nuevo, no de `mi-contexto`

**Se eligió:** `GET /api/stock/sucursales`, permiso `stock.ver`, devuelve **todos**
los puntos de venta de la empresa —activos e inactivos— con
`{ id, name, code, is_active }`. La pantalla lo usa para las columnas (FR-066) y
para los selectores de la transferencia (FR-115). El stock por sucursal sale de
`product.stock[]`, que `products.js:59` ya devuelve con `punto_de_venta_id`.

**Alternativas descartadas:**

- **Sacarle el `where: { is_active: true }` a `mi-contexto`** (`empresas.js:195`),
  **porque** ese payload lo consume todo el shell: el selector de sucursal de la
  barra superior, el POS, `ProductForm` y `ImportWizard` empezarían a ofrecer
  locales cerrados. El radio de la explosión es toda la aplicación para resolver
  una columna de una pantalla.
- **Reusar `GET /api/empresas/:id/puntos-de-venta`** (`empresas.js:558`),
  **porque** filtra igual por `is_active` y pide `sucursales.ver`, un permiso que
  el supuesto 3 no le exige a esta pantalla: un usuario con `products.ver` y sin
  `sucursales.ver` vería la tabla sin columnas de stock.

### 13. «Stock bajo» se define una vez, en la API, y la pantalla la recibe

**Se eligió:** `apps/api/src/utils/stockBajo.js` con `UMBRAL_POR_DEFECTO = 3` y
`esStockBajo(fila, umbral)` —el `min_stock` si está cargado, si no el umbral—, que
usa `GET /api/faltantes` (hoy tiene el 3 literal en `general.js:416`). El umbral
sale además en `GET /api/settings` como `umbral_stock_bajo`, de solo lectura, y la
pantalla lo usa para el indicador, el filtro y el color del badge, con la misma
función portada a `apps/web/src/utils/stockBajo.js` **que recibe el umbral por
parámetro y nunca lo hardcodea**.

**Alternativas descartadas:** repetir el `3` en el frontend, **porque** FR-017
existe justamente para que dos pantallas del mismo sistema no digan cosas
distintas sobre qué falta, y dos literales iguales empiezan iguales y terminan
distintos. Exponerlo de solo lectura **no** es hacerlo configurable, que está
Fuera de alcance.

`GET /api/settings` pide `config.ver` y no `products.ver`, pero eso no agrega
una exigencia: `useStore.initialize()` ya lo llama en el mismo `Promise.all` que
trae los productos (`useStore.js:38-45`), así que sin `config.ver` hoy no carga
ninguna pantalla del store. Es anterior a esta funcionalidad y no se resuelve
acá.

Queda una inconsistencia **a propósito**: `GET /api/alerts` (`general.js:351-354`)
y `dashboardService.js:250` siguen con su regla vieja (`min_stock > 0`). FR-016
enumera indicador, filtro, badge y Faltantes; el panel de control no está en esa
lista y cambiarlo mueve un número que el usuario mira todos los días desde otra
pantalla. Queda anotado en el riesgo 6.

### 14. El listado se actualiza por producto, no recargando el catálogo

**Se eligió:** `useStore` gana `actualizarProducto(producto)` y
`quitarProducto(id)`, que reemplazan la fila en `products` sin tocar `loading`.
Guardar en el panel actualiza la fila y los indicadores con la respuesta del `PUT`
(FR-035). `initialize()` se sigue usando para importar y para el masivo de
precios, donde cambió medio catálogo.

**Alternativas descartadas:** seguir llamando `initialize()` después de cada
guardado, que es lo que hace hoy `Inventory.jsx:423`, **porque** dispara tres
requests, pone `loading: true` global —la tabla entera parpadea— y devuelve la
lista al estado inicial. FR-035 pide explícitamente no perder página, búsqueda,
orden ni scroll.

### 15. El PDF es la vista de impresión, y el bloqueo de la ventana se avisa

**Se eligió:** `apps/web/src/utils/impresionInventario.js` arma el HTML del
listado filtrado —encabezado con fecha, sucursal y cantidad; totales al pie—, lo
abre con `window.open` y llama a `print()`. La hoja lleva
`print-color-adjust: exact` (FR-133) y `break-inside: avoid` en cada fila
(FR-134). **Si `window.open` devuelve `null`, la función lo devuelve y la pantalla
avisa qué hacer** (FR-135).

**Alternativas descartadas:** copiar `printInvoice.js` tal cual, **porque**
`printInvoice.js:94` hace `if (!printWindow) return;` — con el bloqueador de
ventanas emergentes activo, el usuario aprieta Imprimir y **no pasa nada**. Es
exactamente lo que FR-135 prohíbe, y está a punto de copiarse por inercia.

La hoja de impresión es **el único archivo con hexadecimales permitidos** (FR-010,
FR-133) y por eso vive en `utils/`, fuera de la lista de
`guardiasDeDiseno.test.js`: imprime sobre papel blanco y los tokens de pantalla no
existen ahí.

### 16. `PUT /api/products/:id` deja de hacer `update(req.body)` crudo

**Se eligió:** lista blanca de campos, como ya hizo `PUT /api/stock/:id`
(`general.js:58-68`).

**Alternativas descartadas:** dejarlo, **porque** `products.js:132` copia el body
entero sobre la fila: un request armado a mano puede mandar `empresa_id` y
**mover el producto a otra empresa cliente**. Hoy lo ejercita un formulario con
15 campos; con el panel nuevo esa ruta pasa a ser el camino principal de edición
del catálogo, incluida la reactivación (FR-039, que manda `is_active: true`). Son
ocho líneas y FR-079 pide que ninguna guardia de aislamiento empiece a fallar.

---

## Project Structure

### Archivos nuevos

```
apps/api/src/
  migrations/20260804-identidad-de-sucursal-en-stock.js   la migración 14
  utils/sucursalDeStock.js                    resolución única de sucursal (FR-049)
  utils/consolidacionDeStock.js               plan de consolidación, función pura
  utils/historialDeCostos.js                  registrarCambioDeCosto (FR-104, FR-105)
  utils/stockBajo.js                          la regla única y su umbral (FR-016, FR-017)
  utils/importes.js                           aNumero, movido desde comparadorService
  tests/consolidacionDeStock.test.js          la parte que decide qué se fusiona
  tests/sucursalDeStock.test.js               orden de resolución y por defecto
  tests/stockBajo.test.js                     min_stock cargado, en 0, negativo
  scripts/informe-stock-sucursal.js           el modo informe, sin escribir nada

apps/web/src/
  components/PanelProducto.jsx                el panel lateral (reemplaza ProductForm)
  components/PanelTransferencia.jsx           transferencia multi-ítem
  components/HistorialDeCostos.jsx            sección del panel, con «ver más»
  utils/exportarInventario.js                 filas → hoja xlsx, tipos forzados
  utils/exportarInventario.test.js
  utils/impresionInventario.js                la hoja de impresión
  utils/impresionInventario.test.js
  utils/stockBajo.js                          la misma regla, umbral por parámetro
  utils/stockBajo.test.js
```

### Archivos modificados

```
apps/api/src/
  models/Stock.js                punto_de_venta_id NOT NULL; indexes al día con la base
  models/ProductCostHistory.js   +empresa_id, +usuario_id, +índice (empresa_id, change_date)
  models/index.js                ProductCostHistory ↔ Usuario, ↔ Empresa
  routes/general.js              POST /stock valida negativos y resuelve sucursal ·
                                 POST /stock/bulk sin rama location · PUT /stock/:id
                                 no acepta location · /faltantes usa utils/stockBajo ·
                                 GET /settings expone umbral_stock_bajo
  routes/stock.js                +GET /sucursales · transfer con ids, sin `continue`
                                 silencioso, destino inactivo rechazado ·
                                 GET /transfers con los nombres de las sucursales
  routes/products.js             PUT con lista blanca · POST /bulk y cost-history
                                 con historial y autor · cost-history paginado
  routes/import.js               sucursal por id, importes argentinos, historial
  routes/sales.js                POST / y PUT /:id/void resuelven sucursal
  services/purchaseService.js    sucursal por la función compartida
  services/productionService.js  idem + empresa_id en los tres where
  services/tiendanubeService.js  idem
  services/preciosService.js     historial con autor y motivo tipado
  services/comparadorService.js  reexporta aNumero desde utils/importes
  seedPuntosDeVenta.js           sin el mapeo de Stock; el catch relanza
  tests/aislamientoEmpresas.test.js   +guardia de escritura de stock sin sucursal

apps/web/src/
  pages/Inventory.jsx            reescritura completa
  components/ImportWizard.jsx    paso 1 con dos orígenes
  store/useStore.js              +actualizarProducto, +quitarProducto, +sucursales
  services/api.js                getSucursalesDeStock, transferStock con ids,
                                 getCostHistory, importProducts sin cambios
  tests/guardiasDeDiseno.test.js  +Inventory.jsx, +los tres componentes nuevos,
                                  y el toHaveLength(3) pasa a 7

apps/web/src/components/ProductForm.jsx   se elimina (solo lo usa Inventory.jsx:419)
docs/PROXIMOS-PROYECTOS.md                paginar el catálogo contra el servidor
docs/REGLAS-DISENO.md                     Inventario como segunda pantalla del patrón
```

### Orden de construcción

Cada corte se verifica solo y ninguno rompe el anterior.

1. **`utils/sucursalDeStock.js`, `utils/stockBajo.js`, `utils/importes.js` y sus
   tests.** Funciones puras, nada visible.
2. **`utils/consolidacionDeStock.js` + `scripts/informe-stock-sucursal.js`.** Acá
   ya se puede correr el informe contra la base de desarrollo y **mirarlo**.
3. **La migración 14 + `models/Stock.js`.** Después de que el informe se haya
   revisado. Es el punto sin retorno del cambio.
4. **Los diez escritores + la guardia estática.** Van juntos: la guardia falla
   hasta que estén los diez, que es la idea.
5. **`ProductCostHistory` (columnas + `historialDeCostos.js`) y los cinco
   caminos que escriben costo.**
6. **`GET /api/stock/sucursales` y los cambios de contrato de `stock.js` y
   `products.js`.**
7. **La tabla** (historia 1) y **la comparación** (historia 3), que son la misma
   tabla.
8. **`PanelProducto.jsx`** (historia 2), con la sección de stock y la
   reactivación.
9. **`HistorialDeCostos.jsx`** (historia 6), que cuelga del panel.
10. **`PanelTransferencia.jsx`** (historia 5).
11. **Pegar texto en `ImportWizard`** (historia 4).
12. **Export e impresión** (historia 7).

Del 1 al 6 es API y no se ve; del 7 al 12 sigue las prioridades de la spec.

---

## Cómo se verifica

Vale la misma advertencia que dejó escrita el plan de 009 y que sigue siendo
cierta: **no hay infraestructura para probar rutas contra una base**. Los dobles
de `tests/helpers/modelosFalsos.js` no entienden `Op`, ni `include`, ni `lock`.
Un test sobre esos dobles para «verificar» la migración probaría el doble.

**Lo que se testea con jest, porque son funciones puras** —y se extraen a `utils/`
justamente para eso:

| Qué | Archivo | Cubre |
|---|---|---|
| Qué filas se fusionan y con qué valores: suma, máximo del mínimo, vencimiento más próximo, lotes descartados, marca «revisar» | `tests/consolidacionDeStock.test.js` | FR-045, FR-046, FR-047 |
| Idempotencia: el mismo plan sobre filas ya migradas no propone nada | `tests/consolidacionDeStock.test.js` | FR-048 |
| Orden de resolución de sucursal, `code` que no resuelve, los tres escalones del por defecto | `tests/sucursalDeStock.test.js` | FR-043, FR-044, FR-050 |
| `min_stock` cargado / en 0, el mismo número que Faltantes | `tests/stockBajo.test.js` | FR-016, FR-017 |
| La hoja: costo y valorizado como número, SKU como texto, precio vacío sin costo | `utils/exportarInventario.test.js` | FR-123, FR-124, FR-126 |
| La hoja de impresión: `print-color-adjust`, totales, ventana bloqueada | `utils/impresionInventario.test.js` | FR-133, FR-134, FR-135 |
| Separadores, encabezado detectado o no, importes argentinos, repetidos, tope de 2.000, traducción del número de línea | `components/ImportWizard` (test nuevo del parser) | FR-091 a FR-100 |

**Lo que se verifica leyendo el archivo**, con la forma de las guardias que ya
existen:

- `guardiasDeDiseno.test.js` con `Inventory.jsx`, `PanelProducto.jsx`,
  `PanelTransferencia.jsx` y `HistorialDeCostos.jsx` sumados a la lista, y el
  `expect(ARCHIVOS).toHaveLength(3)` actualizado — **si eso no se toca, la guardia
  falla y ese es el recordatorio de que la lista se agrandó**.
- `aislamientoEmpresas.test.js` con la guardia de FR-052.

**Lo que solo se puede verificar contra Postgres, y queda como paso manual
reproducible para `sdd-verify`:**

- El informe de `informe-stock-sucursal.js` sobre la base de desarrollo, mirado
  fila por fila **antes** de aplicar.
- `SELECT count(*) FROM stock WHERE punto_de_venta_id IS NULL` = 0 (criterio 5).
- `SUM(quantity)` agrupado por `(empresa_id, product_id)` antes y después:
  idéntico. **La migración lo chequea sola y aborta la transacción si no da**, así
  que esto es confirmar que el chequeo corrió.
- Correr la migración dos veces (criterio de FR-048) y que la segunda no haga
  nada.
- El `down` completo sobre una copia, y que la tabla quede como estaba.
- Una venta sin cabecera `X-Punto-De-Venta-Id` sigue descontando stock
  (hallazgo 4).
- El `.xlsx` abierto en Excel: SKU con ceros adelante, columna Valorizado que
  suma y coincide con el indicador.

---

## Riesgos

**1. Después de la migración, tres caminos dejan de descontar stock si no se los
toca.** `sales.js:404`, `sales.js:530` y `tiendanubeService.js:122` buscan la fila
con `punto_de_venta_id IS NULL`, que pasa a no existir. *Consecuencia:* la venta se
registra, el inventario no baja, y lo único que avisa es la advertencia de
`sales.js:421` en la respuesta y en el log. Es el riesgo más grave del cambio,
porque **no rompe nada visible**. *Cómo se detecta:* vender un producto sin
cabecera de punto de venta y mirar si `stock.quantity` bajó; el log tiene
`sales: venta sin fila de stock, no se descuenta`. *Mitigación:* los tres están en
la tabla de la decisión 8 y van en el mismo corte que la migración, no después.

**2. La suma de la consolidación puede inflar el inventario.** Es lo analizado
arriba: dos filas que son la misma pila anotada dos veces. *Cómo se detecta:* el
informe previo marca las fusiones sospechosas; después, un recuento físico.
*Techo:* solo afecta productos con más de una fila de stock por sucursal antes de
migrar, que el informe cuenta exactamente. *Si aparece:* las filas originales
están en `stock_migracion_sucursal` y se reconstruye. **Ese archivo es la
mitigación entera; sin él este riesgo no tiene salida.**

**3. `import.js` empieza a rechazar filas que antes aceptaba.** Hoy una columna
Sucursal con cualquier texto crea o encuentra una fila por `location`. Con FR-050,
un texto que no resuelve contra ningún `code` es un error de fila. *Consecuencia
buscada*, pero significa que una planilla que «funcionaba» ahora informa 300
errores. *Cómo se detecta:* la primera importación después del cambio. *Cómo se
amortigua:* el mensaje de error dice qué códigos de sucursal existen, en vez de
solo «sucursal inválida».

**4. `location` sigue siendo `STRING(30)`.** El espejo se escribe con el `code`
del punto de venta, y `PuntoDeVenta.code` también es `STRING(30)`: entran justo.
Pero si el `code` es nulo, el espejo cae al `name`, que es `STRING(100)`. Un
nombre de sucursal de más de 30 caracteres haría fallar el `INSERT` de una fila de
stock. *Mitigación:* `ubicacionDeStock` recorta a 30 y lo deja anotado; el dato
autoritativo es el id, así que recortar el espejo no pierde nada.

**5. `stock_migracion_sucursal` es una tabla que queda para siempre por una
migración.** Es clutter aceptado a cambio de reversibilidad y del rastro que pide
FR-046. *Cuándo se saca:* cuando el inventario de Comprafit esté cargado y
verificado, en una migración posterior de una línea. Queda anotado en
`PROXIMOS-PROYECTOS.md`.

**6. «Stock bajo» va a seguir diciendo dos números distintos en dos pantallas.**
Inventario y Faltantes se unifican (FR-016); el panel de control (`/api/alerts`,
`dashboardService.js:250`) se queda con `min_stock > 0`, que **nunca** cuenta un
producto sin mínimo cargado. *Consecuencia:* Inventario va a mostrar más
productos en stock bajo que el panel de control. *Cómo se detecta:* comparando
las dos pantallas. *Por qué se acepta:* FR-016 no incluye el panel, y cambiarlo
mueve un número que el usuario mira todos los días desde otra funcionalidad.

**7. La pantalla sigue trayendo el catálogo entero.** Es el defecto 6, declarado
Fuera de alcance. Con 5.000 productos y tres sucursales son 15.000 filas de stock
en la respuesta de `initialize()`. *Consecuencia:* la pantalla tarda en abrir, y
el techo real del export no es el tope de 5.000 sino cuántos productos entraron
en la carga inicial. *Cómo se detecta:* el tiempo de la primera carga; FR-077
solo mide el filtrado sobre lo ya cargado, que no lo cubre. *Si aparece:* la API
ya pagina (`products.js:64`).

**8. Cuatro archivos nuevos entran a la guardia de diseño de golpe.** El
`expect(ARCHIVOS).toHaveLength(3)` de `guardiasDeDiseno.test.js:88` obliga a
tocarla, lo cual está bien; el riesgo es al revés: agregar los archivos a la lista
**después** de escribirlos, y descubrir treinta hexadecimales al final. *Cómo se
evita:* los archivos entran a la lista **vacíos**, en el paso 7, antes de tener
contenido.

**9. Eliminar `ProductForm.jsx` toca el alta de producto, no solo la edición.**
Hoy el alta (`ProductForm.jsx:194`) **no crea ninguna fila de stock**:
`stockEntries` está vacío al crear. `PanelProducto` va a poder hacerlo, lo que
significa que el alta pasa a escribir en `Stock` por un camino que antes no
existía. *Cómo se detecta:* crear un producto con cantidad en dos sucursales y
verificar que quedan dos filas, las dos con `punto_de_venta_id`. *Por qué se hace
igual:* el escenario 10 de la historia 2 lo pide.

**10. `productionService` tiene `Stock.findOrCreate` sin `empresa_id` y hay que
tocarlo.** Corregir una fuga de aislamiento adentro de un cambio de otra cosa es
como se cuelan las regresiones. *Cómo se detecta:* `productionService` tiene tests
(`costService.test.js` cubre parte del recosteo); los tres `where` corregidos
llevan un test propio que falla si se le saca el `empresa_id`. *Alternativa
descartada:* dejarlo para otro momento — pero esas tres líneas hay que
reescribirlas igual por FR-049, y dejar el `where` incompleto sabiendo que está
mal no es una opción.

---

## Anexos

- Columnas, tipos, índices, el paso a paso de la migración y qué es reversible:
  [data-model.md](./data-model.md)
- Parámetros, respuestas y códigos de error: [contracts/api-endpoints.md](./contracts/api-endpoints.md)
