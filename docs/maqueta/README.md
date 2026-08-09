# Maqueta del rediseño

`Favalio-Rediseno.dc.html` es la maqueta original de Claude Design
(proyecto `da78da8f-639e-4489-8c2f-4f0bf0bb2f58`), guardada acá como
referencia para las pasadas de diseño que quedan.

**No se ejecuta ni se importa.** Es un archivo `.dc.html` con plantillas
`x-dc` que no renderiza fuera de Claude Design. Se lee.

## Qué pantallas dibuja

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
