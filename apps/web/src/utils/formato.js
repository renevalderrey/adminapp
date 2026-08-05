// ════════════════════════════════════════════
//  ADMINAPP · Cómo se escribe un importe y cómo se escribe una fecha
//
//  Las dos funciones estaban adentro de `components/PanelVenta.jsx` y son las
//  dos versiones correctas que había en el repositorio. Se sacan acá porque
//  FR-052 pide «reutilizando `fechaCorta`», y hasta hoy reutilizarla
//  significaba copiarla — que es exactamente cómo se llegó a tener siete
//  funciones llamadas `pesos` escritas por separado (`Comparador.jsx:29`,
//  `HistorialDeCostos.jsx:30`, `Inventory.jsx:87`, `InvoicesList.jsx:77`,
//  `PanelProducto.jsx:72`, `PanelVenta.jsx:36` e `impresionInventario.js:40`),
//  más otras escritas como `formatCurrency` en las pantallas viejas.
//
//  Esta tarea muda **solo** la de `PanelVenta.jsx`. Las demás se van sumando a
//  medida que cada pantalla se rediseña; decirlo acá es lo que evita que la
//  próxima vuelva a escribir la suya «porque total es una línea».
//
//  ── Por qué `maximumFractionDigits` NO es redundante ──
//
//  Es la mitad que se olvida, y se olvidó: `PurchaseOrders.jsx:156`,
//  `Reports.jsx:85` y `Dashboard.jsx:82` fijan `minimumFractionDigits: 2` y no
//  el máximo. El máximo por defecto es 3, así que `1234.567` sale
//  «1.234,567»: en la misma columna de pesos conviven dos decimales y tres,
//  según qué decimales traiga el dato. Nada falla, la pantalla abre, y los
//  números no se pueden comparar de un vistazo — que es para lo que están
//  alineados a la derecha y en `.num`.
//
//  La spec da por correcto el formateo de `PurchaseOrders.jsx` y **no lo es**
//  (hallazgo 7 del plan). Los dos extremos se fijan juntos o la cantidad de
//  decimales la termina decidiendo el dato.
//
//  ── Por qué `fechaCorta` no pasa por `new Date()` ──
//
//  Un `DATEONLY` viaja como «2026-08-01», y `new Date('2026-08-01')` lo lee
//  como medianoche **UTC**: en Argentina (UTC−3) eso es el 31 de julio a las
//  21, así que el movimiento del primero de agosto se muestra en julio y se
//  lee en el mes equivocado del estado de cuenta. El string se parte a mano,
//  sin pasar por `Date`, y así no hay zona horaria que opine.
// ════════════════════════════════════════════

/**
 * Un importe en pesos argentinos, SIN el signo: `1234` → «1.234,00».
 *
 * El `$` lo pone quien la usa, porque en varias pantallas va en otro elemento
 * —con otro tamaño o en otro tono— que el número.
 *
 * `n || 0` cubre `null`, `undefined`, `''` y `NaN`: los cuatro tienen que dar
 * «0,00». Un `NaN` dibujado en una columna de plata parece un error de carga y
 * manda a revisar los datos cuando el dato es que no hay nada.
 */
export function pesos(n) {
  return Number(n || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * «2026-08-01» → «01/08/2026», sin pasar por `Date` (ver el encabezado).
 *
 * Lo que no tiene forma de fecha se devuelve tal cual en vez de convertirse en
 * «Invalid Date»: si la API cambia el formato, se quiere ver qué mandó, no una
 * cadena que no dice nada.
 */
export function fechaCorta(iso) {
  const t = String(iso || '')
  if (!/^\d{4}-\d{2}-\d{2}/.test(t)) return t || '—'
  const [a, m, d] = t.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}
