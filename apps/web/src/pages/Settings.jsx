import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  AlertTriangle, ArrowRight, Download, ExternalLink, FileWarning, Info,
  KeyRound, Loader2, Receipt, RotateCcw, ShieldCheck, Store, Unlink,
} from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import PuestaEnMarchaAfip from '@/components/PuestaEnMarchaAfip'
import { Can } from '@/components/Can'
import { useConfirmDialog } from '@/components/ConfirmDialog'
import { usePermission } from '@/hooks/usePermission'
import {
  desvincularAfip,
  generarCsrAfip,
  getAfipCertInfo,
  getAfipStatus,
  getDashboardKpis,
  getSettings,
  guardarConfiguracionAfip,
  verificarCircuitoAfip,
} from '@/services/api'
import { mensajeDeError } from '@/utils/erroresDeApi'
import { fechaCortaDeMomento } from '@/utils/formato'
import { diasHastaVencer } from '@/utils/puestaEnMarchaAfip'
import { faltaElPermiso } from '@/utils/permisos'

// ════════════════════════════════════════════
//  FAVALIO · /facturacion — Facturación electrónica (ARCA/AFIP)
//
//  ── Las tres frases que esta pantalla NO copia de la maqueta ──
//
//  La maqueta dice que las llaves se guardan cifradas y que el `.key` queda en el
//  servidor. **Las dos son falsas**, y `GUIA_AFIP.md` las repetía. Copiar esos
//  textos sería escribir en la pantalla una propiedad de seguridad que el sistema
//  no tiene — y alguien decidiría subir su material fiscal en base a eso.
//
//  Lo que es cierto, y es lo que dice esta pantalla:
//
//   · el certificado y la clave se guardan **en la base de datos de Favalio, sin
//     cifrar** (FR-093). Cifrarlos es el proyecto 6 de `PROXIMOS-PROYECTOS.md`,
//     junto con el token de TiendaNube, y esta funcionalidad **no lo hace**;
//   · la clave **no sale nunca de la API**: `GET /api/settings` la excluye
//     (`utils/settingsSecretos.js`) y esta pantalla no la pide, no la muestra y no
//     la enmascara;
//   · la clave del CSR **no se guarda: se descarga y hay que conservarla**
//     (FR-094). El servidor la genera y la devuelve una vez; si se pierde, hay que
//     rehacer el trámite entero en ARCA.
//
//  ── Y el banner verde no puede salir de `FEDummy` ──
//
//  `GET /afip/status` devolvía lo que contestara `FEDummy`, que **no lleva
//  `Auth`**: responde OK con el certificado vencido, con la clave equivocada y sin
//  ningún certificado cargado. Encima la pantalla hacía
//  `setAfipStatus(res.data)` sobre un `{ ok, data }` y después evaluaba
//  `afipStatus.error` —que en una respuesta exitosa **no existe nunca**—, así que
//  el único camino posible era «Conectado: API operativa» (FR-080).
//
//  Ahora son dos cosas separadas: si los servidores de ARCA están arriba, y si el
//  circuito de ESTA empresa está verificado. El estado de la facturación sale de
//  lo segundo.
//
//  Reglas de dibujo: docs/REGLAS-DISENO.md. Referencia viva: pages/Comparador.jsx.
// ════════════════════════════════════════════

const BOTON_PRINCIPAL =
  'inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-semibold ' +
  'text-white shadow-nivel-1 transition-colors hover:bg-brand-dark ' +
  'disabled:cursor-not-allowed disabled:opacity-55'

const BOTON_SECUNDARIO =
  'inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-border bg-surface px-3 ' +
  'text-[13px] font-medium transition-colors hover:bg-surface-3 ' +
  'disabled:cursor-not-allowed disabled:opacity-55'

const BOTON_PELIGROSO =
  'inline-flex h-[34px] items-center gap-1.5 rounded-lg border border-danger-line bg-danger-soft ' +
  'px-3 text-[13px] font-medium text-danger transition-colors hover:bg-surface-3 ' +
  'disabled:cursor-not-allowed disabled:opacity-55'

const CAMPO =
  'h-9 w-full rounded-lg border border-border bg-surface px-3 text-[13px] transition-colors ' +
  'focus-visible:border-brand focus-visible:outline-none ' +
  'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-3'

const CONDICIONES = [
  { codigo: 'Monotributo', etiqueta: 'Monotributo (Factura C)' },
  { codigo: 'RI', etiqueta: 'Responsable Inscripto (Factura A/B)' },
  { codigo: 'Exento', etiqueta: 'Exento (Factura C)' },
]

const CONFIGURACION_VACIA = {
  cuit: '', pv: '', environment: 'homologation', tax_condition: 'Monotributo',
  cert: '', key: '',
}

export default function Settings() {
  const { can } = usePermission()
  const { confirm, ConfirmDialog } = useConfirmDialog()

  const puedeEditar = can('config.editar')

  const [config, setConfig] = useState(CONFIGURACION_VACIA)
  const [guardado, setGuardado] = useState({})
  const [certificado, setCertificado] = useState(null)
  const [estado, setEstado] = useState(null)
  const [ventasRechazadas, setVentasRechazadas] = useState(null)

  const [cargando, setCargando] = useState(true)
  const [errorDeCarga, setErrorDeCarga] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [verificando, setVerificando] = useState(false)
  const [generando, setGenerando] = useState(false)
  const [archivosDelCsr, setArchivosDelCsr] = useState(null)

  // ── La carga ──
  //
  // ⚠ El certificado y la clave NO se traen, y no es un olvido: `GET /settings`
  // no los devuelve (`utils/settingsSecretos.js`) y el formulario los deja
  // vacíos a propósito. El servidor saltea los campos vacíos justamente para que
  // guardar el ambiente no borre el material fiscal.
  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const [ajustes, cert, status] = await Promise.all([
        getSettings(),
        getAfipCertInfo(),
        getAfipStatus(),
      ])

      const datos = ajustes.data?.data || {}

      setGuardado(datos)
      setConfig((actual) => ({
        ...actual,
        cuit: datos.afip_cuit ?? '',
        pv: datos.afip_pv ?? '',
        environment: datos.afip_environment || 'homologation',
        tax_condition: datos.tax_condition || 'Monotributo',
        // Se limpian en cada carga: el material fiscal no vive en el estado de
        // React más de lo que dura el guardado (FR-099).
        cert: '',
        key: '',
      }))

      // `cert-info` responde `{ ok: false }` cuando no hay certificado cargado, y
      // eso NO es un error: es el estado de una empresa que todavía no lo subió.
      setCertificado(cert.data?.ok ? cert.data.data : null)
      setEstado(status.data?.data || null)
      setErrorDeCarga('')
    } catch (err) {
      setErrorDeCarga(mensajeDeError(err, 'No se pudo leer la configuración de facturación.'))
    } finally {
      setCargando(false)
    }
  }, [])

  /**
   * Cuántas ventas rechazó AFIP y siguen sin comprobante (FR-097).
   *
   * ⚠ Sale de `GET /api/dashboard/kpis` y no de una consulta propia **a
   * propósito**: es el mismo número que dibuja el Panel, con el mismo criterio
   * —las que tienen `afip_ultimo_error`, no todas las ventas sin CAE—. Dos
   * fuentes para la misma etiqueta se separan sin que nada avise, que es
   * exactamente cómo el Panel terminó dibujando las alertas de un endpoint y
   * calculando las de otro.
   *
   * Va en su propio pedido y su propio `catch`: un rol sin `dashboard.ver` tiene
   * que poder configurar AFIP igual.
   */
  const cargarRechazadas = useCallback(async () => {
    try {
      const res = await getDashboardKpis()
      const avisos = res.data?.data?.requiere_atencion || []
      const sinCae = avisos.find((aviso) => aviso.tipo === 'sin_cae')

      setVentasRechazadas(sinCae ? sinCae.cantidad : 0)
    } catch {
      // `null` y no `0`: «no se pudo leer» y «no hay ninguna» son cosas
      // distintas, y dibujar la segunda sobre la primera afirma que está todo
      // bien sin haberlo mirado.
      setVentasRechazadas(null)
    }
  }, [])

  useEffect(() => {
    cargar()
    cargarRechazadas()
  }, [cargar, cargarRechazadas])

  // ── El archivo del certificado ──
  const leerArchivo = (evento, campo) => {
    const archivo = evento.target.files[0]
    if (!archivo) return

    const lector = new FileReader()
    lector.onload = (e) => setConfig((actual) => ({ ...actual, [campo]: e.target.result }))
    lector.readAsText(archivo)
  }

  /**
   * Baja un archivo generado en memoria.
   *
   * ⚠ El `revokeObjectURL` no es prolijidad: sin él, cada descarga deja el blob
   * retenido hasta que se recargue la página, y el blob de `.key` **es la clave
   * privada** (A13, FR-099).
   */
  const descargar = (contenido, nombre) => {
    const url = window.URL.createObjectURL(new Blob([contenido], { type: 'text/plain' }))
    const enlace = document.createElement('a')

    enlace.href = url
    enlace.setAttribute('download', nombre)
    document.body.appendChild(enlace)
    enlace.click()
    document.body.removeChild(enlace)
    window.URL.revokeObjectURL(url)
  }

  const generarCsr = async () => {
    setGenerando(true)
    try {
      const res = await generarCsrAfip('Favalio')
      setArchivosDelCsr(res.data?.data || null)
      toast.success('Archivos generados. Descargá los dos antes de cerrar esta pantalla.')
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo generar el pedido de certificado.'))
    } finally {
      setGenerando(false)
    }
  }

  const guardar = async (evento) => {
    evento.preventDefault()

    // ⚠ **La confirmación del pase a producción** (FR-078, US14 escenario 5).
    //
    // Es la única cosa de esta pantalla que no se deshace guardando otra vez: a
    // partir de acá cada comprobante es un hecho fiscal, consume numeración
    // correlativa de AFIP y darlo de baja exige una nota de crédito, que este
    // sistema no emite. Volver el desplegable a homologación no anula nada de lo
    // que ya salió.
    //
    // Solo en la TRANSICIÓN: quien ya está en producción guarda su CUIT o su
    // condición de IVA sin que nada le pregunte nada. Un cartel que sale siempre
    // es un cartel que nadie lee.
    const ambienteGuardado = estado?.ambiente || guardado.afip_environment || 'homologation'

    if (config.environment === 'production' && ambienteGuardado !== 'production') {
      const sigo = await confirm(
        '¿Pasar a producción? Desde este momento los comprobantes que emitas son REALES: ' +
        'tienen validez fiscal, se emiten a nombre de tu CUIT y consumen numeración ' +
        'correlativa de AFIP. Un comprobante emitido no se puede borrar desde acá: darlo ' +
        'de baja exige una nota de crédito. Volver a homologación no anula los que ya se ' +
        'emitieron.',
        // Uno de los cinco rojos de la aplicación: desde acá los comprobantes
        // son fiscalmente reales y no hay vuelta atrás para los ya emitidos.
        { verbo: 'Pasar a producción', destructivo: true }
      )
      if (!sigo) return
    }

    setGuardando(true)
    try {
      await guardarConfiguracionAfip(config)

      // ⚠ Se limpian ACÁ y no en el `finally`: si el guardado falló, el usuario
      // tiene que poder corregir el CUIT y reintentar sin volver a elegir los dos
      // archivos. Lo que no puede pasar es que la clave privada se quede en el
      // estado de React después de un guardado exitoso (FR-099).
      setConfig((actual) => ({ ...actual, cert: '', key: '' }))

      toast.success('Configuración de facturación guardada.')
      await cargar()
    } catch (err) {
      // Los mensajes que la API escribe en castellano —«El certificado y la clave
      // privada no son pareja», «El certificado está emitido para el CUIT …»—
      // llegan al usuario. Antes se mostraba `err.message` de axios: «Request
      // failed with status code 400» (A10, FR-092).
      toast.error(mensajeDeError(err, 'No se pudo guardar la configuración de facturación.'))
    } finally {
      setGuardando(false)
    }
  }

  const verificar = async () => {
    setVerificando(true)
    try {
      const res = await verificarCircuitoAfip()
      const evidencia = res.data?.data

      // El veredicto del servidor también cambió: se acaba de verificar con el
      // certificado y el punto de venta que están cargados. Sin actualizarlo, el
      // paso 4 seguiría mostrando el aviso «se verificó con otro certificado» de
      // la carga anterior sobre una verificación recién hecha.
      setEstado((actual) => ({
        ...(actual || {}),
        verificacion: evidencia,
        circuito: { cumplido: true, via: 'verificacion', otro_certificado: false },
      }))
      toast.success('Circuito verificado: AFIP respondió con el certificado y el punto de venta cargados.')
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo verificar el circuito de facturación.'))
      // La verificación fallida también es evidencia y el servidor la guardó:
      // se relee para que el paso 4 muestre qué falló y no se quede en
      // «pendiente», que es otra cosa.
      await cargar()
    } finally {
      setVerificando(false)
    }
  }

  const desvincular = async () => {
    const ok = await confirm(
      '¿Desvincular AFIP? Se borran el certificado, la clave privada, el punto de venta y el ' +
      'ambiente. Vas a tener que volver a subir el certificado y la clave, y la clave no se ' +
      'puede recuperar de acá: si no la tenés guardada, hay que rehacer el trámite en ARCA. ' +
      'Las ventas ya facturadas conservan su CAE.',
      // Rojo: borra la clave privada, y la clave no se recupera de acá.
      { verbo: 'Desvincular AFIP', destructivo: true }
    )
    if (!ok) return

    try {
      await desvincularAfip()
      toast.success('AFIP desvinculado. Las ventas ya facturadas conservan su CAE.')
      await cargar()
    } catch (err) {
      toast.error(mensajeDeError(err, 'No se pudo desvincular AFIP.'))
    }
  }

  const ambiente = estado?.ambiente || guardado.afip_environment || 'homologation'
  const enProduccion = ambiente === 'production'
  const verificacion = estado?.verificacion || null
  const verificado = verificacion?.resultado === 'ok'

  // El veredicto del servidor, que es el mismo que decide el bloqueo del pase a
  // producción. Lo que hace falta acá es la rama (b): una empresa que ya emitió
  // un comprobante autorizado **puede** pasar a producción sin verificar nada, y
  // esta pantalla le decía lo contrario con todas las letras.
  const circuito = estado?.circuito || null
  const cumplidoPorCaePrevio = circuito?.via === 'cae_previo'
  const puedePasarAProduccion = verificado || cumplidoPorCaePrevio

  const dias = certificado ? diasHastaVencer(certificado.validTo) : null

  return (
    <div className="anim-subida flex flex-col gap-6">
      <PageHeader
        titulo="Facturación AFIP"
        descripcion="Vinculá los servicios oficiales de ARCA para emitir comprobantes electrónicos, y comprobá que el circuito funcione antes de emitir el primero."
        icono={Receipt}
      >
        {cargando && <Loader2 className="h-4 w-4 animate-spin text-fg-3" />}
        <button type="button" className={BOTON_SECUNDARIO} onClick={() => { cargar(); cargarRechazadas() }}>
          <RotateCcw className="h-3.5 w-3.5 text-fg-3" />
          Actualizar
        </button>
      </PageHeader>

      {errorDeCarga && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-danger-line bg-danger-soft px-5 py-4"
        >
          <AlertTriangle className="mt-0.5 h-[18px] w-[18px] shrink-0 text-danger" />
          <p className="flex-1 text-[13.5px] font-medium">{errorDeCarga}</p>
        </div>
      )}

      {/* ── El banner de estado ──

          ⚠ Sale de la EVIDENCIA y del ambiente, nunca de `FEDummy` (FR-080).
          `servidores_afip` se dibuja abajo y aparte, porque contesta otra
          pregunta: si ARCA está arriba, no si esta empresa puede facturar. */}
      <section
        data-estado-de-facturacion={
          puedePasarAProduccion ? (enProduccion ? 'produccion' : 'homologacion') : 'sin_verificar'
        }
        className={`rounded-xl border px-5 py-4 ${
          puedePasarAProduccion && enProduccion
            ? 'border-ok-line bg-ok-soft'
            : puedePasarAProduccion
              ? 'border-warn-line bg-warn-soft'
              : 'border-border bg-surface-2'
        }`}
      >
        <div className="flex flex-wrap items-start gap-3">
          <ShieldCheck
            className={`mt-0.5 h-[18px] w-[18px] shrink-0 ${
              puedePasarAProduccion && enProduccion
                ? 'text-ok'
                : puedePasarAProduccion ? 'text-warn' : 'text-fg-3'
            }`}
          />

          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-semibold">
              {enProduccion
                ? 'Ambiente: producción. Los comprobantes que emitas tienen validez fiscal.'
                : 'Ambiente: homologación. Los comprobantes que emitas NO tienen validez fiscal.'}
            </p>

            <p className="mt-1 max-w-[80ch] text-[13px] leading-relaxed text-fg-2">
              {/* Los encadenados opcionales no son ruido: `verificado` sale de
                  `verificacion`, pero si alguien lo hiciera salir de otra cosa
                  —de `servidores_afip`, por ejemplo, que es el defecto que esta
                  pantalla viene a sacar— la pantalla entera reventaría en vez de
                  mostrar un banner equivocado, y un error de render se lee como
                  «la aplicación está rota» y no como «este banner miente». */}
              {verificado
                ? `Circuito verificado el ${fechaCortaDeMomento(verificacion?.verificado_en)} con el CUIT ` +
                  `${verificacion?.cuit} y el punto de venta ${verificacion?.pv}.`
                : cumplidoPorCaePrevio
                  /* ⚠ La rama que faltaba, y la frase de abajo era FALSA para
                     esta empresa: el servidor le contesta 200 al pase a
                     producción porque ya tiene comprobantes autorizados —un CAE
                     es la prueba más fuerte que existe de que el circuito
                     funciona—. Decirle que no puede pasar hasta verificar la
                     manda a un trámite que no necesita. */
                  ? 'Esta empresa ya tiene comprobantes autorizados por AFIP, así que el circuito funciona y se puede pasar a producción. Verificar igual sirve para comprobar el certificado y el punto de venta que están cargados hoy.'
                  : 'El circuito todavía no se verificó contra AFIP. Hasta que se verifique no se puede pasar a producción.'}
            </p>

            {certificado && (
              <p className="mt-1 text-[13px] text-fg-2">
                Certificado de {certificado.subject} ({certificado.cuit}), emitido por{' '}
                {certificado.issuer}, vigente hasta el {fechaCortaDeMomento(certificado.validTo)}
                {dias !== null && dias > 0 ? ` — faltan ${dias} días.` : '.'}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ── Ventas que AFIP rechazó (FR-097) ── */}
      {ventasRechazadas > 0 && (
        <section className="flex flex-wrap items-center gap-3 rounded-xl border border-warn-line bg-warn-soft px-5 py-4">
          <FileWarning className="h-[18px] w-[18px] shrink-0 text-warn" />
          <p className="min-w-0 flex-1 text-[13.5px]">
            <strong className="num">{ventasRechazadas}</strong>{' '}
            {ventasRechazadas === 1 ? 'venta' : 'ventas'} que AFIP rechazó y siguen sin
            comprobante. Se reintentan una por una desde el historial.
          </p>
          <Link to="/ventas" className={BOTON_SECUNDARIO}>
            Ver ventas <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </section>
      )}

      <PuestaEnMarchaAfip
        configuracion={{ ...guardado, afip_cuit: config.cuit, afip_pv: config.pv }}
        certificado={certificado}
        verificacion={verificacion}
        circuito={circuito}
        verificando={verificando}
        puedeVerificar={puedeEditar}
        onVerificar={verificar}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        {/* ── El trámite en ARCA ── */}
        <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-nivel-1">
          <div className="border-b border-border px-5 py-4">
            <h2>El trámite en ARCA</h2>
            <p className="mt-1 max-w-[70ch] text-[13px] text-fg-2">
              Son tres pasos en el sitio de AFIP y uno acá. La guía completa, incluido el
              certificado de <strong>homologación</strong> —que es un trámite distinto del de
              producción—, está en <code className="num">docs/GUIA_AFIP.md</code>.
            </p>
          </div>

          <ol className="divide-y divide-border">
            <li className="px-5 py-4">
              <p className="text-[13.5px] font-semibold">1 · Generar el pedido de certificado</p>
              <p className="mt-1 max-w-[70ch] text-[13px] leading-relaxed text-fg-2">
                Se generan dos archivos: el pedido (<code className="num">.csr</code>), que se
                sube a ARCA, y la clave privada (<code className="num">.key</code>), que se queda
                con vos.
              </p>

              {/* FR-094. La maqueta decía que la clave queda «segura en tu
                  servidor». Es falso: se genera, se devuelve una vez y NO se
                  guarda del lado del servidor. Si se pierde, hay que rehacer el
                  trámite entero en ARCA. */}
              <p className="mt-1 max-w-[70ch] text-[13px] leading-relaxed text-fg-2">
                <strong>La clave privada no se guarda acá: se descarga y hay que conservarla.</strong>{' '}
                Si la perdés, el certificado que ARCA te emita no va a servir y hay que rehacer el
                trámite.
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                <Can
                  codigo="config.editar"
                  fallback={
                    <p className="text-[12.5px] text-fg-3">
                      No podés generar el pedido: te falta el permiso «config.editar».
                    </p>
                  }
                >
                  <button
                    type="button"
                    className={BOTON_PRINCIPAL}
                    onClick={generarCsr}
                    disabled={generando}
                  >
                    {generando
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <KeyRound className="h-4 w-4" />}
                    Generar pedido
                  </button>
                </Can>

                {archivosDelCsr && (
                  <>
                    <button
                      type="button"
                      className={BOTON_SECUNDARIO}
                      onClick={() => descargar(archivosDelCsr.key, 'favalio_privada.key')}
                    >
                      <Download className="h-3.5 w-3.5 text-fg-3" /> Descargar .key
                    </button>
                    <button
                      type="button"
                      className={BOTON_SECUNDARIO}
                      onClick={() => descargar(archivosDelCsr.csr, 'favalio_pedido.csr')}
                    >
                      <Download className="h-3.5 w-3.5 text-fg-3" /> Descargar .csr
                    </button>
                  </>
                )}
              </div>
            </li>

            <li className="px-5 py-4">
              <p className="text-[13.5px] font-semibold">2 · Obtener el certificado en ARCA</p>
              <p className="mt-1 max-w-[70ch] text-[13px] leading-relaxed text-fg-2">
                Entrá con clave fiscal, buscá «Administración de Certificados Digitales», subí el{' '}
                <code className="num">.csr</code> y descargá el <code className="num">.crt</code>.
                Para probar en homologación el trámite es <strong>otro</strong>: es el servicio de
                certificados de homologación, y da un certificado distinto.
              </p>
              <a
                href="https://auth.afip.gob.ar"
                target="_blank"
                rel="noreferrer"
                className={`${BOTON_SECUNDARIO} mt-3`}
              >
                Ir a AFIP <ExternalLink className="h-3.5 w-3.5 text-fg-3" />
              </a>
            </li>

            <li className="px-5 py-4">
              <p className="text-[13.5px] font-semibold">3 · Delegar la facturación electrónica</p>
              <p className="mt-1 max-w-[70ch] text-[13px] leading-relaxed text-fg-2">
                En «Administrador de Relaciones de Clave Fiscal», vinculá el servicio «Facturación
                Electrónica» al alias del certificado. Sin esto, el ticket de acceso se pide bien y
                AFIP igual rechaza todo.
              </p>
            </li>
          </ol>

          {/* ── Qué se guarda y dónde (FR-093, FR-096) ── */}
          <div className="flex items-start gap-3 border-t border-border bg-surface-2 px-5 py-4">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-fg-3" />
            <p className="max-w-[70ch] text-[12.5px] leading-relaxed text-fg-2">
              El certificado y la clave privada se guardan <strong>en la base de datos de
              Favalio, sin cifrar</strong>. Cifrarlos en reposo es un proyecto abierto y todavía
              no está hecho: decimos qué hay para que puedas decidir con el dato. Lo que sí está:
              la clave <strong>no sale nunca de la API</strong> —ni en esta pantalla, ni
              enmascarada, ni en un respaldo— y queda tapada en los registros del servidor.
            </p>
          </div>
        </section>

        {/* ── Los datos de facturación ── */}
        <div className="flex flex-col gap-6">
          <form
            onSubmit={guardar}
            className="overflow-hidden rounded-xl border border-border bg-surface shadow-nivel-1"
          >
            <div className="border-b border-border px-5 py-4">
              <h2>Datos de facturación</h2>
            </div>

            <div className="flex flex-col gap-4 px-5 py-4">
              <label className="flex flex-col gap-1.5">
                <span className="eyebrow">CUIT emisor</span>
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label="CUIT emisor"
                  className={CAMPO}
                  placeholder="30111111118"
                  value={config.cuit}
                  disabled={!puedeEditar}
                  onChange={(e) => setConfig({ ...config, cuit: e.target.value })}
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="eyebrow">Punto de venta</span>
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label="Punto de venta"
                  className={CAMPO}
                  placeholder="5"
                  value={config.pv}
                  disabled={!puedeEditar}
                  onChange={(e) => setConfig({ ...config, pv: e.target.value })}
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="eyebrow">Condición de IVA</span>
                <select
                  aria-label="Condición de IVA"
                  className={CAMPO}
                  value={config.tax_condition}
                  disabled={!puedeEditar}
                  onChange={(e) => setConfig({ ...config, tax_condition: e.target.value })}
                >
                  {CONDICIONES.map((c) => (
                    <option key={c.codigo} value={c.codigo}>{c.etiqueta}</option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="eyebrow">Ambiente</span>
                <select
                  aria-label="Ambiente de facturación"
                  className={CAMPO}
                  value={config.environment}
                  disabled={!puedeEditar}
                  onChange={(e) => setConfig({ ...config, environment: e.target.value })}
                >
                  <option value="homologation">Homologación — sin validez fiscal</option>
                  <option value="production">Producción — comprobantes reales</option>
                </select>
                <span className="text-[12.5px] leading-relaxed text-fg-3">
                  Pasar a producción exige tener el circuito verificado. El servidor lo vuelve a
                  comprobar al guardar.
                </span>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className="eyebrow">Certificado (.crt)</span>
                  <span
                    className={`flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg
                                border border-border bg-surface px-2 text-[12.5px] font-medium
                                transition-colors hover:bg-surface-3`}
                  >
                    {config.cert
                      ? 'Elegido'
                      : (guardado.afip_cert_cargado ? 'Reemplazar' : 'Subir')}
                    <input
                      type="file"
                      className="hidden"
                      aria-label="Archivo del certificado"
                      /* `accept` no es cosmético: sin él el selector ofrece
                         cualquier archivo y el error aparece recién al guardar
                         (A13, FR-099). */
                      accept=".crt,.pem,.cer,application/x-x509-ca-cert"
                      disabled={!puedeEditar}
                      onChange={(e) => leerArchivo(e, 'cert')}
                    />
                  </span>
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="eyebrow">Clave privada (.key)</span>
                  <span
                    className={`flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg
                                border border-border bg-surface px-2 text-[12.5px] font-medium
                                transition-colors hover:bg-surface-3`}
                  >
                    {config.key
                      ? 'Elegida'
                      : (guardado.afip_key_cargado ? 'Reemplazar' : 'Subir')}
                    <input
                      type="file"
                      className="hidden"
                      aria-label="Archivo de la clave privada"
                      accept=".key,.pem"
                      disabled={!puedeEditar}
                      onChange={(e) => leerArchivo(e, 'key')}
                    />
                  </span>
                </label>
              </div>

              <p className="text-[12.5px] leading-relaxed text-fg-3">
                Los dos van juntos: el certificado y la clave del pedido con el que lo sacaste. Si
                no son pareja, el guardado los rechaza — antes se descubría al facturar.
              </p>

              <Can
                codigo="config.editar"
                fallback={
                  <p className="text-[12.5px] text-fg-3">
                    No podés cambiar la configuración de facturación: te falta el permiso
                    «config.editar».
                  </p>
                }
              >
                <button type="submit" className={BOTON_PRINCIPAL} disabled={guardando}>
                  {guardando
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <ShieldCheck className="h-4 w-4" />}
                  Guardar
                </button>
              </Can>
            </div>
          </form>

          {/* ── Los servidores de ARCA ──

              Va abajo, aparte y en gris: contesta si ARCA está arriba, NO si esta
              empresa puede facturar. `FEDummy` no lleva `Auth`. */}
          <section className="rounded-xl border border-border bg-surface px-5 py-4 shadow-nivel-1">
            <h2>Servidores de ARCA</h2>
            <p className="mt-1 max-w-[60ch] text-[13px] leading-relaxed text-fg-2">
              {estado?.error_servidores
                ? estado.error_servidores
                : estado?.servidores_afip
                  ? Object.entries(estado.servidores_afip)
                    .map(([servidor, valor]) => `${servidor}: ${valor}`)
                    .join(' · ')
                  : 'Sin datos.'}
            </p>
            <p className="mt-1 max-w-[60ch] text-[12.5px] leading-relaxed text-fg-3">
              Esto dice si los servidores de ARCA responden. <strong>No</strong> dice si tu
              certificado sirve: la consulta no lo usa. Eso lo contesta «Verificar circuito».
            </p>
          </section>

          {/* ── Desvincular (FR-098) ── */}
          {(guardado.afip_cert_cargado || guardado.afip_key_cargado) && (
            <section className="rounded-xl border border-danger-line bg-surface px-5 py-4">
              <h2>Desvincular AFIP</h2>
              <p className="mt-1 max-w-[60ch] text-[13px] leading-relaxed text-fg-2">
                Borra el certificado, la clave privada, el punto de venta y el ambiente. El CUIT y
                las ventas ya facturadas <strong>no se tocan</strong>: un CAE emitido existe en
                AFIP y borrarlo de acá no lo deshace.
              </p>
              <Can
                codigo="config.editar"
                fallback={
                  <p className="mt-3 text-[12.5px] text-fg-3">
                    {faltaElPermiso('config.editar')}.
                  </p>
                }
              >
                <button type="button" className={`${BOTON_PELIGROSO} mt-3`} onClick={desvincular}>
                  <Unlink className="h-3.5 w-3.5" />
                  Desvincular AFIP
                </button>
              </Can>
            </section>
          )}

          {/* ── TiendaNube: acá solo queda el enlace ──

              La tarjeta que estaba en este lugar se fue entera en el hito 7:
              afirmaba dos cosas falsas —«el stock se sincroniza automáticamente
              mediante webhooks», sobre un webhook que respondía 401 a todo— y
              leía un `linked` que el endpoint ya no devuelve, así que decía «no
              vinculada» con la tienda vinculada. */}
          <section className="rounded-xl border border-border bg-surface px-5 py-4 shadow-nivel-1">
            <h2 className="flex items-center gap-2">
              <Store className="h-4 w-4 text-fg-3" /> TiendaNube
            </h2>
            <p className="mt-1 max-w-[60ch] text-[13px] leading-relaxed text-fg-2">
              El estado de la conexión, el mapeo de productos y la sincronización de stock viven en
              su propia pantalla.
            </p>
            <Link to="/tiendanube" className={`${BOTON_SECUNDARIO} mt-3`}>
              Ir a TiendaNube <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            {/* El aviso NO es cosmético, y se perdió una vez al reescribir esta
                pantalla: `/tiendanube` está detrás de un `RouteGuard` de módulo,
                así que mientras `tiendanube` no esté en los módulos habilitados
                de la empresa, este enlace **devuelve al punto de venta sin decir
                nada**. Un enlace que expulsa en silencio se lee como un sistema
                roto, y el que lo aprieta no tiene forma de saber que lo que
                falta es una habilitación y no la integración. */}
            <p className="mt-3 text-[12px] leading-relaxed text-fg-3">
              Si al entrar volvés al punto de venta, es que la integración todavía no está
              habilitada para esta empresa.
            </p>
          </section>
        </div>
      </div>

      <ConfirmDialog />
    </div>
  )
}
