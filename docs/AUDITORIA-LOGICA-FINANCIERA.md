# Auditoría de lógica financiera (Frente 2)

**Fecha:** 31 de julio de 2026
**Método:** 13 agentes en paralelo sobre 6 dominios de cálculo, cada hallazgo
sometido a un verificador adversarial cuya instrucción era refutarlo. Más
verificación manual y tests de regresión.
**Resultado:** 140 hallazgos confirmados (14 críticos, 52 altos), 3 refutados.

---

## Lo que se arregló

Los tests pasaron de 6 a **221 en la API** más **22 en el frontend**. Cada
arreglo lleva su test; varios fallaban antes del cambio y pasan después.

### Funcionalidad que estaba completamente caída

| Qué | Causa | Estado |
|---|---|---|
| **Todo el módulo de reportes** | `SaleItem.belongsTo(Sale)` sin `as`, quedaba registrada como `'Sale'`; `reports.js` pedía `as: 'sale'`. Sequelize valida los alias recién al ejecutar: 500 al abrir la pantalla | ✅ |
| **Anular una venta** | `FOR UPDATE` sobre `LEFT OUTER JOIN` — PostgreSQL lo rechaza. Y `findScoped` hacía `parseInt` de un id que es `STRING(40)` | ✅ |
| **Recetas anidadas** | `checkCircularDependency` marcaba como circular cualquier ingrediente con receta propia. El módulo rechazaba su caso de uso central | ✅ |
| **Integración TiendaNube** | Endpoints con `checkPermission` pero montados sin `loadEmpresaContext`: 403 siempre en producción | ✅ |
| **`/api/taxes/monotributo`** | `getConfig` sin `empresaId` tras el Frente 1 — regresión propia | ✅ |

### Cálculos que daban números incorrectos

**El punto de equilibrio recomendaba precios que garantizan pérdida.** La
fórmula da margen sobre la venta; la pantalla lo presentaba como recargo sobre
el costo. Con los valores por defecto decía 34% cuando hacía falta 51,5%:
aplicando lo que sugería, el negocio pierde $623.000 por mes creyendo que está
en equilibrio. Y lo etiquetaba "BEP JUSTO — precio de supervivencia".

**Las ventas anuladas contaban como reales en 13 consultas.** Facturación del
tablero, ingresos de caja, deuda de clientes, categoría de monotributo, costo
de mercadería vendida. Una venta anulada de $50.000 inflaba la deuda de un
cliente de $10.000 a $60.000.

**El total de la venta se guardaba tal cual venía del navegador.** Un carrito de
$10.000 se podía registrar como $1, y quedaban tres números distintos para la
misma operación según qué pantalla se mirara. Ahora se recalcula en el servidor
y se rechaza si no cierra.

**La cascada de costos no propagaba nada.** `recalculateCascadingCosts` no
pasaba la transacción a `calculateProductCost`, que leía por otra conexión los
costos anteriores al `UPDATE` sin commitear. Subir el costo de la harina no
cambiaba el costo del pan. Nunca.

**Una cantidad negativa aumentaba el stock.** `if (available < qty)` con
`qty = -5` es falso, y después `quantity - (-5)` suma 5. Se creaba mercadería
de la nada.

**Merma del 100% dejaba el producto en costo cero**, y ese cero se persistía:
el producto pasaba a venderse regalado.

**Importar una planilla parcial destruía datos.** Sin columna de costo, el costo
de cada producto se ponía en 0 y se llevaba puestos todos los precios. Con la
columna de cantidad en blanco, el inventario se vaciaba.

**Recepción de órdenes de compra**: las cantidades recibidas se mutaban sobre el
JSONB y nunca se persistían; recibir 1 de 3 líneas marcaba la orden como
completa y bloqueaba el resto para siempre.

**Caja**: cada compra a crédito se descontaba dos veces (la deuda y el pago). La
proyección inflada un 10% se devolvía en el campo que la pantalla rotula
"Entradas 30d", como si fuera histórico.

**Tramos de antigüedad solapados**: `Op.between` es inclusivo en ambos extremos
con cortes compartidos, así que una venta en el borde contaba en dos tramos.

### Seguridad

- **Webhook de TiendaNube abierto**: sin firma ni validación de origen, y
  resolvía la empresa con `|| 1`. Cualquiera podía postear un pedido inventado
  y bajarle el inventario a la empresa 1. Ahora valida HMAC-SHA256 en tiempo
  constante y resuelve la empresa por el `store_id`.
- **Doble descuento de stock** por pedido: se procesaban `order/created` y
  `order/paid`. Ahora solo uno, y `processOrderCreated` es idempotente.
- **El callback de OAuth guardaba el token de cualquier empresa bajo la
  empresa 1.**
- **`DELETE /api/expenses/:id` y `dashboardService._customerStats` sin filtro de
  empresa** — dos que se escaparon del Frente 1.
- **`PUT /api/stock/:id` hacía `update(req.body)` crudo**: el cliente podía
  reescribir `empresa_id` y mover la fila a otra empresa.

---

## Guardias nuevos

Además de los tests de cada arreglo, dos que atrapan clases enteras de error:

**`asociaciones.test.js`** — recorre `routes/` y `services/`, extrae los pares
(modelo, alias) de cada `include` y verifica que existan. Es lo que habría
evitado que los reportes estuvieran caídos sin que nadie se enterara.
*Verificado que falla de verdad*: revirtiendo el alias, señala
`routes/reports.js`.

**Los modelos falsos rechazan `undefined` en el `where`**, igual que Sequelize.
Sin eso el doble era más permisivo que la base y dejaba pasar el error más
probable después de cambiar la firma de una función.

---

## Preguntas de producto

63 preguntas que el código no puede responder. Consolidadas, son **14
decisiones**. Están ordenadas por cuánto bloquean.

### Bloquean vender

**1. ¿"Margen 50%" significa recargo sobre el costo o margen sobre la venta?**
Hoy conviven las dos convenciones: `useStore.js` usa recargo sobre costo, el
panel calcula sobre venta. Hay que fijar una y etiquetar el campo. Todo el
sistema de precios depende de esto.

**2. ¿`recargo_tarjeta` es lo que le cobrás de más al cliente, o lo que te
retiene la tarjeta?** La fórmula actual (`precio / (1 - r/100)`) implementa lo
segundo: con `r = 20` el precio sube 25%, no 20%. El texto de la pantalla dice
lo primero. Con `r = 100` divide por cero.

**3. ¿Una venta con cliente asignado es al contado o a cuenta corriente?** Hoy
*toda* venta con `customer_id` cuenta como deuda hasta que alguien registre un
pago a mano. `Sale` no tiene ningún campo para distinguirlo. De esto dependen
"Por Cobrar", "clientes con deuda" y el saldo de caja.

**4. ¿El saldo de caja es base efectivo o base devengado?** Hoy suma las ventas
*y* las cobranzas, contando el mismo peso dos veces. No lo corregí porque la
respuesta define la fórmula, no es un bug con arreglo obvio.

**5. Anular una venta no emite nota de crédito en AFIP.** El comprobante con CAE
sigue existiendo y sigue siendo facturación ante el fisco. ¿El facturado anual
del monotributo excluye las anuladas (criterio interno) o las incluye mientras
no haya NC (criterio AFIP)? Hoy las excluye. **Esto puede hacer que declares de
menos.**

### Bloquean facturar bien

**6. ¿Hay que soportar alícuotas distintas del 21%?** (10,5%, 27%, exento). Si
el catálogo tiene alimentos o servicios, hace falta el campo en `Product` y
facturación con múltiples `AlicIva`.

**7. ¿Qué tipos de comprobante hay que soportar además de 1, 6 y 11?** Notas de
crédito y débito, comprobantes M, FCE MiPyME. Hoy el endpoint acepta cualquier
número y factura mal los que no están en la lista.

**8. ¿La recategorización de monotributo es por año calendario o últimos 12
meses?** Hoy es calendario; AFIP usa los últimos 12 meses. Cambia la categoría
que se muestra todo el año.

**9. ¿Quién actualiza las escalas cuando AFIP las modifica?** Hoy cada empresa
las puede editar por API sin validación.

### Bloquean el módulo de producción

**10. ¿`quantity_produced` son unidades de producto terminado o lotes de
receta?** El código usa una interpretación para consumir insumos y otra para
acreditar el terminado.

**11. ¿La merma se aplica al rendimiento (menos unidades buenas) o a los insumos
(se consume más)?** Hoy al rendimiento, y no afecta el consumo real de stock.

**12. ¿El inventario maneja fracciones?** `Stock.quantity` es `INTEGER` pero las
recetas y las transferencias usan `parseFloat`. Un insumo por gramo no se puede
representar, y `DECIMAL(12,2)` tampoco permite $0,004/g.

### Definiciones que faltan

**13. ¿Qué es `available` frente a `quantity`?** ¿Reservas, mercadería en
tránsito, o son lo mismo? Sin esa definición no se puede fijar la invariante.

**14. ¿Los gastos fijos son mensuales?** No tienen fecha ni periodicidad. El
tablero, el balance de caja y `/reports/profit` hoy lo interpretan cada uno a su
manera, y por eso muestran números distintos.

---

## Lo que queda sin resolver

**Documentado en el código, requiere decisión o migración:**

- **Margen histórico con costo actual.** `/reports/profit` y `/reports/sales`
  calculan el costo de lo vendido con el costo *actual* del producto.
  Actualizar un costo cambia retroactivamente la ganancia de meses cerrados.
  Arreglarlo exige guardar `unit_cost` en `sale_items` al vender: migración más
  decidir qué hacer con el histórico.
- **TiendaNube baja stock pero no registra venta.** Los pedidos online no
  aparecen en facturación, ni en caja, ni en reportes. `tiendanubeService`
  importa `Sale` y `SaleItem` y nunca los usa: quedó a medio construir.
- **El callback de OAuth de TiendaNube exige `state`**, que el frontend todavía
  no manda. La vinculación queda inhabilitada hasta completarlo — preferible a
  seguir escribiendo el token de un cliente en la cuenta de otro.
- **`price_override`, `wholesale_price` y `wholesale_margin`** se guardan, se
  importan y se editan, pero ninguna pantalla los usa para calcular precio.
- **La clave privada de AFIP sigue en texto plano** en la base (pendiente del
  Frente 1).

**Hallazgos de severidad media y baja sin atacar:** 74. Están en el informe
completo del workflow. Ninguno destruye datos ni produce números incorrectos
de primer orden; conviene revisarlos cuando se cierren las decisiones de
arriba, porque varios dependen de ellas.

---

## Nota sobre el método

Los 140 hallazgos vienen de agentes que leyeron el código, y cada uno pasó por
un verificador cuya instrucción explícita era *refutarlo*. Aun así, **verifiqué
a mano cada uno de los que arreglé** antes de tocar nada: reproduje el bug de
recetas anidadas en un script aislado, comprobé el tipo de la clave primaria de
`Sale`, confirmé que el alias `sale` no existía consultando las asociaciones en
runtime, y probé que los guardias fallan cuando se reintroduce el defecto.

Tres hallazgos fueron refutados por el verificador y no se tocaron.

Los de severidad media y baja **no** los verifiqué uno por uno. Trátelos como
pistas, no como conclusiones.
