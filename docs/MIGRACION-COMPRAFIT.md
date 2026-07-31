# ¿Puede Comprafit migrar a AdminApp?

**Fecha:** 31 de julio de 2026
**Método:** lectura completa del sistema legacy (`legacy/`, 11.037 líneas) y
comparación función por función contra AdminApp.

---

## Respuesta corta

**Sí, pero todavía no sin pérdida.** AdminApp hace más cosas que el sistema
viejo en casi todo lo que es contabilidad, fiscalidad y control. Pero hay
**seis funciones del día a día de Comprafit que no existen**, y tres de ellas
son flujos que el cliente usa todas las semanas.

Migrar hoy significa que el cliente gana factura electrónica, clientes con
cuenta corriente, recetas, producción, caja e impuestos — y pierde el
comparador de proveedores, el pedido por WhatsApp y la actualización masiva de
precios con deshacer.

La recomendación está al final.

---

## Qué era el sistema viejo

Conviene entenderlo porque explica qué se puede migrar y qué no.

- **Un archivo HTML de 10.627 líneas** con todo adentro: interfaz, lógica y los
  datos semilla.
- **Un `api.php` de 216 líneas** que es un almacén clave-valor: una tabla
  `cf_datos (clave, valor LONGTEXT)` donde cada clave guarda un JSON entero
  (`cf_db` = todos los productos, `cf_stock` = todo el inventario), más una
  tabla `cf_ventas`.
- **Sin esquema.** No hay tablas de productos, ni de proveedores, ni de
  sucursales. Todo es texto JSON.
- **Autenticación por un token compartido** en una constante del PHP.

Esto importa por dos motivos. Primero: **no había forma de consultar nada** —
para saber cuánto se vendió de un producto hay que traer el JSON completo y
recorrerlo en el navegador. Segundo: cualquier dato que dos personas editaran
a la vez se pisaba, porque se guarda la clave entera.

---

## Comparación módulo por módulo

Leyenda: ✅ está · ⚠️ parcial · ❌ falta · ⭐ solo en AdminApp

### Calculadora de precios

| Función del legacy | Estado |
|---|---|
| Costo → precio con margen | ✅ |
| Recargo por tarjeta y descuento de alianza | ✅ *(y corregido: el legacy confundía margen sobre venta con recargo sobre costo)* |
| Precio manual que anula el margen | ✅ `price_override` |
| Punto de equilibrio a partir de gastos fijos | ✅ en el Panel |
| **Seleccionar N productos y aplicarles un % de una vez** | ❌ |
| **Tarjetas de recomendación de precio por rango** | ❌ |
| **Deshacer la última actualización masiva** (`actUndo`, con historial) | ❌ |

> El legacy guardaba una foto antes de cada actualización masiva y permitía
> volver atrás. Es la función que más se va a extrañar: sin ella, un error de
> tipeo en un margen aplicado a 300 productos no tiene vuelta atrás.

### Inventario

| Función del legacy | Estado |
|---|---|
| Alta, edición y baja de productos y marcas | ✅ |
| Costo, stock y stock mínimo | ✅ |
| Stock por sucursal | ✅ |
| Importar desde Excel / CSV | ✅ y mejor: asistente con mapeo de columnas |
| **Importar desde PDF** | ❌ |
| **Importar pegando texto** | ❌ |
| Exportar a Excel | ✅ desde Reportes |
| **Exportar a PDF** | ❌ |
| Alertas de stock bajo | ✅ en el Panel |
| **Comparar dos sucursales lado a lado** | ❌ *(hay stock por sucursal, no la vista comparativa)* |
| Historial de cambios | ⚠️ el historial de **costos** se guarda, pero no hay pantalla |
| Edición rápida en la tabla | ⚠️ se edita por formulario |
| **Transferir stock entre sucursales** | ⚠️ ⭐ existe en la API, falta la pantalla |

### Facturación / punto de venta

| Función del legacy | Estado |
|---|---|
| Carrito, búsqueda, cantidades | ✅ |
| Método de pago por ítem y pago mixto | ✅ |
| Precio según medio de pago | ✅ |
| **Precio manual por ítem en el carrito** | ❌ |
| **Cálculo de vuelto** | ❌ |
| Registrar venta y descontar stock | ✅ y mejor: transaccional, el total se calcula en el servidor |
| Historial de ventas | ✅ |
| Imprimir comprobante y ticket | ✅ y mejor: con QR de AFIP (RG 4892/2020) |
| **Editar una venta ya registrada** | ⚠️ se anula y se rehace |
| Anular venta | ✅ y mejor: queda el registro, se devuelve el stock |
| **Factura electrónica con CAE de AFIP** | ⭐ **solo AdminApp** |

> El comprobante del legacy decía "Consumidor final" y no tenía CAE: no era una
> factura ante ARCA. Este es el motivo más fuerte para migrar.

### Pedidos y proveedores

| Función del legacy | Estado |
|---|---|
| Armar pedido buscando productos | ✅ Órdenes de compra |
| Recibir pedido y actualizar stock | ⭐ solo AdminApp |
| **Faltantes automáticos → armar el pedido** | ⚠️ hay alerta de stock bajo, no el flujo |
| **Exportar el pedido por WhatsApp, con o sin precios** | ❌ |
| **Exportar el pedido a Excel / PDF** | ❌ |
| **Comparador de proveedores** (subir varias listas, emparejar por nombre, mostrar el mejor precio) | ❌ **no existe nada equivalente** |
| Cuenta corriente: deudas, pagos, movimientos | ✅ |
| Facturas del proveedor con enlace a Drive | ⚠️ la API guarda documentos; falta la pantalla |
| **Foto del pedido** | ❌ |
| **Exportar el asiento contable del proveedor** | ❌ |

> El comparador de proveedores es la función más elaborada del sistema viejo:
> normaliza nombres, calcula similitud entre descripciones y arma una tabla de
> quién tiene cada producto más barato. Reconstruirlo es trabajo nuevo, no
> migración.

### Gastos

| Función del legacy | Estado |
|---|---|
| Gastos fijos mensuales | ✅ |
| **Gastos variables por persona y por mes** | ❌ |

### Usuarios

| Función del legacy | Estado |
|---|---|
| Ingreso con usuario y contraseña | ✅ y mejor: Auth0 |
| Permisos por acción | ✅ y mejor: roles + permisos por usuario |
| **Ver y cerrar sesiones activas** | ❌ |
| Varias empresas por usuario | ⭐ solo AdminApp |

---

## Lo que AdminApp agrega

Nada de esto existía en Comprafit:

- **Facturación electrónica AFIP** con CAE, QR, tipos A/B/C y numeración por
  punto de venta.
- **Clientes con cuenta corriente**: deuda, pagos, antigüedad de saldos,
  ventas a crédito.
- **Recetas y producción**: costeo de productos elaborados, órdenes de
  producción, descuento de insumos.
- **Caja**: ingresos, egresos, saldo y arqueo.
- **Impuestos**: configuración impositiva, cálculo de monotributo, pagos.
- **Reportes** de ventas, rentabilidad e inventario, con exportación.
- **Panel con indicadores** y punto de equilibrio.
- **Integración con TiendaNube.**
- **Multi-empresa** con aislamiento de datos.
- **327 tests automatizados**, integración continua y respaldos. El sistema
  viejo tenía cero.

---

## Lo que falta para migrar sin pérdida

En orden de cuánto se usa, no de dificultad:

| # | Qué | Por qué importa | Tamaño |
|---|---|---|---|
| 1 | **Exportar pedido por WhatsApp** | Es cómo Comprafit le pide a los proveedores. Sin esto hay que copiar a mano. | chico |
| 2 | **Faltantes → pedido en un paso** | Rutina semanal de reposición. | chico |
| 3 | **Actualización masiva de precios con deshacer** | Sin el deshacer, un error masivo no tiene vuelta atrás. | mediano |
| 4 | **Comparador de proveedores** | Es cómo se decide a quién comprarle. | grande |
| 5 | **Vuelto y precio manual en el carrito** | Fricción en cada venta en efectivo. | chico |
| 6 | **Gastos variables por persona y mes** | Se usa todos los meses. | chico |

Los cinco primeros suman aproximadamente el trabajo de una a dos semanas; el
comparador de proveedores es la mitad de eso él solo.

---

## Migrar los datos

Existe `scripts/migrar-legacy.js`. Trae marcas, productos, stock por sucursal,
gastos fijos, ventas con sus ítems y proveedores con movimientos, pedidos y
documentos.

```
npm --prefix apps/api run migrar:legacy -- --empresa=<id>              # simula
npm --prefix apps/api run migrar:legacy -- --empresa=<id> --confirmar  # aplica
```

Tres advertencias:

1. **Para traer los datos de hoy** hacen falta `PHP_API_URL` y `PHP_API_TOKEN`.
   Sin eso el script lee el HTML del repositorio, que tiene los datos
   **semilla** (55 productos, 392 filas de stock) — no los actuales.
2. **El token del hosting hay que rotarlo primero**: está en el historial de
   git. Ver [OPERACION.md](OPERACION.md#rotar-las-credenciales-del-hosting-legacy).
3. **Los permisos no se migran.** El modelo cambió por completo; se cargan de
   nuevo desde Equipo. Son pocos usuarios.

> El script anterior (`src/migrate.js`) **empezaba borrando todas las tablas**
> con `sync({ force: true })`, y `npm run migrate` lo ejecutaba. Se eliminó.

---

## Recomendación

**No presentarlo todavía como reemplazo total.** Dos caminos, en este orden:

**1. Migrar la facturación primero (ya).** Es donde AdminApp gana sin discusión
y donde el legacy directamente no llega: el cliente hoy no puede emitir una
factura válida ante ARCA. Se puede empezar a facturar con AdminApp mientras
sigue usando el sistema viejo para pedidos y comparación de proveedores.

**2. Migrar el resto cuando estén las seis funciones de la tabla.** Las cinco
chicas primero — con eso el día a día ya no pierde nada — y el comparador de
proveedores al final.

Lo que **no** conviene es prometer un reemplazo completo hoy: el cliente lo va
a descubrir el primer lunes que tenga que armar el pedido, y esa impresión no
se recupera.
