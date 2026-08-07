import { fechaCorta } from './formato'

// ════════════════════════════════════════════
//  ADMINAPP · La puesta en marcha de la facturación electrónica
//
//  Los cuatro pasos que evitan la llamada «no puedo facturar»: CUIT cargado,
//  certificado subido y vigente, punto de venta declarado y **circuito
//  verificado**. Es lo que pide 4.9 del plan.
//
//  ── Por qué es una función pura y no un `if` adentro del JSX ──
//
//  Porque lo que decide cada paso es una regla —«¿este certificado sigue
//  sirviendo?», «¿esta verificación es de este punto de venta?»— y una regla
//  probada con un test de render es diez veces más cara y se rompe cuando alguien
//  mueve un `<div>`. El dibujo va aparte, en `components/PuestaEnMarchaAfip.jsx`.
//
//  ── Nunca devuelve `undefined` ──
//
//  Ni en `estado`, ni en `tono`, ni en `detalle` (FR-086). Un paso sin tono es un
//  badge sin color y un paso sin detalle es una fila que dice qué falta sin decir
//  qué hacer — que es exactamente el estado del que esta pantalla viene.
//
//  ── Y un certificado vencido es un paso EN ROJO ──
//
//  No «vence el 12/03/2026» en gris, que es como se veía: una fecha más en una
//  tarjeta. Un certificado vencido es la causa número uno de que un comercio deje
//  de poder facturar de un día para el otro, y AFIP no avisa antes (FR-090).
// ════════════════════════════════════════════

/** Un día, en milisegundos. */
const DIA = 24 * 60 * 60 * 1000

/**
 * A partir de cuántos días de vencimiento el paso pasa a amarillo.
 *
 * Treinta y no siete: sacar un certificado nuevo en ARCA es un trámite con clave
 * fiscal, y el aviso tiene que llegar cuando todavía hay tiempo de hacerlo sin
 * apuro. Con siete días, quien mira la pantalla un lunes se entera el lunes
 * siguiente, con el certificado ya vencido.
 */
export const DIAS_DE_AVISO = 30

/** Las cuatro clases de estado, con el badge que le corresponde a cada una. */
const TONOS = {
  listo: 'border-ok-line bg-ok-soft text-ok',
  // Amarillo: está cumplido pero hay algo que va a dejar de estarlo.
  atencion: 'border-warn-line bg-warn-soft text-warn',
  // Neutro: todavía no se hizo. No es una alarma, es un paso por delante.
  pendiente: 'border-border bg-surface-3 text-fg-2',
  // Rojo: se hizo y NO sirve. Es lo que separa «falta el certificado» de
  // «el certificado que subiste está vencido», que piden cosas distintas.
  error: 'border-danger-line bg-danger-soft text-danger',
}

const ETIQUETAS = {
  listo: 'Listo',
  atencion: 'Revisar',
  pendiente: 'Pendiente',
  error: 'Con problema',
}

/** Las tres clases del badge de un paso, en un solo string. Nunca `undefined`. */
export function tonoDePaso(estado) {
  return TONOS[estado] || TONOS.pendiente
}

/** La etiqueta del badge de un paso. Nunca `undefined`. */
export function etiquetaDePaso(estado) {
  return ETIQUETAS[estado] || ETIQUETAS.pendiente
}

/** Un paso cumplido es el que está en verde **o** en amarillo. */
const CUMPLIDOS = ['listo', 'atencion']

/** Solo los dígitos: un CUIT se compara así venga con guiones o sin ellos. */
function soloDigitos(valor) {
  return String(valor === null || valor === undefined ? '' : valor).replace(/\D/g, '')
}

/** Una fecha utilizable, o `null`. Lo ilegible NO se convierte en 1970. */
function comoFecha(valor) {
  if (!valor) return null

  const fecha = valor instanceof Date ? valor : new Date(valor)
  return Number.isNaN(fecha.getTime()) ? null : fecha
}

/**
 * Cuántos días faltan para que venza el certificado. Negativo si ya venció.
 *
 * Se redondea **hacia arriba**: un certificado que vence en veinte horas tiene
 * «1 día», no «0». Redondear hacia abajo diría «vence en 0 días» sobre algo que
 * todavía sirve, y esa es la lectura que hace que alguien no lo renueve.
 *
 * @returns {number|null} `null` si no hay una fecha utilizable.
 */
export function diasHastaVencer(validTo, ahora = new Date()) {
  const vence = comoFecha(validTo)
  const referencia = comoFecha(ahora) || new Date()

  if (!vence) return null

  return Math.ceil((vence.getTime() - referencia.getTime()) / DIA)
}

/**
 * Si el certificado todavía sirve.
 *
 * ⚠ La comparación es **estricta**: un certificado cuyo vencimiento es este
 * mismo instante ya no sirve. Con `>=`, el que vence justo ahora se dibujaría
 * verde y quien lo mire no va a renovar nada — hasta que el primer comprobante
 * del día siguiente sea rechazado.
 */
function estaVigente(validTo, ahora) {
  const vence = comoFecha(validTo)
  const referencia = comoFecha(ahora) || new Date()

  return Boolean(vence) && vence.getTime() > referencia.getTime()
}

/** El paso 1: el CUIT con el que se factura. */
function pasoDelCuit(configuracion, certificado) {
  const cuit = soloDigitos(configuracion.afip_cuit)

  if (!cuit) {
    return {
      estado: 'pendiente',
      detalle: 'Cargá el CUIT con el que esta empresa emite sus comprobantes.',
    }
  }

  if (cuit.length !== 11) {
    return {
      estado: 'error',
      detalle: `El CUIT cargado (${cuit}) no tiene once dígitos. AFIP lo va a rechazar.`,
    }
  }

  // FR-088 del lado de la pantalla. El dato ya salía por `GET /afip/cert-info` y
  // ya se mostraba: lo que faltaba era alguien que los comparara. Un certificado
  // de otro CUIT —el del contador, el de la otra sociedad— falla recién al pedir
  // el ticket, con un mensaje de AFIP que no nombra ningún número.
  const delCertificado = soloDigitos(certificado && certificado.cuit)

  if (delCertificado && delCertificado !== cuit) {
    return {
      estado: 'error',
      detalle:
        `El certificado está emitido para el CUIT ${delCertificado} y acá está ` +
        `configurado el ${cuit}. Uno de los dos está mal.`,
    }
  }

  return { estado: 'listo', detalle: `Facturás con el CUIT ${cuit}.` }
}

/** El paso 2: el certificado y su clave, subidos y vigentes. */
function pasoDelCertificado(configuracion, certificado, ahora) {
  const cert = configuracion.afip_cert_cargado === true
  const clave = configuracion.afip_key_cargado === true

  if (!cert || !clave) {
    return {
      estado: 'pendiente',
      detalle:
        'Subí el certificado (.crt) que bajaste de ARCA junto con la clave privada ' +
        '(.key) del pedido con el que lo sacaste. Los dos van juntos.',
    }
  }

  if (!certificado || !certificado.validTo) {
    // Hay material cargado y no se pudo leer: es distinto de «falta subirlo» y
    // pide otra cosa —volver a subirlo—, así que no puede verse igual.
    return {
      estado: 'error',
      detalle: 'Hay un certificado cargado pero no se pudo leer. Volvé a subirlo.',
    }
  }

  const dias = diasHastaVencer(certificado.validTo, ahora)

  if (!estaVigente(certificado.validTo, ahora)) {
    return {
      estado: 'error',
      detalle:
        `El certificado venció el ${fechaCorta(certificado.validTo)}. ` +
        'Mientras esté vencido no se puede emitir ningún comprobante: sacá uno nuevo en ARCA.',
      dias,
    }
  }

  if (dias !== null && dias <= DIAS_DE_AVISO) {
    return {
      estado: 'atencion',
      detalle:
        `El certificado vence el ${fechaCorta(certificado.validTo)}, en ${dias} ` +
        `${dias === 1 ? 'día' : 'días'}. Sacá uno nuevo en ARCA antes de esa fecha.`,
      dias,
    }
  }

  return {
    estado: 'listo',
    detalle: `Certificado vigente hasta el ${fechaCorta(certificado.validTo)}.`,
    dias,
  }
}

/** El paso 3: el punto de venta declarado en ARCA. */
function pasoDelPuntoDeVenta(configuracion) {
  const pv = String(configuracion.afip_pv === null || configuracion.afip_pv === undefined
    ? ''
    : configuracion.afip_pv).trim()

  if (!pv || Number(pv) <= 0 || Number.isNaN(Number(pv))) {
    return {
      estado: 'pendiente',
      detalle:
        'Cargá el punto de venta que diste de alta en ARCA como «Factura Electrónica - ' +
        'Web Services». No es el número de tu sucursal.',
    }
  }

  return { estado: 'listo', detalle: `Emitís con el punto de venta ${pv}.` }
}

/**
 * El paso 4: el circuito ejercitado contra AFIP.
 *
 * ⚠ **Es el que bloquea el pase a producción**, y por eso su evidencia la escribe
 * el servidor: `PUT /api/settings/afip_verificacion` la rechaza. Un paso de
 * checklist que el cliente puede marcar solo no es un paso de checklist.
 */
function pasoDelCircuito(configuracion, verificacion, certificado) {
  if (!verificacion) {
    return {
      estado: 'pendiente',
      detalle:
        'Todavía no se probó el circuito. «Verificar circuito» pide el ticket de acceso ' +
        'y consulta el último comprobante autorizado: no emite nada ni consume numeración.',
    }
  }

  if (verificacion.resultado !== 'ok') {
    return {
      estado: 'error',
      detalle:
        verificacion.paso === 'ticket_wsaa'
          ? 'La última verificación falló al pedir el ticket de acceso: AFIP no aceptó el ' +
            'certificado o el servicio no está delegado a ese alias.'
          : 'La última verificación falló en el punto de venta: AFIP no lo reconoce para ' +
            'este CUIT.',
    }
  }

  const mismoCuit = soloDigitos(verificacion.cuit) === soloDigitos(configuracion.afip_cuit)
  const mismoPv = String(verificacion.pv) === String(
    configuracion.afip_pv === null || configuracion.afip_pv === undefined
      ? ''
      : configuracion.afip_pv
  ).trim()

  if (!mismoCuit || !mismoPv) {
    // La verificación probó OTRA configuración. Dejarla como cumplida sería
    // decir que el punto de venta que se está por usar funciona, cuando lo que
    // se probó fue otro — y ese es justamente el paso que impide la mitad de las
    // llamadas «no puedo facturar».
    return {
      estado: 'pendiente',
      detalle:
        `La última verificación fue con el CUIT ${soloDigitos(verificacion.cuit) || '—'} y el ` +
        `punto de venta ${verificacion.pv}. Cambió la configuración: verificá de nuevo.`,
    }
  }

  // ⚠ **Esto avisa, NO bloquea.** El pase a producción implica cambiar el
  // certificado, así que invalidar la evidencia al cambiarlo dejaría el paso 4
  // imposible de cumplir justo cuando hace falta (ajuste 3 del plan).
  //
  // Se detecta sin la huella —que el navegador no tiene, porque el certificado no
  // sale por la API— comparando fechas: si el certificado en uso empezó a valer
  // DESPUÉS de la verificación, el que se verificó era otro.
  const verificadoEn = comoFecha(verificacion.verificado_en)
  const desde = comoFecha(certificado && certificado.validFrom)

  if (verificadoEn && desde && desde.getTime() > verificadoEn.getTime()) {
    return {
      estado: 'atencion',
      detalle:
        `Se verificó el ${fechaCorta(verificacion.verificado_en)}, con un certificado ` +
        'anterior al que está cargado hoy. Conviene verificar de nuevo.',
    }
  }

  return {
    estado: 'listo',
    detalle:
      `Circuito verificado el ${fechaCorta(verificacion.verificado_en)} contra ` +
      `${verificacion.ambiente === 'production' ? 'producción' : 'homologación'}.`,
  }
}

/** Los cuatro pasos, con su número y su título. El orden es el del trámite. */
const DEFINICIONES = [
  { codigo: 'cuit', titulo: 'CUIT cargado', calcular: (d) => pasoDelCuit(d.configuracion, d.certificado) },
  {
    codigo: 'certificado',
    titulo: 'Certificado subido y vigente',
    calcular: (d) => pasoDelCertificado(d.configuracion, d.certificado, d.ahora),
  },
  {
    codigo: 'punto_de_venta',
    titulo: 'Punto de venta declarado',
    calcular: (d) => pasoDelPuntoDeVenta(d.configuracion),
  },
  {
    codigo: 'circuito',
    titulo: 'Circuito verificado',
    calcular: (d) => pasoDelCircuito(d.configuracion, d.verificacion, d.certificado),
  },
]

/**
 * El estado de la puesta en marcha de AFIP de una empresa.
 *
 * @param {object} [datos]
 * @param {object} [datos.configuracion] Lo que devuelve `GET /api/settings`:
 *   `afip_cuit`, `afip_pv`, `afip_cert_cargado`, `afip_key_cargado`.
 * @param {object|null} [datos.certificado] Lo que devuelve `GET /api/afip/cert-info`.
 * @param {object|null} [datos.verificacion] La evidencia de `GET /api/afip/status`.
 * @param {Date} [datos.ahora] Inyectable: sin esto el vencimiento no se puede testear.
 * @returns {{pasos: Array<object>, completa: boolean, pendientes: number}}
 */
export function puestaEnMarchaAfip({
  configuracion = {},
  certificado = null,
  verificacion = null,
  ahora = new Date(),
} = {}) {
  const datos = { configuracion: configuracion || {}, certificado, verificacion, ahora }

  const pasos = DEFINICIONES.map((definicion, i) => {
    const resultado = definicion.calcular(datos) || {}
    const estado = TONOS[resultado.estado] ? resultado.estado : 'pendiente'

    return {
      codigo: definicion.codigo,
      numero: i + 1,
      titulo: definicion.titulo,
      estado,
      cumplido: CUMPLIDOS.includes(estado),
      tono: tonoDePaso(estado),
      etiqueta: etiquetaDePaso(estado),
      detalle: resultado.detalle || '',
      dias: resultado.dias === undefined ? null : resultado.dias,
    }
  })

  const pendientes = pasos.filter((p) => !p.cumplido).length

  // FR-085: no puede decir que está completo si algún paso no lo está. Se calcula
  // de los pasos y no se pasa por afuera para que no puedan discrepar.
  return { pasos, completa: pendientes === 0, pendientes }
}
