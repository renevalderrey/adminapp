# Tasks: Cantidades decimales en la cadena de stock y ventas

**Input**: documentos de diseño en `docs/specs/016-cantidades-decimales/`
(`spec.md`, `plan.md`, `data-model.md`, `contracts/api-endpoints.md`)

---

## Antes de empezar

### Los comandos

```
npm run test:api                              # jest — NO levanta los de integración
npm run test:web                              # vitest
npm --prefix apps/api run test:db:levantar    # una vez: contenedor + migraciones
npm --prefix apps/api run test:integracion    # el ÚNICO nivel que ve un DECIMAL como string
npm --prefix apps/api run db:migrate
npm run build
```

**En `apps/api` los tests van siempre en `src/tests/`**, aunque prueben una función
pura de `src/utils/`. Un `src/utils/algo.test.js` jest no lo corre nunca: no falla,
no avisa, y alguien lee el nombre del archivo y da por cubierto lo que jamás se
ejecutó. En `apps/web` sí se permite `utils/*.test.js`.

### Cómo están cortadas las fases

El orden no es el de la spec, es el que el plan justifica:

1. **La aritmética primero**, con su guardia estática. Mientras las columnas sean
   `INTEGER` esto es un **no-op**: `pg` devuelve números y no hay nada que
   concatenar. Por eso se puede desplegar sola y deja el diff de la migración chico.
2. **Después la puerta del endpoint**, que corrige un defecto que existe **hoy**:
   `POST /api/sales` con `quantity: 0.4` responde 200 y guarda una línea en cero.
3. **Después la migración**, que es la que enciende todo lo anterior y lo hace
   verificable de verdad contra Postgres.
4. **Después el formateo**, que también es un no-op contra la base de hoy
   —`cantidad(12)` es `'12'`, igual que lo que se dibuja ahora—.

⚠ **Puerta de despliegue.** Las fases son el orden del trabajo, no cuatro releases.
La Fase 1 puede salir sola. **La Fase 3 y la Fase 4 salen juntas o no salen**: con
el esquema migrado y sin formateador, Comprafit imprime `3.0000 x Creatina` en el
intervalo entre las dos (H1), y ese ticket es el papel que le queda al cliente.

### Las cuatro correcciones al enunciado que estas tareas ya incorporan

1. **FR-034 no incluye `PanelProducto.jsx:1158`.** Es un `<input type="number">`: un
   `value="9,6"` deja el campo **en blanco** y quien guarde escribe cero. Ese campo
   se normaliza numéricamente en el origen, no pasa por el formateador (T405).
2. **Son diez puntos de dibujo, no nueve.** Falta `PanelProducto.jsx:1165`
   (`value={fila.min_stock}`), el gemelo tres líneas abajo. `min_stock` también
   migra (T405).
3. **`enEsAr` agrupa los miles.** `enEsAr(1234, 0, 3)` da `1.234` donde hoy se
   dibuja `1234`, así que el formateador pedido para que nada cambie rompería US4
   para todo stock de cuatro cifras. `enEsAr` gana un cuarto parámetro para apagar
   la agrupación (T401).
4. **`PanelProducto.jsx:1156` y `:1163` tienen `step="1"`.** Después de migrar,
   producción puede dejar un stock en 9,6; el navegador marca ese valor como
   inválido contra `step="1"` y el formulario queda trabado sin explicación
   visible. Van en `step="0.001"` los dos (T406). Un formulario que muestra un valor
   que él mismo considera inválido está roto.

### Lo que no aplica, y por qué se dice

- **No hay modelo nuevo que registrar** en `models/index.js`: cambian nueve
  atributos de cuatro modelos que ya están registrados.
- **No hay ruta nueva que montar** en `server.js`: 016 no agrega ningún endpoint
  (`contracts/api-endpoints.md`, §1).
- **No hay ítem de menú que agregar** en la navegación: FR-044 prohíbe que aparezca
  ningún control, campo ni pantalla nueva.

### La regla de verificación que gobierna todo el archivo

`CONVENCIONES.md:373-376` dice dónde este proyecto más se equivocó: importes
redondos que cierran igual con y sin el arreglo, listas de una sola página, filtros
probados siempre sin filtro. **Cada verificación de acá abajo tiene que poder
distinguir el defecto**, y la forma de comprobarlo es revertir la línea corregida,
correr el test, verlo en rojo y restaurar. El caso que manda, y que se repite en
varias tareas:

> Stock de **10,5000** → vender 0,250 → anular → el stock vuelve a **exactamente
> 10,5000**. Con `sales.js:722` revertido da `"10.25000.2500"`, que es un número
> **mayor**: por eso la aserción es de igualdad exacta y nunca un `toBeLessThan`.

---

## Phase 1: La aritmética de cantidades y su guardia

**Purpose**: al terminar, los cinco lugares donde una cantidad se suma dejan de
depender del tipo que devuelva el driver, y una guardia estática se pone en rojo si
alguien vuelve a escribir un `+` desnudo. Todo esto es un **no-op contra las
columnas `INTEGER` de hoy**, así que se puede desplegar solo y sin migrar nada.

⚠ **Por qué los tests de esta fase son con dobles y no de integración**: mientras
las columnas sean `INTEGER`, Postgres devuelve números y el defecto **no existe
todavía**. Lo que sí se puede hacer hoy es **inyectarle el string al doble** —los
dobles devuelven lo que se les puso— y afirmar el resultado. La prueba de que
Postgres efectivamente entrega `"10.5000"` es de la Fase 3, y ahí cada una de estas
cinco correcciones vuelve a tener su test ejecutado contra la base real (FR-028).

- [x] **T101** Crear `apps/api/src/utils/cantidades.js` con `aCantidad`,
      `sumarCantidades`, `redondearCantidad`, `textoDeCantidad`,
      `motivoDeCantidadInvalida` y la constante `DECIMALES_DE_UNA_LINEA_DE_VENTA`,
      que en la 016 vale **0** y lleva escrito al lado que la 017 la mueve a **3**
      (un gramo, PENDIENTE 1). Test en `apps/api/src/tests/cantidades.test.js`.
      **Verificación**: el test afirma
      `sumarCantidades('10.5000', '0.2500') === 10.75` y **no** `'10.50000.2500'`;
      `aCantidad('0.0000') === 0` y que `null`, `''`, `'tres'` y `undefined` dan el
      mismo valor documentado en el comentario; `redondearCantidad(0.1 + 0.2) === 0.3`
      —el redondeo es explícito y no un efecto del cast—;
      `textoDeCantidad('9.6000') === '9,6'`, `textoDeCantidad('0.0000') === '0'` y
      `textoDeCantidad(1250) === '1250'` (sin separador de miles: en una frase
      «disponible 1.250» se lee de dos maneras); `motivoDeCantidadInvalida` con 0
      decimales rechaza `0.4`, `0`, `-5`, `'tres'` y `999999999999999` y acepta `3`,
      y **con 3 decimales acepta `0.25` y rechaza `0.00004`**, que es la regla de la
      017 ejercitada aunque el endpoint todavía no la use. Y el caso con el nombre
      escrito: `it('Math.max(0, "100" + 5) NO es 105')` (H3, criterio 6).

- [x] **T102** `apps/api/src/routes/sales.js:722-723` — la reposición al anular una
      venta pasa a `sumarCantidades(...)` para `quantity` y `available`.
      *(Depende de T101.)*
      **Verificación**: en `src/tests/rutasDeVentas.test.js`, un caso que le inyecta
      al doble `stock.quantity = '10.5000'` y a la línea `item.quantity = '0.2500'`
      y afirma que el `update` recibe `10.75`. Revertir la línea sola deja
      `'10.50000.2500'` y el test en rojo.

- [x] **T103** [P] `apps/api/src/routes/stock.js:155-156` — el **destino** de una
      transferencia pasa a `sumarCantidades(...)`. ⚠ `:145-146` **no se toca**: es
      una resta y anda. *(Depende de T101.)*
      **Verificación**: en `src/tests/rutasDeStock.test.js`, un caso con
      `destStock.quantity = '20.0000'` y `qty = 5` que afirma **25 en el destino**.
      El origen no sirve de control: la resta cierra igual con y sin la corrección,
      así que un test que mire solo el origen pasa con el defecto puesto.

- [x] **T104** [P] `apps/api/src/services/purchaseService.js:496-497` — la recepción
      de una orden de compra pasa a `sumarCantidades(...)`. *(Depende de T101.)*
      **Verificación**: en `src/tests/recepcionDeOrden.test.js`, un caso con
      `stock.quantity = '7.0000'` y `recibido_ahora = 10` que afirma **17**.
      Revertida, da `'7.000010'`.

- [x] **T105** [P] `apps/api/src/routes/general.js:88-90` y `:178-183` — la edición
      manual de stock convierte con `aCantidad(...)` antes de calcular el `delta` y
      antes del `Math.max(0, ...)`. El `Math.max(0, …)` **se conserva**: esta spec no
      cambia el trato del `available` negativo. *(Depende de T101.)*
      **Verificación**: en `src/tests/rutasDeStock.test.js` —que ya monta
      `routes/general`—, una fila con `quantity = '100.0000'`, `available = '100.0000'`
      editada a `105` deja `available` en **105 y no en 1005**, por los dos caminos
      (`PUT /api/stock/:id` y `POST /api/stock`). Es el peor de los cuatro: el
      `Math.max` convierte **después** de que el `+` ya concatenó y no lanza nada.

- [x] **T106** [P] `apps/api/src/routes/import.js:406` y `:431` — `parseInt` sale y
      entra `aCantidad`, **conservando la distinción entre celda vacía y cero** que
      documenta el comentario de `:403-405`; la nota de la columna del CSV en `:96`
      deja de decir «Número entero» (FR-026). *(Depende de T101.)*
      **Verificación**: un caso que importa una fila con la cantidad en `0,4` y
      afirma que se guardó **0,4** y no **0** (`parseInt('0.4')` es `0`, y truncar no
      avisa), **y otro con la celda vacía** que afirma que la fila no se toca: el
      defecto que el comentario de `:403-405` describe es justamente que una planilla
      con la columna en blanco vaciaba el inventario.

- [x] **T107** Crear la guardia estática
      `apps/api/src/tests/aritmeticaDeCantidades.test.js`, en el molde exacto de
      `observabilidad.test.js`: `leerCarpeta('routes'|'services'|'utils')`, **ancla
      que afirma cuántos archivos leyó**, detector probado contra una muestra mala y
      una buena antes de correrlo sobre el repositorio, y filtro de comentarios. Tres
      reglas: (a) suma desnuda sobre `.quantity|.available|.min_stock|.cantidad`,
      (b) `parseInt` sobre una cantidad, (c) `setTypeParser` en `src/` (FR-027).
      *(Va después de T102–T106: escrita antes deja la suite en rojo.)*
      **Verificación**: la guardia se pone en rojo si se revierte **cualquiera** de
      T102 a T106, y verde con las cinco puestas. La única excepción permitida es
      `routes/catalogoPublico.js:168` —`catalogo_visitas.cantidad + 1` **adentro de
      un `UPDATE` de SQL**, donde suma Postgres y no JavaScript—, que va en una lista
      con el texto exacto de la línea y un `expect(EXCEPCIONES).toHaveLength(1)` al
      lado, como hace `observabilidad.test.js:203-232` con `suppliers.js`.

**Checkpoint**: `npm run test:api` pasa; la guardia nueva reporta cero hallazgos y
dice cuántos archivos revisó; revertir cualquiera de las cinco líneas pone en rojo
**su** test y la guardia. **Esta fase se puede desplegar sola**: contra las columnas
`INTEGER` de hoy no cambia ningún resultado.

---

## Phase 2: Lo que el servidor contesta sobre una cantidad

**Purpose**: al terminar, `POST /api/sales` deja de aceptar lo que la columna no
puede representar —hoy `quantity: 0.4` responde 200 y guarda una línea en **cero**,
en producción— y los dos mensajes de stock insuficiente dejan de depender del tipo
del valor. Todo esto **corrige defectos que existen hoy** y no espera a la
migración.

- [x] **T201** `apps/api/src/routes/sales.js:321-332` — `motivoDeCantidadInvalida(l.quantity,
      DECIMALES_DE_UNA_LINEA_DE_VENTA)` reemplaza a `l.quantity <= 0`. **La forma de
      la respuesta no cambia**: sigue siendo
      `400 { ok: false, error: 'ITEM_INVALIDO', message: … }` con el producto y la
      cantidad nombrados. *(Depende de T101.)*
      **Verificación**: en `src/tests/rutasDeVentas.test.js`, `quantity: 0.4` pasa de
      201 a **400**; `quantity: 999999999999999` da **400 con mensaje legible** y no
      un 500; el mensaje **no** nombra tabla, columna ni restricción (FR-021); una
      venta normal de 3 unidades sigue dando el mismo total, el mismo descuento y el
      mismo movimiento. ⚠ **El test del defecto viejo —la cantidad negativa que
      sumaba inventario, documentada en `sales.js:318-320`— tiene que seguir pasando
      sin tocarse** (US3.3): si hubo que editarlo, la forma de la respuesta cambió y
      eso es un fallo de la tarea.

- [x] **T202** Crear `apps/api/src/tests/integracion/cantidadesDecimales.integracion.test.js`
      con la mitad de US3 que solo se ve contra Postgres: `POST /api/sales` con
      `quantity: 0.4` se rechaza **y no queda ninguna fila**. *(Depende de T201.)*
      **Verificación**: después del 400, `sales`, `sale_items` y `stock_movements` no
      tienen ninguna fila nueva **y la fila de `stock` quedó en el valor que tenía
      antes**, leído antes de la llamada y comparado por igualdad. Revertir T201 pone
      el test en rojo por partida doble: responde 201 y deja una línea en cero. El
      archivo arranca con `baseDePruebas` **antes que `supertest` y que cualquier
      modelo** (`config/database.js` arma la conexión al importarse), `beforeAll(conectarOFallar)`,
      `limpiarLaBase()` + `sembrarDosEmpresas()` en el `beforeEach` y `cerrar()` en el
      `afterAll`.

- [x] **T203** [P] `apps/api/src/routes/sales.js:548` — el mensaje de stock
      insuficiente al vender escribe `textoDeCantidad(stock.available)`.
      *(Depende de T101.)*
      **Verificación**: con `stock.available` inyectado como `'5.0000'` el mensaje
      dice **`disponible 5`** y no `disponible 5.0000`; y `sales.js:595`, que
      reconoce el error por `err.message.startsWith('Stock insuficiente')`, sigue
      entrando por esa rama —hay un test que lo ejercita, no alcanza con leerlo—.

- [x] **T204** [P] `apps/api/src/routes/stock.js:142` —
      `sourceStock?.quantity || 0` pasa a `textoDeCantidad(sourceStock?.quantity)`.
      **No se arregla formateando el resultado**: con la cadena `"0.0000"`, que es
      *truthy*, el `||` deja de caer al cero. Lo que se saca es la dependencia de que
      el valor sea *falsy*. *(Depende de T101.)*
      **Verificación**: tres casos en `src/tests/rutasDeStock.test.js` —
      `quantity = '0.0000'` → `disponible: 0`; `quantity = 0` → `disponible: 0`;
      `sourceStock` inexistente → `disponible: 0`. El primero es el que importa: **es
      el único caso en que ese mensaje se lee**, y es exactamente donde la expresión
      de hoy cambia de rama. `rutasDeStock.test.js:293`, que exige
      ``ErrorDeNegocio(`Stock insuficiente`` en el fuente, sigue pasando.

**Checkpoint**: `npm run test:api` y `npm --prefix apps/api run test:integracion`
pasan. Un `POST /api/sales` con `0.4` ya no deja una línea fantasma en cero, que es
un defecto que hoy está en producción. La puerta queda cerrada a toda fracción: la
017 la abre cambiando `DECIMALES_DE_UNA_LINEA_DE_VENTA` a 3.

---

## Phase 3: El esquema — la migración, los modelos y la verificación ejecutada

**Purpose**: al terminar, la base representa 9,6 y las cinco correcciones de la Fase
1 tienen su prueba **contra Postgres real**, que es el único nivel donde un `DECIMAL`
vuelve como string. Acá se corrige el hallazgo `auditoria-frente2-hallazgos.json:335`.

⚠ **A partir de esta fase la interfaz muestra `3.0000` hasta que termine la Fase 4.**
Es la puerta de despliegue del preámbulo: en producción las dos van juntas.

- [ ] **T301** Crear `apps/api/src/migrations/20260820-cantidades-decimales.js` **y
      cambiar los nueve atributos de los cuatro modelos en el mismo commit** (FR-006):
      `Sale.js:176`, `Stock.js:43,48,53`, `StockMovement.js:30,34,38,42`,
      `PedidoItem.js:34` a `DataTypes.DECIMAL(14, 4)`. El `up` va entero en una
      transacción sobre el molde de `20260814-productos-publicables.js`: lee
      `information_schema.columns` y **salta las columnas que ya son `numeric(14,4)`**,
      arma la foto de control `ON COMMIT DROP` con las sumas por tabla, corre los
      `ALTER TABLE … ALTER COLUMN … TYPE NUMERIC(14,4)`, y verifica **solo lo que esta
      corrida convirtió**. El `down` es la negativa condicional de `data-model.md`.
      **NO se agrega a `SE_NIEGAN`** (FR-012, H7).
      **Verificación**: `npm --prefix apps/api run db:migrate` sobre una base **con
      filas sembradas** deja las nueve columnas en `numeric(14,4)` según
      `information_schema`; `node apps/api/scripts/verificar-esquema.js` no reporta
      divergencia; **corrida dos veces seguidas la segunda no toca nada y loguea que
      ya estaban**; el log dice qué columnas convirtió y cuántas filas tenía cada
      tabla; `reversibilidadDeMigraciones.test.js` la encuentra en el rango que
      recorre y verifica que exporta `up` y `down`; y `SE_NIEGAN` sigue teniendo una
      sola entrada.

- [ ] **T302** [P] Extender `apps/api/src/tests/modeloStock.test.js` y
      `modeloSale.test.js` con el caso «el modelo declara `DECIMAL(14,4)` **y** la
      migración escribe `NUMERIC(14,4)`», leyendo `rawAttributes[…].type.options` de
      un lado y el fuente de la migración del otro. *(Depende de T301.)*
      **Verificación**: el test se pone en rojo si el modelo dice `DECIMAL(12,4)` con
      la migración en 14,4 — que es justo el caso que `scripts/verificar-esquema.js`
      **no** puede ver, porque compara `udt_name` y nada más (`:204`): para él
      `numeric(14,4)` y `numeric(12,4)` son la misma columna.

- [ ] **T303** [P] Crear `apps/api/src/tests/modeloStockMovement.test.js` y
      `modeloPedidoItem.test.js` con la misma atadura, para las cuatro columnas de
      `stock_movements` y para `pedido_items.cantidad`. *(Depende de T301.)*
      **Verificación**: las cinco columnas, una por una, con el mismo caso de rojo
      que T302. Son los dos modelos que hoy no tienen guardia y por eso son los que
      se degradan sin que nadie se entere.

- [ ] **T304** Completar `cantidadesDecimales.integracion.test.js` con US1: una orden
      de producción que consume **0,4** sobre un stock de 10 deja **9,6**, y una de
      **0,6** deja **9,4**; una línea de venta con `0.4` **escrita directo en el
      modelo** —no por el endpoint, que la rechaza (PENDIENTE 2)— vale 0,4 al leerla;
      y una fila de stock en 12 sigue valiendo doce aunque el driver la entregue como
      `"12.0000"`. *(Depende de T301.)*
      **Verificación**: son los dos números textuales del hallazgo
      `auditoria-frente2-hallazgos.json:335` ejecutados —hoy dan **10** y **9**—.
      Revertir el tipo de `stock.quantity` a `INTEGER` pone los dos casos en rojo. La
      comparación es por igualdad exacta contra `9.6` y `9.4`, no un rango.

- [ ] **T305** Crear `apps/api/src/tests/integracion/sumasDeStock.integracion.test.js`
      con los cuatro caminos de US2, cada uno con su propio caso para que se sepa
      cuál se rompió (FR-028). El `beforeEach` siembra, después de
      `sembrarDosEmpresas()`, **un stock de `10.5000`**, una fila con `available = 0`
      y un producto propio — **no se toca `fixtures.js`**, que la comparten treinta
      archivos y varios afirman conteos; sí se le agrega al encabezado una línea que
      diga que sus cantidades son enteras a propósito y dónde vive la fraccionaria.
      *(Depende de T301.)*
      **Verificación**: **el caso que manda** — stock en 10,5000, se siembra una venta
      de 0,250 escribiendo directo en el modelo (el endpoint la rechaza), se anula por
      la ruta, y el stock vuelve a **exactamente 10,5000**, comparado contra el valor
      leído antes y no contra un número escrito a mano. Revertir `sales.js:722` da
      `"10.25000.2500"` —un número **mayor**— y el test se pone en rojo. Además: la
      transferencia se verifica **en el destino** (20 → 25) y no en el origen; la
      recepción de compra sobre 7 pendientes de 10 da 17; la edición manual deja
      `available` en 105 y no en 1005 **por los dos caminos** de `general.js`. Cada
      uno se revierte por separado y solo su caso se pone en rojo.

- [ ] **T306** [P] Agregar a `sumasDeStock.integracion.test.js` el caso de la
      importación: una planilla con la columna cantidad en `0,4` guarda **0,4**.
      *(Depende de T106 y T301.)*
      **Verificación**: con `parseInt` de vuelta el test da 0 y se pone en rojo. Va
      con su gemelo de celda vacía, que tiene que seguir dejando la fila como estaba.

- [ ] **T307** Crear
      `apps/api/src/tests/integracion/reversionDeCantidades.integracion.test.js` con
      US5 y con la promesa de la migración. El `down` se llama pasándole un
      `queryInterface` cuyo `sequelize.transaction(fn)` abre un **SAVEPOINT** sobre
      una transacción externa que el test revierte al terminar —en Postgres el DDL es
      transaccional, así que el esquema de la base de pruebas queda como estaba y los
      demás archivos de la suite no se enteran—. La técnica está en
      `models/Stock.js:213-227`, con el motivo escrito. *(Depende de T301.)*
      **Verificación**: (a) con una fila fraccionaria sembrada, el `down` **se niega**
      y el mensaje nombra **la tabla y cuántas filas**, más qué hacer si igual hace
      falta; (b) sin fracciones, revierte limpio y ningún valor se pierde; (c) la
      promesa de FR-005 **con filas sembradas antes de correr el `up`** —sobre una
      base vacía esa verificación pasa siempre y no verifica nada (criterio 8)—, y un
      caso donde una columna quedó fraccionaria a propósito para ver que la migración
      **aborta y no deja nada aplicado**.

**Checkpoint**: `npm --prefix apps/api run test:integracion` pasa y el hallazgo de la
auditoría está cerrado: un consumo de 0,4 sobre 10 deja 9,6. La cadena de stock ya no
redondea en silencio. **La interfaz todavía dibuja `3.0000`**: eso lo cierra la Fase 4
y las dos salen juntas a producción.

---

## Phase 4: El formateo — los diez puntos donde una cantidad se dibuja

**Purpose**: al terminar, la pantalla y el ticket se ven **exactamente** como antes
de la migración, y ese es el criterio que gobierna la spec entera. Contra la base de
hoy esta fase también es un no-op: `cantidad(12)` es `'12'`, que es lo que se dibuja
ahora.

- [ ] **T401** `apps/web/src/utils/formato.js` — `enEsAr(n, minimos, maximos)` gana un
      cuarto parámetro `agrupa = true`, y nace `export function cantidad(n)`
      construida sobre ella (FR-030: nada de `toLocaleString` suelto). Las cinco
      funciones de plata siguen llamándola con tres argumentos. Casos en
      `apps/web/src/utils/formato.test.js`.
      **Verificación**: `cantidad(12)`, `cantidad('12.0000')` y `cantidad(12.0)` los
      tres dan **`'12'`**; `cantidad(9.6)` da **`'9,6'`** y **no** `'9,600'`;
      `cantidad(0.2505)` da `'0,251'`; `cantidad(null|undefined|''|NaN|'tres')` da
      `'0'` y **nunca** `NaN` ni `undefined` (FR-033: `enEsAr('tres', 0, 3)` devuelve
      literalmente `'NaN'`, así que `cantidad` corta antes con `Number.isFinite`); y
      el caso que la corrección 3 del preámbulo hace obligatorio:
      **`cantidad(1234) === '1234'`, sin punto de miles** — con la agrupación puesta
      da `'1.234'` y rompe US4 para todo stock de cuatro cifras. Ese caso se pone en
      rojo si alguien saca el cuarto parámetro.

- [ ] **T402** `apps/web/src/utils/printInvoice.js:125` — `${cantidad(l.cantidad)} x …`.
      Es **el criterio de éxito 1**. *(Depende de T401.)*
      **Verificación**: un test que espía `window.open`, captura lo que se escribe con
      `document.write` y, partiendo de una línea con `quantity: '3.0000'` —lo que
      `GET /api/sales/:id` devuelve después de migrar—, afirma que el HTML contiene
      **`3 x Creatina`** y **no** `3.0000 x Creatina`. El nombre del test lleva escrito
      el caso: `it('NO imprime «3.0000 x Creatina»')` (FR-037).

- [ ] **T403** [P] `apps/web/src/components/pos/CatalogoDelPos.jsx:200` —
      `{cantidad(fila.disponible)} u.`. *(Depende de T401.)*
      **Verificación**: test de render con el disponible en `'5.0000'` que afirma la
      baldosa en **`5 u.`**. La fuente del string son las dos puntas —`GET /api/products`
      y el arreglo `stock` que devuelve `POST /api/sales`, que `Billing.jsx:434-450`
      escribe tal cual en el catálogo del navegador—, así que el caso se siembra con
      un string y no con un número.

- [ ] **T404** [P] `apps/web/src/pages/Billing.jsx:468` —
      `hay ${cantidad(disponible)} en esta sucursal`. *(Depende de T401.)*
      **Verificación**: test de render con el disponible en `'5.0000'` que afirma
      **`hay 5 en esta sucursal`**.

- [ ] **T405** `apps/web/src/components/PanelProducto.jsx` — dos cambios distintos y
      el motivo escrito al lado de cada uno: `:1173` pasa por
      `{cantidad(guardada?.available)}`, y `:310-314` carga `quantity`, `available` y
      `min_stock` con `Number(...)`, que es lo que arregla los puntos 5 y **10** (los
      dos `<input type="number">`, `:1158` y `:1165`). **El campo editable NO pasa por
      el formateador**: un `value="9,6"` deja el control en blanco y quien guarde
      escribe cero. *(Depende de T401.)*
      **Verificación**: en `src/tests/renderDePanelProducto.test.jsx`, con una fila de
      stock que llega como `{ quantity: '10.0000', available: '10.0000', min_stock: '0.0000' }`:
      el texto del disponible dice **`10`**, el input de cantidad vale **`10`** y no
      `10.0000` **ni vacío**, y el de mínimo vale **`0`**. Los dos inputs se afirman
      por separado: `min_stock` es el punto que la spec no tenía y el que se olvida.

- [ ] **T406** `apps/web/src/components/PanelProducto.jsx:1156` y `:1163` — los dos
      `<input type="number">` pasan de `step="1"` a **`step="0.001"`**. Es una
      reparación, no una funcionalidad: después de migrar, producción puede dejar un
      stock en 9,6, el navegador marca ese valor como inválido contra `step="1"` y el
      formulario queda trabado sin decir por qué. *(Mismo archivo que T405: no van en
      paralelo.)*
      **Verificación**: test de render que carga la fila con `quantity: '9.6000'` y
      afirma que el input reporta **`validity.valid === true`** (con `step="1"` da
      `false` por `stepMismatch`) y que el formulario se puede guardar. El mismo test
      con `step="1"` se pone en rojo. Los 3 decimales del `step` son los mismos que
      `DECIMALES_DE_UNA_LINEA_DE_VENTA` va a tomar en la 017, y eso se anota en el
      comentario.

- [ ] **T407** [P] `apps/web/src/pages/Reports.jsx:345` y `:232` —
      `{cantidad(item.quantity)}` en los dos. *(Depende de T401.)*
      **Verificación**: `:345` es el punto 6 —el reporte de inventario, que
      `routes/reports.js:95` devuelve crudo— y con `'12.0000'` tiene que decir **`12`**.
      `:232` es FR-034a y **no es una regresión del día de la migración**
      (`routes/reports.js:39` ya hace `parseFloat`): entra porque hoy dibujaría `9.6`
      con punto en vez de `9,6`. El motivo va escrito al lado de cada uno para que
      nadie los confunda.

- [ ] **T408** [P] `apps/web/src/components/PanelDePedido.jsx:229` —
      `{cantidad(l.cantidad)}×`. *(Depende de T401.)*
      **Verificación**: test de render con `cantidad: '2.0000'` que afirma **`2×`**.
      Nada escribe decimales en `pedido_items` —`apps/tienda/src/carrito.js:55` hace
      `Math.floor` y la tienda pública sigue vendiendo por unidad (H5)—, pero la
      columna migra igual y el punto rompe igual.

- [ ] **T409** [P] `apps/web/src/components/pos/TicketDelPos.jsx:219` y
      `apps/web/src/pages/Inventory.jsx:147` — los dos por `cantidad(...)`, **con el
      motivo escrito al lado**: ninguno viene de una columna `DECIMAL` —el ticket sale
      del carrito del navegador y el resumen de transferencias sale de
      `StockTransfer.items`, que es `JSONB`— así que entran por FR-034a y no por la
      regresión. *(Depende de T401.)*
      **Verificación**: los dos siguen mostrando **exactamente lo mismo** que hoy con
      valores enteros (US4.11), y con `9.6` escriben `9,6` y no `9.6`.

- [ ] **T410** `apps/web/src/utils/formato.test.js` — sexta regla de la guardia que ya
      recorre `pages/` y `components/`: un formateo de cantidad escrito a mano adentro
      de una pantalla. Y las entradas nuevas en `IMPORTAN` (`:769-791`), que es la
      mitad que evita «borré la copia y dejé de mostrar el número».
      *(Va después de T402–T409.)*
      **Verificación**: la guardia **sigue afirmando cuántos archivos revisó**
      (`:621-639`) — este repositorio ya tuvo dos guardias que pasaban por vacío—; se
      pone en rojo contra una muestra mala del orden de `Number(x).toFixed(0)` en un
      `.jsx`, y verde contra una buena. Sin esto la unificación dura un sprint
      (US4.10).

**Checkpoint**: `npm run test:web` y `npm run build` pasan. Con el esquema migrado en
local, los diez puntos se ven **carácter por carácter** como antes: el ticket dice
`3 x Creatina`, la baldosa `5 u.`, el reporte `12`, el pedido `2×`, y el campo
editable de la ficha muestra `10` y acepta un 9,6 sin trabarse. **Acá recién se puede
desplegar la migración.**

---

## Phase 5: Operación

**Purpose**: al terminar, quien corre el despliegue sabe qué medir antes, qué mirar
después y qué avisar; y existe escrito el procedimiento que hoy es el hueco más
grande de la verificación (riesgo 3 del plan).

- [ ] **T501** `docs/OPERACION.md` — sección nueva en «Situaciones», al lado de «Los
      números del Panel cambiaron», con dos partes: **(a)** el procedimiento previo
      —repetir la medición de `sale_items`, `stock`, `stock_movements` y
      `pedido_items` **contra la base del VPS** (`docker-compose.produccion.yml`), no
      contra la de Neon del PENDIENTE 3; respaldo verificado inmediatamente antes
      (`deploy/respaldo.sh` deja la copia en el mismo disco que la base, `:22-23`);
      correr; leer el log de la migración; `node scripts/verificar-esquema.js`— y
      **(b)** el texto del aviso.
      **Verificación**: el aviso dice, en castellano y sin jerga, que los stocks de
      los insumos que pasan por producción **van a empezar a mostrar decimales que
      antes se redondeaban, que el número nuevo es el correcto y el viejo estaba
      mal**, y que **las cantidades ya corrompidas no se recuperan** —el `9,6` que se
      guardó como `10` en marzo es indistinguible de un `10` legítimo—. El
      procedimiento dice qué hacer si `sale_items` no está en el orden de las decenas:
      **este plan se reabre**. Y dice que el `down` se niega justamente cuando más
      falta haría, así que la salida de emergencia es el respaldo y no el `down`.

- [ ] **T502** `docs/OPERACION.md` — el procedimiento escrito para comparar los **diez
      puntos** contra una copia de los datos reales, que hoy no existe y es la
      dependencia que sostiene el criterio de éxito 2.
      **Verificación**: la lista tiene los diez puntos con su pantalla y el valor
      esperado, dice que se compara **carácter por carácter** y no de vista, y aclara
      que comparar contra una base sembrada a mano no prueba que nada cambió **para
      Comprafit**. Que la lista esté completa se comprueba contra la tabla del plan:
      son diez, no nueve.

- [ ] **T503** Cierre: correr las cuatro suites y mirar la corrida de CI.
      **Verificación**: `npm run test:api`, `npm run test:web`,
      `npm --prefix apps/api run test:integracion` y `npm run build` pasan;
      `aislamientoEmpresas.test.js`, `observabilidad.test.js`,
      `verificacionDeTiposDelEsquema.test.js`, `reversibilidadDeMigraciones.test.js`,
      `guardiaDelArnes.test.js` y `todosLosTestsCorren.test.js` siguen limpias;
      `centavoDelSaldo.integracion.test.js:243` sigue pasando con
      `expect(typeof filas[0].total).toBe('string')` —o sea que nadie registró un
      `setTypeParser` global (FR-027)—; el job «API — la imagen arranca y migra» está
      en verde; y **la corrida de CI se mira después del push, no antes**.

**Checkpoint**: la funcionalidad está lista para desplegar con el orden del plan:
medir el VPS, respaldar, migrar, verificar el esquema, avisar.

---

## Resumen

| Fase | Tareas | Qué queda funcionando |
|---|---|---|
| 1 · Aritmética y guardia | 7 | Las cinco sumas dejan de depender del tipo. **Desplegable sola** |
| 2 · Lo que el servidor contesta | 4 | `0.4` deja de guardarse como una línea en cero |
| 3 · Esquema | 7 | La base representa 9,6. El hallazgo de la auditoría, cerrado |
| 4 · Formateo | 10 | Los diez puntos se ven igual que antes. **Sale con la Fase 3** |
| 5 · Operación | 3 | Quien despliega sabe qué medir, qué mirar y qué avisar |
| **Total** | **31** | |

**La primera es T101**: `apps/api/src/utils/cantidades.js` y su test en
`src/tests/cantidades.test.js`. De ella cuelgan las once tareas de las fases 1 y 2.
