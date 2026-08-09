import Pagination from '@/components/Pagination'

// ════════════════════════════════════════════
//  FAVALIO · «Mostrando 25 de 312 productos», y las páginas
//
//  ── Por qué las dos cosas van juntas ──
//
//  Porque son la misma pregunta. Los botones «1 · 2 · 3» dicen que hay más
//  páginas; el «de 312» dice cuánto más. Separados, cinco pantallas terminaron
//  con los botones y solo dos con la franja: quien veía «1 · 2 · 3» sabía que
//  faltaba algo pero no cuánto, y quien estaba en la última página no tenía
//  forma de saber si había llegado al final o si la lista se había cortado.
//
//  ⚠ Es **lo único de la lista que agrega información**. Los dos números ya
//  existían en la pantalla —el total está en el badge del encabezado, y las
//  filas se pueden contar—, pero puestos uno al lado del otro contestan de un
//  vistazo la pregunta que se hace cualquiera que mira una tabla larga: «¿esto
//  es todo?».
//
//  ── Y por qué la franja aparece SIEMPRE que hay paginación ──
//
//  A diferencia del aviso de truncado —ese sí aparece solo cuando la lista está
//  cortada, porque un «Mostrando 12 de 12» permanente al lado de doce filas es
//  ruido—, acá la franja convive con los botones de página. Con una sola página
//  la paginación no se dibuja y la franja tampoco tiene sentido: por eso quien
//  la usa la pone dentro de la rama que ya dibuja la tabla.
// ════════════════════════════════════════════

/**
 * @param {object} props
 * @param {number} props.mostrados Cuántas filas se están viendo.
 * @param {number} props.total Cuántas hay en total, según el servidor.
 * @param {string} props.sustantivo Qué se está listando, en plural: «ventas».
 * @param {number} props.pagina
 * @param {number} props.totalPaginas
 * @param {(n: number) => void} props.alCambiarPagina
 */
export default function PieDeTabla({
  mostrados,
  total,
  sustantivo,
  pagina,
  totalPaginas,
  alCambiarPagina,
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-2 text-[12.5px] text-fg-2">
      <span>
        Mostrando <span className="num">{mostrados}</span> de{' '}
        <span className="num">{total}</span> {sustantivo}
      </span>
      <Pagination page={pagina} totalPages={totalPaginas} onPageChange={alCambiarPagina} />
    </div>
  )
}
