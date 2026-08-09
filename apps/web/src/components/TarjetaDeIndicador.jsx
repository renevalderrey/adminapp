import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { alturasDelSparkline } from '@/utils/panel'

// ════════════════════════════════════════════
//  FAVALIO · Una tarjeta de indicador del Panel
//
//  Etiqueta, número grande, variación, sparkline de doce barras y **la nota al
//  pie con la definición del número**.
//
//  ── La nota al pie no es decoración: es la mitad de esta tarjeta ──
//
//  El corte 2 de la 014 cambió cinco números que el dueño mira todos los días:
//  «Por Pagar» bajó porque hasta entonces nunca restaba los pagos, «Por Cobrar»
//  bajó porque contaba las ventas de contado, «stock bajo» subió porque pasó a
//  contar los productos en cero sin mínimo cargado. La tabla de `OPERACION.md`
//  la lee alguien **una vez**; la nota al pie la lee **todos los días el que
//  mira el número**. Un número que el dueño puede explicar no se lee como un bug
//  la próxima vez (decisión 7 del usuario).
//
//  Por eso `nota` es obligatoria en la práctica: una tarjeta sin definición es
//  la que produjo la pregunta «¿qué le pasó al sistema?».
//
//  ── Sin serie NO se dibuja sparkline ──
//
//  FR-068. Doce barras en cero para un negocio de cinco meses dibujan una caída
//  que nunca pasó, y la maqueta lo hace todavía peor: las genera con `Math.sin`
//  (`:1166`). Una línea inventada en una tarjeta de plata es la familia de error
//  que abre `CONVENCIONES.md`. Cuando el servidor no manda la clave, acá no hay
//  hueco: la tarjeta se dibuja más baja y ya está.
//
//  ── Qué NO decide esta tarjeta ──
//
//  **No decide si se dibuja.** Un bloque que el servidor no mandó por permisos
//  no llega hasta acá: la pantalla no lo pinta y dice por qué en un solo lugar
//  (FR-050). Acá adentro no hay ningún `?? 0` justamente para que no exista la
//  forma de que un dato ausente se dibuje como cero.
//
//  Reglas de dibujo: docs/REGLAS-DISENO.md. Referencia viva: pages/Comparador.jsx.
// ════════════════════════════════════════════

/**
 * Cuánto se destaca cada barra.
 *
 * Las últimas son las que importan —el mes en curso y los anteriores— así que la
 * opacidad sube hacia la derecha. Sin eso, doce barras del mismo tono se leen
 * como un patrón decorativo y no como una línea de tiempo.
 */
function opacidadDeLaBarra(indice, total) {
  return 0.35 + (0.65 * (indice + 1)) / total
}

/**
 * El sparkline: doce `div`s de altura porcentual. **Sin librería de gráficos**
 * (FR-069): una dependencia nueva en el bundle por doce rectángulos es cara y no
 * se saca después.
 *
 * ⚠ `min-w-0` en el contenedor y `flex-1` en cada barra: es lo que impide que
 * doce barras con ancho mínimo empujen la tarjeta a lo ancho. Que de verdad no
 * desborde es geometría y se verifica en el navegador —jsdom devuelve cero en
 * `scrollWidth` y `clientWidth`—, en `maquetadoDelPanel.navegador.js`.
 */
function Sparkline({ serie }) {
  const alturas = alturasDelSparkline(serie)

  if (!alturas.length) return null

  return (
    <div
      data-sparkline="true"
      aria-hidden="true"
      className="flex h-7 min-w-0 items-end gap-[3px]"
    >
      {alturas.map((altura, i) => (
        <div
          key={i}
          data-barra="true"
          className="min-w-0 flex-1 rounded-[2px] bg-brand"
          style={{ height: `${altura}%`, opacity: opacidadDeLaBarra(i, alturas.length) }}
        />
      ))}
    </div>
  )
}

/**
 * @param {object} props
 * @param {string} props.etiqueta   «Ventas del mes», «Saldo de caja»…
 * @param {string} props.valor      Ya formateado: acá no se formatea plata, sale
 *   de `utils/formato.js` (FR-010).
 * @param {string} props.nota       La DEFINICIÓN del número. Ver el encabezado.
 * @param {number[]} [props.serie]  Doce puntos, o nada. Nada = sin sparkline.
 * @param {number|null} [props.variacion] Porcentaje contra el período anterior.
 *   `null` es «no se puede comparar», que NO es «no cambió».
 * @param {string} [props.notaDeVariacion] Por qué la comparación puede engañar
 *   —un mes en curso contra uno completo—, cuando corresponde.
 */
export default function TarjetaDeIndicador({
  etiqueta,
  valor,
  nota,
  serie,
  variacion = null,
  notaDeVariacion,
}) {
  // ⚠ `Number.isFinite(Number(variacion))` NO sirve: `Number(null)` es `0`, que
  // es finito, así que «no se puede comparar» se dibujaría como «+0.0 %» —o sea
  // «el negocio quedó igual»—. Es el mismo defecto que esta pantalla vino a
  // cerrar, en chico: un dato ausente leído como un cero.
  const hayVariacion = typeof variacion === 'number' && Number.isFinite(variacion)
  const sube = Number(variacion) >= 0
  const Flecha = sube ? ArrowUpRight : ArrowDownRight

  return (
    <div
      data-indicador={etiqueta}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface
                 px-[18px] pb-4 pt-[18px] shadow-nivel-1"
    >
      <span className="text-[11.5px] font-semibold text-fg-2">{etiqueta}</span>

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="num text-[26px] font-semibold leading-none">{valor}</span>

        {hayVariacion && (
          <span
            className={`inline-flex items-center gap-[3px] text-[12px] font-semibold ${
              sube ? 'text-ok' : 'text-danger'
            }`}
            title={notaDeVariacion || undefined}
          >
            <Flecha className="h-3 w-3" />
            {`${sube ? '+' : ''}${Number(variacion).toFixed(1)}%`}
          </span>
        )}
      </div>

      <Sparkline serie={serie} />

      {/* La definición del número. Ver el encabezado: es la parte durable. */}
      <span className="text-[11.5px] leading-snug text-fg-3">{nota}</span>
    </div>
  )
}
