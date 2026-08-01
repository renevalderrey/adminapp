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
