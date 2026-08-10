import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import QRCode from 'qrcode'
import { Copy, Download, Loader2, Printer, TriangleAlert } from 'lucide-react'
import { imprimirCartel } from '@/utils/cartelDeQr'
import { urlDelCatalogo, urlDelQr, llevaAlgunLado } from '@/utils/catalogos'

// ════════════════════════════════════════════
//  FAVALIO · El QR y el enlace del catálogo
//
//  ── El QR se genera en el navegador ──
//
//  Con `qrcode`, que **ya está instalado** y ya se usa para el QR fiscal de los
//  comprobantes (`utils/printInvoice.js`). Cero dependencias nuevas y cero
//  endpoint: un `GET /catalogos/:id/qr.png` sería un handler, una ruta, un
//  formato de imagen y un caché para producir exactamente el mismo cuadrado que
//  el navegador dibuja sin pedirle nada a nadie.
//
//  ── El parámetro de origen ──
//
//  La URL del QR lleva `?f=qr`. El enlace que se copia y se pega en WhatsApp,
//  no. Es lo único que después permite separar las visitas que llegaron por el
//  cartel de la pared de las que llegaron por un mensaje; sin él, la pestaña de
//  métricas mostraría el total de visitas del catálogo y lo llamaría «escaneos».
//
//  ── El catálogo en borrador ──
//
//  El QR **está igual** —hay que poder prepararlo antes de publicar— pero la
//  pantalla dice que todavía no lleva a ningún lado. Un cartel impreso de un
//  catálogo sin publicar es un cartel que manda a un 404, y eso se descubre con
//  el primer socio que lo escanea y no vuelve a intentar.
//
//  📌 La pestaña de métricas del QR —visitas, pedidos y conversión (`:1044-1048`)—
//  no está: la conversión necesita pedidos, que son de la etapa 2. Dibujar los
//  tres números hoy sería dibujar tres ceros inventados.
// ════════════════════════════════════════════

const BOTON_SECUNDARIO =
  'inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-border bg-surface '
  + 'px-3 text-[13px] font-medium transition-colors hover:bg-surface-3 '
  + 'disabled:cursor-not-allowed disabled:opacity-55'

/** Ancho del PNG que se descarga. 1024 aguanta un cartel A4 sin pixelarse. */
const ANCHO_DEL_PNG = 1024

export default function QrDelCatalogo({ catalogo }) {
  const [vistaPrevia, setVistaPrevia] = useState(null)
  const [generando, setGenerando] = useState(true)

  const enlace = urlDelCatalogo(catalogo.slug)
  const enlaceDelQr = urlDelQr(catalogo.slug)
  const publicado = llevaAlgunLado(catalogo.estado)

  useEffect(() => {
    let vivo = true
    setGenerando(true)

    QRCode.toDataURL(enlaceDelQr, { margin: 1, width: 320 })
      .then((dataUrl) => { if (vivo) { setVistaPrevia(dataUrl); setGenerando(false) } })
      .catch(() => { if (vivo) { setVistaPrevia(null); setGenerando(false) } })

    return () => { vivo = false }
  }, [enlaceDelQr])

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(enlace)
      toast.success('Enlace copiado.')
    } catch {
      // Sin portapapeles —contexto no seguro, permiso denegado— el enlace sigue
      // a la vista y se puede seleccionar: lo que no puede pasar es que el botón
      // no haga nada y no diga nada.
      toast.error('No se pudo copiar. El enlace está a la vista y se puede seleccionar.')
    }
  }

  /** Baja un `data:` URI con el nombre que corresponde. */
  const bajar = (dataUrl, extension) => {
    const enlaceTemporal = document.createElement('a')
    enlaceTemporal.href = dataUrl
    enlaceTemporal.download = `qr-${catalogo.slug}.${extension}`
    enlaceTemporal.click()
  }

  const descargarPng = async () => {
    try {
      bajar(await QRCode.toDataURL(enlaceDelQr, { margin: 1, width: ANCHO_DEL_PNG }), 'png')
    } catch {
      toast.error('No se pudo generar el QR.')
    }
  }

  const descargarSvg = async () => {
    try {
      const svg = await QRCode.toString(enlaceDelQr, { type: 'svg', margin: 1 })
      // `data:` y no un `Blob`: no hay `URL.revokeObjectURL` que alguien se
      // pueda olvidar de llamar, y el archivo no depende de que la pestaña siga
      // abierta.
      bajar(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, 'svg')
    } catch {
      toast.error('No se pudo generar el QR.')
    }
  }

  const imprimir = async () => {
    try {
      const qr = await QRCode.toDataURL(enlaceDelQr, { margin: 1, width: ANCHO_DEL_PNG })

      const salio = imprimirCartel({
        nombre: catalogo.nombre_visible,
        descripcion: catalogo.descripcion,
        direccion: enlace,
        qr,
        logo: catalogo.logo_url,
      })

      if (!salio) toast.error('El navegador bloqueó la ventana de impresión. Permitila y probá de nuevo.')
    } catch {
      toast.error('No se pudo armar el cartel.')
    }
  }

  return (
    <section className="flex flex-wrap items-start gap-6 rounded-xl border border-border bg-surface p-5 shadow-nivel-1">

      <div className="w-[236px] shrink-0">
        <div className="grid h-[236px] w-[236px] place-items-center rounded-xl border border-border bg-surface p-3.5">
          {generando ? (
            <Loader2 className="h-5 w-5 animate-spin text-fg-3" />
          ) : vistaPrevia ? (
            <img src={vistaPrevia} alt={`QR de ${catalogo.nombre_visible}`} className="h-full w-full object-contain" />
          ) : (
            <span className="text-center text-[12px] text-fg-3">No se pudo generar el QR.</span>
          )}
        </div>
        <p className="mt-2.5 text-center text-[11.5px] text-fg-3">
          El QR lleva el parámetro de origen, así se distinguen los escaneos del cartel.
        </p>
      </div>

      <div className="flex min-w-[280px] flex-1 flex-col gap-4">

        {/* ⚠ El aviso del borrador va ARRIBA de las descargas, no debajo: si
            estuviera al pie, quien viene a imprimir ya apretó el botón. */}
        {!publicado && (
          <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-warn-line bg-warn-soft px-3 py-2.5">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
            <p className="text-[12.5px] text-fg-2">
              <span className="font-semibold text-warn">El catálogo está en borrador: este QR todavía no lleva a ningún lado.</span>
              {' '}
              Quien lo escanee va a ver el mismo error que con una dirección inventada. Publicalo antes de imprimir el cartel.
            </p>
          </div>
        )}

        <div>
          <p className="eyebrow">Enlace del catálogo</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <span data-enlace className="num flex h-9 min-w-0 flex-1 items-center overflow-hidden truncate rounded-lg border border-border bg-surface-2 px-2.5 text-[12.5px]">
              {enlace}
            </span>
            <button className={BOTON_SECUNDARIO} onClick={copiar}>
              <Copy className="h-3.5 w-3.5 text-fg-3" />
              Copiar
            </button>
          </div>
          <p className="mt-1.5 text-[11.5px] text-fg-3">
            Se copia con el protocolo: sin él, WhatsApp lo manda como texto y no como enlace.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button className={BOTON_SECUNDARIO} onClick={descargarPng}>
            <Download className="h-3.5 w-3.5 text-fg-3" />
            Descargar PNG
          </button>
          <button className={BOTON_SECUNDARIO} onClick={descargarSvg}>
            <Download className="h-3.5 w-3.5 text-fg-3" />
            Descargar SVG
          </button>
          <button className={BOTON_SECUNDARIO} onClick={imprimir}>
            <Printer className="h-3.5 w-3.5 text-fg-3" />
            Cartel A4 para imprimir
          </button>
        </div>

        <p className="border-t border-border pt-3.5 text-[12.5px] leading-relaxed text-fg-2">
          El cartel A4 ya trae el logo, el nombre del catálogo y la leyenda «escaneá con la cámara».
          Es lo que se pega en la recepción: imprimir el QR solo, sin contexto, baja el escaneo.
          El SVG es el que conviene mandarle a una imprenta, porque no se pixela en ningún tamaño.
        </p>
      </div>
    </section>
  )
}
