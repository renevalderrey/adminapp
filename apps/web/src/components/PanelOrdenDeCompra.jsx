// ════════════════════════════════════════════
//  ADMINAPP · El panel lateral de una orden de compra
//
//  ⚠ VACÍO A PROPÓSITO. Lo llenan T1236 (modo detalle) y T1237 (modo
//  recepción).
//
//  Existe desde este commit —devolviendo `null`— para entrar a la lista de
//  `tests/guardiasDeDiseno.test.js` ANTES de tener una línea de dibujo. Así
//  cada hex, cada `dark:` y cada clase de la paleta falla en el momento en que
//  se escribe, y no treinta juntos al final, cuando ya nadie sabe cuál vino de
//  dónde y la salida barata es comentar la guardia.
//
//  Va a ser: un `ui/sheet.jsx` de 520px con dos modos. En **detalle**, el
//  seguimiento de la orden, la tabla de ítems con `recibido / pedido` en una
//  sola celda, el total y el pie con anular, las dos de WhatsApp y registrar
//  recepción. En **recepción**, el formulario de cantidades recibidas.
//
//  ⚠ La recepción es UN SOLO componente para las dos pantallas (FR-034). Dos
//  implementaciones es exactamente lo que dejó a una de ellas rota: hoy
//  `Orders.jsx` y `PurchaseOrders.jsx` indexan las cantidades por
//  `product_id`, así que una orden con dos líneas del mismo producto tiene un
//  solo campo y dos `key` de React repetidos.
//
//  ⚠ Recibe todo por props y NO lee el estado global por su cuenta, igual que
//  los tres componentes de `components/pos/` y por el mismo motivo: dos dueños
//  del mismo dato terminan dibujando una línea y recibiendo otra.
// ════════════════════════════════════════════

export default function PanelOrdenDeCompra() {
  return null
}
