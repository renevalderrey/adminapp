# Próximos proyectos

Lo que sabemos que hay que construir y todavía no tiene fecha. Cada uno con lo
que ya está resuelto y lo que falta de verdad, para poder estimarlo sin volver
a investigar.

Cuando uno arranca, se le hace su spec con `/sdd` y se lo saca de acá.

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

## 5c · Tests de integración contra una base real

**Apareció** escribiendo el plan del historial de ventas (1/8/2026).

No existe forma de probar una ruta contra Postgres. `src/tests/` cubre
utilidades y guardias estáticas, y `server.test.js` llega hasta `/ping`,
`/health` y CORS. Los dobles de `tests/helpers/modelosFalsos.js` lo dicen en su
propio encabezado: *«un bug que solo aparece contra Postgres real —por ejemplo,
DECIMAL devuelto como string— NO lo atrapan»*.

Ese ejemplo dejó de ser hipotético: es exactamente el motivo por el que la
columna Total del export no sumaría.

Lo mismo pasa con el orden estable de la paginación, los locks, y el
aislamiento entre empresas — que hoy se verifica con guardias que leen el
código fuente, no ejecutándolo.

**Qué implica**: un Postgres de test (el CI ya levanta uno), fixtures mínimas
—dos empresas con datos— y `supertest` contra la app real. Es la pieza que
convierte a `sdd-verify` de lector de código en verificador de verdad.

**Es la deuda técnica con mejor relación entre lo que cuesta y lo que evita.**

---

## ~~5d · Tests de render en la web~~ · hecho

Hecho en **`3bd02fc`** (3/8/2026), sin ciclo SDD porque no cambia el
comportamiento de la aplicación: `jsdom` y `@testing-library` en
`apps/web/devDependencies`, el bloque `test` en `vite.config.js`, y 28 tests de
render que atrapan los cuatro incumplimientos de Inventario que habían pasado
en verde. Cómo se escribe uno —y cuándo corresponde uno en vez de una función
pura— está en
[CONVENCIONES.md](specs/CONVENCIONES.md#tests-de-render-en-la-web).

Queda **5c** —los tests de integración de la API contra Postgres— como la otra
mitad de lo que convierte a `sdd-verify` de lector de código en verificador de
verdad. Y queda sin cubrir Historial de ventas: el entorno ya está, los tests
de esa pantalla no se escribieron.

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
