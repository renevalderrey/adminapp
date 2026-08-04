// ════════════════════════════════════════════
//  ADMINAPP · Punto de venta, la columna izquierda
//
//  ⚠ VACÍO A PROPÓSITO. Lo llena T1120.
//
//  Va a ser: la barra de búsqueda fija arriba con sus filtros —chips de
//  categoría y el conmutador «Solo con stock»—, y debajo la lista con su propio
//  scroll. El encabezado de columna y cada fila comparten el MISMO string de
//  `grid-template-columns`: si difieren, se lee un precio bajo la etiqueta
//  equivocada.
//
//  ⚠ Recibe todo por props y NO lee el estado global por su cuenta. La pantalla
//  tiene un solo dueño del estado, y el primero que agregue una lectura acá
//  crea una segunda fuente para el mismo dato. No es una convención escrita al
//  aire: hay una guardia estática en `tests/guardiasDeDiseno.test.js` que falla
//  si este archivo la rompe.
//
//  El corte en tres componentes es por TAMAÑO y no por arquitectura: se parten
//  por zona de la pantalla, no por responsabilidad abstracta.
// ════════════════════════════════════════════

export default function CatalogoDelPos() {
  return null
}
