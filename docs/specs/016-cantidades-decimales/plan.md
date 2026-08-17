# Implementation Plan: Cantidades decimales en la cadena de stock y ventas

**Spec**: [`spec.md`](./spec.md) · **Estado**: aprobada, con los cuatro pendientes resueltos
**Modelo de datos**: [`data-model.md`](./data-model.md) · **Contrato**: [`contracts/api-endpoints.md`](./contracts/api-endpoints.md)

---

## Summary

Nueve columnas de cuatro tablas pasan de `INTEGER` a `DECIMAL(14,4)` en una sola
migración transaccional. El driver empieza a devolverlas como texto —`"12.0000"`—,
así que en el mismo entregable se corrigen los **cuatro sitios de aritmética** que
concatenan en vez de sumar, los **dos mensajes del servidor** que dibujarían la
escala cruda, la importación que trunca con `parseInt`, y los **diez puntos de la
web** donde una cantidad se dibuja. `POST /api/sales` pasa a rechazar toda cantidad
no entera: la capacidad queda en el esquema y la puerta sigue cerrada hasta la 017.
No aparece ningún control, campo ni pantalla nueva.

---

## Technical Context

### Lo que se reusa, y no se vuelve a escribir

| Pieza que ya existe | Para qué se usa acá |
|---|---|
| `src/migrations/20260814-productos-publicables.js` | **El molde de la migración**: todo en una transacción, la promesa verificada adentro de esa misma transacción con un `COUNT(*)`, y el `down` avisando por log qué se pierde |
| `src/migrations/20260804-identidad-de-sucursal-en-stock.js` | **El molde de la negativa condicional** del `down` (`:464-473`) y de la foto de control `ON COMMIT DROP` (`:76-84`) |
| `src/tests/observabilidad.test.js` | **El molde de la guardia estática**: `leerCarpeta('routes'|'services'|'utils')`, el ancla que afirma cuántos archivos leyó, el detector probado contra una muestra mala y una buena, y el filtro de comentarios |
| `src/tests/modeloStock.test.js`, `modeloSale.test.js` | **El molde de atar el modelo a la migración** leyendo el fuente de las dos puntas |
| `src/tests/integracion/baseDePruebas.js` + `fixtures.js` | El arnés del cuarto nivel. `conectarOFallar`, `limpiarLaBase`, `sembrarDosEmpresas` |
| `src/tests/integracion/importesConDecimales.integracion.test.js` | El precedente exacto de «un DECIMAL vuelve como string» ejecutado contra Postgres |
| `src/utils/calculosVenta.js` | `normalizarItem` ya convierte con `Number(...)` y ya devuelve `0` ante `'tres'`; `aCentavos` (`:12-14`) es el precedente del redondeo explícito |
| `apps/web/src/utils/formato.js` | `enEsAr(n, min, max)` (`:72-77`), sobre el que se construye el formateador nuevo |
| `apps/web/src/utils/formato.test.js` | La guardia de formateo que recorre `pages/` y `components/` con recursión y **afirma cuántos archivos revisó** (`:621-639`) |
| `src/utils/errores.js` | `ErrorDeNegocio` para el rechazo de cantidad inválida y para el mensaje de transferencia |

### Lo que se verificó y **no** hay que tocar

Cada uno se nombra para que nadie «lo arregle» y escriba un test que pasa con y sin
el cambio:

- **La sincronización con TiendaNube está a salvo.** `utils/tiendanubeCola.js:226-228`
  (`stockAPublicar`) y `:243-260` (`hayQueEmpujar`) ya hacen `Number(disponible)` y
  `Math.trunc`, y la reconciliación diaria compara **números convertidos**, no los
  crudos. `tiendanubeService.js:522-523` es una **resta**. Ni un PUT ni la
  reconciliación cambian de comportamiento.
- **El catálogo público está a salvo**: `routes/catalogoPublico.js:237` y `:689`
  envuelven en `Number(s.available)`.
- **`utils/stockBajo.js`, `utils/inventario.js` y `utils/consolidacionDeStock.js`**
  envuelven cada lectura en `Number(...) || 0`, con el motivo escrito arriba.
- **`services/productionService.js`** ya usa `parseFloat` en `:247`, `:355`, `:482`
  y `:506`. Su defecto era la **columna de destino**, que esta migración arregla:
  no hay que tocarle una línea de aritmética.
- **`routes/sales.js:553-554`** y **`routes/stock.js:145-146`** son restas y andan.
- **`packages/precios`** (FR-040) y **`apps/tienda`** (FR-043) no se tocan.

### Módulos no liberados

**No hay gates nuevos que poner.** 016 no agrega ningún endpoint ni ninguna
pantalla, así que los tres lados —barra lateral, `RouteGuard`, `requireSuperadmin`
en la API— quedan exactamente como están. Lo que sí conviene tener presente para
leer los riesgos: de los diez puntos donde se dibuja una cantidad, **dos viven
detrás de `requireSuperadmin`** (`app.use('/api/reports', …, requireSuperadmin, …)`,
`server.js:663`) y la producción que motiva la spec también
(`server.js:655`). O sea que la regresión de esos puntos la vería un operador de la
plataforma, no un cliente; la de los otros ocho la ve Comprafit el mismo día.

### Diseño

No hay pantalla nueva ni componente nuevo: **cero cambios de color, de token y de
maquetado**. Lo único que se toca de la web es el texto de un número, y sale de
`utils/formato.js`. `REGLAS-DISENO.md` no aplica más allá de eso.

---

## Lo que la spec pide y **no se puede construir como está**

Tres cosas. Se listan primero porque cambian el alcance del trabajo, y es más
barato discutirlas ahora que en la tarea 14.

### 1 · `PanelProducto.jsx:1158` no puede pasar por el formateador (FR-034)

FR-034 mete el campo editable de cantidad entre los siete puntos que «DEBEN pasar
por esa función». **No puede.** Es un `<input type="number">`, y el algoritmo de
saneamiento del valor de ese control descarta todo lo que no sea un número de punto
flotante válido: un `value="9,6"` —con coma— deja el campo **en blanco**. O sea que
aplicarle el formateador argentino convierte un stock fraccionario en un campo
vacío que, si alguien guarda, escribe cero.

Lo que corresponde ahí es **normalización numérica en el origen** (`:310`,
`quantity: existente?.quantity ?? 0` → `Number(...)`), que devuelve `10` y `9.6`.
Ver la decisión «El campo editable de PanelProducto…».

### 2 · Falta un punto: son **diez**, no nueve

La tabla de la spec lista `PanelProducto.jsx:1158` (`value={fila.quantity}`) y se
olvida de **`PanelProducto.jsx:1165` (`value={fila.min_stock}`)**, tres líneas más
abajo, en el mismo `<div>`. `min_stock` también migra a `DECIMAL(14,4)` (FR-001),
así que ese campo mostraría `0.0000` con la base tal como está hoy. Se corrige junto
con su hermano y por el mismo camino.

### 3 · El formateador **agrupa los miles**, y eso rompe US4

`enEsAr(n, 0, 3)` es `toLocaleString('es-AR')` con los extremos puestos, y en
`es-AR` eso agrupa: **`1234` sale `1.234`**. Medido, no supuesto. Hoy
`{item.quantity}` dibuja `1234`. O sea que el formateador que la spec pide para no
cambiar nada **cambia todo stock de cuatro cifras o más**, que es exactamente lo que
el criterio de éxito 2 prohíbe («carácter por carácter»).

La salida está en la decisión «El formateador de cantidad…»: `enEsAr` recibe un
cuarto parámetro para apagar la agrupación, y las cinco funciones de plata siguen
llamándola con tres.

---

## Decisiones

### Dónde se convierte el `DECIMAL`: en el sitio de uso, no en un getter del modelo

**Se eligió:** conversión explícita donde el valor se usa, con un helper propio
(`src/utils/cantidades.js`) y una guardia estática que falla si vuelve a aparecer un
`+` desnudo sobre una cantidad.

**Alternativas descartadas:** un `get()` en los nueve atributos de los cuatro
modelos de Sequelize, que devolvería `Number(...)` y arreglaría los cuatro sitios
—y de paso dejaría el JSON idéntico al de hoy, sin tocar una sola pantalla—,
**porque** son tres cosas a la vez y las tres importan:

1. **No cubre `raw: true`, ni `sequelize.query`, ni los agregados.** Un getter de
   Sequelize solo corre cuando hay instancia. `services/dashboardService.js:596-606`
   y `:917-928` leen `quantity` y `min_stock` con `raw: true`; `routes/reports.js:35`
   hace lo mismo con las líneas de venta. Ahí el getter no existe. Es la peor forma
   de cobertura: anda en casi todos lados, así que nadie mira los lugares donde no.
2. **Sacarlo es invisible.** El encabezado de `src/tests/helpers/modelosFalsos.js`
   lo dice de sí mismo: «un bug que solo aparece contra Postgres real —por ejemplo,
   DECIMAL devuelto como string— NO lo atrapan estos tests». Los 1400 tests rápidos
   pasan en verde con y sin el getter. Una guardia estática, en cambio, se pone en
   rojo en `npm run test:api`, en **todos** los archivos y no solo en el que alguien
   se acordó de probar.
3. **Haría que la respuesta mienta sobre la columna.** El repositorio ya tomó esta
   decisión para la plata y la dejó escrita:
   `tests/integracion/centavoDelSaldo.integracion.test.js:243` explica por qué el
   `total` viaja como string y `:53-56` lo fija con
   `expect(typeof filas[0].total).toBe('string')`. La regla es «lo que hay en la base
   viaja tal cual y cada consumidor convierte», y el precio de aplicarla acá está
   presupuestado: es el formateador de FR-030 a FR-037.

⚠ Y para que no se confunda con H6: **la objeción al `setTypeParser` global no es la
misma que la objeción al getter.** Aquel rompería los importes; un getter por
columna de cantidad no los tocaría. El getter se descarta por los tres motivos de
arriba, no por precisión.

### Una función `sumarCantidades`, y no un `Number(...) + Number(...)` suelto

**Se eligió:** `src/utils/cantidades.js` con cuatro funciones puras —`aCantidad`,
`sumarCantidades`, `redondearCantidad`, `textoDeCantidad`— y los cuatro sitios
llamando a `sumarCantidades(a, b)`.

**Alternativas descartadas:** escribir `Number(stock.quantity) + Number(item.quantity)`
en cada sitio, **porque** el defecto que estamos corrigiendo nació justamente de
tener la misma cuenta escrita en cuatro lugares y arreglada en ninguno, y porque un
`Number(x) || 0` inline convierte en silencio un dato ilegible en un cero de
inventario. Con una función hay un solo lugar donde se decide qué pasa con `null`,
con `''` y con `'tres'`, y hay un test de unidad —barato, en `src/tests/`— que lo
dice. Además la guardia estática puede exigir la forma: `sumarCantidades(` es un
literal que se busca; «que hayan convertido bien» no lo es.

### El redondeo a cuatro decimales es explícito, no un efecto del cast

**Se eligió:** `sumarCantidades` redondea el resultado con
`Math.round(n * 10000) / 10000` antes de escribirlo.

**Alternativas descartadas:** dejar que Postgres redondee al asignar,
**porque** es literalmente el defecto que esta funcionalidad vino a eliminar, y la
propia spec lo pide en el borde de `0.1 + 0.2` («el redondeo tiene que ser explícito
y no un efecto del cast»). El precedente está al lado: `utils/calculosVenta.js:12-14`
hace lo mismo con los centavos y por el mismo motivo.

### La guardia estática: archivo propio, `routes/` + `services/` + `utils/`

**Se eligió:** `src/tests/aritmeticaDeCantidades.test.js`, en el molde exacto de
`observabilidad.test.js`: lee los tres directorios con `leerCarpeta`, **afirma
cuántos archivos leyó**, prueba el detector contra una muestra mala y una buena
antes de correrlo sobre el repositorio, y filtra comentarios. Tres reglas:

| Regla | Qué busca | Por qué |
|---|---|---|
| Una suma desnuda sobre una cantidad | `\.(quantity\|available\|min_stock\|cantidad)\s*\+` y `\+\s*\w+\.(…)` | `'100' + 5` es `'1005'` |
| `parseInt` sobre una cantidad | `parseInt\([^)]*\b(quantity\|min_stock\|cantidad)\b` | Trunca: `parseInt('0.4')` es `0` (FR-026) |
| Un `setTypeParser` para `NUMERIC` | `setTypeParser` en `src/` | FR-027, y lo protege en la suite rápida en vez de solo en la de integración |

**Alternativas descartadas:** (a) meter las reglas dentro de `observabilidad.test.js`,
**porque** ese archivo ya tiene siete guardias y el motivo de esta necesita veinte
líneas de encabezado propio; (b) escribir la regla sobre `git grep` en CI,
**porque** una guardia que vive fuera de la suite es una que no corre cuando alguien
corre la suite; (c) buscar `parseFloat` para auditar, **porque** el hallazgo H2 ya
demostró que eso da un listado falso: los cuatro sitios rotos usan `parseFloat`
sobre el **input**, no sobre lo leído de la base.

⚠ **Una excepción, y una sola:** `routes/catalogoPublico.js:168` tiene
`catalogo_visitas.cantidad + 1` **adentro de un `UPDATE` de SQL**, donde suma
Postgres y no JavaScript. Va en una lista de excepciones con el texto exacto de la
línea y un `expect(EXCEPCIONES).toHaveLength(1)` al lado, igual que
`observabilidad.test.js:203-232` hace con `suppliers.js`: así el día que alguien la
edite, la guardia vuelve a mirarla.

### `POST /api/sales` acepta solo enteros, y el 3 vive en una constante

**Se eligió:** `motivoDeCantidadInvalida(valor, decimalesPermitidos)` en
`utils/cantidades.js`, llamada desde `routes/sales.js:321-323` con
`DECIMALES_DE_UNA_LINEA_DE_VENTA`, que en la 016 vale **0**. La constante lleva
escrito al lado que la 017 la mueve a **3** —un gramo, la unidad más chica que
informa una balanza comercial— y **el test cubre los dos valores**, así que la regla
resuelta en el PENDIENTE 1 queda ejercitada aunque el endpoint todavía no la use.

**Alternativas descartadas:** (a) dejar la regla de 3 sin escribir hasta la 017,
**porque** una decisión que se tomó y no quedó en ningún lado se vuelve a discutir;
(b) escribir la constante y no usarla, **porque** una constante sin llamador es
código muerto que el primer refactor borra; (c) validar 4 decimales —la propuesta
original del pendiente—, **porque** el dueño del producto eligió A y la 017 tendría
que endurecer una validación ya desplegada sobre datos que ya pueden tener 4
decimales.

La forma de la respuesta **no cambia**: sigue siendo
`400 { ok: false, error: 'ITEM_INVALIDO', message: … }` con el producto y la
cantidad nombrados, para que el test del defecto viejo —la cantidad negativa que
sumaba inventario, documentada en `sales.js:318-320`— siga pasando sin tocarse
(US3.3). Lo que cambia es qué entra en `motivoDeCantidadInvalida`: cero, negativa,
no numérica, **no entera**, y por encima de la precisión de la columna.

### El mensaje de `stock.js:142` deja de depender de que el valor sea *falsy*

**Se eligió:** `${textoDeCantidad(sourceStock?.quantity)}`, que devuelve `0` tanto
para `undefined` como para `"0.0000"`.

**Alternativas descartadas:** `${Number(sourceStock?.quantity) || 0}`,
**porque** deja el `||` en el mismo lugar y con el mismo problema conceptual —el día
que alguien pase un `-0` o un `NaN` vuelve a cambiar de rama—, y sobre todo porque
el caso donde ese mensaje se lee **es** el de stock cero: es el único que se ejercita
y el único donde la expresión de hoy se rompe.

### La migración: `ALTER TYPE` directo, y la verificación solo de lo que convirtió

**Se eligió:** `src/migrations/20260820-cantidades-decimales.js`. Una transacción,
nueve `ALTER TABLE … ALTER COLUMN … TYPE NUMERIC(14,4)`, foto de control
`ON COMMIT DROP` con las sumas de antes, y la verificación de FR-005 adentro de la
misma transacción.

Con las magnitudes medidas —`sale_items` 4 filas, `stock` 42, `stock_movements` 5,
`pedido_items` 2— el `ACCESS EXCLUSIVE LOCK` es instantáneo. **No hay columna nueva,
ni copia en lotes, ni cambio de nombre, ni ventana de migración.**

**Alternativas descartadas:** columna nueva + copia en lotes + rename,
**porque** el PENDIENTE 3 se cerró midiendo y ese plan cuesta tres migraciones, un
período de doble escritura y una ventana de reconciliación para ahorrar un lock de
milisegundos sobre cuatro filas.

⚠ **Un detalle que FR-005 no puede cumplir tal como está escrito.** «Un `COUNT(*)`
de filas con `quantity <> ROUND(quantity)` que tiene que dar cero **después** del
`ALTER`» solo es cierto la **primera** vez. La spec también pide que la migración sea
idempotente («corre dos veces → no cambia nada»), y en una base donde ya corrió y
después hubo una producción con consumo fraccionario, ese `COUNT(*)` daría distinto
de cero y abortaría **por hacer bien su trabajo**. Solución: la migración lee
`information_schema.columns` primero, **salta las columnas que ya son
`numeric(14,4)`** y verifica **solo las que convirtió en esta corrida**. Sobre una
base recién migrada eso es exactamente lo que FR-005 pide; sobre una base ya migrada,
no verifica nada porque no hizo nada.

### El `down` se niega condicionalmente, y **no** entra en `SE_NIEGAN`

**Se eligió:** el `down` cuenta, por tabla, las filas con al menos una columna
fraccionaria. Si hay alguna, tira nombrando **la tabla y cuántas filas**, más qué
hacer si igual hace falta. Si no hay ninguna, revierte con
`ALTER … TYPE INTEGER USING <col>::integer` —el `USING` explícito aunque el cast de
asignación exista, para que la intención se lea— y avisa por log.

**Alternativas descartadas:** (a) negarse siempre y entrar en el mapa `SE_NIEGAN` de
`scripts/verificar-reversibilidad.js:110`, **porque** ese mapa es de las que se
niegan *siempre* y su test (`reversibilidadDeMigraciones.test.js:99-119`) corre el
`down` **esperando que falle**: una negativa condicional metida ahí pasaría en verde
sobre una base limpia por la razón equivocada, que es el modo de falla que este
repositorio viene juntando; (b) redondear al revertir, **porque** es el defecto que
la migración elimina, en espejo.

El precedente correcto es `20260804-identidad-de-sucursal-en-stock.js:464-473`, cuyo
test es `reversibilidadDeMigraciones.test.js:121-129`: se niega **por una condición
de los datos** y por eso vive en su propio caso y no en el mapa.

`scripts/verificar-reversibilidad.js` la agarra sola: recorre en ascendente desde
`DESDE_POR_DEFECTO` y sobre su base descartable —vacía— el `down` revierte limpio,
que es el resultado correcto.

### El test del `down` corre contra la base de integración, adentro de una transacción que se revierte

**Se eligió:** `src/tests/integracion/reversionDeCantidades.integracion.test.js`
siembra una fila fraccionaria y llama al `down` de la migración pasándole un
`queryInterface` cuyo `sequelize.transaction(fn)` abre un **SAVEPOINT** sobre una
transacción externa que el test revierte al terminar. En Postgres el DDL es
transaccional, así que el esquema de la base de pruebas queda como estaba y los
otros archivos de la suite no se enteran.

**Alternativas descartadas:** (a) correr el `down` de verdad sobre la base de
pruebas y volver a correr el `up`, **porque** `npm run test:integracion` va
`--runInBand` pero dentro de un mismo archivo un fallo a mitad de camino dejaría la
base en `INTEGER` y los archivos siguientes fallarían por un motivo que no es el
suyo; (b) hacerlo con dobles como
`reversibilidadDeMigraciones.test.js:57-72`, **porque** ahí lo que se ejercita es una
rama de control de flujo que se toma **antes** de tocar la base, y acá la rama
depende de un `COUNT(*)` sobre filas reales — FR-013 pide explícitamente sembrar; (c)
dejarlo para `scripts/verificar-reversibilidad.js`, **porque** ese script corre sobre
una base **vacía** y ahí la negativa nunca se ejercita.

La técnica del savepoint no es nueva acá: `models/Stock.js:213-227` la usa y explica
por qué.

### El formateador de cantidad: `cantidad()` sobre `enEsAr`, con la agrupación apagada

**Se eligió:** `export function cantidad(n)` en `apps/web/src/utils/formato.js`,
construida sobre `enEsAr`, que gana un **cuarto parámetro** `agrupa = true`:

```
cantidad(12)          → '12'      cantidad('12.0000') → '12'
cantidad(9.6)         → '9,6'     cantidad('0.0000')  → '0'
cantidad(0.2505)      → '0,251'   cantidad(1234)      → '1234'
cantidad(null|''|NaN|'tres') → '0'
```

Los tres primeros salen textuales de la resolución del PENDIENTE 4 y están
verificados contra Node: `0.2505` con `maximumFractionDigits: 3` da `0,251`.

**Alternativas descartadas:**

- **Dejar la agrupación puesta** (`1.234`), **porque** rompe US4 para todo stock de
  cuatro cifras y el criterio de éxito 2 dice «carácter por carácter». Agregar el
  separador de miles a las cantidades puede ser una buena idea; es un cambio visible
  y no lo decide una migración que promete que nada cambia.
- **Llamar a `toLocaleString` con las opciones sueltas** para poder pasar
  `useGrouping`, **porque** el encabezado de `formato.js:33-45` explica el defecto
  que eso produjo —tres pantallas fijando el mínimo y olvidando el máximo— y FR-030
  lo prohíbe. Por eso el parámetro se le agrega a `enEsAr`: los dos extremos siguen
  siendo obligatorios y posicionales.
- **Delegar el caso ilegible en `enEsAr`**, **porque** `enEsAr('tres', 0, 3)` da
  literalmente `'NaN'` (medido), y FR-033 exige que nunca llegue a la pantalla.
  `cantidad()` corta antes con `Number.isFinite`.
- **Devolver `'—'` ante un valor ilegible**, como `importeOGuion`, **porque** estas
  celdas dicen «5 u.» y «hay 5 en esta sucursal»: un guión ahí se lee como un
  problema de maquetado, y la columna es `NOT NULL` con `DEFAULT 0`, así que el cero
  es la lectura honesta. La diferencia con `importeOGuion` es la misma que su propio
  comentario explica (`formato.js:125-137`): ahí el campo puede no venir; acá no.

La guardia de `formato.test.js` se extiende con una sexta regla —un formateo de
cantidad escrito a mano en una pantalla— y sigue afirmando cuántos archivos revisó
(`:621-639`). `IMPORTAN` (`:769-791`) gana las entradas de los archivos nuevos, que
es la mitad que evita «borré la copia y dejé de mostrar el número».

### El campo editable de `PanelProducto` NO pasa por el formateador

**Se eligió:** normalizar en el origen. `PanelProducto.jsx:310-314` carga
`quantity`, `available` y `min_stock` con `Number(...)`, así que el estado del
formulario vuelve a tener números y los dos `<input type="number">` (`:1158`,
`:1165`) no se tocan.

**Alternativas descartadas:** (a) `value={cantidad(fila.quantity)}`, **porque** un
`value="9,6"` en un `<input type="number">` **vacía el campo** —el navegador descarta
todo lo que no parsee como número de punto flotante— y el usuario guardaría cero; (b)
cambiar el input a `type="text"` con máscara, **porque** es una pantalla nueva
disfrazada de arreglo y FR-044 lo prohíbe.

⚠ Queda una asimetría deliberada y anotada: ese campo, y solo ese, escribe `9.6` con
punto mientras el resto de la pantalla escribe `9,6`. Es inherente al control nativo,
solo se ve con un stock fraccionario —que hoy solo produce producción, un módulo de
superadmin— y cambiarlo es de la 017, que es la que le pone al campo su forma
definitiva. `step="1"` **se deja como está** en la 016 por el mismo motivo.

### Los mensajes del servidor se escriben con `textoDeCantidad`, no con el de la web

**Se eligió:** `textoDeCantidad(v)` en `src/utils/cantidades.js`: redondea a 3
decimales, saca los ceros de relleno y escribe con **coma**, sin separador de miles.
La usan `routes/sales.js:548` y `routes/stock.js:142`.

**Alternativas descartadas:** (a) dejar `${Number(x)}`, que daría «disponible 9.6»,
**porque** un punto decimal en una frase en castellano, en un sistema donde todo lo
demás usa coma, es la ambigüedad que este repositorio ya pagó una vez («leer 1.234 al
revés convierte $1.234 en $1,234»); (b) crear un paquete compartido con la web,
**porque** la Assumption 9 de la spec ya lo resolvió —el formateador vive en
`apps/web` y los dos mensajes del servidor se resuelven en el servidor— y `packages/`
existe desde la 015, así que mudarlo después es aditivo; (c) usar
`toLocaleString('es-AR')` en Node, **porque** ata el texto de un error a que el ICU
del contenedor tenga el locale, y es una dependencia gratuita de evitar en una
función de cinco líneas.

**No lleva separador de miles**, y es a propósito: «disponible 1.250» adentro de una
oración se lee como mil doscientos cincuenta o como uno coma veinticinco según quién
lo lea. En una columna alineada el separador ayuda; en una frase, estorba.

### La fila fraccionaria se siembra en el test, no en `fixtures.js`

**Se eligió:** cada archivo de integración de esta funcionalidad siembra en su
`beforeEach`, después de `sembrarDosEmpresas()`, las filas que necesita: **un stock
de `10.5000`** —el valor no redondo que pide `CONVENCIONES.md:373-376`—, una fila con
`available = 0`, y un producto propio.

**Alternativas descartadas:** agregar esas filas a `fixtures.js`, **porque** esa
fixture la comparten treinta archivos y varios afirman **conteos**: sumarle un
producto a la empresa A mueve los números de las métricas del catálogo, del panel y
de los listados, y arreglar diez tests ajenos para poder escribir el propio es
exactamente cómo una fixture compartida se vuelve intocable. Lo que **sí** se hace es
agregarle al encabezado de `fixtures.js` —que ya explica dato por dato por qué es como
es— una línea diciendo que las cantidades de esa fixture son enteras a propósito y
dónde vive la fila fraccionaria.

La fixture compartida **ya cumple** las otras dos exigencias de la spec: `ventaA`
tiene dos líneas (`fixtures.js:289`, `:298`) y las cantidades y disponibles difieren
entre sí (`:168`, `available: 5` con `quantity: 7`).

### La escala de la columna se ata con una guardia estática, no con `verificar-esquema.js`

**Se eligió:** extender `src/tests/modeloStock.test.js` y `modeloSale.test.js` —y
agregar sus gemelos para `StockMovement` y `PedidoItem`— con el caso «el modelo
declara `DECIMAL(14,4)` **y** la migración escribe `NUMERIC(14,4)`», leyendo
`rawAttributes[…].type.options` de un lado y el fuente de la migración del otro.

**Alternativas descartadas:** enseñarle a `scripts/verificar-esquema.js` a comparar
`numeric_precision` y `numeric_scale`, **porque** hoy solo compara `udt_name`
(`:204`) y para él `numeric(14,4)` y `numeric(12,4)` son la misma cosa; agregarle la
escala es tentador —son diez líneas— pero pasa a comparar **todas** las columnas
`DECIMAL` del repositorio contra la base real, y basta con que un `DECIMAL(12,2)`
viejo esté creado como `numeric(10,2)` en algún lado para que el job «API — la imagen
arranca y migra» (`ci.yml:502`) se ponga en rojo por algo que no es de esta
funcionalidad. Queda anotado como deuda con su motivo, y el riesgo que tapa —que
alguien escriba `DECIMAL(12,4)` en un modelo y degrade la columna— lo cubre la
guardia de arriba, que es la que sí puede correr en la suite rápida.

FR-006 y el criterio de éxito 10 se siguen cumpliendo: `verificar-esquema.js`
verifica que modelo y base coincidan en **ser** `numeric`, que es lo que hoy sabe
hacer, y la guardia nueva verifica la escala.

### El aviso del PENDIENTE 4 va a `docs/OPERACION.md`

**Se eligió:** una sección nueva en `docs/OPERACION.md` con dos partes: (a) el
**procedimiento previo** —medir las cuatro tablas contra la base del VPS, respaldo
verificado, correr, verificar— y (b) el **texto del aviso**: «los stocks de los
insumos que pasan por producción van a empezar a mostrar decimales que antes se
redondeaban; el número nuevo es el correcto y el viejo estaba mal».

**Alternativas descartadas:** (a) un banner en la aplicación, **porque** FR-044
prohíbe que aparezca nada nuevo en la interfaz; (b) no avisar, **porque** un stock que
pasa de `10` a `9,6` sin que nadie toque nada es exactamente lo que hace que alguien
abra un ticket urgente por un arreglo. El público es chico —recetas y producción son
solo superadmin— y `OPERACION.md` es donde ese público ya mira.

---

## Project Structure

### Archivos nuevos

| Archivo | Qué es |
|---|---|
| `apps/api/src/migrations/20260820-cantidades-decimales.js` | La migración. `up` con foto de control y verificación adentro de la transacción; `down` con negativa condicional |
| `apps/api/src/utils/cantidades.js` | `aCantidad`, `sumarCantidades`, `redondearCantidad`, `textoDeCantidad`, `motivoDeCantidadInvalida`, `DECIMALES_DE_UNA_LINEA_DE_VENTA` |
| `apps/api/src/tests/cantidades.test.js` | El test de unidad de las seis. Incluye `it('Math.max(0, "100" + 5) NO es 105')` (H3, criterio 6) |
| `apps/api/src/tests/aritmeticaDeCantidades.test.js` | La guardia estática: suma desnuda, `parseInt` sobre cantidad, `setTypeParser` |
| `apps/api/src/tests/modeloStockMovement.test.js` | Ata las cuatro columnas de `stock_movements` al tipo de la migración |
| `apps/api/src/tests/modeloPedidoItem.test.js` | Ídem para `pedido_items.cantidad` |
| `apps/api/src/tests/integracion/cantidadesDecimales.integracion.test.js` | US1 y US3 |
| `apps/api/src/tests/integracion/sumasDeStock.integracion.test.js` | US2, los cuatro caminos más la importación |
| `apps/api/src/tests/integracion/reversionDeCantidades.integracion.test.js` | US5 |
| `docs/specs/016-cantidades-decimales/data-model.md` | Este cambio de esquema, columna por columna |
| `docs/specs/016-cantidades-decimales/contracts/api-endpoints.md` | Los campos que cambian de tipo en la respuesta y el rechazo nuevo |

### Archivos modificados

**Esquema y modelos** (van en el mismo commit que la migración, FR-006)

| Archivo | Qué cambia |
|---|---|
| `apps/api/src/models/Sale.js:176` | `quantity` → `DECIMAL(14,4)` |
| `apps/api/src/models/Stock.js:43,48,53` | `quantity`, `available`, `min_stock` → `DECIMAL(14,4)` |
| `apps/api/src/models/StockMovement.js:30,34,38,42` | Las cuatro → `DECIMAL(14,4)` |
| `apps/api/src/models/PedidoItem.js:34` | `cantidad` → `DECIMAL(14,4)` |

**Aritmética** (FR-022 a FR-026; cada uno con su propio test que se pone en rojo al revertir esa línea sola, FR-028)

| Archivo:línea | Qué cambia |
|---|---|
| `apps/api/src/routes/sales.js:722-723` | `stock.quantity + item.quantity` → `sumarCantidades(…)` |
| `apps/api/src/routes/stock.js:155-156` | `destStock.quantity += qty` → `sumarCantidades(…)`. ⚠ `:145-146` **no se toca**: es resta y anda |
| `apps/api/src/services/purchaseService.js:496-497` | `stock.quantity + linea.recibido_ahora` → `sumarCantidades(…)` |
| `apps/api/src/routes/general.js:88-90` | `delta` y `Math.max(0, oldAvail + delta)` sobre `aCantidad(…)` |
| `apps/api/src/routes/general.js:178-183` | Ídem en el `POST /api/stock` |
| `apps/api/src/routes/import.js:406,431` | `parseInt` → `aCantidad`, conservando la distinción entre celda vacía y cero que el comentario de `:403-405` documenta |
| `apps/api/src/routes/import.js:96` | La nota de la columna del CSV deja de decir «Número entero» (FR-026) |

**Validación y mensajes**

| Archivo:línea | Qué cambia |
|---|---|
| `apps/api/src/routes/sales.js:321-332` | `motivoDeCantidadInvalida` reemplaza a `l.quantity <= 0`. Misma forma de respuesta |
| `apps/api/src/routes/sales.js:548` | `disponible ${textoDeCantidad(stock.available)}` |
| `apps/api/src/routes/stock.js:142` | `sourceStock?.quantity \|\| 0` → `textoDeCantidad(sourceStock?.quantity)` |
| `apps/api/src/tests/integracion/fixtures.js` | Solo el encabezado: por qué sus cantidades son enteras y dónde vive la fraccionaria |

**Web** (los diez puntos; FR-034, FR-034a)

| Archivo:línea | Qué cambia | Motivo |
|---|---|---|
| `apps/web/src/utils/formato.js:72-77` | `enEsAr` gana `agrupa = true`; nace `cantidad(n)` | FR-030 a FR-033 |
| `apps/web/src/utils/printInvoice.js:125` | `${cantidad(l.cantidad)} x …` | Punto 1 · **el criterio de éxito 1** |
| `apps/web/src/components/pos/CatalogoDelPos.jsx:200` | `{cantidad(fila.disponible)} u.` | Punto 2 |
| `apps/web/src/pages/Billing.jsx:468` | `hay ${cantidad(disponible)} …` | Punto 3 |
| `apps/web/src/components/PanelProducto.jsx:1173` | `{cantidad(guardada?.available)}` | Punto 4 |
| `apps/web/src/components/PanelProducto.jsx:310-314` | `Number(...)` al cargar las tres filas | Puntos 5 y **10** (`min_stock`), y **no** el formateador |
| `apps/web/src/pages/Reports.jsx:345` | `{cantidad(item.quantity)}` | Punto 6 |
| `apps/web/src/components/PanelDePedido.jsx:229` | `{cantidad(l.cantidad)}× ` | Punto 7 |
| `apps/web/src/components/pos/TicketDelPos.jsx:219` | `{cantidad(linea.qty)}` | FR-034a — **no** es regresión del día de la migración: es `9.6` con punto |
| `apps/web/src/pages/Inventory.jsx:147` | `×${cantidad(i.quantity)}` | FR-034a, ídem. Sale de `StockTransfer.items`, que es `JSONB` |
| `apps/web/src/pages/Reports.jsx:232` | `{cantidad(item.quantity)}` | FR-034a, ídem. `routes/reports.js:39` ya hace `parseFloat` |
| `apps/web/src/utils/formato.test.js` | Sexta regla de la guardia, entradas nuevas en `IMPORTAN`, y los casos de `cantidad()` incluido `it('NO imprime «3.0000 x Creatina»')` | FR-036, FR-037 |
| `apps/web/src/tests/` | Test de render del ticket impreso y de la baldosa del POS | Criterio de éxito 1 |

**Operación**

| Archivo | Qué cambia |
|---|---|
| `docs/OPERACION.md` | Sección nueva: procedimiento previo a la migración y el texto del aviso |

---

## Qué se verifica en qué nivel

La escalera es la de `CONVENCIONES.md:313-355`. **El cuarto nivel no es opcional
acá**: los dobles de `helpers/modelosFalsos.js` no saben de tipos y pasan en verde
con la aritmética rota.

| Afirmación | Nivel | Dónde |
|---|---|---|
| `aCantidad`, `sumarCantidades`, `textoDeCantidad`, `motivoDeCantidadInvalida` | Función pura | `src/tests/cantidades.test.js` |
| `Math.max(0, "100" + 5)` no es 105 | Función pura, con el nombre escrito | ídem (criterio 6) |
| `cantidad()` escribe `12`, `9,6`, `0,251`, `1234` y `0` | Función pura | `apps/web/src/utils/formato.test.js` |
| Ninguna pantalla formatea una cantidad a mano | Guardia estática | La sexta regla de `formato.test.js`, con su conteo de archivos |
| Ningún `+` desnudo, ningún `parseInt`, ningún `setTypeParser` | Guardia estática | `src/tests/aritmeticaDeCantidades.test.js` |
| Modelo y migración declaran la misma escala | Guardia estática | `modeloStock/Sale/StockMovement/PedidoItem.test.js` |
| El ticket impreso dice `3 x Creatina` | Test de render | `apps/web/src/tests/` |
| Un consumo de producción de 0,4 sobre 10 deja **9,6**; uno de 0,6 deja **9,4** | Integración | `cantidadesDecimales.integracion.test.js` |
| Una línea de venta con 0,4 escrita **directo en el modelo** vale 0,4 | Integración | ídem (US1.3, por el modelo y no por el endpoint: PENDIENTE 2) |
| `POST /api/sales` con 0,4 se rechaza y **no queda venta, ni línea, ni movimiento** | Integración | ídem |
| Anular devuelve el stock a **exactamente 10,5000**, comparado contra el leído antes | Integración | `sumasDeStock.integracion.test.js` |
| Una transferencia suma bien **en el destino** | Integración | ídem (el origen no sirve de control: la resta anda igual) |
| Una recepción de compra suma bien | Integración | ídem |
| La edición manual deja `available` en 105 y no en 1005 | Integración | ídem, los dos caminos (`general.js:90` y `:181`) |
| Una planilla con `0,4` importa 0,4 | Integración | ídem |
| El `down` revierte limpio sin fracciones y se **niega** con ellas, nombrando tabla y filas | Integración | `reversionDeCantidades.integracion.test.js` |
| La migración no cambió el valor de ninguna fila, **con filas sembradas antes** | Integración | ídem |
| El aislamiento sigue cerrado en todo lo tocado | Guardia + integración | `aislamientoEmpresas.test.js`, `aislamientoEntreEmpresas.integracion.test.js` |

**La fixture del caso que importa**, y por qué es así: se arranca de **10,5000** y no
de 10 porque con un entero redondo la aserción cierra igual con y sin la corrección
(`CONVENCIONES.md:372-376`). El caso que se pone en rojo al revertir
`sales.js:722` es: vender 0,250 → anular → el stock tiene que volver a
**exactamente 10,5000**. Con la línea rota da `"10.25000.2500"`, que es un número
**mayor**, así que la aserción es de igualdad exacta y no un `toBeLessThan`.

---

## Orden de despliegue

Uno solo, y entero. La migración y las cinco correcciones de aritmética **van en el
mismo commit o no van**: la migración sola rompe cuatro caminos de escritura de
inventario que hoy funcionan (US2), y el formateador separado deja a Comprafit
imprimiendo `3.0000 x Creatina` en el intervalo (H1).

Antes de correrla en producción, y en este orden:

1. **Repetir la medición contra la base del VPS.** Las cifras del PENDIENTE 3 son de
   la base de Neon, que `render.yaml` describe como «Neon durante desarrollo». El
   repositorio tiene además `docker-compose.produccion.yml` con su propio
   `postgres:16-alpine` y su volumen `datos_postgres`. **Si esa base tiene datos
   reales, las cuatro cuentas hay que hacerlas ahí** —`sale_items`, `stock`,
   `stock_movements`, `pedido_items`— antes de dar el punto por cerrado. Con órdenes
   de magnitud parecidas el `ALTER` directo sigue alcanzando; con `sale_items` en
   cientos de miles, este plan se reabre.
2. **Respaldo verificado inmediatamente antes.** `deploy/respaldo.sh` existe, que el
   cron esté puesto no lo verifica nada y la copia queda en el mismo disco que la
   base (`:22-23`). El `down` se niega justamente cuando más falta haría.
3. Correr, y mirar el log de la migración: dice qué columnas convirtió.
4. `node scripts/verificar-esquema.js` (es lo que ya hace el job `ci.yml:552`).
5. Mandar el aviso de `docs/OPERACION.md`.

---

## Riesgos

| # | Riesgo | Cómo se detecta |
|---|---|---|
| 1 | **La medición del VPS resulta ser otra.** Todo el «no hace falta ventana» cuelga de cuatro filas en `sale_items` medidas contra Neon | El paso 1 del orden de despliegue. Si `sale_items` no está en el orden de las decenas, **este plan se reabre**: vuelve la discusión de columna nueva y copia en lotes que el PENDIENTE 3 cerró |
| 2 | **Alguien saca una conversión y nada se pone en rojo.** Es el modo de falla central de esta funcionalidad: la suite rápida no distingue un `number` de un `"12.0000"` | La guardia estática de `aritmeticaDeCantidades.test.js` — es la única red que corre siempre. Su propio riesgo es nacer floja: por eso lleva ancla de conteo, muestra mala y muestra buena, como todas las de este repositorio |
| 3 | **Un punto de dibujo que nadie listó.** Se encontró uno que la spec no tenía (`PanelProducto.jsx:1165`) mirando el archivo; puede haber otro | La sexta regla de la guardia de `formato.test.js` no lo encuentra —esa busca formateo escrito a mano, no ausencia de formateo—. Lo que lo encuentra es el recorrido manual del criterio de éxito 2 contra una copia de los datos reales, y **ese procedimiento no existe escrito** (es una de las cuatro Dependencias de la spec). Hoy es el hueco más grande de la verificación |
| 4 | **El `down` no sirve cuando hace falta.** Después de la primera producción con consumo fraccionario, revertir se niega — que es lo correcto, y significa que la salida de emergencia dura poco | Está escrito en el mensaje del propio `down`. Mitigación real: el respaldo del paso 2, no el `down` |
| 5 | **`verificar-esquema.js` no distingue `numeric(14,4)` de `numeric(12,4)`.** Un modelo mal escrito degradaría la columna sin que CI lo diga | La guardia modelo↔migración de los cuatro `modelo*.test.js`. Queda como deuda anotada, con el motivo por el que no se arregló en el script (riesgo de poner en rojo el job por columnas viejas ajenas a esta funcionalidad) |
| 6 | **El campo de `PanelProducto` escribe `9.6` con punto** mientras el resto escribe `9,6` | Es una asimetría conocida y anotada, no un defecto latente: solo se ve con un stock fraccionario, que hoy solo produce el módulo de producción. La 017 le da al campo su forma definitiva |
| 7 | **Los tests de integración no corren solos.** `npm run test:api` **no los levanta**, y en esta funcionalidad son el único nivel que ve el defecto | `guardiaDelArnes.test.js` —que sí va en la suite rápida— verifica que CI los ejecute y que el job tenga su Postgres. Y la definición de terminado (`CONVENCIONES.md:411`) los exige explícitamente |
| 8 | **La migración corre dos veces sobre una base que ya tiene fracciones** y FR-005 la aborta por hacer bien su trabajo | Resuelto en el diseño: solo se verifican las columnas que esta corrida convirtió. El caso está en el test de la migración |
| 9 | **Las cantidades ya corrompidas no se recuperan.** El `9,6` que se guardó como `10` en marzo es indistinguible de un `10` legítimo | No se detecta y no se intenta reparar: inventar el dato sería peor. Está en el fuera de alcance de la spec y se repite en el aviso de `OPERACION.md` |
