# Maquetas

Dos archivos de Claude Design, guardados acá como referencia.

**No se ejecutan ni se importan.** Son archivos `.dc.html` con plantillas
`x-dc` que no renderizan fuera de Claude Design: dependen de un `support.js`
que no está en el repositorio, y las imágenes que citan tampoco. Se leen.

| Archivo | Proyecto | Qué cubre |
|---|---|---|
| `Favalio-Rediseno.dc.html` | `da78da8f-639e-4489-8c2f-4f0bf0bb2f58` | El rediseño del panel: las pantallas que ya existen |
| `Catalogo-de-ventas-online.dc.html` | `124b38ce-7088-4f46-a3f1-6ee8900d3d7c` | El módulo de venta online: la tienda pública y su panel |

---

## `Favalio-Rediseno.dc.html` · qué pantallas dibuja

| Pantalla | Dónde mirar |
|---|---|
| Panel de control | bloque `isPanel` |
| Punto de venta | el `<aside>` de 400px con el ticket |
| Historial de ventas | la tabla en grid — **es la más completa** |
| Inventario | bloque `isInv` |
| Órdenes de compra | |
| Configuración | «Puesta en marcha» y «Datos de facturación» |
| Panel lateral de detalle | el `<aside>` fijo de 520px |

Lo que ya se extrajo de acá —tokens, tipografía, medidas, patrones— está en
[REGLAS-DISENO.md](../REGLAS-DISENO.md), que es lo que hay que leer primero.
La maqueta sirve para lo que ese documento no alcanza a describir: el detalle
de una pantalla concreta.

---

## `Catalogo-de-ventas-online.dc.html` · qué pantallas dibuja

Son **dos superficies con reglas distintas**, y el archivo las separa en dos
secciones. Las decisiones de producto que las originaron están en
[PLAN-CATALOGO-PUBLICO.md](../PLAN-CATALOGO-PUBLICO.md).

**A · La tienda pública** (`<section id="tienda">`) — 390 px, tema del
comercio, un solo color configurable (`--marca`, con `--marca-texto` calculado
por contraste en `textoSobre()`).

| Pantalla | Dónde mirar |
|---|---|
| Catálogo, ficha, carrito | `esCatalogo` · `esProducto` · `esCarrito` |
| Checkout en tres pasos | `esDatos` · `esEntrega` · `esPago`, con la barra de progreso en `estiloPaso1..3` |
| Pedido confirmado | `esConfirmado` |
| Los seis estados que casi nadie diseña | el bloque final de tarjetas de 330 px: cargando, pausado, sin resultados, carrito vacío, pago rechazado y **se agotó mientras compraba** |

**B · El panel** (`<section id="panel">`) — 1560×940, dentro del shell de
Favalio, con los tokens del sistema y modo claro y oscuro.

| Pantalla | Dónde mirar |
|---|---|
| Lista de catálogos | `esCatalogos`, tabla `CATALOGOS` |
| Detalle · Identidad | `tabIdentidad` — incluye la previsualización en vivo del color |
| Detalle · Entrega y pago | `tabEntrega` |
| Detalle · **Reglas de precio** | `tabReglas` — la sangría y la columna «Gana en» son la explicación de que gana la más específica y no se acumulan |
| Detalle · Productos | `tabProductos` |
| Detalle · QR y enlace | `tabQr` |
| Bandeja de pedidos | `esPedidos`, con panel lateral (`hayPedido`) y la confirmación de «Marcar cobrado» (`hayConfirmacion`) |

Tres cosas del archivo que son decisiones, no adorno:

- **El color de marca aparece solo en lo que se toca.** Nunca como fondo de una
  zona grande. Por eso la tienda se ve igual de sobria con turquesa que con
  negro, y por eso el archivo trae los cuatro colores de prueba arriba.
- **La confirmación de «Marcar cobrado» dice qué toca**: descuenta stock y
  registra la venta. El texto es parte del diseño, no un `confirm()` genérico.
- **El pie dice «powered by favalio»** en todas las pantallas de la tienda.
