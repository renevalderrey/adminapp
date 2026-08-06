# Próximos proyectos

Lo que sabemos que hay que construir y todavía no tiene fecha. Cada uno con lo
que ya está resuelto y lo que falta de verdad, para poder estimarlo sin volver
a investigar.

Cuando uno arranca, se le hace su spec con `/sdd` y se lo saca de acá.

---

## ~~0 · Las migraciones no pueden recrear la base~~ · hecho la mitad

Hecho el **4/8/2026**, sin ciclo SDD: la causa estaba comprobada y el arreglo no
cambia el comportamiento de la aplicación.

**Lo que se cerró.** Las cuatro tablas que tenían modelo y ninguna migración
—`roles`, `permisos`, `rol_permisos`, `usuario_permisos`— y la columna
`usuario_empresas.rol_id` ahora las crea
`migrations/20260806-esquema-de-permisos.js`, con exactamente la forma que dejó
`sequelize.sync()` en producción (se obtuvo sincronizando una base limpia y
volcándola con `pg_dump`; el DDL coincide byte a byte). Es aditiva y toda
`IF NOT EXISTS`, así que sobre producción —donde las tablas ya están, con datos—
no hace nada. **No es reversible**: su `down` se niega con un error explicando
por qué, porque en producción un `down` borraría el modelo de permisos entero.

No siembra: `seedPermissions()` ya lo hace en cada arranque, es idempotente, y el
catálogo de permisos cambia con cada funcionalidad — congelarlo en una migración
garantiza que quede viejo.

Apareció una quinta ausencia por el camino: `cashflow_entries.punto_de_venta_id`,
que el modelo declara con índice y ninguna migración creaba
(`20260604-add-pv-to-fixed-expenses.js` se la puso a `fixed_expenses` y se olvidó
de caja). En una base recreada, cualquier consulta a caja devolvía 500. La crea
`migrations/20260807-punto-de-venta-en-cashflow.js`, que sí es reversible porque
la columna está vacía.

**El paso de CI que faltaba** es `apps/api/scripts/verificar-esquema.js`: recorre
los modelos de `src/models/index.js` y hace un `findOne` por cada uno. No hay
lista que mantener y es más estricto que preguntar si la tabla existe, porque
Sequelize enumera todas las columnas del modelo en el `SELECT` — así apareció lo
de caja. Corre en el job «la imagen arranca y migra», después de migrar.

**Y el error que se tragaba.** `seedPermissions()` separa ahora el fallo de
esquema (42P01/42703) del transitorio: el primero va como `fatal`, dice que
ningún usuario va a tener permisos y nombra el script que lo arregla. `auth.js`
sigue fallando cerrado —eso está bien y no se toca— pero el aviso subió de `warn`
a `error` y se reporta a Sentry una vez por proceso. **Ninguno de los dos tumba
el arranque**: el freno duro va en CI, donde equivocarse cuesta un pipeline en
rojo y no un cliente sin sistema.

### Lo que sigue abierto: los ENUM

Una base creada solo con migraciones **todavía no puede levantar en desarrollo**.
El síntoma original del 4/8/2026 sigue igual:

```
default for column "unit_type" cannot be cast automatically to type enum_products_unit_type
```

La causa es otra: ocho columnas están declaradas `DataTypes.ENUM` en el modelo y
creadas `VARCHAR` por las migraciones —`products.unit_type`,
`cashflow_entries.type`, `invitaciones.role`, `invitaciones.status`,
`production_orders.status`, `supplier_movements.type`, `supplier_orders.status`,
`suscripciones.status`—. `sequelize.sync({ alter: true })`, que corre en todo
entorno que no sea producción, intenta convertirlas y muere.

No lo detecta `verificar-esquema.js` porque un `SELECT` sobre un `VARCHAR` donde
el modelo espera un ENUM anda perfecto: el chequeo responde «¿puede el código
leer esta tabla?», no «¿es el esquema idéntico al de los modelos?».

**Qué implica**: decidir de qué lado se unifica —crear los tipos ENUM en una
migración, o bajar los modelos a `STRING` con validación— y aplicarlo. Ojo con
producción: ahí las columnas **sí** son ENUM, así que la migración tiene que
contemplar los dos estados posibles.

Faltan además tres índices que los modelos declaran y las migraciones no crean:
`products.barcode`, `products.category` y `products.supplier_id`. Es rendimiento,
no corrección, y por eso no lo ve ningún chequeo.

---

## 1 · Notas de crédito

**Por qué es lo primero.** Hoy anular una venta que ya tiene CAE la deja
anulada en AdminApp y **vigente ante ARCA**. El monto sigue contando como
facturación del cliente. `taxService` ya expone el número —
`anuladas_con_cae_sin_nc` — justamente porque es un desvío conocido.

Mientras esto no exista, la pantalla de ventas **bloquea** anular un
comprobante con CAE (decisión del 1/8/2026). Es la única salida honesta: dejar
anular sin emitir la nota de crédito es fabricar el problema en silencio.

**Lo que ya está resuelto**

- `afipService` emite contra WSFEv1 con firma PKCS#7 y WSAA. El camino de
  emisión es genérico en el tipo de comprobante: pedirle un tipo 3 u 8 en vez
  de 1 o 6 no requiere tocar la plomería.
- La numeración correlativa por punto de venta y tipo ya está serializada.
- El comprobante impreso ya lleva el QR de la RG 4892/2020.

**Lo que falta, y es lo que hace al trabajo**

| Qué | Por qué importa |
|---|---|
| **`CbtesAsoc`** en la solicitud | ARCA exige que la NC diga a qué comprobante anula: tipo, punto de venta y número. Sin eso la NC no está asociada a nada y no cancela la factura |
| **Tipo 13 (NC C)** | El mapeo de tipos hoy contempla `[1, 3, 6, 8]` para Responsable Inscripto. Un monotributista emite Factura C (11) y necesita NC C (13) |
| **Vínculo en la base** | Qué NC anula qué venta. Sin esto no se puede evitar emitir dos notas de crédito sobre la misma factura — que es un problema fiscal, no un bug de interfaz |
| **Idempotencia** | Mismo criterio que `/facturar`: reintentar no puede emitir dos |
| **Endpoint y pantalla** | Desde el detalle del comprobante |

**El riesgo real.** El circuito AFIP **nunca se probó contra homologación**.
Emitir notas de crédito sin haberlo hecho es peor que emitir facturas: una NC
mal asociada o rechazada deja al cliente con un desvío que hay que resolver con
el contador, no con un botón.

**Por eso el orden es**: primero la prueba de homologación de punta a punta,
después las notas de crédito.

**Tamaño estimado**: un proyecto propio, no una tarea. Dos días de trabajo más
la prueba en homologación.

---

## 2 · Probar el circuito AFIP en homologación

No es una funcionalidad, es una verificación que nunca se hizo y de la que
depende todo lo fiscal.

Emitir en homologación con un CUIT de prueba: Factura A, B y C, con y sin CUIT
del cliente, con importes que dejen centavos, y verificar que el CAE vuelve y
que el comprobante impreso valida el QR.

**Bloquea**: notas de crédito, y honestamente también el primer comprobante
real de Comprafit.

### 2b · Dónde va «Emitir Factura de Prueba (1 ARS)»

**Ya salió del punto de venta** (funcionalidad 011, T1122, FR-068). Estaba en el
pie de cobro, a un clic del botón de cobrar, y **en producción no emite una
prueba: emite un comprobante fiscal REAL de $1**, con número correlativo
consumido que después hay que dar de baja con una nota de crédito — que es el
proyecto 1, y no existe. Pedía confirmación por `window.confirm`, y eso es todo
lo que había entre un clic mal apuntado y un comprobante fiscal.

Lo que esta funcionalidad necesitaba era que **no estuviera ahí**, y eso ya está.
Lo que falta es decidir su destino, y son dos:

| Salida | Qué implica |
|---|---|
| **Ajustes → Facturación AFIP** (hito 8, `PLAN-COMPRAFIT.md` 4.9) | Es donde tiene sentido: al lado del CUIT, el punto de venta y el certificado, como el «probar la conexión» de la pantalla que los configura. Debería emitir **solo en homologación** y estar deshabilitado con su motivo cuando `afip_environment` sea `production` |
| **Eliminarlo** | Es lo más barato y no se pierde nada **si el proyecto 2 se hace**: probar el circuito en homologación cubre lo mismo y mejor, con Factura A, B y C, con y sin CUIT, y verificando el QR del comprobante impreso |

**Hay que cruzarlo con el proyecto 2, y en este orden**: si el circuito de
homologación se prueba de verdad, este botón no hace falta y se elimina. Si no
se prueba, mudarlo a Ajustes es lo único que queda para verificar que la
configuración de AFIP de un cliente nuevo funciona antes de la primera venta
real — y ahí **tiene que quedar restringido a homologación**, porque hoy no lo
está.

El código sale de `apps/web/src/pages/Billing.jsx` y está en el commit de T1122
(`handleTestInvoice`, que llamaba a `POST /api/afip/invoice` y después a
`POST /api/sales` con un `id` `test_…`). El endpoint sigue existiendo: lo único
que se sacó es el botón.

---

## 3 · Alícuotas de IVA distintas del 21 %

Hoy está fija en 21 %. Si el catálogo tiene alimentos (10,5 %) o exentos, hace
falta el campo en `Product` y facturar con múltiples `AlicIva`.

Comprafit vende suplementos; **puede que no lo necesite nunca**. Verificarlo
antes de construirlo.

---

## 4 · Tipos de comprobante que faltan

Notas de débito, comprobantes M y FCE MiPyME. Ninguno hace falta para
Comprafit; se anota para no volver a investigar si aparece otro cliente.

---

## 5 · Concepto «servicios»

El sistema manda siempre `Concepto: 1` (productos). Para servicios AFIP exige
además `FchServDesde` y `FchServHasta`.

Comprafit vende productos. Aplica si el producto se vende a otro rubro.

---

## 5b · Punto de venta de AFIP por sucursal

**Apareció** escribiendo el plan del historial de ventas (1/8/2026).

Hoy el número de punto de venta de ARCA vive en **un solo `Setting` por
empresa**, y el POS factura todas las sucursales con ese mismo número
(`Billing.jsx:243`). `puntos_de_venta` tiene `id, name, code, address,
is_active` y **ninguna columna con el número de PV fiscal**.

Para una empresa de una sola sucursal no se nota. Para una con dos o más, ARCA
lleva la numeración correlativa **por punto de venta**: facturar las dos
sucursales con el mismo número es correcto solo si ARCA tiene declarado un
único punto de venta. Si el cliente declara uno por sucursal —que es lo
habitual cuando factura desde dos direcciones— el sistema no lo puede
representar.

**Qué implica**: una columna en `puntos_de_venta`, el campo en la pantalla de
sucursales, y que la emisión lo tome de ahí con el `Setting` como respaldo para
los que no lo tengan cargado.

Comprafit tiene una sucursal. **Verificar si eso va a seguir así antes de
construirlo.**

---

## ~~5c · Tests de integración contra una base real~~ · hecho

Hecho el 5/8/2026, sin ciclo SDD porque no cambia el comportamiento de la
aplicación: **no se tocó una línea de código de producción**. Se desbloqueó
cuando el esquema migrado convergió con el de producción — antes, una base
creada solo con migraciones no levantaba.

**Qué quedó.** `apps/api/src/tests/integracion/`: el arnés (`baseDePruebas.js`),
las fixtures de dos empresas (`fixtures.js`), el preparador de la base
(`prepararBase.js`) y **43 tests** en cuatro archivos `*.integracion.test.js`,
con `supertest` contra la aplicación real de `server.js`. Cómo se escribe uno
—y cuándo corresponde uno en vez de un doble— está en
[CONVENCIONES.md](specs/CONVENCIONES.md#el-cuarto-nivel-tests-de-integración-contra-postgres-appsapi).

```
npm --prefix apps/api run test:db:levantar   # una vez: contenedor + migraciones
npm --prefix apps/api run test:integracion   # migra lo que falte y corre
npm --prefix apps/api run test:db:bajar
```

**Las dos decisiones que había que tomar, y por qué:**

- **Se trunca entre test y test, no se envuelve cada uno en una transacción.**
  La transacción del test no alcanza a `supertest` —el request entra por la
  aplicación, que pide su propia conexión— y, sobre todo, el commit real es
  justo lo que se quiere probar: sin dos transacciones de verdad, la carrera de
  la idempotencia no existe.
- **Sin Postgres, FALLAN.** No se saltean. Lo que evita que eso moleste es que
  `npm test` no los levanta: se corren cuando alguien los pide, y entonces no
  hay razón honesta para pasar en verde sin base. El mensaje dice el comando
  exacto. Que sigan corriendo lo verifica `guardiaDelArnes.test.js`, que sí va
  en la suite rápida y mira el `package.json` y el `ci.yml`.

**Los cuatro primeros casos, que son los que faltaban:**

| Archivo | Lo que ningún doble podía ejercitar |
|---|---|
| `idempotenciaDeVentas` | Seis `POST /api/sales` **en paralelo** con el mismo id. La rama del `SequelizeUniqueConstraintError` —«la que de verdad sostiene la garantía»— **no la toca un test secuencial**, y se comprueba que corrió. |
| `saldoDeProveedores` | El `GROUP BY` del saldo, el `COUNT` agrupado, el `translate()` de la búsqueda sin acentos, y el saldo inicial de la página 2 con su desempate por id — el paso manual P1 del riesgo 9. |
| `aislamientoEntreEmpresas` | Pedir un recurso de la empresa B con la sesión de la A: 404, **y la fila de B intacta** en los dos que escriben (anular y borrar). |
| `importesConDecimales` | DECIMAL que vuelve como string, el total del período que sin convertir se concatena, y el centavo cerrando exacto. |

**Lo que NO quedó hecho:**

- **Solo cubre cuatro endpoints.** Ventas, proveedores, productos y el listado.
  Stock, producción, caja, AFIP y TiendaNube siguen sin un solo test de
  integración.
- **No cubre el orden estable de la paginación de ventas** —el `ORDER BY` con
  desempate—, que era uno de los motivos originales. Sí quedó cubierto el de la
  cuenta corriente de proveedores.
- **La sesión es siempre la empresa 1.** Con `BYPASS_AUTH`, `server.js` clava
  `req.empresaId = 1`, así que se puede preguntar «¿A alcanza lo de B?» pero no
  «¿qué ve B?». Cubrir el segundo lado pide entrar con un token, y eso es otro
  proyecto.
- **Es lento contra Docker Desktop en Windows**: ~1,5 s por test, casi todo en
  el `TRUNCATE`. Medido: truncar 39 tablas y truncar 1 tardan lo mismo, así que
  el costo es el viaje de ida y vuelta y no hay nada barato que optimizar. En
  CI (Linux) no se nota.

---

## ~~5d · Tests de render en la web~~ · hecho

Hecho en **`3bd02fc`** (3/8/2026), sin ciclo SDD porque no cambia el
comportamiento de la aplicación: `jsdom` y `@testing-library` en
`apps/web/devDependencies`, el bloque `test` en `vite.config.js`, y 28 tests de
render que atrapan los cuatro incumplimientos de Inventario que habían pasado
en verde. Cómo se escribe uno —y cuándo corresponde uno en vez de una función
pura— está en
[CONVENCIONES.md](specs/CONVENCIONES.md#tests-de-render-en-la-web).

La otra mitad —**5c**, los tests de integración de la API contra Postgres— se
hizo el 5/8/2026 y está arriba. Las dos juntas son lo que convierte a
`sdd-verify` de lector de código en verificador de verdad. Y queda sin cubrir
Historial de ventas: el entorno ya está, los tests de esa pantalla no se
escribieron.

---

## 5e · La pantalla de Inventario se trae el catálogo entero

**Apareció** escribiendo la spec de Inventario (1/8/2026).

`useStore.js:38` pide `/products?active=true` sin paginar, y la búsqueda y la
paginación se hacen en memoria. **La API ya pagina y ya busca; nadie la usa.**

No es el mismo caso que el historial de ventas: **acá la búsqueda sí funciona**
(`Inventory.jsx:118` filtra el catálogo completo, no solo la página). Lo único
mal es la escala.

Con los 55 productos de Comprafit no se nota. Con dos mil sí, y arrastra a todo
lo que trabaja sobre esa lista: comparar sucursales y exportar operan sobre lo
que haya en memoria, no sobre el catálogo.

Quedó fuera del alcance del hito 4 por decisión de alcance, no porque no
importe.

---

## 5f · Sacar `stock_migracion_sucursal`

**Apareció** implementando la migración de identidad de sucursal (4/8/2026).
Es el riesgo 5 del plan de `docs/specs/010-inventario/`.

La migración 14 (`20260804-identidad-de-sucursal-en-stock.js`) crea la tabla
`stock_migracion_sucursal` y guarda ahí **una fila por cada fila de `stock` que
tocó**: las que solo cambiaron de sucursal —con su `punto_de_venta_id` y su
`location` anteriores— y las que desaparecieron fusionadas, con el `JSONB`
completo de la fila original, el `stock_id` que sobrevivió, la marca «revisar» y
la nota. También quedan registrados los puntos de venta que la migración tuvo
que crear.

**Cuándo se saca**: en una migración posterior de una línea (`dropTable`),
**cuando el inventario de Comprafit esté cargado y verificado** — o sea, cuando
alguien haya contado físicamente los productos que el informe marcó «revisar» y
el recuento cierre. No antes.

**Qué se pierde al sacarla**: la única salida del riesgo 2, que es una fusión que
**infló el inventario**. Dos filas de 100 unidades del mismo producto en la misma
sucursal pueden ser dos pilas de verdad —y entonces sumarlas está bien— o una
pila anotada dos veces —y entonces el inventario pasó a decir 200 donde hay
100—. La marca «revisar» distingue el caso sospechoso pero no lo resuelve: eso
lo resuelve contar. Mientras la tabla exista, la fila original está entera y se
corrige con un ajuste de stock; sin la tabla, la única forma de saber cuánto
había antes es un backup.

El `down()` de la migración 14 también depende de ella: restaura desde ahí. Sin
la tabla, la migración deja de ser reversible — que a esa altura es lo esperado,
porque el `down` **pisa cualquier movimiento de stock posterior** y es para
volver atrás minutos después de un deploy, no semanas.

Una tabla de archivo sin condición de salida se queda para siempre. Ésta la
tiene escrita: inventario contado y verificado.

---

## 6 · Cifrar la clave privada de AFIP en reposo

Está en texto plano en la base. Es material fiscal del cliente. Quedó anotado
desde la auditoría de aislamiento y sigue pendiente.

---

## 7 · Pasarela de pago

Stripe no cobra en pesos en Argentina; el camino es Mercado Pago. Las columnas
`stripe_customer_id` y `stripe_subscription_id` están muertas: nadie las lee ni
las escribe.

Requisito previo: Términos y Condiciones y Política de Privacidad, que tampoco
existen.

---

## 8 · Sesiones activas

El sistema viejo las tenía y es lo último que le falta a la pantalla de Equipo.
Decidir entre listar sesiones de Auth0 —más fiel, más trabajo— o registrar el
último acceso por usuario, que cubre el 90 % del caso con una columna.

---

## 9 · Migración de los datos de Comprafit

Bloqueado hasta tener acceso al hosting viejo. El procedimiento completo está
en [OPERACION.md](OPERACION.md#migrar-un-cliente-desde-el-sistema-legacy).

**Rotar las credenciales antes**, no después.

---

## 10 · Lo que dejó afuera Proveedores y Órdenes de compra

**Apareció** implementando `docs/specs/012-proveedores-y-ordenes-de-compra/`
(5/8/2026). Cinco cosas: tres funciones del sistema viejo que no entraron y dos
riesgos conocidos con su mitigación ya escrita.

Cada una dice **qué falta**, **por qué no entró** y **cuál es el primer paso**.
Una función que desaparece de una pantalla sin quedar anotada es una función que
alguien vuelve a pedir dentro de tres meses; y un riesgo conocido sin su
mitigación escrita es un riesgo que se reconstruye desde cero el día que muerde.

### 10a · Enlace de factura por ORDEN, además del del proveedor

**Qué falta.** El legacy (`legacy:8182`) permitía colgarle el enlace de la
factura a **la orden** que la generó. Lo que entró en el hito 012 es el bloque de
documentos **del proveedor** (`components/BloqueDeDocumentos.jsx`): sirve para
guardar facturas, remitos y presupuestos, pero no dice a qué orden corresponde
cada uno.

**Por qué no entró.** La spec resolvió el badge «sin factura» por proveedor
(FR-086) y con eso se cubre la pregunta que Comprafit hacía todos los días —«¿a
quién le compré sin que me facture?»—. La pregunta por orden aparece recién al
conciliar con el contador.

**Primer paso.** Una columna `supplier_order_id` (nullable) en
`supplier_documents`, con su índice `(empresa_id, supplier_order_id)`, y el
bloque de documentos dibujado también adentro de `PanelOrdenDeCompra`. No hace
falta modelo nuevo ni ruta nueva.

### 10b · Estado de cuenta del proveedor por WhatsApp

**Qué falta.** Mandarle al proveedor su estado de cuenta —lo que se le debe y
desde cuándo— por WhatsApp, como hacía el legacy (`legacy:8242`).

**Por qué no entró.** El envío de **la orden** sí está y se conserva
(`enviarOrdenPorWhatsapp` en `components/PanelOrdenDeCompra.jsx`, con y sin
precios): es lo que se usa para comprar. El estado de cuenta se manda una vez por
mes y hoy se resuelve con el `.xlsx` exportado.

**Primer paso.** Reusar `enviarOrdenPorWhatsapp` como molde —ya resuelve el
teléfono, el aviso cuando no hay y el armado del texto— sobre las filas que
devuelve `GET /api/suppliers/:id/movimientos/export`, que ya existen y ya traen
el saldo acumulado.

### 10c · Badge de «sin factura» en la barra lateral

**Qué falta.** El contador global de proveedores con actividad y sin ningún
documento cargado, al lado del ítem «Proveedores» del menú (`legacy:1445`,
`:7889`).

**Por qué no entró.** El badge **por proveedor** sí entró (FR-086, en la fila de
la lista). El de la barra lateral es un número que hay que calcular en cada carga
de cualquier pantalla, y hoy no existe ningún endpoint de conteos para el menú:
sería el primero, y esa decisión —qué más va a contar la barra lateral— es más
grande que este hito.

**Primer paso.** Decidir si la barra lateral va a tener contadores en general. Si
sí, un `GET /api/badges` que devuelva todos juntos; si no, no hacerlo solo para
proveedores.

### 10d · ⚠ El lock de la recepción es sobre el stock, NO sobre la orden

Es el **riesgo 7** del plan de la 012, y está declarado *Fuera de alcance* en la
spec.

**Qué falta.** `purchaseService.receiveOrder` abre una transacción y toma
`lock: t.LOCK.UPDATE` sobre la fila de `Stock` —el único `lock` del archivo—,
**no sobre la orden**. Dos personas recibiendo la misma orden a la vez leen el mismo
`detail`, y la segunda escritura pisa a la primera: la orden puede quedar con
**menos recibido del que entró de verdad**. El stock no se duplica —eso sí lo
protege el lock— pero el detalle de la orden y la deuda quedan cortos.

**El hito 012 empeora la exposición y hay que decirlo**: «Recibir» pasó a estar
en **cada fila** de la tabla (FR-007), donde antes había que expandir un acordeón.
Más gente puede llegar a la misma orden al mismo tiempo.

**Primer paso, y es UNA línea**: agregarle `lock: t.LOCK.UPDATE` al
`SupplierOrder.findOne` de `receiveOrder`. No entró ahora porque cambiar el
locking de una transacción que **ya bloquea filas de `Stock` en otro orden** es
una decisión sobre deadlocks, y eso merece su propia verificación contra Postgres
—dos recepciones simultáneas, dos órdenes que comparten producto, en los dos
órdenes de llegada—, que es un paso manual y no un test.

### 10e · Sacar la cascada de costos de la transacción de la recepción

Es el **riesgo 3** del plan de la 012.

**Qué falta.** `receiveOrder` recostea en cascada los productos elaborados que
usan el insumo comprado (`recostearDependientes` →
`costService.recalculateCascadingCosts`), **dentro de la misma transacción** que
el stock y la deuda. Una orden de veinte insumos anidados puede recostear decenas
de productos con la transacción abierta.

**Por qué no entró.** Se acepta porque es exactamente lo que hace
`productionService.recibirOrden` desde siempre, sobre el mismo grafo de recetas.
Y porque la alternativa **no es gratis**: sacarla deja una ventana en la que el
insumo ya cambió de costo y el elaborado todavía no, o sea el defecto 3 corrido
un nivel durante unos segundos.

**Primer paso.** Medir antes de tocar: es el paso manual **P11** de
`docs/specs/012-proveedores-y-ordenes-de-compra/tasks.md` —recibir una orden de
veinte insumos anidados y cronometrar—. Si el número molesta, mover la llamada
después del `commit` es un cambio de una línea; lo que hay que decidir junto con
eso es qué pasa si el proceso se cae en el medio.

⚠ **P11 ya no es solo una medición.** La verificación adversarial reprodujo un
fallo de la cascada sobre un grafo en diamante; el defecto se corrigió y lo que
quedó abierto está en **11d** y **11e**, acá abajo. El paso manual sigue
pendiente y ahora contesta dos preguntas: cuánto tarda, y si el recosteo llega a
todo el grafo.

---

## 11 · Lo que encontró la verificación adversarial del hito 6

**Apareció** verificando `docs/specs/012-proveedores-y-ordenes-de-compra/`
(5/8/2026). La verificación encontró ocho defectos y se corrigieron todos; **esto
es lo otro**: lo que se vio de paso y **no** se corrigió, cada cosa con por qué no
y cuál es el primer paso.

Ocho, agrupadas: dos son de permisos y no son de este hito —se cruzaron mirando
otra cosa—; tres son del grafo de costos, y una de ellas (**11d**) es **la causa
raíz de los dos defectos de diamante que sí se corrigieron**; dos son limpieza; y
la última es la verificación manual que nadie corrió todavía.

### 11a · `GET /api/empresas/:id/suscripcion` no declara ningún permiso

**Qué falta.** El endpoint (`routes/empresas.js:538`) va detrás de
`requireEmpresa` + `requireEmpresaPropia()`, así que **no cruza empresas**: nadie
lee la suscripción de otro cliente. Lo que sí pasa es que **cualquier miembro de
la empresa —un cajero— puede leer el plan, el estado y las fechas de
vencimiento**. Le correspondería `config.ver`, que es lo que ya piden
`GET /api/empresas` y `GET /api/empresas/:id` (`:412`, `:424`).

**Y el permiso ya está elegido, en el lugar que no manda.** El ítem de menú
declara `permission: 'config.ver'` (`components/navegacion.js:51`), así que hoy el
gateo existe **solo en la barra lateral**, que es exactamente lo que el plan
llama cosmético: la ruta `/suscripcion` se monta **sin `RouteGuard`**
(`App.jsx:292`) y el endpoint no pide nada. Quien no ve el ítem llega igual
escribiendo la URL.

**Por qué no se corrigió.** Un endpoint que empieza a responder 403 en producción
deja afuera a quien hoy entra, y acá encima **no se nota**: el único llamador es
`pages/SubscriptionSettings.jsx:28`, y su `catch { }` está vacío, así que un 403
no se ve como «no tenés permiso» sino como **«No hay información de
suscripción»** — que es mentira y manda a mirar la base. Eso es una decisión con
consecuencia para el cliente, y toca tres archivos, no una línea.

**Primer paso.** Cerrar los tres lados juntos —`checkPermission('config.ver')` en
el endpoint, `RouteGuard` en la ruta, y el ítem que ya está— y **arreglar ese
`catch` vacío en el mismo movimiento**, o el arreglo se va a leer como una
pantalla rota. **Y borrar esta entrada al hacerlo**: hay un test que se pone en
rojo el día que alguien lo arregle —`src/tests/permisosDeRutas.test.js`, entrada
`DEUDA_DE_PERMISOS`—, justamente para que la lista de deuda no le sobreviva a la
deuda.

### 11b · El mismo pago pide dos permisos distintos según a quién se le pague

**Qué falta.** `POST /api/suppliers/:id/payments` exige `proveedores.crear`
(`routes/suppliers.js:866`) y `POST /api/customers/:id/payments` exige
`caja.crear` (`routes/customers.js:108`). Es **la misma operación** —registrar un
movimiento de plata en una cuenta corriente— con dos permisos distintos.

**Por qué importa.** Un rol con `proveedores.crear` y sin `caja.crear` puede
pagarle a proveedores. Quien arma ese rol está pensando «que pueda dar de alta
proveedores», no «que pueda mover plata», y el permiso no se lo dice. Es un
agujero de intención, no de aislamiento: la fila queda en la empresa correcta.

**Por qué no se corrigió.** Unificar el criterio cambia qué puede hacer cada rol
ya creado en producción, en los dos sentidos: si el pago a proveedores pasa a
pedir `caja.crear`, alguien que hoy paga deja de poder; si se elige al revés,
alguien gana un permiso. Eso se decide con el catálogo de permisos a la vista, no
en un fix.

**Primer paso.** Escribir qué significa cada familia —`caja.*` es «mueve plata»,
`proveedores.*` es «administra la ficha del proveedor»— y recién después mover el
permiso. Con la definición escrita, el resto del catálogo se revisa una vez y no
se vuelve a discutir.

### 11c · `recipe_items` no tiene índice único por `(recipe_id, ingredient_product_id)`

**Qué falta.** Nada impide que una receta liste el mismo insumo dos veces
(`models/RecipeItem.js`, sin índice único). Cuando pasa,
`costService.calculateProductCost` **suma el mismo insumo dos veces** y el
elaborado queda costeado de más, en silencio: el margen del POS y el precio
recomendado del Comparador salen de ese número.

**Por qué importa.** Es el mismo error que la spec de la 012 persigue en otros
lados —un número de plata que está mal y no falla nada—, pero acá no lo tapa
ninguna función pura: el dato ya está mal en la base.

**Por qué no se corrigió.** Pide una migración con dos pasos, y el segundo no es
mecánico: **antes del índice hay que limpiar los duplicados que ya existan**, y
fusionar dos líneas del mismo insumo significa decidir si las cantidades se suman
o si una es un error de carga. Eso lo contesta quien cargó la receta.

**Primer paso.** Una consulta que cuente cuántas recetas tienen el problema hoy.
Con cero filas, la migración es el índice y nada más; con filas, sale un informe
como el de `stock_migracion_sucursal` (5f) antes de tocar nada. El recosteo ya
protege el otro lado —`recostearDependientes` deduplica por elaborado, así que un
insumo repetido no recostea dos veces—, pero eso no arregla el costo.

### 11d · `recalculateCascadingCosts` tira un `Error` pelado y confía en el `Set` que le pasan

**Es la causa raíz de los dos defectos de diamante del hito**, y el que más
conviene cerrar de esta lista.

**Qué falta.** `costService.recalculateCascadingCosts(productId, visited, transaction)`
hace dos cosas frágiles (`services/costService.js:80-84`):

1. si el `Set` que recibe **ya trae** el producto, tira
   `new Error('Dependencia circular detectada…')` —un `Error` pelado, sin
   `status` y sin el nombre del producto—, así que sube como **500 genérico** y
   quien lo lee no sabe qué receta abrir;
2. **muta el `Set` del llamador** (`visited.add`) y clona solo hacia adentro, en
   la recursión. O sea que reusar un `Set` entre dos ramas hermanas es un falso
   «ciclo» sobre un grafo que no tiene ninguno: el llamador tiene que acordarse
   de clonar, y el día que se olvide no falla en la función que se olvidó, falla
   acá, con un mensaje que dice otra cosa.

Los dos defectos que el hito corrigió son exactamente eso: `recostearDependientes`
compartía un `Set` entre ramas y el error salía como 500 sin nombrar nada. Se
arregló **del lado del llamador**, que era lo que estaba en alcance.

**Por qué importa.** El próximo llamador vuelve a caer. Y el defecto es
**intermitente** —depende de qué rama del grafo se recorra primero—, que es la
forma más cara de que un bug exista: la misma operación responde 200 o 500 según
el orden de las filas.

**Por qué no se corrigió.** `costService` lo usan producción, recetas y compras;
cambiar el tipo de error que tira cambia qué responden esos tres caminos, y eso
es otra verificación.

**Primer paso, y son dos líneas.** Que el error sea un `ErrorDeNegocio` con el
**nombre** del producto —el molde ya está escrito en
`purchaseService.avisoDeRecosteoFallido`—, y que la función **clone ella misma**
el `Set` que recibe en vez de confiar en que el llamador se acuerde. Lo segundo
es lo que cierra la clase entera de defectos, no un caso.

### 11e · La cascada de costos no se deshace por partes

**Qué falta.** Si el recosteo en cascada falla a la mitad, **los costos que ya
escribió quedan escritos**. La decisión 13 de la spec de la 012 dice que la
recepción vale igual y el fallo se informa como aviso —y eso está bien: la
mercadería entró—, pero deja el grafo a medio recostear sin que nadie lo
deshaga.

**Por qué importa.** Sobre un grafo con un ciclo real esos costos ya eran
indefendibles antes de la recepción, y el aviso es lo que manda a alguien a
mirarlos. Sobre uno sano —el caso de 11d— el fallo era espurio y los costos
parciales no tenían por qué existir.

**Por qué no se corrigió, y ojo con el test.** Pide un SAVEPOINT alrededor de la
cascada. Y hay una trampa: **el doble de `tests/helpers/modelosFalsos.js` no
soporta `rollback`**, así que un test unitario que afirmara «los costos parciales
se deshicieron» **pasaría con y sin el SAVEPOINT**. Sería uno más de los tests
que no prueban nada, que es lo que este proyecto viene sacando.

**Primer paso.** El SAVEPOINT es corto de escribir; lo que hay que resolver
primero es **contra qué se verifica**, y hoy la respuesta es el proyecto **5c**
—tests de integración contra un Postgres real—. Sin eso, se escribe la línea y no
se puede afirmar que funciona.

### 11f · `contadoresPorSegmento` quedó sin uso en producción

**Qué falta.** `apps/web/src/utils/ordenDeCompra.js` exporta
`contadoresPorSegmento`, y **el único que la llama es su propio test**. Los
contadores de los segmentos los devuelve el servidor y la pantalla los lee de ahí
(`PurchaseOrders.jsx`, estado `contadores`).

**Por qué importa.** No rompe nada, y por eso es peligrosa: es código muerto que
sigue **verde**, así que la suite da la impresión de estar cubriendo el contador
de los segmentos cuando lo que se dibuja sale de otro lado. Un test que pasa
sobre una función que nadie usa es ruido con forma de garantía: es el mismo
problema que persigue `todosLosTestsCorren.test.js`, visto por el otro lado —allá
un test que nunca corre, acá uno que corre sobre algo que ya no se dibuja—.

**Primer paso.** Borrar la función y su test, o —si se decide volver a contar en
el navegador cuando el listado no está paginado— dejar escrito quién la va a
llamar. Las dos salidas sirven; lo que no sirve es que quede así.

### 11g · Tres copias de «la fecha de hoy» en la web

**Qué falta.** La misma función —el día de hoy como `AAAA-MM-DD` leído en la zona
del usuario, **sin pasar por UTC**— está escrita tres veces:
`pages/Orders.jsx` (`hoy`), `pages/PurchaseOrders.jsx` (`fechaDeHoy`) y
`components/BloqueDeDocumentos.jsx` (`hoy`). Su lugar es `utils/formato.js`, al
lado de `fechaCorta`.

**Por qué importa.** El comentario de las tres explica el mismo defecto: con
`toISOString()` toda la tarde argentina del día 5 se guarda como día 6, y el pago
—o la factura— cargado a las 21:30 aparece en el mes equivocado cada fin de mes.
Tres copias es cómo una se arregla y las otras no.

**Por qué no se corrigió.** Mudarla toca `utils/formato.js` —que hoy exporta
`pesos` y `fechaCorta` y nada más—, y ese archivo estaba fuera del alcance de la
corrección que encontró las copias.

**Primer paso.** Mover **una sola** versión a `utils/formato.js` con su
comentario, y que los tres archivos la importen. Es un commit, no cambia
comportamiento, y le da a la función un test propio: hoy **ninguna de las tres
copias tiene uno que verifique lo que su propio comentario explica** —que la
tarde del día 5 no se guarde como día 6—, porque son funciones privadas de un
módulo y desde afuera no se las puede llamar.

### 11h · 11 de los 12 pasos manuales del hito siguen sin correr

**Qué falta.** `tasks.md` de la 012 deja doce verificaciones que **necesitan una
persona**. Corrió una: **P8** (las rutas siguen centradas), que además quedó
automatizada. Las once restantes están pendientes, y estas cuatro son las que
importan:

| Paso | Qué contesta, y por qué no lo contesta ningún test |
|---|---|
| **P11** · La recepción con cascada | **Urgente**: dejó de ser una medición. La verificación confirmó que la cascada **se caía** sobre un grafo en diamante. Hay que correrlo sobre un diamante —no sobre una cadena, que es donde el defecto no aparece— y además cronometrar los veinte insumos anidados |
| **P6** · El índice **se usa** | Es el único que verifica que la migración de índices haya servido de algo. `verificar:esquema` no mira índices y una consulta con `Seq Scan` devuelve **los mismos datos**, solo que tarda. Necesita un `EXPLAIN ANALYZE` con datos suficientes, o el planificador prefiere el `Seq Scan` por tamaño y el paso no prueba nada |
| **P5** · El `down` de la migración, **corrido** | Leerlo no es correrlo: el `IF EXISTS` puede estar bien escrito y el `down` fallar igual, por el orden de la transacción o por un nombre de índice que no coincide con el del `up`. Y no se descubre al escribir la migración: se descubre **el día que hay que revertir un deploy** |
| **P7** · La columna suma en una planilla | El test afirma que cada celda lleva `{ t: 'n' }`, que es todo lo que un test puede afirmar. Lo que no puede es abrir el `.xlsx`: si el tipo se pierde al escribir la hoja, **el archivo abre, se ve bien y está mal**, y el contador se entera cuando selecciona la columna Saldo y no aparece ninguna suma |

**Por qué no se corrieron.** Todos cuelgan del procedimiento **P0**, que necesita
**dos bases descartables** —una migrada y otra sincronizada— y el
`ALLOWED_ORIGINS` armado. No es una tarde de trabajo y no lo puede hacer un
agente.

**Primer paso.** P11 primero, porque ya se sabe que ahí había un defecto y lo que
falta es confirmar que el arreglo alcanza. Después P6 y P5, que son la misma
sesión de `psql`. P7 se cierra abriendo un archivo.

---

## 12 · Lo que dejó afuera TiendaNube

**Apareció** implementando `docs/specs/013-tiendanube/` (6/8/2026). Siete cosas:
tres funciones que no entraron, dos condiciones del entorno que hacen que algo ya
escrito no se ejecute, y dos puntos ciegos —uno de la verificación y otro de una
guardia—.

Cada una dice **qué falta**, **por qué no entró** y **cuál es el primer paso**.

Y una que **no** queda pendiente y corrige el registro: la columna muerta
`products.tiendanube_variant_id` **dejó de ser escribible** y sus valores se
ignoran explícitamente (`routes/products.js:40-52`). Existía, se podía completar
desde el panel de producto, el sistema respondía «guardado» y **no la leía
nadie**. La columna no se borra —sacarla de la lista blanca es reversible, un
`DROP COLUMN` no—.

### 12a · No hay reservas de stock, y cinco caminos borrarían la que hubiera

**Qué falta.** El concepto de «comprometido». La spec decidió publicar en
TiendaNube el **disponible** (`stock.available`) y no la cantidad, con el ejemplo
«un producto con 10 en el depósito y 3 comprometidos publica 7». Ese estado
**AdminApp no lo puede producir**: nada reserva stock.

**Por qué importa igual.** Publicar `available` es lo correcto y **hoy no cambia
ningún número**, así que no cuesta nada. Lo que no se puede afirmar es que
proteja de una sobreventa, y ahí está la trampa: el día que exista una reserva de
verdad, **cinco caminos la borran** asignando `available = quantity` sin que nada
avise:

| Dónde | Qué es |
|---|---|
| `services/productionService.js:357` | Consumo de insumos de una producción |
| `services/productionService.js:380` | Alta del producto terminado |
| `routes/import.js:438` | Importación de una planilla |
| `routes/products.js:344` y `:350` | Alta y actualización de producto con stock |
| `routes/general.js:265` y `:271` | `POST /api/stock/bulk` |

El único camino que hoy puede separarlas es el ajuste manual de
`routes/general.js:83-91`, y la siguiente producción o importación lo pisa. Es un
número que se puede mover y que **nada conserva**.

**Primer paso.** Antes de escribir cualquier reserva, decidir qué significa
`available` y hacer que los cinco caminos respeten esa definición **en el mismo
commit**. Escribir la reserva primero y arreglar los escritores después deja una
ventana en la que el sistema promete algo que cinco lugares deshacen.

### 12b · Un permiso propio de TiendaNube

**Qué falta.** La pantalla se gatea con `config.ver` y `config.editar`, que son
los permisos de **toda la configuración de la empresa**: el CUIT, el certificado
de AFIP, los márgenes.

**Por qué no entró.** Los dos permisos ya existen (`seedPermissions.js:59-60`) y
crear uno nuevo obliga a decidir qué rol lo lleva y a migrar los roles cargados.
Con una pantalla que todavía no usa nadie, esa decisión se toma sin información.

**Cuándo va a doler.** El día que el encargado de depósito tenga que sincronizar
el stock o corregir un mapeo: hoy, para hacerlo, hay que darle acceso a la
configuración fiscal de la empresa.

**Primer paso.** `tiendanube.ver` y `tiendanube.editar` en `seedPermissions.js`,
y cambiar los `checkPermission` de las once rutas privadas de
`routes/tiendanube.js`, la `<Route>` de `App.jsx` y el ítem de
`components/navegacion.js` **a la vez**: el gate va en los tres lados o no sirve.

### 12c · Un pedido de la tienda no registra ninguna venta

**Qué falta.** Un `order/paid` **baja el inventario y no registra una venta**. No
aparece en facturación, ni en el flujo de caja, ni en los reportes: el stock sale
del depósito sin ingreso asociado.

**Por qué no entró.** Registrar la venta implica decidir tipo de comprobante,
punto de venta de AFIP, cliente, medio de pago y numeración — y para un
comprobante fiscal, además, qué pasa si AFIP rechaza un pedido que ya descontó
stock. Es una funcionalidad propia, no un agregado.

**Por qué ahora alguien va a preguntar.** Hasta este hito la limitación estaba
escrita en un comentario del servicio y en `ANALISIS.md`, o sea en ningún lado
que un usuario mire. **Ahora la pantalla lo dice**, arriba de la tabla. Eso es
correcto —el que no lo sabía cerraba la caja con una diferencia que no podía
explicar— y tiene la consecuencia de que la pregunta llega.

**Primer paso.** Decidir si el pedido genera una venta **no fiscal** —que cubre
caja y reportes y no toca AFIP— o una con comprobante. La primera es
sustancialmente más chica y contesta la pregunta que la gente hace.

### 12d · `order/cancelled` y las devoluciones

**Qué falta.** Un pedido cancelado o devuelto en TiendaNube **no repone el
stock**. AdminApp solo escucha `order/paid`.

**Por qué no entró.** Reponer necesita **su propia guarda de idempotencia**, y no
es la misma que la del descuento: reponer dos veces es tan malo como descontar
dos veces, y la fila de `tiendanube_pedidos` que hoy impide el segundo descuento
no dice nada sobre reposiciones. Improvisarla es cómo se llega a un inventario
inflado que nadie puede reconstruir.

**Mientras tanto** la pantalla lo advierte y dice qué hacer: ajustarlo a mano
desde Inventario.

**Primer paso.** Una columna o una tabla que registre la reposición por pedido,
con su `UNIQUE`, **antes** de escribir el handler. Es la lección del CAE y la de
`POST /api/sales`: la garantía la sostiene una restricción de la base, no el
orden en que se ejecutaron dos entregas.

### 12e · ⚠ El contrato real de TiendaNube no lo verifica **ni un solo test**

**Qué falta.** Un entorno de pruebas. Las tres URL de la API de TiendaNube están
**literales** en `services/tiendanubeService.js` y no hay ninguna variable para
moverlas, así que no se puede apuntar a un sandbox ni a un doble de servidor.

**Qué queda sin verificar, dicho sin adornos.** Todo lo que sigue está escrito
mirando la documentación y **nadie vio nunca una respuesta real**:

- **El nombre de la cabecera de la firma** (`x-linkedstore-hmac-sha256`). El test
  de HMAC prueba que **AdminApp verifica lo que AdminApp firmó**: el circuito, no
  el algoritmo del otro lado. Si la cabecera se llamara distinto, ese test
  seguiría verde y **todo webhook real respondería 401** — que es el mismo
  síntoma que ya tuvo esta integración durante meses.
- **El formato de la paginación**: si es `page`/`per_page`, y si el fin de las
  páginas se detecta por una respuesta vacía o por una cabecera.
- **La forma del cuerpo del webhook**: `store_id`, `id`, `products` contra
  `items`, `product_variant_id` contra `variant_id`. El código contempla **las
  dos formas de cada par** justamente porque no se sabe cuál llega.
- **Que `PUT /v1/{user_id}/products/variants/{id}` acepte `{ stock }`**.
- **Que TiendaNube mande `Retry-After` en un 429**, y en qué formato. La función
  pura contempla los tres casos; cuál ocurre, no lo sabemos.

**Por qué importa que esté escrito acá.** Porque la suite de este hito es grande
y verde, y una suite grande y verde se lee como «esto está probado». Lo que está
probado es AdminApp de su lado del cable.

**Primer paso.** `TIENDANUBE_API_URL` con valor por defecto el actual, para poder
apuntar a un servidor de pruebas. Es media hora y convierte cinco preguntas
abiertas en cinco tests. Los pasos manuales P1 y P2 —una compra real en una
tienda real— siguen siendo la única forma de cerrarlas hoy.

### 12f · `API_URL` y `CRON_SECRET` sin configurar: la reconciliación no se ejecuta

**Qué falta.** Dos secretos de panel. `.github/workflows/tareas-diarias.yml:50-51`
corta si faltan, y sin `CRON_SECRET` en Render el endpoint responde **404 aunque
se lo llame**. Están sin marcar en
[OPERACION.md](OPERACION.md#antes-del-primer-cliente-real) desde antes de este
hito.

**Por qué importa más que antes.** La decisión de sincronizar ante cada
movimiento de stock viene con una red de tres partes: cola con reintento,
agrupado y **reconciliación diaria**. Las dos primeras corren en el proceso; la
tercera es este cron. **Sin él, un empujón que se perdió queda perdido**, y el
número que alguien cambió a mano en el panel de TiendaNube no vuelve nunca.

**Lo que sí está.** Toda la lógica está escrita y testeada llamando a la función
directamente. Lo que falta es el disparador.

**Cómo se ve que falta, sin entrar a ningún panel.** La pantalla muestra
**«Última reconciliación»** y dice cuándo nunca corrió. Es deliberado: la
ausencia de la red se ve, en vez de suponerse.

**Primer paso.** Los tres pasos de
[Tareas programadas](OPERACION.md#tareas-programadas). No es trabajo de
desarrollo.

### 12g · La guardia de aislamiento no ve el id que sale de un elemento de un arreglo

**Qué falta.** Que `analizarCreates` (`tests/aislamientoEmpresas.test.js`)
reconozca la forma `Modelo.create({ x_id: item.x_id })` dentro de un bucle sobre
un arreglo del cuerpo.

**Por qué importa.** Es la forma que tenía el IDOR de `POST /api/stock/bulk`, que
**ya está corregido** —`d6ac55a`, la consulta que comprueba que los productos
sean de la empresa antes de tocar una sola fila (`routes/general.js:236-253`)—.
Lo que sigue abierto es el **detector**: `sospechosas` marca un valor cuando
empieza en `req.params|body|query.` o cuando es un identificador que la función
recibió como parámetro (`:450-461`). `item.product_id` no es ninguna de las dos
—`item` es la variable del `for`—, así que **el patrón puede volver mañana en
otro endpoint y la guardia lo va a dar por bueno**.

Es exactamente el modo de falla que este repositorio viene juntando, y el hito
013 ya lo encontró una vez con otra forma: la forma corta de ES6 y los routers
que no se llaman `router`, que T1301 tuvo que enseñarle al mismo detector.

**Primer paso.** Seguir el valor un salto más: si es `<ident>.<algo>_id` y
`<ident>` es la variable de un `for…of` cuyo iterable sale del cuerpo del
request, tratarlo como si fuera del cliente. Y **antes de nada, correr la suite
entera**: ensanchar el detector cambia la población que mira, y las dos veces que
se lo ensanchó apareció un IDOR vivo que nadie había visto.
