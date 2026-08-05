// ════════════════════════════════════════════
//  ADMINAPP · Los documentos de un proveedor
//
//  ⚠ VACÍO A PROPÓSITO. Lo llena T1243.
//
//  Existe desde este commit —devolviendo `null`— para entrar a la lista de
//  `tests/guardiasDeDiseno.test.js` ANTES de tener una línea de dibujo, por el
//  mismo motivo que `PanelOrdenDeCompra.jsx`: un color fuera del sistema tiene
//  que fallar cuando se escribe, no en una auditoría de treinta al final.
//
//  Va a ser: nombre, tipo, fecha y enlace de cada documento, el alta con los
//  cuatro tipos del modelo, copiar el enlace y eliminar, y el aviso de «sin
//  factura».
//
//  ⚠ AdminApp NO sube ningún archivo: guarda el enlace (FR-081). Un enlace sin
//  `http` se rechaza ANTES de mandar la llamada —con `esEnlaceAceptable`— para
//  que el error no dependa de que el servidor lo devuelva, y los enlaces abren
//  en pestaña nueva con `rel="noopener noreferrer"` porque los escribió una
//  persona y apuntan afuera del sistema.
//
//  ⚠ Recibe todo por props y NO lee el estado global por su cuenta, igual que
//  `PanelOrdenDeCompra` y los tres de `components/pos/`.
// ════════════════════════════════════════════

export default function BloqueDeDocumentos() {
  return null
}
