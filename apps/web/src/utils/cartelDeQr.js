// ════════════════════════════════════════════
//  FAVALIO · El cartel A4 que se pega en la pared
//
//  Es lo que el comercio imprime y pega en la recepción del gimnasio. **No es
//  el QR solo**: lleva el logo, el nombre del catálogo y la leyenda «escaneá con
//  la cámara» (maqueta `:1042`). Imprimir el QR pelado, sin decir de qué es,
//  es un cartel que nadie escanea — el cuadrado negro no invita a nada.
//
//  ── Por qué es HTML y `window.print()`, y no un PDF ──
//
//  «Guardar como PDF» ya está en el diálogo de impresión de todos los
//  navegadores. Componer un PDF del lado del servidor es un proyecto propio
//  —una biblioteca, un endpoint, fuentes embebidas, un segundo motor de
//  maquetado que mantener— para producir exactamente la misma hoja. Es la misma
//  decisión que ya había tomado `utils/impresionInventario.js`.
//
//  ── Por qué este archivo SÍ puede tener hexadecimales ──
//
//  Por lo mismo que `utils/impresionInventario.js`, y por eso vive acá y **fuera**
//  de la lista de `src/tests/guardiasDeDiseno.test.js`: los tokens de `index.css`
//  son colores de **pantalla**, resueltos con variables CSS que la ventana de
//  impresión —un documento nuevo, sin la hoja de estilos de la aplicación— no
//  tiene. La hoja imprime sobre papel blanco, que no es el modo claro ni el
//  oscuro.
//
//  La alternativa que NO se tomó: escribir los mismos colores como `rgb(16,20,24)`
//  dentro del componente para que la guardia no los vea. Eso es un color fuera
//  del sistema escrito de otra forma, que es exactamente lo que la guardia
//  existe para encontrar.
//
//  ⚠ Los atributos del HTML van con comillas **simples** a propósito: la guardia
//  de comillas angulares de `guardiasDeSrc.test.js` busca el patrón `"${…}"` —un
//  valor rodeado de comillas rectas dentro de una plantilla— porque en un texto
//  que lee una persona las comillas van « ». Acá son sintaxis de HTML, y usar
//  las simples evita tener que agregar este archivo a la lista de excepciones de
//  esa guardia.
// ════════════════════════════════════════════

/**
 * Escapa lo que va adentro del HTML.
 *
 * Un catálogo llamado «Pack 2<3» rompe la página, y uno con `<script>` en el
 * nombre hace algo peor: el nombre visible lo escribe el comercio en un
 * formulario y termina acá adentro sin pasar por React.
 */
function escapar(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * La hoja A4 entera, lista para escribir en una ventana de impresión.
 *
 * @param {object} datos
 * @param {string} datos.nombre       El nombre visible del catálogo.
 * @param {string} datos.descripcion  Una línea, opcional.
 * @param {string} datos.direccion    La dirección legible, sin `?f=qr`: es la
 *   que alguien puede tipear si no le anda la cámara.
 * @param {string} datos.qr           El QR ya generado, como `data:` URI.
 * @param {string|null} datos.logo    El logo del catálogo, opcional.
 */
export function armarCartel({ nombre, descripcion, direccion, qr, logo }) {
  const conLogo = logo
    ? `<img class='logo' src='${escapar(logo)}' alt=''>`
    : ''

  const conDescripcion = descripcion
    ? `<p class='bajada'>${escapar(descripcion)}</p>`
    : ''

  return `<!DOCTYPE html>
<html lang='es'>
<head>
<meta charset='utf-8'>
<title>${escapar(nombre)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: Inter, -apple-system, 'Segoe UI', sans-serif;
    color: #101418;
    background: #FFFFFF;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .hoja {
    width: 210mm; height: 297mm;
    padding: 26mm 20mm;
    display: flex; flex-direction: column; align-items: center; text-align: center;
  }
  .logo { max-height: 26mm; max-width: 70mm; object-fit: contain; margin-bottom: 8mm; }
  h1 { margin: 0; font-size: 34pt; font-weight: 700; letter-spacing: -0.02em; line-height: 1.1; }
  .bajada { margin: 5mm 0 0; font-size: 13pt; color: #5A646E; max-width: 130mm; }
  .qr { margin: 14mm 0 0; padding: 6mm; border: 1px solid #E5E8EA; border-radius: 6mm; }
  .qr img { display: block; width: 90mm; height: 90mm; }
  .leyenda { margin: 10mm 0 0; font-size: 20pt; font-weight: 600; }
  .direccion {
    margin: 6mm 0 0; font-family: 'JetBrains Mono', monospace; font-size: 12pt; color: #5A646E;
    word-break: break-all; max-width: 150mm;
  }
  .pie { margin-top: auto; font-size: 9pt; color: #8B959E; }
</style>
</head>
<body>
  <div class='hoja'>
    ${conLogo}
    <h1>${escapar(nombre)}</h1>
    ${conDescripcion}
    <div class='qr'><img src='${escapar(qr)}' alt=''></div>
    <p class='leyenda'>Escaneá con la cámara</p>
    <p class='direccion'>${escapar(direccion)}</p>
    <p class='pie'>Comprá desde el teléfono y retirá o recibí el pedido.</p>
  </div>
</body>
</html>`
}

/**
 * Abre la ventana, escribe la hoja y manda a imprimir.
 *
 * Devuelve `false` cuando no hay ventana: sin esto, un bloqueador de pop-ups
 * dejaría la pantalla como si el botón no hiciera nada. La pantalla lo dice.
 */
export function imprimirCartel(datos) {
  if (typeof window === 'undefined' || typeof window.open !== 'function') return false

  const ventana = window.open('', '_blank')
  if (!ventana) return false

  ventana.document.write(armarCartel(datos))
  ventana.document.close()
  // `focus()` antes de `print()`: en varios navegadores el diálogo sale detrás
  // de la ventana principal y parece que no pasó nada.
  ventana.focus()
  ventana.print()

  return true
}
