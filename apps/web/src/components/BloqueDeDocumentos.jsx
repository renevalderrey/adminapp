import { useState } from 'react'
import { toast } from 'sonner'
import { Copy, ExternalLink, Paperclip, Plus, Trash2 } from 'lucide-react'
import { createSupplierDocument, deleteDocument } from '@/services/api'
import { usePermission } from '@/hooks/usePermission'
import { useConfirmDialog } from '@/components/ConfirmDialog'
import { TablaGrid, Encabezado, Fila, BotonDeFila } from '@/components/TablaGrid'
import { fechaCorta } from '@/utils/formato'
import { mensajeDeError } from '@/utils/erroresDeApi'
import { TIPOS, esEnlaceAceptable, nubeDelEnlace } from '@/utils/documentosDeProveedor'
import { faltaElPermiso } from '@/utils/permisos'

// ════════════════════════════════════════════
//  FAVALIO · Los documentos de un proveedor
//
//  El modelo (`SupplierDocument`) y los dos endpoints existen y funcionan desde
//  siempre —`POST /api/suppliers/:id/documents` y
//  `DELETE /api/suppliers/documents/:id`, los dos con `findScoped` y lista
//  blanca (`routes/suppliers.js:816`, `:841`)—. Lo que no existía era una sola
//  línea de interfaz: el listado ya traía los documentos y la pantalla los
//  descartaba. Este archivo es esa interfaz y nada más; los endpoints **no se
//  tocan** (US7 escenario 10).
//
//  ── Favalio no sube ningún archivo ──
//
//  Guarda el ENLACE a la nube donde el usuario ya tiene la factura (FR-081), lo
//  mismo que el legacy (`legacy:2516-2518`, `:7948-7983`). Por eso el campo se
//  llama «Enlace» y el texto lo dice: quien espera un botón de «Examinar…» tiene
//  que entender en el momento que acá se pega un link, no que el sistema perdió
//  su archivo.
//
//  ── Por qué el enlace se valida ACÁ y no se deja para el servidor ──
//
//  El servidor acepta cualquier texto en `url` —es un `TEXT` sin validación— así
//  que si la pantalla no mira, «Factura 0001-00043212.pdf» se guarda igual y
//  produce un documento que no lleva a ninguna parte. Peor: apaga el aviso de
//  «sin factura» del proveedor (FR-086), y un aviso que se apaga sin que el
//  respaldo exista es exactamente lo que ese aviso venía a evitar. La regla es
//  la del legacy (`:7930`) y vive en `utils/documentosDeProveedor.js`.
//
//  ── Recibe props y no lee el estado global ──
//
//  Igual que `PanelOrdenDeCompra` y los tres de `components/pos/`: los
//  documentos llegan por prop y el aviso de «hubo un cambio» sale por
//  `onCambio`. Dos dueños del mismo dato terminan mostrando una lista y
//  borrando de otra. Lo único que sí sale del estado global son los permisos,
//  que es de donde los lee `usePermission` en todo el repositorio.
//
//  Reglas de dibujo: docs/REGLAS-DISENO.md. La referencia viva es
//  `pages/Comparador.jsx`.
// ════════════════════════════════════════════

/**
 * Las columnas de la tabla. **El mismo string en el encabezado y en las filas**:
 * si difieren, las etiquetas dejan de estar sobre sus datos y se lee una fecha
 * bajo «Nube».
 *
 * El bloque vive en la mitad derecha de `/proveedores`, así que el ancho mínimo
 * es bajo a propósito: por debajo scrollea adentro de su tarjeta y no empuja la
 * página.
 */
const COLUMNAS = 'minmax(0,1.8fr) 104px 128px 96px 72px'
const ANCHO_MINIMO = 620

/** Clases del campo del sistema (36px, borde, foco en `brand`). */
const CAMPO =
  'h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] transition-colors ' +
  'focus-visible:border-brand focus-visible:outline-none disabled:bg-surface-2 disabled:text-fg-2'

/** Un campo con su etiqueta. */
function Campo({ etiqueta, ancho = '', children }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1.5 ${ancho}`}>
      <span className="eyebrow">{etiqueta}</span>
      {children}
    </label>
  )
}

/**
 * La fecha de hoy como `AAAA-MM-DD`, leída en la zona horaria del usuario.
 *
 * **No** es `new Date().toISOString().slice(0, 10)`: eso pasa por UTC, así que
 * en Argentina (UTC−3) toda la tarde del día 5 se guarda como día 6. La factura
 * cargada a las 21:30 quedaría con la fecha del día siguiente y aparecería en el
 * mes equivocado del estado de cuenta cada 31 del mes.
 */
function hoy() {
  const ahora = new Date()
  const mes = String(ahora.getMonth() + 1).padStart(2, '0')
  const dia = String(ahora.getDate()).padStart(2, '0')

  return `${ahora.getFullYear()}-${mes}-${dia}`
}

/** El formulario recién abierto: el primer tipo del modelo y la fecha de hoy. */
function formularioVacio() {
  return { name: '', type: TIPOS[0].codigo, date: hoy(), url: '' }
}

/**
 * Cómo se escribe el tipo de un documento.
 *
 * ⚠ `TIPOS` es una lista de `{ codigo, etiqueta }` y **no exporta ninguna
 * función de traducción**: un `TIPOS.find(...).etiqueta` directo tira sobre un
 * `type` que no esté en la lista y se lleva puesta la fila entera —y con ella el
 * bloque—. La columna es un `STRING(30)` sin validación en el servidor y admite
 * `null`, así que los dos casos son alcanzables sin que nadie haya hecho nada
 * raro.
 *
 * Un tipo desconocido se muestra **tal cual** en vez de traducirse a «Otro»: si
 * alguna vez se guarda un quinto tipo, verlo es lo único que permite
 * corregirlo; esconderlo detrás de «Otro» lo vuelve invisible para siempre.
 */
function etiquetaDeTipo(type) {
  const conocido = TIPOS.find((t) => t.codigo === type)
  if (conocido) return conocido.etiqueta

  return typeof type === 'string' && type.trim() !== '' ? type : '—'
}

/**
 * El bloque de documentos de la cuenta de un proveedor (FR-080 a FR-087).
 *
 * @param {number|string} proveedorId  A quién se le agregan los documentos.
 * @param {Array} documentos           Los que devuelve `GET /suppliers/:id` en
 *   `documents`. Se dibujan **en el orden en que vienen**: acá no hay `.sort()`
 *   —ni siquiera sobre una copia— porque el orden lo decide el servidor
 *   (FR-053), y un `.sort()` sobre el arreglo del estado de React sería además
 *   una mutación en medio de un render.
 * @param {Function} onCambio          Se llama después de agregar o eliminar,
 *   para que la pantalla vuelva a pedir la ficha. El bloque no guarda una
 *   segunda copia de la lista.
 */
export default function BloqueDeDocumentos({ proveedorId, documentos = [], onCambio }) {
  const { can } = usePermission()
  const { confirm, ConfirmDialog } = useConfirmDialog()

  const [form, setForm] = useState(formularioVacio)
  const [guardando, setGuardando] = useState(false)

  // FR-087. Deshabilitado **con su explicación** y no ausente: un formulario que
  // desaparece deja al usuario sin entender por qué no puede cargar la factura,
  // y termina en un pedido de soporte que dice «no me anda».
  const puedeEditar = can('proveedores.editar')
  const puedeEliminar = can('proveedores.eliminar')

  const cambiar = (campo) => (valor) => setForm((f) => ({ ...f, [campo]: valor }))

  async function agregar() {
    // Sin esto, un doble clic sobre «Agregar» carga el documento dos veces: la
    // primera llamada todavía no volvió y el formulario sigue completo.
    if (guardando || !puedeEditar) return

    const nombre = form.name.trim()
    // ⚠ Se guarda `url.trim()` y NO el texto crudo del campo: pegar desde
    // WhatsApp arrastra un espacio o un salto de línea al final.
    // `esEnlaceAceptable` tolera los espacios de los bordes justamente para no
    // rechazar ese pegado, así que si acá se mandara el texto crudo el enlace
    // pasaría la validación y se guardaría con el espacio adentro.
    const enlace = form.url.trim()

    if (nombre === '') {
      toast.error('Poné un nombre para reconocer el documento, por ejemplo «Factura 0001-00043212».')
      return
    }

    if (enlace === '') {
      toast.error('Pegá el enlace del archivo. Favalio no sube archivos: guarda el enlace a tu nube.')
      return
    }

    // FR-082 y US7 escenario 3. Se rechaza ANTES de mandar la llamada: el
    // servidor guarda cualquier texto, así que esperar su respuesta significa
    // guardar un documento que no abre en ninguna parte.
    if (!esEnlaceAceptable(enlace)) {
      toast.error('El enlace tiene que empezar con «http» y no puede tener espacios en el medio. Pegá el link de Drive, Dropbox u OneDrive, no el nombre del archivo.')
      return
    }

    setGuardando(true)

    try {
      await createSupplierDocument(proveedorId, {
        name: nombre,
        type: form.type,
        url: enlace,
        // Vacío va como `null` y no como `''`: una cadena vacía en un DATEONLY
        // hace fallar la validación de Sequelize con un error de tipo.
        date: form.date || null,
      })

      setForm(formularioVacio())
      toast.success('Documento agregado.')
      onCambio?.()
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo agregar el documento.'))
    } finally {
      setGuardando(false)
    }
  }

  async function eliminar(documento) {
    // La confirmación dice qué se borra y qué NO: el archivo sigue en la nube
    // del usuario, acá se pierde el enlace. Sin esa segunda mitad, borrar un
    // documento parece borrar la factura y nadie se anima a tocar el botón.
    const ok = await confirm(
      `¿Eliminar «${documento.name}»? Se borra el enlace guardado en Favalio; el archivo sigue en tu nube.`,
      { verbo: 'Eliminar documento' }
    )
    if (!ok) return

    try {
      await deleteDocument(documento.id)
      toast.success('Documento eliminado.')
      onCambio?.()
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo eliminar el documento.'))
    }
  }

  async function copiar(documento) {
    // `navigator.clipboard` no existe fuera de un contexto seguro —ni en jsdom—,
    // así que sin este guarda tocar «Copiar» tira un TypeError que se lleva
    // puesto el render entero. Lo que hace falta cuando no está es decir cómo
    // seguir, no fallar en silencio.
    if (!navigator.clipboard?.writeText) {
      toast.error('El navegador no deja copiar desde acá. Abrí el enlace y copialo de la barra de direcciones.')
      return
    }

    try {
      await navigator.clipboard.writeText(documento.url || '')
      toast.success('Enlace copiado.')
    } catch {
      toast.error('No se pudo copiar el enlace. Abrilo y copialo de la barra de direcciones.')
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-nivel-1">
      <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
        <h2>Documentos</h2>
        <span className="num rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-fg-2">
          {documentos.length}
        </span>
        <div className="flex-1" />
        <span className="text-[12.5px] text-fg-3">Se guarda el enlace, no el archivo</span>
      </div>

      {/* ── Alta ── */}
      <div className="border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-end gap-3">
          <Campo etiqueta="Nombre" ancho="min-w-[160px] flex-[2]">
            <input
              className={CAMPO}
              placeholder="Factura 0001-00043212"
              value={form.name}
              disabled={!puedeEditar}
              onChange={(e) => cambiar('name')(e.target.value)}
            />
          </Campo>

          <Campo etiqueta="Tipo" ancho="w-[136px]">
            <select
              className={CAMPO}
              value={form.type}
              disabled={!puedeEditar}
              onChange={(e) => cambiar('type')(e.target.value)}
            >
              {TIPOS.map((t) => (
                <option key={t.codigo} value={t.codigo}>{t.etiqueta}</option>
              ))}
            </select>
          </Campo>

          <Campo etiqueta="Fecha" ancho="w-[152px]">
            <input
              type="date"
              className={`${CAMPO} num`}
              value={form.date}
              disabled={!puedeEditar}
              onChange={(e) => cambiar('date')(e.target.value)}
            />
          </Campo>

          <Campo etiqueta="Enlace" ancho="min-w-[200px] flex-[3]">
            <input
              type="url"
              className={CAMPO}
              placeholder="https://drive.google.com/…"
              value={form.url}
              disabled={!puedeEditar}
              onChange={(e) => cambiar('url')(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') agregar() }}
            />
          </Campo>

          <button
            type="button"
            onClick={agregar}
            disabled={!puedeEditar || guardando}
            title={puedeEditar ? 'Agregar el documento' : faltaElPermiso('proveedores.editar')}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-semibold
                       text-white shadow-nivel-1 transition-colors hover:bg-brand-dark
                       disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Agregar
          </button>
        </div>

        {!puedeEditar && (
          <p className="mt-2.5 text-[12.5px] text-fg-2">
            {faltaElPermiso('proveedores.editar')} para cargar documentos. Los que ya están se
            pueden abrir y copiar.
          </p>
        )}
      </div>

      {/* ── Lista ── */}
      {documentos.length === 0 ? (
        <div className="py-12 text-center">
          <Paperclip className="mx-auto mb-2 h-6 w-6 text-fg-3" />
          <p className="font-semibold">Este proveedor no tiene ningún documento.</p>
          <p className="mx-auto mt-1 max-w-[46ch] text-sm text-fg-2">
            Pegá arriba el enlace de Drive, Dropbox u OneDrive de la primera factura. Cuando el
            contador la pida, va a estar a un clic y no en un chat.
          </p>
        </div>
      ) : (
        <TablaGrid anchoMinimo={ANCHO_MINIMO}>
          <Encabezado columnas={COLUMNAS}>
            <span>Documento</span>
            <span>Tipo</span>
            <span>Nube</span>
            <span>Fecha</span>
            <span className="text-right">Acciones</span>
          </Encabezado>

          {documentos.map((documento) => {
            const nube = nubeDelEnlace(documento.url)
            const tieneEnlace = esEnlaceAceptable(documento.url)

            return (
              <Fila key={documento.id} columnas={COLUMNAS} className="cursor-default">
                <span className="min-w-0">
                  {tieneEnlace ? (
                    // FR-084. `target="_blank"` sin `rel="noopener noreferrer"` le
                    // deja a la página de destino un `window.opener` con el que
                    // puede redirigir esta pestaña, y el enlace lo escribió una
                    // persona apuntando afuera del sistema.
                    <a
                      href={documento.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-w-0 items-center gap-1.5 text-[13.5px] font-semibold
                                 transition-colors hover:text-brand"
                    >
                      <span className="truncate">{documento.name}</span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-fg-3" />
                    </a>
                  ) : (
                    // Un documento viejo sin enlace utilizable no se dibuja como
                    // un link roto: se dice que le falta el enlace, que es lo
                    // único que se puede afirmar desde acá.
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[13.5px] font-semibold">{documento.name}</span>
                      <span className="text-[11.5px] text-warn">Sin un enlace que se pueda abrir</span>
                    </span>
                  )}
                </span>

                <span className="truncate text-[13px] text-fg-2">{etiquetaDeTipo(documento.type)}</span>

                <span>
                  <span className="inline-flex items-center rounded-md border border-border bg-surface-3
                                   px-2 py-0.5 text-xs font-semibold text-fg-2">
                    {nube.etiqueta}
                  </span>
                </span>

                <span className="num text-[13px] text-fg-2">{fechaCorta(documento.date)}</span>

                <span className="flex justify-end gap-0.5">
                  <BotonDeFila title="Copiar el enlace" onClick={() => copiar(documento)}>
                    <Copy />
                  </BotonDeFila>
                  <BotonDeFila
                    title={puedeEliminar ? 'Eliminar el documento' : faltaElPermiso('proveedores.eliminar')}
                    disabled={!puedeEliminar}
                    onClick={() => eliminar(documento)}
                    className="hover:bg-danger-soft hover:text-danger"
                  >
                    <Trash2 />
                  </BotonDeFila>
                </span>
              </Fila>
            )
          })}
        </TablaGrid>
      )}

      <ConfirmDialog />
    </section>
  )
}
