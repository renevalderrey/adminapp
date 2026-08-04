# Tasks: Punto de venta — pasada fina

**Input**: documentos de diseño en `docs/specs/011-punto-de-venta/`
(`spec.md`, `plan.md`, `contracts/api-endpoints.md`). **No hay `data-model.md`**:
esta funcionalidad no agrega ni cambia ninguna columna, y el motivo está
verificado en la decisión 4 del plan.

Treinta y cuatro tareas en diez fases. El orden sale de «Orden de construcción»
del plan y de una restricción que manda sobre el corte: **las fases 1 y 2 son
defectos vivos y van primero**, en un corte propio, commiteable y desplegable
**sin nada del rediseño**. Cada día que dura la reescritura de la pantalla, la
fuga del carrito y el doble cobro producen datos que no se pueden reparar
después.

`[P]` marca las que se pueden hacer en paralelo porque tocan archivos distintos.

⚠ **Tres pares de `[P]` comparten el archivo de test, no el de código**:
T1113 y T1114 escriben en `tests/mediosDePago.test.js`, y T1120 y T1121 en
`tests/renderDelPuntoDeVenta.test.jsx`. Sus `describe` son distintos, así que el
conflicto —si se hacen a la vez— es de merge y no de diseño. Se dice acá para que
nadie resuelva el conflicto borrando el `describe` del otro.

---

## Antes de empezar: seis cosas que no son tareas

### 1. Cómo se verifica, en tres niveles

| Nivel | Qué cubre | Dónde |
|---|---|---|
| Test unitario / de render | Las cinco funciones puras, los contratos de `services/api.js`, el store, y lo que se afirma del dibujo y del efecto | `apps/web/src/utils/*.test.js` · `apps/web/src/tests/*.test.js(x)` · `apps/api/src/tests/*.test.js` |
| Guardia estática | Que no reaparezca un hex, un `dark:`, una clase de la paleta de Tailwind, un `<table>`, un `punto_de_venta_id \|\| null` en el `Sale.create`, ni una ruta sin `MarcoDePantalla` | `tests/guardiasDeDiseno.test.js` (web) · `tests/rutasDeVentas.test.js`, `tests/descuentoDeStock.test.js` (api) |
| Paso manual reproducible | Todo lo que exige un motor de maquetado o un Postgres de verdad | Sección «Los pasos manuales de `sdd-verify`», al final |

**Ninguna tarea de acá abajo pide un test de integración**, porque no existe la
infraestructura para escribirlo (proyecto **5c** de `PROXIMOS-PROYECTOS.md`), y
ninguna llama «test» a algo que en realidad se mira a mano.

**Precisión sobre lo que falta del 5c.** `PROXIMOS-PROYECTOS.md:135` dice «el CI
ya levanta uno [un Postgres de test]», y es cierto: `.github/workflows/ci.yml:91`
levanta `postgres:16-alpine` — pero en el job de la **imagen**, que solo
comprueba que el contenedor arranque y migre. El job de **tests** corre
`npm test` sin base. O sea: el servidor ya está y mover el servicio al otro job
es una línea; lo que falta de verdad son **las fixtures y `supertest` contra la
app real**. Es el motivo por el que el punto 6 del plan es un paso manual y no un
test, y por el que el procedimiento para correrlo está escrito entero al final de
este archivo.

### 2. Lo que ya está y no lleva tarea

- **No hay migración.** `Sale.payment_method` es `STRING(20)` libre en el modelo
  (`models/Sale.js:38-42`) y en la base (`migrations/20260531-initial-schema.js:344`),
  sin `ENUM` y sin `CHECK`. Los nueve códigos entran sin tocar nada. **No hay
  tarea de migración y no hay `data-model.md`.**
- **No hay modelo nuevo que registrar** en `apps/api/src/models/index.js`.
- **No hay ruta nueva que montar** en `apps/api/src/server.js`: el único endpoint
  que cambia es `POST /api/sales`, ya montado.
- **No hay ítem de menú que agregar.** `apps/web/src/components/navegacion.js:22`
  ya tiene `{ to: '/pos', label: 'Punto de venta', permission: 'ventas.crear',
  modulo: 'pos' }`.
- **No se crea ningún permiso** (supuesto 6): `ventas.crear` ya existe y ya lo
  exigen `POST /api/sales` y `POST /api/sales/:id/facturar`. Lo que se agrega es
  que **la pantalla lo consulte** (FR-024), que hoy no lo hace.
- **No van gates de superadmin.** El POS es para el cliente. La única pieza
  condicionada sigue siendo el buscador de fichas de cliente
  (`Billing.jsx:55`, supuesto 12).

### 3. Los dos cortes que se despliegan primero y se pueden desplegar solos

**Fases 1 y 2 no dependen de nada del rediseño y no lo bloquean.** Las cinco
tareas tocan `apps/api/src/routes/sales.js`, `apps/web/src/services/api.js`,
`apps/web/src/pages/Billing.jsx` (tres líneas) y
`apps/web/src/store/useStore.js` (una línea). Ninguna toca el dibujo. Se
mergean y se despliegan sin esperar a nada.

### 4. ⚠ La entropía del id y la idempotencia son **una sola cosa**, y tienen un orden

**T1101 (entropía) va antes que T1102 (idempotencia). Nunca al revés, y nunca
una sin la otra.** El motivo está en el riesgo 1 del plan y hay que tenerlo a la
vista mientras se hacen las dos:

| Qué se despliega | Qué pasa |
|---|---|
| Entropía sola | Nada malo: los ids dejan de chocar. Es estrictamente mejor que hoy |
| **Idempotencia sola** | **Dos cajas que cobran en el mismo milisegundo generan el mismo `sale_${Date.now()}`. La segunda recibe `200 { yaRegistrada: true }` con los datos de la venta de la primera, imprime un comprobante ajeno y no registra nada.** Hoy eso es un error visible; así sería una venta que desaparece en silencio |
| Las dos juntas | Lo buscado |

Por eso las dos tareas dicen la otra en su propia verificación: **una revisión
que apruebe T1102 sin T1101 tiene que poder verlo escrito en T1102.**

### 5. Cuatro cosas que el plan no vio y pegan en una tarea concreta

Están marcadas ⚠ donde pegan.

**(a) La lista de la API no tiene nueve claves, tiene diez, y va a tener once.**
El plan dice que el test de contrato «verifica que las dos listas tengan las
mismas claves» (decisión 2). `ETIQUETAS_DE_PAGO` de `apps/api/src/utils/exportVentas.js:22-33`
tiene **`tc: 'T. Crédito'`** además de los nueve, y le falta `tc3` — que es el
que el POS viene escribiendo mal (hallazgo 3). Una igualdad estricta de claves
contra `MEDIOS` fallaría por `tc` y por `tc3`, que son **códigos históricos y no
medios ofrecibles**. Se resuelve en T1106 y T1111: el módulo de la web separa
`MEDIOS` (los nueve que el control ofrece) de `ETIQUETAS` (los nueve **más** los
históricos), y el contrato compara `ETIQUETAS` contra la lista de la API. Sin
esa separación, la salida barata es agregar `tc` a los segmentos y que el POS
ofrezca un medio que nadie eligió nunca.

**(b) `precioDeLinea` tiene que conocer `tc3` desde el primer día.** El refactor
de los tres `priceMap` (T1112) ocurre en la fase 3, y la pantalla sigue
escribiendo `'tc3'` hasta la fase 9 (`Billing.jsx:565`). Si `precioDeLinea`
solo conoce los nueve, entre la fase 3 y la 9 **todas las ventas con tarjeta
cotizan al precio de efectivo** y nada falla. `tc3` va en el mapa de precios
como `tarjeta`, con un test que lo fija.

**(c) La guardia de `<Can>` no lee subcarpetas.**
`guardiasDeDiseno.test.js:162-171` hace `fs.readdirSync(path.join(SRC, carpeta))`
sobre `pages` y `components`, **sin recursión**. Los tres componentes nuevos
viven en `components/pos/`, así que quedarían **fuera** de esa guardia sin que
nada avise: un `<Can permission="…">` ahí adentro dejaría ver el botón a
cualquiera y la guardia seguiría verde. Se arregla en T1115.

**(d) `utils/comprobantes.js` y `utils/comprobanteAfip.js` son dos archivos
distintos y se van a confundir.** El segundo ya existe y es el QR de la RG
4892/2020 más el nombre del comprobante para imprimir. El nuevo es **qué
comprobantes puede ofrecer el selector**. Los dos empiezan igual y hacen cosas
que no tienen nada que ver. Queda dicho en el encabezado de los dos archivos
(T1107).

### 6. Las tres decisiones de la spec que mandan sobre el plan largo

De la tabla «Lo que faltaba decidir · **resuelto**». Se repiten acá porque son
las que cambian requisitos y el planteo de abajo de esa tabla dice otra cosa:

1. **Segmentos de precio + medio exacto adentro** (opción B). El vuelto aparece
   solo con efectivo de verdad.
2. **Confirmación antes de vaciar con `Esc`** (opción A). No doble `Esc`, no
   deshacer.
3. **Medio de pago del ticket, heredado** (opción B). El pie de cobro lleva el
   medio vigente; las líneas nuevas lo heredan.

---

## Phase 1: `POST /api/sales` deja de duplicar ventas y de perder la sucursal

**Purpose**: las dos cosas irreversibles quedan cerradas. Un reintento no
registra una segunda venta, dos cajas simultáneas no se pisan, y toda venta
nueva queda asentada en la sucursal de la que salió la mercadería. **Es API
pura más tres líneas del cliente: no depende de la pantalla y no la bloquea.**

Es el corte 1 del plan y también su riesgo 8: `POST /api/sales` es el camino más
crítico del sistema y esta fase lo toca en tres lugares. Van los tres juntos y
aislados de todo lo visual, para que si algo se rompe se sepa dónde mirar.

- [x] **T1101** ⚠ **Va antes que T1102 y nunca sin ella (punto 4 de «Antes de
      empezar»).** En `apps/web/src/services/api.js`, agregar
      `nuevoIdDeVenta()` —`` `sale_${Date.now()}_${crypto.randomUUID().slice(0, 8)}` ``,
      27 caracteres sobre los 40 de `Sale.id`— exportada al lado de `createSale`
      (`:167`), con el comentario de por qué la marca de tiempo va **adelante**
      (los ids ordenan cronológicamente y un listado crudo de la base se puede
      leer) y por qué no es `randomUUID()` a secas (36 caracteres, no entra con
      el prefijo). En `apps/web/src/pages/Billing.jsx`, el `id: \`sale_${Date.now()}\``
      de `:210` sale del handler: el identificador se genera **una vez por
      ticket** —en un `useRef` que se renueva al vaciar el carrito y al terminar
      una venta con éxito, no en cada disparo— y se reusa en cualquier reintento
      del mismo ticket (FR-043).
      **Verificación**: `npm --prefix apps/web test -- src/tests/contratosDeApi.test.js`
      pasa con los casos nuevos en ese archivo (el molde ya está: axios doblado,
      se mira qué sale de verdad).
      **El test**: `it('NO genera dos veces el mismo id en el mismo milisegundo')`
      —mil llamadas a `nuevoIdDeVenta()` dentro de un `Date.now()` congelado con
      `vi.setSystemTime`, y `new Set(ids).size` tiene que ser 1000—, más
      `it('el id entra en los 40 caracteres de Sale.id')` y
      `it('el id de un ticket NO cambia entre el primer cobro y el reintento')`,
      que dispara `handleRegisterSale` dos veces sobre el mismo carrito con el
      primer `api.post` rechazado y afirma que los dos cuerpos llevan **el mismo
      `id`**.
      **Cómo se comprueba que el test sirve**: se reemplaza el cuerpo de
      `nuevoIdDeVenta` por `` `sale_${Date.now()}` `` —o sea, se revierte a la
      línea de hoy— y el primero de los tres se pone en rojo con
      `expected 1 to be 1000`. Para el tercero, se vuelve a poner la generación
      **adentro** del handler y falla comparando dos ids distintos. Sin el
      primero de los tres, T1102 convierte el edge case 2 de la spec en una venta
      perdida en silencio, y **eso no lo detecta nada**.

- [x] **T1102** ⚠ **No se mergea sin T1101.** En
      `apps/api/src/routes/sales.js`, `POST /` (`:321`): antes del `Sale.create`
      (`:423`), buscar la venta con
      `findScoped(Sale, id, req.empresaId, { transaction: t })`; si existe,
      `t.rollback()` y responder **200** con
      `{ ok: true, yaRegistrada: true, data: sale, warnings: [], stock: [] }`.
      Y **además**, en el `catch` (`:512`), distinguir
      `SequelizeUniqueConstraintError` sobre la clave primaria y responder lo
      mismo — el `findScoped` previo **no es atómico** y dos requests en vuelo
      pasan los dos por el `findOne`: la guardia real es la restricción de la
      base, el `findOne` es el camino normal. `stock: []` y `warnings: []` van
      vacíos **a propósito**: la venta ya existe, su stock ya se descontó, y
      devolver los avisos de aquella vez los mostraría dos veces. Es el mismo
      molde que `POST /:id/facturar` ya usa para el CAE (`:854-870`), y el
      comentario tiene que decirlo.
      **Verificación**: `npm run test:api` pasa, y el paso manual **6a** del
      final —dos `POST /api/sales` con el mismo `id` contra Postgres— deja
      **una** fila en `sales` y **un** movimiento en `stock_movements`.
      **El test**: en `apps/api/src/tests/rutasDeVentas.test.js`, que ya lee
      `routes/sales.js` como texto,
      `it('POST / busca la venta por id ANTES de crearla, y con findScoped')` y
      `it('el catch de POST / no responde 500 ante una clave primaria repetida')`:
      el primero afirma que entre `router.post('/'` y `Sale.create(` aparece
      `findScoped(Sale` **con `req.empresaId`**; el segundo, que el bloque del
      `catch` menciona `SequelizeUniqueConstraintError` antes de llegar a
      `fallo(`.
      **Cómo se comprueba que el test sirve**: se borra la llamada a `findScoped`
      previa y el primero se pone en rojo; se borra la rama del
      `SequelizeUniqueConstraintError` y el segundo también. Es una guardia
      estática y no un test de comportamiento **porque los dobles de
      `tests/helpers/modelosFalsos.js` no entienden `lock` ni transacciones**
      (lo dice su propio encabezado): un test de idempotencia escrito sobre ellos
      probaría el doble. El comportamiento se verifica contra Postgres, en el
      paso manual 6a.
      ⚠ **Aislamiento**: el `findScoped` lleva `req.empresaId`, así que un `id`
      que existe en **otra** empresa **no** se encuentra y la venta se crea
      normalmente, que es lo correcto —los ids son de la empresa, no globales—.
      `npm --prefix apps/api test -- aislamientoEmpresas` tiene que seguir en
      verde **sin agregarle ninguna excepción**.

- [x] **T1103** En `apps/api/src/routes/sales.js`, `POST /`: la llamada a
      `resolverSucursal({ empresaId, puntoDeVentaId, transaction })` que hoy está
      **adentro** de `if (lineas.length)` (`:442-446`) sube **antes** del
      `Sale.create`, y `saleData.punto_de_venta_id` pasa de
      `req.puntoDeVentaId || null` (`:396`) a `sucursal.id`. **Nada más se
      mueve**: el bucle de stock sigue usando la misma variable, así que **por
      construcción** la venta queda asentada en la sucursal de la que salió la
      mercadería (FR-070, FR-071). Los tres escalones de `sucursalDeAnulacion`
      (`:27-47`) quedan **intactos** para las ventas viejas (FR-073), y
      `Sale.location` sigue siendo texto histórico (FR-074).
      **Verificación**: `npm run test:api` pasa, y el paso manual **6b** —una
      venta **sin** la cabecera `X-Punto-De-Venta-Id`— deja
      `sales.punto_de_venta_id` **no nulo** y la anulación devuelve el stock a
      esa misma sucursal.
      **El test**: en `apps/api/src/tests/descuentoDeStock.test.js`, que ya es
      la guardia estática de este mismo defecto en el otro sentido,
      `it('el Sale.create NO escribe punto_de_venta_id como req.puntoDeVentaId || null')`
      —el bloque del `saleData` no puede contener
      `punto_de_venta_id: req.puntoDeVentaId || null` ni `|| null` en esa
      clave— y `it('la sucursal se resuelve ANTES del Sale.create')`, que afirma
      que el índice de `resolverSucursal(` en el archivo es **menor** que el de
      `Sale.create(`.
      **Cómo se comprueba que el test sirve**: se vuelve la línea a
      `punto_de_venta_id: req.puntoDeVentaId || null` y el primero se pone en
      rojo; se baja el bloque de `resolverSucursal` adentro del `if
      (lineas.length)` otra vez y el segundo también. El segundo test es el que
      cubre el escenario 6.3 —una venta **sin líneas** también tiene que quedar
      atribuida—, que es exactamente lo que se pierde si alguien «ordena» el
      handler y devuelve la llamada adentro del `if`.
      ⚠ **Cambio de comportamiento declarado** (contrato, cambio 3): una empresa
      **sin ninguna sucursal** que registre una venta **sin líneas** pasa de
      `201` a `400` con el `ErrorDeNegocio` que ya tira `sucursalPorDefecto`
      (`utils/sucursalDeStock.js:94-98`). Es lo buscado (FR-072) y hay que
      decirlo en el commit.

- [x] **T1104** ⚠ **Riesgo 8: es el tercer lugar del mismo handler, y va en este
      corte por eso.** En `apps/api/src/routes/sales.js`, `POST /`: la respuesta
      `201` suma un campo `stock` con una fila por cada `Stock` que el handler
      **efectivamente actualizó**, leída **después** del `update` y dentro de la
      misma transacción: `{ product_id, punto_de_venta_id, quantity, available }`.
      Los productos **sin** fila de stock **no** aparecen en `stock` y **sí** en
      `warnings`: los dos arreglos son complementarios y ninguno hay que
      parsear. Es aditivo —el único llamador es el POS— y es lo que hace posible
      FR-047 sin volver a pedir el catálogo. **Todavía no lo consume nadie**: se
      consume en T1125.
      **Verificación**: `npm run test:api` pasa, y el paso manual **6c**: una
      venta de dos productos, uno con fila de stock y otro sin ella, devuelve
      `stock` con **una** entrada y `warnings` con **una** frase.
      **El test**: en `apps/api/src/tests/descuentoDeStock.test.js`,
      `it('la respuesta de POST / NO obliga al navegador a restar available - qty')`
      —guardia estática: el `res.status(201).json(` de `POST /` tiene que
      mencionar `stock`, y el arreglo tiene que armarse dentro del bloque que
      hace `stock.update(`, no después del `t.commit()`—.
      **Cómo se comprueba que el test sirve**: se saca `stock` del `json(` y el
      test se pone en rojo. La segunda mitad —que se lea **dentro** de la
      transacción— importa porque leerlo después del commit devuelve valores que
      otra caja ya pudo cambiar, y el catálogo quedaría mostrando el stock de la
      venta de otro. Eso **no** lo detecta el test estático y por eso está en el
      paso manual 6c.

**Checkpoint**: contra Postgres, dos `POST /api/sales` con el mismo `id` dejan
una sola venta y un solo movimiento de stock; una venta sin la cabecera queda
con `punto_de_venta_id` no nulo; y `npm run test:api` y `npm run test:web`
pasan. **Este corte se puede mergear, desplegar y olvidar**: no hay nada de la
pantalla adentro y las dos cosas irreversibles quedaron cerradas.

---

## Phase 2: El carrito no cruza de una empresa a otra

**Purpose**: un superadmin que cambia de empresa con el ticket cargado no puede
cobrar una venta con los productos de otro cliente. **Una línea de código, un
test de store, cero conflicto con la reescritura.**

- [x] **T1105** En `apps/web/src/store/useStore.js`, `setEmpresaActiva`
      (`:144-167`): el `set({ … })` que hoy limpia `sucursales: []` limpia
      también `cart: []`, **con el comentario al lado del que ya está** — es el
      mismo motivo y conviene que se lean juntos. Hoy `sucursales` se limpia
      «porque mostrar las columnas de otro cliente en la tabla de este es justo
      lo que el aislamiento viene a evitar»; el carrito es peor, porque no se
      muestra: se **cobra**. Al cobrar, `SaleItem` guarda los `product_id` de la
      empresa A, la búsqueda de stock por `empresa_id: B` no encuentra nada, y la
      venta queda registrada con las líneas de otro cliente y sin descontar nada,
      con un aviso que se lee como un problema de stock (FR-062, defecto 2).
      **Verificación**: `npm --prefix apps/web test -- src/tests/storeDeInventario.test.js`
      pasa con el caso nuevo. Ese archivo ya tiene el molde: `api` doblado, el
      store rellenado a mano con `useStore.setState`.
      **El test**: `it('NO deja el ticket de una empresa cargado al cambiar a otra')`
      — se llena `cart` con dos líneas, se llama a `setEmpresaActiva(2)`, y
      `useStore.getState().cart` tiene que quedar en `[]`. Y en el mismo bloque,
      `it('limpia el carrito ANTES de pedir los datos de la empresa nueva')`,
      que afirma que cuando se registra la llamada a `initialize` el carrito ya
      está vacío: limpiarlo después deja una ventana en la que la pantalla dibuja
      líneas de A con el contexto de B.
      **Cómo se comprueba que el test sirve**: se saca `cart: []` del `set` y el
      primero se pone en rojo con dos líneas contra cero; se mueve el
      `clearCart()` debajo del `await get().initialize()` y el segundo se pone en
      rojo. El archivo se llama `storeDeInventario` porque es donde está el molde
      del store doblado —lo dice el plan— y el encabezado tiene que aclarar que
      desde acá cubre también el carrito, o el próximo que busque este test no lo
      encuentra.

**Checkpoint**: cambiar de empresa con el ticket cargado lo deja vacío.
**Hasta acá los dos defectos vivos están cerrados y no se tocó una sola línea de
dibujo.** De acá en adelante es todo el rediseño.

---

## Phase 3: Las cinco funciones puras, y las tres copias que se juntan

**Purpose**: existe —y está testeado— todo lo que decide **qué medio de pago hay,
qué precio le toca a una línea, qué comprobante puede emitir la empresa, cuánto
vuelto va y qué hace cada tecla**, sin que nada de la pantalla haya cambiado
todavía.

Es la decisión 1 del plan: la regla sale del componente porque un test de render
que verifica una regla es diez veces más lento y se pone en rojo cuando alguien
mueve un `<div>`. El criterio fue uno solo: **¿se puede afirmar sin un DOM?**

- [x] **T1106** [P] ⚠ **Dependencia (a) y (b).** Crear
      `apps/web/src/utils/mediosDePago.js` con `SEGMENTOS = ['efectivo',
      'tarjeta', 'alianza']`, `MEDIOS` con los nueve códigos de la decisión 2 del
      plan —cada uno con `codigo`, `etiqueta`, `etiquetaCorta`, `segmento` y
      `vuelto`—, y `segmentoDe`, `mediosDelSegmento`, `medioPorDefecto`,
      `llevaVuelto`, `etiquetaDePago` y `precioDeLinea(codigo, linea)`.
      **Dos cosas que no son obvias y son la tarea**:
      **(1)** `segmento` y `vuelto` son **dos ejes distintos**: el segmento
      decide el precio, la bandera decide si aparece el bloque de vuelto. Una
      transferencia cotiza como efectivo y **no** lleva vuelto. Solo `ef` lleva.
      **(2)** `MEDIOS` son los nueve que el control **ofrece**; los históricos
      —`tc` y `tc3`, que están guardados y no se pueden ofrecer— viven en un mapa
      aparte, y `etiquetaDePago` cubre los once. `precioDeLinea` **también**
      conoce `tc3` como `tarjeta`, porque la pantalla lo sigue escribiendo hasta
      la fase 9 y sin eso todas las ventas con tarjeta cotizarían al precio de
      efectivo entre medio, en silencio. `tc1` va en el segmento **efectivo**
      —cotiza a ese precio en el sistema viejo (`legacy:6122`)—, con el motivo
      escrito en el archivo: **el segmento es un nivel de precio, no una forma de
      pagar** (riesgo 4). Test en `apps/web/src/utils/mediosDePago.test.js`.
      **Verificación**: `npm --prefix apps/web test -- src/utils/mediosDePago.test.js`.
      **El test**: `it('NO cotiza una compra con tarjeta al precio de efectivo')`
      —`precioDeLinea('tc3v', linea)` y `precioDeLinea('tc3', linea)` dan
      `base_card`, y los cinco del segmento efectivo dan `base_cash`—;
      `it('NO ofrece el bloque de vuelto para una transferencia')`
      —`llevaVuelto` es `true` solo para `ef`, y se recorre `MEDIOS` entero para
      afirmarlo, no se listan tres a mano—;
      `it('NO devuelve el precio de lista cuando la línea tiene precio a mano')`;
      `it('NO ofrece tc ni tc3 como medios elegibles')` —están en `etiquetaDePago`
      y **no** en `MEDIOS`, que es la diferencia entre «se puede leer» y «se puede
      elegir»—; y `it('un código desconocido cae a efectivo y no a undefined')`.
      **Cómo se comprueba que el test sirve**: se saca `tc3` del mapa de precios
      y el primero se pone en rojo; se le pone `vuelto: true` a `tr` y el segundo;
      se agrega `tc3` a `MEDIOS` y el cuarto. Los tres son plata: equivocar el
      mapa cobra el precio de efectivo por una compra con tarjeta y **nada
      falla**.

- [x] **T1107** [P] ⚠ **Dependencia (d).** Crear
      `apps/web/src/utils/comprobantes.js` con
      `comprobantesDisponibles({ condicionFiscal, afipConfigurado })` →
      la lista de `{ valor, etiqueta, fiscal, disponible, motivo }`,
      `comprobanteInicial(condicionFiscal)` y
      `desglosarIva({ total, condicionFiscal, comprobante })`. **El encabezado
      del archivo dice que no es `utils/comprobanteAfip.js`**, que es el QR de la
      RG 4892/2020 y el nombre para imprimir: los dos nombres empiezan igual y
      hacen cosas que no tienen nada que ver. Reglas: `RI` → Factura B y A;
      `Monotributo` **y `Exento`** → Factura C (supuesto 10, y es el defecto 1
      entero); Remito y Recibo X siempre. Sin AFIP configurado, los fiscales van
      `disponible: false` **con motivo**, no ausentes (decisión 8 de la spec,
      FR-055). `desglosarIva` devuelve `null` salvo que la empresa sea `RI`
      **y** el comprobante sea Factura A o B, y calcula igual que el servidor:
      neto `= total / 1,21`, etiquetado como IVA **incluido**
      (`afipService.js:263`, FR-022). Test en
      `apps/web/src/utils/comprobantes.test.js`.
      **Verificación**: `npm --prefix apps/web test -- src/utils/comprobantes.test.js`.
      **El test**: `it('una empresa Exento NO se queda sin Factura C')` —hoy la
      lista solo la ofrece con `'Monotributo'` exacto (`Billing.jsx:625-627`)
      mientras el estado inicial ya dice `afip_c` (`:70`): se ve seleccionado
      «Remito» y se emite Factura C—;
      `it('el comprobante inicial SIEMPRE está en la lista, para las tres condiciones')`
      —el invariante de FR-061, recorriendo `['RI', 'Monotributo', 'Exento']` y
      afirmando `lista.some(c => c.valor === inicial)`, que renderizado costaría
      tres montajes de la pantalla entera—;
      `it('un monotributista NO ve una línea de IVA que no cobró')` —`Monotributo`
      y `Exento` dan `null` con cualquier comprobante; `RI` con remito también—; y
      `it('el neto y el IVA suman exactamente el total')` con total 0, total 1 y
      un total con centavos que no divide redondo.
      **Cómo se comprueba que el test sirve**: se cambia la condición de la
      Factura C a `=== 'Monotributo'` —o sea, se copia la línea de hoy— y el
      primero y el segundo se ponen en rojo; se saca la condición de `RI` de
      `desglosarIva` y el tercero. El cuarto es la regla de CONVENCIONES sobre
      dinero: casos de borde obligatorios.

- [x] **T1108** [P] Crear `apps/web/src/utils/atajosDelPos.js` con
      `atajoDe(evento)` → `'enfocarBusqueda' | 'agregarPrimero' | 'cobrar' |
      'limpiar' | null`. Es **pura**: recibe `{ key, ctrlKey, metaKey, altKey,
      shiftKey, defaultPrevented, target: { tagName, isContentEditable, dataset } }`
      y no toca el DOM. La tabla de decisión completa es FR-030 a FR-039 y la
      tabla de atajos de la historia 2 de la spec. **Dos reglas mandan sobre
      todo lo demás y van primero en la función**: si `defaultPrevented` es
      `true` devuelve `null` —eso es FR-038 sin enumerar selectores del DOM, que
      es lo que se rompe la primera vez que alguien cambia la librería de
      diálogos—; y si hay `altKey` o `shiftKey` devuelve `null` (FR-039). Después:
      `/` fuera de un campo de texto enfoca, `/` **dentro** de uno devuelve `null`
      (escribe la barra, FR-032); `Enter` a secas devuelve `'agregarPrimero'`
      **solo** si el foco está en el campo de búsqueda —marcado con un
      `data-*`— y `null` en cualquier otro lado (**`Enter` NO cobra nunca**,
      FR-031); `Ctrl+Enter` o `⌘+Enter` devuelve `'cobrar'` desde donde sea,
      incluidos los campos de texto (FR-035); `Esc` devuelve `'limpiar'`. Test en
      `apps/web/src/utils/atajosDelPos.test.js`.
      **Verificación**: `npm --prefix apps/web test -- src/utils/atajosDelPos.test.js`,
      con la tabla completa: 4 teclas × `nada`/`Ctrl`/`Meta`/`Alt`/`Shift` × foco
      en `INPUT`/`TEXTAREA`/`SELECT`/`BODY` × `defaultPrevented` en `true` y
      `false`. Son objetos planos: milisegundos, sin render.
      **El test**: `it('Enter NO cobra, esté donde esté el foco')` —recorre las
      cuatro ubicaciones de foco y afirma que ninguna devuelve `'cobrar'`; es
      **el** test de esta tarea, porque un lector de código de barras termina
      cada lectura con `Enter` y si `Enter` cobrara **cada escaneo cobraría la
      venta**—; `it('/ dentro de un campo de texto NO se roba la tecla')`;
      `it('ningún atajo se dispara con Alt o Shift')`;
      `it('ningún atajo se dispara si otro control ya usó la tecla')` con
      `defaultPrevented: true`, que es el `Esc` de un diálogo abierto (escenario
      2.13).
      **Cómo se comprueba que el test sirve**: se agrega una rama que devuelva
      `'cobrar'` para `Enter` sin modificadores —que es literalmente lo que pide
      `PLAN-COMPRAFIT.md` 4.1 y que esta spec contradice a propósito— y el
      primero se pone en rojo; se saca el `if (evento.defaultPrevented) return
      null` y el cuarto.

- [x] **T1109** [P] Crear `apps/web/src/utils/vuelto.js` moviendo
      `sugerenciasDeVuelto` desde el `useMemo` de `apps/web/src/pages/Billing.jsx:106-118`,
      junto con el cálculo del vuelto (`:97`) como
      `calcularVuelto(pagaCon, total)` → `{ vuelto, falta }`. Es aritmética con
      plata escrita adentro de un `useMemo` donde **ningún test la alcanza**, y
      FR-018 la da por conservada sin que exista nada que lo garantice. Test en
      `apps/web/src/utils/vuelto.test.js`.
      **Verificación**: `npm --prefix apps/web test -- src/utils/vuelto.test.js`.
      **El test**: `it('NO propone un billete que no alcanza para el total')`
      —con $47.300 propone $50.000, $60.000 y $100.000, y ninguno menor al
      total—; `it('con total 0 no propone nada')`;
      `it('con un total que ya es un escalón exacto no propone ese mismo escalón')`
      —$50.000 no puede proponer $50.000, que es «pagó justo» y no una
      sugerencia—; y `it('NO devuelve un vuelto negativo: devuelve cuánto falta')`
      (escenario 5.10), que es la diferencia entre decirle al operador «−$3.200»
      y decirle «faltan $3.200».
      **Cómo se comprueba que el test sirve**: se cambia el `redondeado >
      totalAmount` por `>=` y el tercero se pone en rojo; se devuelve el vuelto
      crudo sin separar `falta` y el cuarto.

- [x] **T1110** [P] ⚠ **Hallazgo 5 del plan: sin esto, `Enter` con un escáner
      agrega al ticket un producto que nadie escaneó.** Crear
      `apps/web/src/utils/busquedaDelPos.js` con
      `buscarEnCatalogo(catalogo, consulta, fuse)` →
      `{ resultados, exacta, codigoNoEncontrado }`, que resuelve en este orden:
      **(1)** coincidencia exacta de `barcode` o `sku`, normalizados sin espacios
      ni guiones → devuelve **ese producto solo**, `exacta: true`; **(2)** si no,
      y la consulta **parece un código** —solo dígitos, 8 caracteres o más—
      devuelve lista vacía con `codigoNoEncontrado: true`; **(3)** si no, la
      búsqueda difusa de `Fuse` que ya está (`Billing.jsx:137`, `threshold: 0.4`).
      Test en `apps/web/src/utils/busquedaDelPos.test.js`.
      **Verificación**: `npm --prefix apps/web test -- src/utils/busquedaDelPos.test.js`.
      **El test**: `it('un EAN de 13 dígitos que no existe NO devuelve el producto más parecido')`
      —es el test que da nombre al archivo: `Fuse` con `threshold: 0.4` sobre un
      EAN inexistente casi siempre devuelve *algo*, porque los códigos comparten
      dígitos, y con FR-033 eso significa vender un producto que no salió del
      local—; `it('el código exacto le gana a la difusa aunque haya diez parecidos')`;
      `it('una consulta corta sí usa la difusa')` —«colageno» con typo tiene que
      seguir encontrando «Colágeno», que es el otro uso del mismo campo—; y
      `it('un SKU con guiones y espacios encuentra igual')`.
      **Cómo se comprueba que el test sirve**: se saca el paso 2 y el primero se
      pone en rojo devolviendo un producto; se saca el paso 1 y el segundo.
      ⚠ **Riesgo 9**: si `barcode` está vacío en la mayoría del catálogo, el paso
      2 empieza a rechazar escaneos de productos que **sí** están cargados. Por
      eso el aviso que consume esto (T1117) dice «ningún producto tiene ese
      código de barras o SKU» —apunta al dato faltante y no al producto— y el
      operador puede seguir buscando por nombre en el mismo campo.

- [x] **T1111** ⚠ **Dependencia (a): la lista de la API tiene diez claves, no
      nueve.** Dos archivos, un commit: en `apps/api/src/utils/exportVentas.js`,
      agregar `tc3: 'T. Crédito 3c'` a `ETIQUETAS_DE_PAGO` (`:22-33`) —es el
      código que el POS **ya escribió** en ventas reales y que hoy se exporta
      crudo (`:69` cae al `|| venta.payment_method`), se ve crudo en
      `PanelVenta.jsx:202` y aparece como una clave sin etiqueta en
      `Dashboard.jsx:209`—; y crear `apps/web/src/tests/mediosDePago.test.js`,
      que lee **el archivo de la API como texto** —igual que hacen las guardias
      estáticas— y compara sus claves contra las de `etiquetaDePago` de T1106.
      **Las ventas viejas no se migran**: nada en la fila dice si esa tarjeta fue
      Visa, Master o Naranja, y reescribir el registro contable de una operación
      cerrada a partir de una adivinanza es peor que dejarlo. El valor sigue
      significando «tarjeta, sin decir cuál». Sumar el caso a
      `apps/api/src/tests/exportVentas.test.js`.
      **Verificación**: `npm run test:api` y `npm run test:web` pasan.
      **El test**: `it('el historial NO muestra un código de pago sin etiqueta')`
      en `exportVentas.test.js` —una venta con `payment_method: 'tc3'` se exporta
      como `'T. Crédito 3c'` y no como `'tc3'`—; y en
      `apps/web/src/tests/mediosDePago.test.js`,
      `it('la lista del navegador y la de la API no se separaron')`, que afirma
      igualdad de conjuntos de claves en **los dos sentidos**: una clave de más en
      la web es un medio que el historial no sabe leer, y una de más en la API es
      un medio que el POS no puede elegir.
      **Cómo se comprueba que el test sirve**: se saca `tc3` de la lista de la
      API y los dos se ponen en rojo. El de contrato es grosero —lee un archivo de
      otro paquete como texto— y es exactamente lo que hace falta: **si no
      existiera, `tc3` no lo habría visto nadie**, que es lo que pasó.

- [x] **T1112** [P] ⚠ **Dependencia (b).** En
      `apps/web/src/store/useStore.js`, los **tres** `priceMap` escritos a mano
      —`addToCart` (`:193`), `updateCartMethod` (`:237`) y `updateCartPrice`
      (`:262`)— pasan a llamar a `precioDeLinea` de T1106. Tres literales iguales
      empiezan iguales y terminan distintos, y con nueve medios en vez de tres hay
      que tocar los tres a la vez. **Lo que no cambia acá**: `addToCart` sigue
      recibiendo el medio por parámetro (la herencia del medio del ticket es
      T1129), y el precio a mano sigue sobreviviendo al cambio de medio
      (`:235`).
      **Verificación**: `npm --prefix apps/web test -- src/tests/storeDeInventario.test.js`
      pasa, y **la pantalla vieja sigue cobrando bien**: `precioDeLinea('tc3',
      linea)` devuelve `base_card`, que es lo que `Billing.jsx:565` sigue
      escribiendo hasta la fase 9.
      **El test**: en `storeDeInventario.test.js`,
      `it('NO queda ningún priceMap escrito a mano en el store')` —guardia
      estática sobre `useStore.js`: `base_card` no puede aparecer dentro de un
      literal de objeto con `ef:`— y
      `it('la pantalla vieja sigue cobrando la tarjeta al precio de tarjeta')`,
      que llama a `updateCartMethod(id, 'tc3')` y afirma `price === base_card`.
      **Cómo se comprueba que el test sirve**: se saca `tc3` del mapa de
      `precioDeLinea` y el segundo se pone en rojo cobrando el precio de
      efectivo. **Ese es el test que importa de esta tarea**: sin él, entre la
      fase 3 y la fase 9 todas las ventas con tarjeta se cobran mal y nada falla.

- [x] **T1113** [P] En `apps/web/src/components/PanelVenta.jsx`, borrar la copia
      local de `ETIQUETAS_DE_PAGO` (`:28-39`) e importar `etiquetaDePago` de
      T1106. Es la tercera copia de la misma lista y el archivo lo dice en su
      propio comentario («son las mismas que escribe el archivo exportado»), que
      es cómo se sabe que ya se separaron.
      **Verificación**: `npm --prefix apps/web test -- src/tests/historialDeVentas.test.js`
      y `npm run build` pasan; `PanelVenta.jsx` sigue en verde en
      `guardiasDeDiseno.test.js`.
      **El test**: en `apps/web/src/tests/mediosDePago.test.js` (el de T1111),
      `it('PanelVenta NO tiene su propia copia de las etiquetas')` — guardia
      estática: el archivo no puede contener `ETIQUETAS_DE_PAGO = {`.
      **Cómo se comprueba que el test sirve**: se vuelve a pegar el objeto en
      `PanelVenta.jsx` y el test se pone en rojo. Sin la guardia, la copia vuelve
      la próxima vez que alguien necesite una etiqueta y no quiera importar nada.

- [x] **T1114** [P] En `apps/web/src/pages/Dashboard.jsx:205-215`, el bloque «Por
      Método de Pago (30d)» deja de imprimir la clave cruda
      (`method.replace(/_/g, ' ')`) y usa `etiquetaDePago` de T1106. Con tres
      valores esto ya era feo; a partir de la fase 9 le muestra `tc3n` al
      usuario. **Lo que el panel *cuenta* no cambia acá** (decisión 4c).
      **Verificación**: `npm run build` pasa y el panel muestra «Naranja 3c» y no
      `tc3n`.
      **El test**: en `apps/web/src/tests/mediosDePago.test.js`,
      `it('el panel NO le muestra al usuario el código crudo del medio de pago')`
      — guardia estática sobre `Dashboard.jsx`: la línea que renderiza `method`
      no puede hacerlo sin pasar por `etiquetaDePago`.
      **Cómo se comprueba que el test sirve**: se vuelve la línea a
      `{method.replace(/_/g, ' ')}` y el test se pone en rojo.
      ⚠ **Riesgo 3, y hay que decirlo en el commit**: a partir de la fase 9 este
      panel pasa de tres buckets a hasta nueve, y **el «Efectivo» del día deja de
      incluir las transferencias**. Es el defecto 3 resuelto, pero significa que
      un número que el dueño mira todos los días cambia sin que se haya roto
      nada. Se documenta en T1134.

**Checkpoint**: `npm run test:web` pasa con cinco archivos de tests nuevos de
funciones puras más el de contrato. **Nada se ve todavía**: la pantalla es la
misma, con la única diferencia de que el precio de una línea y las etiquetas del
historial salen ahora de un solo lugar.

---

## Phase 4: La guardia de diseño entra **antes** de escribir la pantalla

**Purpose**: cada hex, cada `dark:` y cada clase de la paleta de Tailwind falla
**en el momento en que se escribe** y no treinta juntos al final, cuando ya nadie
sabe cuál vino de dónde y la salida barata es comentar la guardia.

- [x] **T1115** ⚠⚠ **Esta tarea deja `npm run test:web` EN ROJO a propósito, y
      así se queda hasta T1122.** Crear vacíos —un componente que devuelve `null`
      y un comentario de qué va a ser— `apps/web/src/components/MarcoDePantalla.jsx`,
      `apps/web/src/components/pos/CatalogoDelPos.jsx`,
      `apps/web/src/components/pos/TicketDelPos.jsx` y
      `apps/web/src/components/pos/SegmentoDePago.jsx`; sumarlos **más
      `pages/Billing.jsx`** a la lista `ARCHIVOS` de
      `apps/web/src/tests/guardiasDeDiseno.test.js:48-55`, con el
      `expect(ARCHIVOS).toHaveLength(7)` de `:104` pasando a **12**; y agregar el
      cuarto patrón, el de la paleta de Tailwind, con el regex de la decisión 11
      del plan. **`white` y `black` quedan fuera del patrón a propósito y hay que
      escribir por qué**: `REGLAS-DISENO.md` fija el botón principal como
      `bg-brand text-white` y la maqueta pone `color:#fff` adentro del botón de
      confirmar (`docs/maqueta/AdminApp-Rediseno.dc.html:484`); un patrón que los
      incluyera fallaría contra el propio sistema de diseño el primer día.
      **En la misma tarea, ⚠ dependencia (c)**: la guardia de `<Can>`
      (`:160-171`) hace `readdirSync` **sin recursión** sobre `pages` y
      `components`, así que `components/pos/` quedaría fuera y un `<Can>` mal
      escrito ahí adentro dejaría ver un botón a cualquiera **con la guardia en
      verde**. Se hace recursiva.
      **Verificación**: `npm --prefix apps/web test -- src/tests/guardiasDeDiseno.test.js`
      falla, y falla **nombrando `pages/Billing.jsx` y las cuatro líneas
      exactas**: `text-blue-500` (`:460`), `border-orange-400` (`:588`),
      `border-green-500/30` y `bg-green-50` (`:777`). **Que esté en rojo es el
      resultado buscado de esta tarea**, y es lo mismo que hizo la 010 con
      `Inventory.jsx` (T1031). Queda escrito en el comentario del archivo, arriba
      de la lista, con la tarea que lo pone en verde: **T1122**.
      **⚠ Lo que nadie puede hacer para «arreglarlo»**: sacar `pages/Billing.jsx`
      de `ARCHIVOS`, comentar el patrón nuevo, o meter las cuatro clases adentro
      de un comentario. Si el rojo molesta, la salida es T1122, no la lista.
      **El test**: los que ya existen, ampliados —
      `it('$nombre no usa clases de la paleta de Tailwind')`— más
      `it('la guardia de <Can> mira también las subcarpetas de components')`, que
      afirma que la lista de archivos escaneados incluye `components/pos/`; más
      —⚠ **riesgo 6, que el plan da por no verificable**—
      `it('los componentes de components/pos NO leen el store por su cuenta')`,
      una guardia estática: ninguno de los tres puede contener `useStore`. El
      plan dice «no se detecta automáticamente. Mitigación: queda escrito en el
      encabezado de cada archivo», y un comentario no detiene a nadie: el primero
      que agregue un `useStore(...)` adentro de `TicketDelPos` crea una segunda
      fuente para el mismo dato y la pantalla deja de tener un solo dueño del
      estado. La guardia pasa trivialmente hoy —los tres archivos están vacíos— y
      muerde el día que importe.
      **Cómo se comprueba que el test sirve**: se agrega a mano un `text-red-500`
      a `components/MarcoDePantalla.jsx` y la guardia lo nombra con archivo y
      línea; se agrega un `#fff` y la de hexadecimales también. Para el de
      `<Can>`: se escribe `<Can permission="ventas.crear">` dentro de
      `components/pos/TicketDelPos.jsx` y la guardia se pone en rojo — antes de
      esta tarea, pasaba.

**Checkpoint**: la suite de la web está en rojo, **en un solo archivo y por una
sola razón conocida**, y cada línea que se escriba de acá en adelante en los
cinco archivos de la lista se verifica en el momento.

---

## Phase 5: El marco de 1320px baja a un componente, y `/pos` se sale de él

**Purpose**: el POS puede ocupar el alto completo de `<main>` y administrar su
propio scroll, **sin que ninguna de las otras diecisiete pantallas cambie**.

⚠ **Riesgo 7, y por eso esta fase tiene una sola tarea y va sola, antes de tocar
el POS.** Un error acá no rompe el POS: rompe **todo lo demás**. Y `npm run
build` no lo ve.

- [x] **T1116** En `apps/web/src/components/MarcoDePantalla.jsx` (creado vacío en
      T1115), mover el contenedor que hoy está en `apps/web/src/App.jsx:253`:
      `mx-auto max-w-[1320px] px-5 py-7 lg:px-9 lg:py-8`, más `overflow-y-auto
      h-full`. En `App.jsx`, el `<main>` (`:252`) pasa de
      `min-h-0 flex-1 overflow-y-auto` a `min-h-0 flex-1 overflow-hidden`, el
      `<div>` de `:253` desaparece, y **cada `<Route>` menos `/pos`** envuelve su
      elemento en `<MarcoDePantalla>`. `/pos` recibe `h-full` a secas.
      **Alternativas ya descartadas y que no hay que volver a intentar**
      (decisión 6 del plan): márgenes negativos en `Billing.jsx` —se rompen en el
      primer `lg:`, que son cuatro valores en dos breakpoints, y el `calc` de la
      altura duplica el alto del `AppTopbar` en un archivo que no lo conoce—; y
      una ruta fuera del shell —el POS necesita el `AppTopbar` entero: la miga de
      pan que lo nombra, en la que se apoya FR-004 para no tener `h1`, y el
      selector de sucursal, que es lo que FR-063 hace cambiar—.
      **Verificación**: `npm run build` pasa **y no alcanza**: la verificación
      real es el paso manual **5** del final —abrir Ventas, Inventario y Panel y
      comprobar que siguen centradas a 1320px con el mismo padding, y que su
      scroll sigue siendo el de siempre—. Tres pantallas y no una: el error
      típico acá es dejar bien la primera que se mira.
      **El test**: crear `apps/web/src/tests/marcoDePantalla.test.js`,
      `it('ninguna pantalla se quedó sin el marco de 1320px al sacarlo de App.jsx')`
      — lee `App.jsx` como texto, extrae **todos** los `<Route path="…">`, saca
      los que son `<Navigate>` puros, y afirma que el elemento de cada uno de los
      restantes contiene `MarcoDePantalla`, **salvo `/pos`**. Y
      `it('/pos es la única excepción, y está declarada')`, que afirma que la
      lista de excepciones del test tiene exactamente un elemento: si mañana
      alguien saca otra pantalla del marco, tiene que venir acá y escribirlo.
      **Cómo se comprueba que el test sirve**: se le saca el `<MarcoDePantalla>`
      a **una** ruta cualquiera —`/inventario`, por ejemplo— y el test se pone en
      rojo **nombrando esa ruta**. Se agrega una segunda excepción sin declararla
      y el segundo también. Es una guardia estática porque lo que hay que
      verificar es que **no falte ninguna de diecisiete**, y montar diecisiete
      pantallas en jsdom para eso cuesta más de lo que atrapa; lo que el test no
      puede ver —que el padding se vea igual— es el paso manual 5.

**Checkpoint**: las diecisiete pantallas se ven exactamente igual que antes,
verificado a ojo en tres de ellas. El POS todavía es el viejo, ahora sin marco:
va a verse pegado al borde hasta T1122, y eso es esperado.

---

## Phase 6: Los atajos y el foco, sobre la pantalla vieja

**Purpose**: se puede hacer una venta entera sin tocar el mouse, y después de
cada una el cursor ya está en la búsqueda.

El corte 6 antes del 7 es deliberado y va contra el orden de prioridades de la
spec. El motivo: los atajos y el foco son la parte que **más fácil se rompe sin
que se note** y la que tiene diecisiete criterios de aceptación; probarlos sobre
un dibujo que ya funciona los aísla del riesgo de la reescritura. Si algo falla,
se sabe que es el teclado y no el layout.

- [x] **T1117** Crear `apps/web/src/hooks/useAtajosDelPos.js` con el patrón de la
      decisión 5 del plan: **dos efectos**, uno sin deps que guarda las acciones
      en un `ref` en cada render, y otro con **deps `[]`** que suscribe
      `keydown` en `window` una sola vez y devuelve su `removeEventListener`. El
      handler llama a `atajoDe(evento)` de T1108, y solo hace
      `evento.preventDefault()` **si hay atajo**. **En fase de burbuja y en
      `window`, no en captura y no en el `<div>` raíz** (las tres alternativas y
      su motivo están en la decisión 5). Engancharlo en
      `apps/web/src/pages/Billing.jsx` con las cuatro acciones: `enfocarBusqueda`
      mueve el foco al campo; `agregarPrimero` usa `buscarEnCatalogo` de T1110 y
      —si hay resultado **con stock**— lo agrega, vacía la consulta y **deja el
      foco donde estaba**; si no hay resultados **no** vacía la consulta y avisa
      (FR-033, escenario 2.5); si el primero no tiene stock, no lo agrega y dice
      por qué (escenario 2.6); `cobrar` llama al handler que ya existe; `limpiar`
      es T1119.
      **Verificación**: `npm --prefix apps/web test -- src/tests/renderDelPuntoDeVenta.test.jsx`
      (archivo nuevo, molde en `renderDeInventario.test.jsx`: store lleno a mano
      con `useStore.setState` incluidas las acciones, `initialize` doblado con
      `vi.fn()`, y `vi.spyOn(api, 'post')` en vez de mockear `@/services/api`
      entero).
      **El test**: `it('Enter en la búsqueda agrega el primer resultado y NO cobra')`
      —afirma las dos cosas: la línea entró al ticket **y** `api.post` no se
      llamó—; `it('Ctrl+Enter dispara un solo POST /sales')`;
      `it('un código escaneado que no existe NO borra la consulta')`;
      y **el que verifica una ausencia**:
      `it('desmontada la pantalla, Ctrl+Enter no llama a api.post')`, que monta
      con una línea en el ticket, espía `api.post`, **desmonta**, dispara
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }))`
      y afirma que no se llamó.
      **Cómo se comprueba que el test sirve**: se borra el `return` del
      `useEffect` —el `removeEventListener`— y el último se pone en rojo: el
      escuchador huérfano sigue viendo el store, que es global, y dispara el
      cobro. **Es el único test de este hito que verifica una ausencia y por eso
      hay que dejarlo dicho en el encabezado del archivo**; un test que verifica
      que algo *no* pasa es el primero que alguien borra por «no probar nada».
      Para el tercero, se agrega `setSearchQuery('')` incondicional en
      `agregarPrimero` y se pone en rojo.

- [x] **T1118** En `apps/web/src/pages/Billing.jsx`, el foco automático (historia
      3): un `ref` en el campo de búsqueda, `focus()` al montar, y `focus()`
      **imperativo al final del handler de cobro** —no por `useEffect`— y al
      agregar un producto con el mouse. ⚠ **El `useEffect` no puede depender de
      `loading`**: los escenarios 3.3 y 3.7 hablan del mismo instante y piden
      cosas opuestas, y `useEffect(() => buscador.current?.focus(), [loading])`
      incumple 3.7 la primera vez que el operador tipea un CUIT mientras se
      resuelve **cualquier otra cosa** —la búsqueda de fichas de cliente, por
      ejemplo—. Se resuelve como dice el punto 4 de «Lo que la spec pide y hay
      que ajustar»: el foco se fuerza **solo** al terminar la operación de cobro,
      que es la que además limpia el CUIT (FR-048), así que no hay nada que
      preservar. Los demás pedidos en vuelo **nunca** tocan el foco.
      **Verificación**: `npm --prefix apps/web test -- src/tests/renderDelPuntoDeVenta.test.jsx`.
      **El test**: `it('al abrir la pantalla el foco NO se queda en el body')`
      —`document.activeElement` es el campo de búsqueda—;
      `it('después de cobrar el foco vuelve a la búsqueda y la consulta está vacía')`;
      `it('escribiendo en el CUIT, la respuesta de otro pedido NO me mueve el foco')`,
      que enfoca el CUIT, resuelve una promesa de `getCustomers` y afirma que
      `document.activeElement` sigue siendo el CUIT.
      **Cómo se comprueba que el test sirve**: se saca el `focus()` del montaje y
      el primero se pone en rojo con `<body>`; se cambia el `focus()` imperativo
      del final del handler por `useEffect(…, [loading])` y **el tercero** se
      pone en rojo. Ese tercero es el que protege la corrección que el plan tuvo
      que inventar para dos escenarios que se contradecían: sin él, la salida
      «obvia» —el efecto— vuelve sola.

- [x] **T1119** En `apps/web/src/pages/Billing.jsx`, la acción `limpiar` de
      T1117: con texto en la búsqueda, `Esc` limpia **el campo** y deja el foco
      ahí, y **no toca el ticket** (FR-036); con la búsqueda ya vacía y el ticket
      cargado, abre la confirmación con `useConfirmDialog`
      (`apps/web/src/components/ConfirmDialog.jsx:12`, decisión 2 de la spec);
      con el ticket **vacío**, no abre nada —no hay nada que perder y un diálogo
      para confirmar que se borre lo que ya está borrado es ruido—. **En los dos
      finales del diálogo —confirmar y cancelar— el `resolve` termina con
      `buscador.current?.focus()`**, y ese `focus()` explícito no es adorno:
      `ui/dialog` devuelve el foco **al elemento que lo abrió**, y acá no hay
      elemento —lo abrió una tecla—, así que sin él el foco vuelve al `<body>` y
      el operador tiene que apretar `/` para volver a donde ya estaba.
      **Verificación**: `npm --prefix apps/web test -- src/tests/renderDelPuntoDeVenta.test.jsx`.
      **El test**: `it('Esc con texto en la búsqueda NO vacía el ticket')` —el
      caso que motivó la decisión: en un mostrador `Esc` se aprieta por reflejo—;
      `it('Esc con la búsqueda vacía pide confirmación antes de tirar el ticket')`;
      `it('cancelar la confirmación devuelve el foco a la búsqueda, no al body')`.
      **Cómo se comprueba que el test sirve**: se hace que `limpiar` llame a
      `clearCart()` sin mirar la consulta y el primero se pone en rojo; se saca
      el `focus()` del `resolve` y el tercero se pone en rojo con `<body>`.

**Checkpoint**: se hace una venta entera sin un solo evento de mouse —`/`,
escribir, `Enter`, `Ctrl+Enter`— sobre la pantalla vieja, y el cursor vuelve solo
a la búsqueda. La pantalla sigue fea y sigue en una columna.

---

## Phase 7: Las dos columnas de la maqueta

**Purpose**: la pantalla se ve como el bloque `isPos` de
`docs/maqueta/AdminApp-Rediseno.dc.html:336-489`, y **la guardia del corte 4 pasa
a verde**.

- [x] **T1120** [P] Escribir `apps/web/src/components/pos/CatalogoDelPos.jsx` (la
      columna izquierda): barra de búsqueda **fija arriba** con sus filtros
      —chips de categoría de 29px y el conmutador «Solo con stock»
      (`maqueta:347-357`)— y la lista con **su propio scroll** debajo; el
      encabezado de columna `Producto · Efectivo · Tarjeta · Alianza` con
      `.eyebrow`, y el **mismo string** de `grid-template-columns`
      (`minmax(0,1fr) 104px 104px 104px 44px`, `gap: 0 16px`) en el encabezado y
      en cada fila (FR-007); las filas como **tarjetas separadas**
      (`rounded-[11px]`, borde, `gap` de 8px) y **no** como `Fila` de `TablaGrid`
      —el motivo va escrito en el archivo: en un listado se escanea, acá se
      apunta con la mano y se toca; `Fila` fija `border-b … px-5 py-[15px]` y
      `BotonDeFila` fija 29px cuando la maqueta pide 32px (`:378`), y forzar el
      marco exige agregarle props, que es lo que `TablaGrid.jsx:20-30` dice que no
      se hace—; nombre arriba y `marca · SKU · stock` debajo en `fg-3` con SKU y
      stock en `.num`, «—» donde falte el dato; los tres precios a la derecha en
      `.num` con el de efectivo con más peso, y `sinCosto` de `calcularPrecios`
      marcado en vez de un `$0` que parece un precio; producto sin stock atenuado
      y con el botón deshabilitado; estado vacío con ícono apagado, dos líneas y
      **la sugerencia de quitar el filtro de stock**; y el tope de resultados
      visibles con la línea «N de M · afiná la búsqueda» (decisión 6 de la spec),
      **sin paginador**. Recibe todo por props y **no toca el store** (riesgo 6),
      y eso va escrito en el encabezado.
      **Verificación**: `npm --prefix apps/web test -- src/tests/guardiasDeDiseno.test.js`
      no reporta nada nuevo en este archivo, y los pasos manuales **2** y **3**
      del final.
      **El test**: en `renderDelPuntoDeVenta.test.jsx`,
      `it('ningún precio queda bajo la etiqueta equivocada')` —el encabezado y una
      fila comparten el **mismo string** de `grid-template-columns`, comparados
      como strings y no «parecidos»— y
      `it('una búsqueda sin resultados NO deja una lista en blanco')`.
      **Cómo se comprueba que el test sirve**: se le cambia `104px` por `100px` a
      **una** de las dos declaraciones y el primero se pone en rojo. Es el test
      que la 010 dejó como patrón: dos strings que empiezan iguales y se separan
      es cómo un precio termina bajo otra etiqueta.

- [x] **T1121** [P] Escribir `apps/web/src/components/pos/TicketDelPos.jsx` (la
      columna derecha, **400px** y no 380 como hoy `Billing.jsx:387`): encabezado
      propio con título, la cantidad de ítems en `.num` dentro de un chip y
      **Vaciar** a la derecha (FR-014); la lista de líneas con **su propio
      scroll**; cada línea con nombre, precio unitario, total de línea en `.num`,
      control de cantidad, selector de medio de pago y botón de quitar; **el
      precio manual conservado entero**, con su marca visible y su forma de volver
      al de lista —la maqueta no lo dibuja porque se dibujó antes, y **una función
      liberada no se pierde por seguir un dibujo** (FR-017, mismo criterio que
      FR-009 de la 010)—; el ticket vacío diciendo qué hacer y **nombrando el
      atajo con un `<kbd>` sobre `surface-3`** (FR-015, `maqueta:435`); y el pie
      de cobro **fijo abajo**, con el selector de comprobante como **control
      segmentado y no un `<select>`** (FR-019) alimentado por
      `comprobantesDisponibles` de T1107, el desglose Subtotal / IVA de
      `desglosarIva` —que devuelve `null` y entonces no se dibuja nada para un
      monotributista—, Condición IVA y CUIT/DNI en dos columnas con comprobante
      fiscal o el nombre del cliente con uno interno (FR-023), el bloque de
      vuelto de T1109, el total en `.num` a 24px sobre `surface-2` separado por
      un borde punteado (FR-021, `maqueta:473-480`), y `⌘↵` **adentro** del botón
      de confirmar (`maqueta:484`, FR-041). Recibe todo por props y **no toca el
      store**.
      **Verificación**: la guardia de diseño no reporta nada nuevo en este
      archivo; pasos manuales **2** y **4**.
      **El test**: en `renderDelPuntoDeVenta.test.jsx`,
      `it('un monotributista NO ve una línea de IVA que no cobró')` —criterio de
      éxito 14, y acá se afirma el **dibujo**; la regla ya la cubre
      `comprobantes.test.js`—; `it('el ticket vacío nombra el atajo dentro de un <kbd>')`
      —un atajo que no está escrito en ningún lado no lo usa nadie—; y
      `it('el selector de comprobante NO es un <select>')` (FR-019).
      **Cómo se comprueba que el test sirve**: se dibuja el desglose sin mirar el
      `null` de `desglosarIva` y el primero se pone en rojo; se saca el `<kbd>`
      del estado vacío y el segundo; se vuelve al `<select>` de `Billing.jsx:614`
      y el tercero.

- [x] **T1122** ⚠ **Es la tarea que pone en verde la guardia de T1115.**
      Reescribir `apps/web/src/pages/Billing.jsx` como las dos columnas: `h-full`
      con `min-width: 1080px` propio (`maqueta:337`), el catálogo ocupando el
      ancho restante y el ticket declarando **400px**, con un borde entre las
      dos; **sin `h1` y sin descripción** —la maqueta los reemplaza por la barra
      de búsqueda (`:339-358`) y la miga de pan del `AppTopbar` ya nombra la
      pantalla; es la única excepción de `REGLAS-DISENO.md` y se registra en
      T1132—; el cuerpo de la página **no scrollea** (FR-002); se borran el
      paginador y `PER_PAGE` (`:35`, `:474-507`), `getAvailableStock` (`:120`) se
      reemplaza por `filaDeStock` de `utils/inventario.js:57`, y **se saca el
      botón «Emitir Factura de Prueba (1 ARS)» del pie de cobro** junto con
      `handleTestInvoice` (`:316-376`, `:792-796`): emite un comprobante **fiscal
      real** en producción y está a un clic del botón de cobrar (FR-068); su
      destino se anota en T1133. Y **cero hexadecimales, cero `dark:` y cero
      clases de la paleta**: las cuatro de hoy —`text-blue-500` (`:460`),
      `border-orange-400` (`:588`), `border-green-500/30` y `bg-green-50`
      (`:777`)— salen a tokens de `index.css`.
      **Verificación**: `npm --prefix apps/web test -- src/tests/guardiasDeDiseno.test.js`
      **pasa en verde**, que es lo que esta tarea viene a lograr y lo que estuvo
      en rojo desde T1115; `npm run build` pasa; y los pasos manuales **1**, **2**
      y **3**.
      **El test**: la guardia de diseño ampliada de T1115, ahora en verde, más
      `it('el pie de cobro NO tiene el botón de factura de prueba')` en
      `renderDelPuntoDeVenta.test.jsx`, y
      `it('la pantalla NO dibuja su propio encabezado de pantalla')`, que afirma
      que no hay ningún `h1` en el documento (FR-004).
      **Cómo se comprueba que el test sirve**: se vuelve a pegar cualquiera de las
      cuatro clases —`text-blue-500`, por ejemplo— y la guardia vuelve al rojo
      nombrando el archivo y la línea; se vuelve a poner el botón de prueba y su
      test se pone en rojo.

**Checkpoint**: la pantalla se ve como el bloque `isPos` de la maqueta, el
catálogo y el ticket scrollean por separado, el cuerpo de la página no scrollea,
y **`npm run test:web` vuelve a estar entero en verde por primera vez desde
T1115**.

---

## Phase 8: El cobro, con sus tres finales

**Purpose**: apretar cobrar dos veces registra **una** venta; se sabe en qué paso
está la espera; y los tres finales posibles —todo bien, AFIP rechaza, la red se
cae— dejan la pantalla en un estado que no invita a cobrar de nuevo.

- [x] **T1123** En `apps/web/src/pages/Billing.jsx`, `handleRegisterSale`: el
      guardia contra el doble disparo pasa a ser un **`useRef`** y no `loading`
      (FR-042, defecto 5). `loading` es estado de React: cada render **captura
      una copia**, y dos eventos de la misma tanda —doble clic, o la tecla en
      autorrepetición— ejecutan el mismo handler de la misma copia y los dos leen
      `false`; recién el render siguiente ve `true`, y para entonces los dos
      `POST` ya salieron. Un `ref` es **una celda mutable única** que sobrevive a
      los renders: la escritura del primer disparo es visible para el segundo en
      el mismo tick. El `disabled` sigue existiendo para que se **vea** que no hay
      que apretar, no como guardia.
      ⚠ **Riesgo 2, y es una línea concreta**: `cobroEnCurso.current = true` es
      **la primera línea del `try`**, no la de antes, y el `finally` está en el
      mismo bloque. Una excepción lanzada antes de entrar al `try` dejaría el
      cerrojo tomado y el POS no cobraría más hasta cambiar de pantalla, con el
      botón habilitado y sin pasar nada al apretarlo —el peor síntoma posible en
      un mostrador—. Va con un comentario que lo diga, porque mover esa línea
      «para que quede más prolijo» reintroduce el riesgo.
      En la misma tarea, el botón dice **en qué paso está** (FR-045): registrar la
      venta y pedir el CAE son dos esperas distintas y la segunda puede durar 30 s
      (`afipService.js:26`); pasado un umbral aparece la línea que explica que
      ARCA puede tardar y que **la venta ya quedó registrada**, para que nadie
      apriete de nuevo.
      **Verificación**: `npm --prefix apps/web test -- src/tests/renderDelPuntoDeVenta.test.jsx`.
      **El test**: `it('dos Ctrl+Enter seguidos NO registran dos ventas')` —dos
      `keydown` en la misma tanda, `api.post` llamado **una** vez— y
      `it('dos clics rápidos en cobrar NO registran dos ventas')` con
      `userEvent.dblClick`.
      Y para la segunda mitad de la tarea,
      `it('pasado el umbral, la espera del CAE dice que la venta ya quedó registrada')`,
      con `vi.useFakeTimers()` y el `api.post` de `/facturar` colgado: se avanza
      el reloj y el texto tiene que aparecer. Sin fake timers ese criterio (4.3)
      no se puede afirmar, y sin afirmarlo el operador aprieta de nuevo, que es
      exactamente lo que la línea viene a evitar.
      **Cómo se comprueba que el test sirve**: se vuelve el guardia a
      `if (loading) return` —que es lo de hoy, `disabled={cart.length === 0 ||
      loading}` en `:785`— y los dos primeros se ponen en rojo con dos llamadas
      contra una. **Es el criterio de éxito 6 y es verificable contra hoy**, donde
      registra dos. Para el tercero, se saca el umbral y se muestra la línea
      desde el primer instante: el test se pone en rojo porque la afirma
      **ausente** antes de avanzar el reloj.

- [x] **T1124** En la misma pantalla, el ticket queda **bloqueado** mientras dura
      el cobro (FR-046): no se pueden cambiar cantidades, precios ni medios de
      pago, ni agregar productos. Lo que se está facturando no puede cambiar
      mientras se factura.
      **Verificación**: `npm --prefix apps/web test -- src/tests/renderDelPuntoDeVenta.test.jsx`.
      **El test**: `it('con el cobro en curso, tocar el ticket NO lo modifica')`
      — con `api.post` colgado en una promesa sin resolver, se intenta subir una
      cantidad, editar un precio y cambiar un segmento, y se afirma que los tres
      controles están `disabled` **y** que el estado del carrito no cambió. Las
      dos mitades: `disabled` en el DOM no impide que un `keydown` dispare la
      acción por otro camino.
      **Cómo se comprueba que el test sirve**: se saca el `disabled` del stepper
      de cantidad y el test se pone en rojo en la primera mitad; se deja el
      `disabled` pero se permite que `agregarPrimero` siga funcionando durante el
      cobro y se pone en rojo en la segunda.

- [x] **T1125** En la misma pantalla, reemplazar las **dos** llamadas a
      `initialize()` de `handleRegisterSale` (`:261` en el camino de fallo de AFIP
      y `:297` en el de éxito) por el recorrido del campo `stock` que devuelve
      `POST /api/sales` (T1104), llamando a `actualizarProducto`
      (`useStore.js:96`) y reemplazando **la fila de stock de esa sucursal** en
      `producto.stock[]` —para eso viene `punto_de_venta_id` en cada entrada—.
      **Ningún `GET /products`.** Hoy `initialize()` dispara tres pedidos, pone
      `loading: true` global y vuelve a traer todos los productos con todas sus
      filas de stock (`useStore.js:43-61`) para actualizar dos o tres: entre una
      venta y la siguiente la pantalla parpadea y el catálogo se redibuja entero
      (defecto 4, FR-047).
      **Verificación**: `npm --prefix apps/web test -- src/tests/renderDelPuntoDeVenta.test.jsx`.
      **El test**: `it('después de una venta NO sale ningún GET /products')`
      —espía `api.get` y afirma que ninguna URL contiene `/products`; es el
      criterio de éxito 10 y es verificable contra hoy, donde salen tres
      pedidos— y `it('el stock del catálogo baja con lo que dijo el servidor, no con una resta del navegador')`,
      que devuelve un `stock` con un `available` **distinto** de `anterior − qty`
      y afirma que la fila queda con el del servidor.
      **Cómo se comprueba que el test sirve**: se vuelve a poner `await
      initialize()` y el primero se pone en rojo; se calcula `available - qty` en
      el navegador y el segundo. El segundo importa porque restar por cuenta
      propia es **mentira** en el caso que la spec nombra —el producto sin fila de
      stock, que no se descontó— y el catálogo mostraría un stock que no bajó.

- [x] **T1126** En la misma pantalla, los tres finales del cobro y lo que se
      limpia:
      **(a) éxito** → se limpian ticket, «Paga con», CUIT/DNI, nombre del
      cliente, cliente seleccionado y consulta de búsqueda (FR-048); **se
      conservan** tipo de comprobante, filtros de categoría y marca, «Solo con
      stock» y sucursal activa (FR-049) — en un mostrador se emite el mismo tipo
      de comprobante cincuenta veces seguidas.
      **(b) la venta se registró y AFIP la rechazó** → el mensaje de AFIP **tal
      cual**, dicho explícitamente que **la venta quedó registrada** y que el
      comprobante se reintenta desde el historial, en un aviso que **no
      desaparece solo**: un `toast` de cinco segundos no alcanza para «no se
      emitió la factura» (FR-051). El ticket **se vacía igual** (FR-052): la
      operación existe, y dejarlo cargado invita a cobrarla de nuevo.
      **(c) la API rechazó y no registró nada** —total inconsistente, ítem
      inválido, stock insuficiente— → el ticket queda **intacto** (FR-053).
      Más: `400 CUIT_REQUERIDO` (`sales.js:887-893`) se distingue **por el código
      y no por el texto**, deja cargar el CUIT y reintenta **solo la
      facturación**, sin volver a registrar la venta (FR-054); y la respuesta
      `200 { yaRegistrada: true }` de T1102 se trata como éxito, **sin volver a
      pedir el CAE si la venta ya lo tiene**.
      **Verificación**: `npm --prefix apps/web test -- src/tests/renderDelPuntoDeVenta.test.jsx`.
      **El test**: `it('un rechazo de AFIP NO deja el ticket cargado')`;
      `it('un rechazo de la API que no registró nada NO vacía el ticket')` —los
      dos juntos, porque la diferencia entre los dos es todo el criterio y
      confundirlos es cómo se cobra dos veces—;
      `it('el tipo de comprobante NO se resetea después de cada venta')`;
      `it('CUIT_REQUERIDO NO vuelve a registrar la venta')`, que afirma que el
      reintento manda **un solo** `POST /sales/:id/facturar` y **ningún**
      `POST /sales`.
      **Cómo se comprueba que el test sirve**: se saca el `clearCart()` de la
      rama de AFIP y el primero se pone en rojo; se agrega uno en el `catch`
      general y el segundo; se resetea `docType` al terminar y el tercero; se
      hace que el reintento de CUIT vuelva a llamar a `handleRegisterSale`
      entero y el cuarto.

- [x] **T1127** En la misma pantalla, tres cosas que van juntas porque las tres
      son «decirlo antes y no después»:
      **(a)** el comprobante se puede **imprimir** sin bloquear la venta
      siguiente, y la opción sigue disponible hasta que empieza la próxima, pero
      **fuera del pie de cobro** (FR-050) — hoy es un botón de ancho completo
      arriba del de cobrar (`:776-781`);
      **(b)** con AFIP **no** configurado, los comprobantes fiscales aparecen
      **deshabilitados con la explicación** —no ocultos— y el aviso va **antes**
      de cobrar, no después de haber registrado la venta (FR-055, decisión 8 de
      la spec). La lista ya viene resuelta de `comprobantesDisponibles` (T1107):
      acá se dibuja el `motivo`;
      **(c)** un usuario **sin `ventas.crear`** ve el botón de cobrar
      **deshabilitado con su explicación, no ausente** (FR-024). Hoy la pantalla
      no consulta el permiso: se agrega con `usePermission`, que lee los códigos
      de `useStore.permisos`.
      **Verificación**: `npm --prefix apps/web test -- src/tests/renderDelPuntoDeVenta.test.jsx`
      y el paso manual **7**.
      **El test**: `it('sin ventas.crear el botón de cobrar está deshabilitado y dice por qué')`
      —las dos mitades: `disabled` **y** la explicación presente en el documento;
      un botón deshabilitado sin motivo es un botón roto— y
      `it('sin ventas.crear, Ctrl+Enter no manda ningún pedido')` (escenario
      2.17), que es la mitad que el `disabled` no cubre;
      `it('con AFIP sin configurar los comprobantes fiscales no se pueden elegir, y se dice por qué')`.
      **Cómo se comprueba que el test sirve**: se saca el chequeo de permiso del
      handler dejando solo el `disabled` y el segundo se pone en rojo; se ocultan
      los comprobantes fiscales en vez de deshabilitarlos y el tercero.

**Checkpoint**: apretar cobrar dos veces deja una venta y un descuento de stock;
el botón dice si está registrando o esperando a ARCA; los tres finales dejan la
pantalla como corresponde; y entre una venta y la siguiente no sale ningún
`GET /products`.

---

## Phase 9: El ticket no miente

**Purpose**: el medio de pago que se registra es el que el cliente usó, el stock
que muestra el ticket es el de la sucursal activa, y el vuelto solo aparece
cuando hay billetes de por medio.

- [x] **T1128** Escribir `apps/web/src/components/pos/SegmentoDePago.jsx`: **tres
      segmentos** (Efectivo · Tarjeta · Alianza) que se reparten el ancho y
      comparten borde y estados (FR-020, `maqueta:404-417`). Un clic elige el
      segmento y le pone su `medioPorDefecto` (`ef`, `tc3v`, `al`); un **segundo
      clic sobre el segmento ya activo** —o el chevron de 10px que aparece cuando
      el segmento tiene más de un medio— abre un popover con `mediosDelSegmento`;
      cuando el medio elegido **no** es el por defecto, el segmento muestra su
      `etiquetaCorta` («Transf.», «Master») en lugar del nombre del segmento.
      ⚠ **Riesgo 5, y va escrito en el archivo**: el chevron **no está en la
      maqueta**, porque la maqueta se dibujó cuando la pregunta 1 de la spec
      todavía no estaba contestada —el mismo argumento que FR-017 usa para el
      precio manual—. `sdd-verify` va a comparar contra el dibujo y encontrar un
      control de más; el motivo tiene que estar donde lo va a buscar.
      **Por qué no entra de otra forma**: la columna mide 400px y la fila de
      controles ya lleva el stepper de 28px más los tres segmentos de 26px. Cinco
      opciones inline no entran sin apilar el control en dos filas, y apilar
      duplica el alto de cada línea: con ocho productos el ticket deja de entrar
      en la pantalla, que es justo lo que FR-002 viene a garantizar.
      **Verificación**: la guardia de diseño no reporta nada nuevo en este
      archivo; `npm --prefix apps/web test -- src/tests/renderDelPuntoDeVenta.test.jsx`.
      **El test**: `it('elegir Tarjeta NO deja la línea con un medio que no existe')`
      —el valor que queda es `tc3v` y está en `MEDIOS`; hoy queda `tc3`, que no
      está en ninguna de las tres listas del sistema (hallazgo 3)— y
      `it('el segmento activo muestra el medio exacto cuando no es el por defecto')`.
      **Cómo se comprueba que el test sirve**: se vuelve el valor del segmento
      Tarjeta a `'tc3'` —que es lo que escribe `Billing.jsx:565`— y el primero se
      pone en rojo.

- [x] **T1129** El **medio de pago del ticket, heredado** (decisión 3 de la
      spec, como el sistema viejo `legacy:6237-6240`): el pie de cobro lleva el
      medio vigente; `addToCart` en `apps/web/src/store/useStore.js:187` lo recibe
      del llamador en vez de nacer siempre en `'ef'` (`:188`); cambiarlo por línea
      lo pisa **solo para esa línea**. Y en el cuerpo de `POST /api/sales`, el
      `payment_method` de la venta pasa a ser **el del ticket** y no
      `cart[0]?.method` (`Billing.jsx:211`): con nueve medios, más tickets van a
      quedar clasificados como mixtos —`metodoDePago(lineas)`
      (`calculosVenta.js:105`) devuelve el método solo si **todas** coinciden— y
      entonces el servidor cae al declarado (`sales.js:393`); el medio vigente del
      pie es la respuesta correcta a «con qué se pagó esta venta» cuando las
      líneas difieren.
      **Verificación**: `npm --prefix apps/web test -- src/tests/storeDeInventario.test.js src/tests/renderDelPuntoDeVenta.test.jsx`.
      **El test**: `it('una línea nueva NO nace en efectivo cuando el ticket va con tarjeta')`
      —un ticket de ocho productos pagado con tarjeta exigía ocho clics en
      «Tarjeta», y el precio de las líneas que se olviden queda mal porque cada
      nivel tiene otro precio— y
      `it('cambiar el medio de una línea NO cambia el del ticket ni el de las demás')`.
      **Cómo se comprueba que el test sirve**: se vuelve `addToCart` a
      `method = 'ef'` fijo y el primero se pone en rojo; se hace que el control de
      línea escriba el medio del ticket y el segundo.

- [x] **T1130** El vuelto de verdad: el bloque aparece **solo si alguna línea
      lleva vuelto** según `llevaVuelto` de T1106 —no `i.method === 'ef'` a mano
      (`Billing.jsx:96`)—, con las sugerencias de billetes de `utils/vuelto.js`
      (T1109) intactas (FR-018); si **ninguna** línea queda en efectivo, el
      importe de «Paga con» se **descarta**, no se oculta (FR-067) — hoy queda
      guardado y reaparece con un valor viejo si se vuelve a efectivo; el vuelto
      se recalcula solo cuando cambia el total (escenario 5.8); y un «Paga con»
      menor al total dice cuánto **falta**, en `danger`, y no un vuelto negativo
      (escenario 5.10).
      **Verificación**: `npm --prefix apps/web test -- src/tests/renderDelPuntoDeVenta.test.jsx`.
      **El test**: `it('una transferencia NO muestra el bloque de vuelto')` —es
      la decisión 1 de la spec entera: el segmento decide el precio, la bandera
      decide el vuelto— y
      `it('el importe de «Paga con» NO reaparece con un valor viejo')`, que
      escribe $50.000, cambia la única línea a transferencia, la vuelve a
      efectivo y afirma que el campo quedó vacío.
      **Cómo se comprueba que el test sirve**: se vuelve la condición a
      `cart.some(i => i.method === 'ef')` y el primero **sigue pasando** —`ef`
      lleva vuelto igual—; hay que probarlo con una línea en `tr`, que es
      exactamente por qué el test se llama así. Para el segundo, se oculta el
      bloque sin limpiar `pagaCon` y se pone en rojo.

- [x] **T1131** El ticket contra el stock de la sucursal activa:
      **(a)** cambiar de **sucursal** conserva el ticket, revalida el stock de
      cada línea contra la sucursal nueva y avisa de lo que ya no alcanza
      (FR-063) — el producto es el mismo, lo que cambia es de dónde sale;
      **(b)** agregar un producto que ya está sube la cantidad de **la línea que
      existe** y **conserva el precio a mano** (FR-064): acordar $18.000 y que la
      segunda unidad vuelva al de lista es la clase de cosa que se descubre
      cuando el cliente ya se fue;
      **(c)** superar el disponible de la sucursal activa se avisa **en la
      pantalla, antes de cobrar** (FR-065), y no cuando la API rechace la venta;
      **(d)** los avisos de stock que devuelve la API (`sales.js:468-476`) van
      **agrupados en un bloque fijo del ticket** y no en `toast` (decisión 7 de la
      spec, FR-066): tres productos sin fila de stock hoy son cuatro `toast`
      compitiendo con el verde de éxito, y el que importa se va solo a los
      segundos.
      **Verificación**: `npm --prefix apps/web test -- src/tests/renderDelPuntoDeVenta.test.jsx`.
      **El test**: `it('agregar de nuevo un producto con precio a mano NO le devuelve el precio de lista')`;
      `it('pasar el disponible avisa antes de cobrar, no después del rechazo de la API')`;
      `it('el aviso de stock no descontado NO se pierde entre los toast de éxito')`,
      que afirma que el texto queda en el documento después de que el `toast`
      verde ya se fue.
      **Cómo se comprueba que el test sirve**: se hace que `addToCart` recalcule
      el precio al subir la cantidad y el primero se pone en rojo; se mandan los
      `warnings` a `toast.warning` —que es lo de hoy, `Billing.jsx:235-237`— y el
      tercero.

**Checkpoint**: una transferencia se registra como transferencia y no muestra
vuelto; una empresa `Exento` emite Factura C y el selector dice lo que se emite;
cambiar de sucursal revalida el ticket; y el aviso de «no se descontó
inventario» queda a la vista.

---

## Phase 10: Documentación de cierre

**Purpose**: la excepción del marco queda escrita donde se la va a buscar, el
botón de prueba tiene destino, y quien opera se entera de que el arqueo de caja
va a mostrar números distintos.

- [x] **T1132** [P] En `docs/REGLAS-DISENO.md`, la excepción en **dos** lugares:
      en «El shell» (`:190`), donde hoy dice «Una pantalla nueva no dibuja su
      propio marco. Devuelve su contenido y el shell la envuelve: el `<main>` ya
      centra a 1320px y aplica el padding» — pasa a decir que el marco lo aplica
      `MarcoDePantalla` y que **`/pos` es la única salvedad**, con el motivo (un
      ticket que scrollea con la página deja de estar visible justo cuando tiene
      ocho ítems, que es cuando hace falta mirarlo); y en «Encabezado de pantalla»
      (`:215`), donde hoy dice «Todas las pantallas arrancan igual» — el POS es la
      única sin `h1`, y por qué (60px de alto en la pantalla que se usa ocho horas
      por día valen más que un título que no informa nada, y la miga de pan ya la
      nombra).
      **Verificación**: quien vaya a rediseñar la próxima pantalla lee las dos
      secciones y encuentra la excepción **con su motivo**, sin abrir esta spec.
      Una regla que dice «todas las pantallas» y tiene una excepción no escrita
      deja de ser una regla: la próxima pantalla que no entre en el marco la va a
      resolver a mano, distinto, y **nada lo detectaría porque no hay test
      visual**.

- [x] **T1133** [P] En `docs/PROXIMOS-PROYECTOS.md`, anotar el destino de «Emitir
      Factura de Prueba (1 ARS)» —sacado del pie de cobro en T1122—: Ajustes →
      Facturación AFIP (hito 8 de `PLAN-COMPRAFIT.md` 4.9), **o eliminarlo**, ya
      que emite un comprobante fiscal **real** y el circuito de homologación
      nunca se probó (proyecto 2 de ese mismo archivo, con el que hay que
      cruzarlo). Lo que esta funcionalidad necesitaba era que **no estuviera en
      el pie de cobro**, y eso ya está.
      **Verificación**: la anotación dice **dónde va** y **qué pasa si se
      elimina**, no solo que se sacó de acá. Una función que desaparece de una
      pantalla sin quedar anotada en ningún lado es una función que alguien
      vuelve a pedir dentro de tres meses.

- [x] **T1134** ⚠ **Riesgo 3.** En `docs/OPERACION.md`, en «Situaciones»
      (`:86`), una sección nueva: **el arqueo de caja y el panel de control van a
      mostrar números distintos a partir del día del deploy**. Tres cosas:
      **(1)** qué cambia — el «Efectivo» del día deja de incluir transferencias,
      QR y débito, y `GET /api/sales/summary` (`sales.js:203`) y
      `dashboardService._salesByMethod` (`:106`) pasan de tres buckets a hasta
      nueve; **(2)** por qué es lo correcto — es el defecto 3: el arqueo contaba
      como billetes plata que entró por CBU, y el POS ofrecía tres de los nueve
      medios que el negocio usa; **(3)** qué **no** se hizo y por qué — el
      histórico no se toca, así que la comparación año contra año sigue siendo
      válida para los códigos que ya existían, y `tc3` conserva su significado
      («tarjeta, sin decir cuál») con una etiqueta nueva en vez de una migración
      que adivine si fue Visa, Master o Naranja.
      **Verificación**: quien opera puede leer esa sección el día que note el
      número distinto y entender **que no se rompió nada**, sin abrir la spec, el
      plan ni el código. Esta tarea existe porque es exactamente el tipo de
      cambio que llega como «el sistema está mal, el efectivo de ayer no da»: sin
      el documento, la respuesta se reconstruye desde cero cada vez.

**Checkpoint**: `npm run test:api`, `npm run test:web` y `npm run build` pasan;
las guardias de aislamiento, observabilidad y diseño siguen limpias **sin
excepciones nuevas**; y lo que cambió para quien opera está escrito donde lo va a
buscar.

---

## Los pasos manuales de `sdd-verify`

**Esto no son tareas.** Son las verificaciones que **no se pueden escribir como
test en este repositorio**, escritas como pasos reproducibles justamente para no
disfrazarlas de test. Cada una dice **qué hacer** y **qué tiene que verse**.

### Por qué jsdom no alcanza (pasos 1 a 5)

`apps/web/src/tests/preparacion.js` lo dice en su propio comentario: **un test no
puede afirmar nada sobre posiciones ni sobre tamaños**. `scrollWidth`,
`clientWidth` y `getBoundingClientRect` devuelven **cero siempre**, así que un
test que los mire **pasa con y sin el cambio**, que es la definición de test que
no vale nada.

1. **El cuerpo de la página no scrollea** (escenario 1.3, FR-002). Abrir el POS
   con la ventana a **1080px** y después a **1920px**, con veinte productos en el
   catálogo. *Qué tiene que verse*: **ninguna barra de scroll horizontal en el
   `<body>`** en ninguno de los dos anchos, y ninguna barra vertical de la página
   —solo las dos internas—.
2. **Las dos zonas scrollean por separado** (escenario 1.2, FR-003). Con **40
   resultados** en el catálogo y **8 líneas** en el ticket, rodar la rueda sobre
   el catálogo y después sobre el ticket. *Qué tiene que verse*: la barra de
   búsqueda con sus filtros **sigue visible** mientras la lista corre, y el pie de
   cobro con el total y el botón **sigue visible** mientras las líneas corren.
   Ninguno de los dos se va de pantalla.
3. **Un nombre largo no corre las columnas de precio.** Cargar un producto con un
   nombre de **80 caracteres**. *Qué tiene que verse*: el nombre recorta con
   elipsis y las tres columnas de precio quedan **exactamente** donde estaban en
   las demás filas.
4. **El total es el elemento de más peso del pie** (FR-021). Mirar el pie de
   cobro. *Qué tiene que verse*: el total en `.num` a 24px domina el bloque; ni
   el subtotal, ni el IVA, ni el botón le compiten.
5. ⚠ **Las otras diecisiete pantallas siguen centradas** (riesgo 7, después de
   T1116). Abrir **Ventas, Inventario y Panel** —tres, no una—. *Qué tiene que
   verse*: contenido centrado con el mismo tope de 1320px y el mismo padding que
   antes del cambio, y el scroll de la página funcionando como siempre. **`npm
   run build` no ve esto**: un error acá no rompe el POS, rompe todo lo demás.

### Por qué hace falta Postgres de verdad (paso 6)

Los dobles de `apps/api/src/tests/helpers/modelosFalsos.js` **no entienden `lock`
ni transacciones** —lo dice su propio encabezado—: un test de idempotencia
escrito sobre ellos **probaría el doble**. Es la misma advertencia que dejaron
los planes de la 009 y la 010, y sigue siendo cierta. Es el proyecto **5c** de
`PROXIMOS-PROYECTOS.md`, y **no está hecho**: el job de tests de
`.github/workflows/ci.yml` corre `npm test` sin base (el Postgres del `ci.yml:91`
vive en el job de la imagen), y no hay fixtures ni `supertest`.

**Cómo se corre, concretamente:**

```bash
# 1. Una base de desarrollo, en apps/api/.env
#    DATABASE_URL=postgres://usuario:clave@localhost:5432/adminapp_dev
#    DB_SSL=false          ← sin esto el driver exige TLS y no conecta en local
npm --prefix apps/api run db:migrate     # las 15 migraciones, sobre la base vacía

# 2. La API levantada contra esa base, SIN Auth0.
#    `BYPASS_AUTH=true` (apps/api/src/server.js:264) inyecta req.userId,
#    req.empresaId y req.userRole, y checkPermission.js:5 deja pasar sin mirar
#    permisos. No hace falta token ni copiar nada de las devtools.
#
#    Es seguro fuera de produccion y solo fuera de produccion: con
#    NODE_ENV=production, checkPermission responde 500 y loguea
#    «BYPASS_AUTH esta activo en produccion». Nunca ponerlo en Railway.
BYPASS_AUTH=true npm run dev:api
```

6. **Contra Postgres** (criterios de éxito 6, 7 y 11):

   **(6a) Idempotencia — T1102.** Armar el cuerpo de una venta con un `id`
   generado a mano (`sale_1754320000000_9f3a1c02`) y **mandarlo dos veces**:

   ```bash
   curl -s -X POST localhost:3000/api/sales \
     -H 'Content-Type: application/json' -H 'X-Punto-De-Venta-Id: 1' \
     -d @venta.json
   ```

   *Qué tiene que verse*: la **primera** responde `201`; la **segunda** responde
   `200` con `yaRegistrada: true`, `warnings: []` y `stock: []` — **no un 500**,
   que es lo que pasa hoy. Y en la base:

   ```sql
   SELECT count(*) FROM sales           WHERE id = 'sale_1754320000000_9f3a1c02';  -- 1
   SELECT count(*) FROM stock_movements WHERE referencia_id = 'sale_1754320000000_9f3a1c02';  -- 1
   ```

   Las dos tienen que dar **1**. Si la segunda da 2, el stock se descontó dos
   veces por una sola venta.

   **(6b) La sucursal — T1103.** El mismo `curl` **sin** la cabecera
   `X-Punto-De-Venta-Id`, con un `id` nuevo. *Qué tiene que verse*:

   ```sql
   SELECT punto_de_venta_id FROM sales WHERE id = '<el nuevo>';  -- NO NULL
   ```

   y que sea **la misma** sucursal que la del `stock_movements` de esa venta.
   Después, anular esa venta (`PUT /api/sales/:id/void`) y comprobar que
   `stock.quantity` volvió a subir **en esa misma sucursal**. Repetir con una
   venta **sin líneas**: también tiene que quedar con sucursal (escenario 6.3).

   **(6c) El campo `stock` — T1104.** Una venta de **dos** productos: uno con
   fila de stock en la sucursal y otro **sin ninguna**. *Qué tiene que verse*:
   `stock` con **una** entrada —la del que sí tenía, con el `available` ya
   descontado— y `warnings` con **una** frase, la del que no. Los dos arreglos
   complementarios y ninguno para parsear.

   **(6d) Empresa sin sucursales.** Una empresa sin ningún `punto_de_venta`,
   registrando una venta **sin líneas**. *Qué tiene que verse*: `400` con el
   `ErrorDeNegocio` de `sucursalPorDefecto` en castellano —«hay que crear una
   sucursal»— y **no** un `500`, y **no** un `201` con `punto_de_venta_id: null`,
   que es lo que pasa hoy (FR-072).

### Lo demás

7. **Imprimir sin bloquear la venta siguiente** (FR-050). Cobrar, imprimir el
   comprobante, y empezar a cargar el ticket siguiente. *Qué tiene que verse*: la
   opción de imprimir **sigue disponible** mientras el ticket nuevo está vacío, y
   **desaparece** cuando entra la primera línea. Con el bloqueador de emergentes
   activo, avisa qué hacer en vez de no pasar nada.
8. **La venta completa sin mouse, de punta a punta.** Con la mano fuera del
   mouse: `/`, escribir tres letras, `Enter`, `Ctrl+Enter`. *Qué tiene que
   verse*: la venta se cobra y el cursor ya está en la búsqueda para la
   siguiente. Es el criterio de éxito 1 y el test automático lo cubre, pero
   hacerlo a mano una vez es lo que detecta que el circuito **se siente** roto
   aunque los pasos pasen.
9. **El lector de código de barras de verdad**, si hay uno a mano. Escanear un
   producto que existe y uno que no. *Qué tiene que verse*: el primero entra al
   ticket y la consulta se vacía; el segundo **no** agrega nada, avisa, y la
   consulta **queda** —borrarla obliga a volver a tipear el código que
   justamente no existe—. Es el riesgo 9: si el catálogo no tiene los `barcode`
   cargados, esto va a rechazar escaneos de productos que sí están, y el aviso
   tiene que apuntar al dato faltante y no al producto.
10. ⚠ **El catálogo entero en el navegador** (riesgo 10, declarado Fuera de
    alcance — proyecto **5e**). Abrir el POS de una empresa con **más de 2.000
    productos** y tipear en la búsqueda. *Qué tiene que verse*: cuánto tarda en
    abrir y si el tipeo se siente fluido. **No hay número de corte y no hay
    tarea**: es una medición, y se anota. El POS es la pantalla que más lo sufre
    porque se abre al empezar el día y se deja abierta, y ahora además dibuja la
    lista con scroll y un tope visible en vez de paginar, así que el trabajo de
    dibujado por render **sube** respecto de hoy. *Si aparece*: el tope de
    resultados visibles ya está en el diseño (T1120) y se puede bajar sin tocar
    nada más.

---

## Resumen

| Fase | Tareas | Qué queda funcionando |
|---|---|---|
| 1 · `POST /api/sales` | T1101–T1104 (4) | Un reintento no duplica la venta, dos cajas no se pisan, y toda venta nueva queda asentada en su sucursal |
| 2 · El carrito y la empresa | T1105 (1) | Cambiar de empresa con el ticket cargado lo vacía |
| 3 · Las funciones puras | T1106–T1114 (9) | Los nueve medios, los comprobantes, los atajos, el vuelto y la búsqueda, testeados y sin tres copias de nada |
| 4 · La guardia de diseño | T1115 (1) | Cada color fuera del sistema falla en el momento en que se escribe. **En rojo a propósito hasta T1122** |
| 5 · El marco | T1116 (1) | El POS puede ocupar el alto completo sin que las otras diecisiete cambien |
| 6 · Atajos y foco | T1117–T1119 (3) | Una venta entera sin mouse, sobre la pantalla vieja |
| 7 · Las dos columnas | T1120–T1122 (3) | La pantalla se ve como la maqueta y la guardia pasa a verde |
| 8 · El cobro | T1123–T1127 (5) | Dos disparos, una venta; los tres finales; sin recargar el catálogo |
| 9 · El ticket | T1128–T1131 (4) | El medio exacto, el stock de la sucursal activa y el vuelto que corresponde |
| 10 · Documentación | T1132–T1134 (3) | La excepción escrita, el botón de prueba con destino, y el arqueo explicado antes de que cambie |

**Total: 34 tareas.**

**La primera es T1101**: el identificador de la venta con entropía. No es la más
grande ni la más visible, pero **es la que habilita T1102** y el orden entre las
dos no es negociable (punto 4 de «Antes de empezar»): con la idempotencia
desplegada sin ella, dos cajas que cobran en el mismo milisegundo dejan de
producir un error visible y pasan a producir **una venta que desaparece en
silencio**.

**Las fases 1 y 2 son un corte cerrado.** Se mergean y se despliegan solas, sin
esperar a nada del rediseño, y cierran las dos cosas de este hito que **no se
pueden reparar después**: una venta con las líneas de otra empresa cliente y sin
descuento de stock, y una venta duplicada con el inventario descontado dos veces.
Todo lo demás —los atajos, el foco, las dos columnas— es incomodidad, no daño.

**La fase 5 va sola.** Toca el marco de las dieciocho pantallas para arreglar
una, `npm run build` no lo ve, y la verificación es abrir tres pantallas
distintas.
