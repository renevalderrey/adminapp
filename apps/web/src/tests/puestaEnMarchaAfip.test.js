import { describe, it, expect } from 'vitest'
import {
  DIAS_DE_AVISO,
  diasHastaVencer,
  etiquetaDePaso,
  puestaEnMarchaAfip,
  tonoDePaso,
} from '@/utils/puestaEnMarchaAfip'

// ════════════════════════════════════════════
//  La puesta en marcha de AFIP · las reglas
//
//  Lo que se afirma acá son REGLAS, no dibujo: qué estado tiene cada paso, cuándo
//  el checklist está completo, y cuántos días faltan para que venza el
//  certificado. El dibujo —que el badge esté en la fila que corresponde— es
//  `renderDeAjustesAfip.test.jsx`, que es diez veces más lento.
//
//  ── Los tres defectos que este archivo existe para que no vuelvan ──
//
//   1. **El certificado vencido se veía como una fecha más.** La tarjeta decía
//      «Vencimiento: 12/03/2026» en gris, igual que si faltaran dos años. Un
//      certificado vencido es la causa número uno de que un comercio deje de
//      poder facturar de un día para el otro, y AFIP no avisa antes.
//   2. **No había checklist**, así que no había forma de que dijera que estaba
//      completo cuando no lo estaba — ni de que lo dijera cuando sí.
//   3. **El paso 4 no existía**: el circuito nunca se había probado y no había
//      dónde registrar que se probó.
// ════════════════════════════════════════════

const AHORA = new Date('2026-08-06T12:00:00.000Z')

/** Una fecha a N días de `AHORA`. Negativo = en el pasado. */
const enDias = (n) => new Date(AHORA.getTime() + n * 24 * 60 * 60 * 1000).toISOString()

/**
 * Una empresa con todo en orden.
 *
 * ⚠ La fixture tiene los cuatro pasos cumplidos **de verdad**, y con datos que
 * se distinguen entre sí: el CUIT del certificado es el mismo que el
 * configurado, la verificación es del mismo punto de venta, y el certificado
 * empezó a valer ANTES de la verificación. Con una fixture a medias, media
 * docena de casos de abajo pasarían por el motivo equivocado.
 */
const COMPLETA = {
  configuracion: {
    afip_cuit: '30111111118',
    afip_pv: '5',
    afip_cert_cargado: true,
    afip_key_cargado: true,
  },
  certificado: {
    cuit: 'CUIT 30111111118',
    validFrom: enDias(-200),
    validTo: enDias(400),
  },
  verificacion: {
    resultado: 'ok',
    cuit: '30111111118',
    pv: 5,
    ambiente: 'homologation',
    verificado_en: enDias(-2),
  },
  // El veredicto del servidor (`GET /afip/status` → `circuito`), calculado por el
  // mismo `estadoDelCircuito` que decide el bloqueo del pase a producción. La
  // pantalla lo recibe: no lo recalcula ni lo adivina.
  circuito: { cumplido: true, via: 'verificacion', otro_certificado: false },
  ahora: AHORA,
}

/** El paso con ese código, del resultado. */
const paso = (resultado, codigo) => resultado.pasos.find((p) => p.codigo === codigo)

describe('los cuatro pasos salen siempre, y nunca con undefined', () => {
  it('devuelve los cuatro pasos, en el orden del trámite', () => {
    // El orden importa: es el del trámite en ARCA. Verificar el circuito antes de
    // tener el punto de venta no se puede, y el checklist tiene que leerse de
    // arriba abajo como una lista de cosas por hacer.
    const { pasos } = puestaEnMarchaAfip(COMPLETA)

    expect(pasos.map((p) => p.codigo)).toEqual([
      'cuit', 'certificado', 'punto_de_venta', 'circuito',
    ])
    expect(pasos.map((p) => p.numero)).toEqual([1, 2, 3, 4])
  })

  it('sin ningún dato NO devuelve undefined en ningún campo de ningún paso', () => {
    // FR-086. Un paso sin tono es un badge sin color; un paso sin detalle es una
    // fila que dice qué falta sin decir qué hacer. Y la empresa que todavía no
    // configuró nada es justamente la que más necesita leer los cuatro.
    const { pasos } = puestaEnMarchaAfip()

    expect(pasos).toHaveLength(4)

    for (const p of pasos) {
      expect(p.estado).toBeTruthy()
      expect(p.tono).toMatch(/border-.+ bg-.+ text-/)
      expect(p.etiqueta).toBeTruthy()
      expect(p.detalle.length).toBeGreaterThan(10)
      expect(typeof p.cumplido).toBe('boolean')
    }
  })

  it('un estado que no existe cae en «pendiente» y no en un tono vacío', () => {
    // La red de seguridad del badge: `tonoDePaso(undefined)` tiene que devolver
    // las tres clases igual. Sin esto, un estado nuevo mal escrito dibuja un
    // badge transparente y nadie lo nota.
    expect(tonoDePaso('inventado')).toBe(tonoDePaso('pendiente'))
    expect(tonoDePaso(undefined)).toContain('border-border')
    expect(etiquetaDePaso(undefined)).toBe('Pendiente')
  })
})

describe('el certificado vencido es un paso en rojo', () => {
  it('un certificado vencido ayer es un paso en rojo y no «vence en -1 días»', () => {
    // **El defecto 1.** La pantalla vieja imprimía `validTo` y nada más: un
    // certificado vencido ayer se veía igual que uno que vence en dos años, con
    // otra fecha. Lo que decide acá es el ESTADO, no el texto.
    const resultado = puestaEnMarchaAfip({
      ...COMPLETA,
      certificado: { ...COMPLETA.certificado, validTo: enDias(-1) },
    })

    const cert = paso(resultado, 'certificado')

    expect(cert.estado).toBe('error')
    expect(cert.cumplido).toBe(false)
    expect(cert.tono).toContain('text-danger')
    expect(cert.detalle).toMatch(/venció/i)
    expect(cert.detalle).not.toMatch(/-1 día/)
  })

  it('el certificado que vence en este mismo instante YA no sirve', () => {
    // La comparación es estricta a propósito. Con `>=`, el que vence justo ahora
    // se dibujaría verde y quien lo mire no va a renovar nada — hasta que el
    // primer comprobante del día siguiente sea rechazado.
    const resultado = puestaEnMarchaAfip({
      ...COMPLETA,
      certificado: { ...COMPLETA.certificado, validTo: AHORA.toISOString() },
    })

    expect(paso(resultado, 'certificado').estado).toBe('error')
  })

  it('un certificado que vence dentro del mes es amarillo, y dice cuántos días', () => {
    // FR-089. Amarillo y no rojo: todavía se puede facturar. Lo que hay que
    // hacer es sacar uno nuevo, y para eso hay que saber cuánto tiempo queda.
    const resultado = puestaEnMarchaAfip({
      ...COMPLETA,
      certificado: { ...COMPLETA.certificado, validTo: enDias(12) },
    })

    const cert = paso(resultado, 'certificado')

    expect(cert.estado).toBe('atencion')
    expect(cert.cumplido).toBe(true)
    expect(cert.dias).toBe(12)
    expect(cert.detalle).toContain('12 días')
  })

  it('un certificado con más de un mes por delante es verde', () => {
    // El contrapeso: sin este caso, una regla que pusiera todo en amarillo
    // pasaría los dos de arriba y la pantalla avisaría siempre — que es lo mismo
    // que no avisar nunca.
    const resultado = puestaEnMarchaAfip({
      ...COMPLETA,
      certificado: { ...COMPLETA.certificado, validTo: enDias(DIAS_DE_AVISO + 1) },
    })

    expect(paso(resultado, 'certificado').estado).toBe('listo')
  })

  it('«subido» y «vencido» son dos estados distintos, no el mismo', () => {
    // Sin el certificado cargado el paso es PENDIENTE (todavía no lo hiciste);
    // con uno vencido es ERROR (lo hiciste y no sirve). Piden cosas distintas y
    // por eso no se pueden ver igual.
    const sinSubir = puestaEnMarchaAfip({
      ...COMPLETA,
      configuracion: { ...COMPLETA.configuracion, afip_cert_cargado: false, afip_key_cargado: false },
      certificado: null,
    })

    expect(paso(sinSubir, 'certificado').estado).toBe('pendiente')
    expect(paso(sinSubir, 'certificado').detalle).toMatch(/Subí/)
  })

  it('la clave sin el certificado tampoco cuenta como subido', () => {
    // Los dos van juntos: con uno solo no se puede firmar nada, y es el caso que
    // el servidor rechaza con «se cargan juntos».
    const resultado = puestaEnMarchaAfip({
      ...COMPLETA,
      configuracion: { ...COMPLETA.configuracion, afip_key_cargado: false },
    })

    expect(paso(resultado, 'certificado').estado).toBe('pendiente')
  })
})

describe('diasHastaVencer', () => {
  it('redondea hacia arriba: veinte horas es un día, no cero', () => {
    // Redondear hacia abajo diría «vence en 0 días» sobre un certificado que
    // todavía sirve, y esa es la lectura que hace que alguien no lo renueve.
    const enVeinteHoras = new Date(AHORA.getTime() + 20 * 60 * 60 * 1000)

    expect(diasHastaVencer(enVeinteHoras, AHORA)).toBe(1)
  })

  it('una fecha ilegible da null y NO 1970', () => {
    // `new Date('cualquier cosa')` da `Invalid Date`, y restarle una fecha da
    // `NaN`: sin esta guarda, el detalle diría «vence en NaN días».
    expect(diasHastaVencer('no es una fecha', AHORA)).toBeNull()
    expect(diasHastaVencer(null, AHORA)).toBeNull()
  })

  // ── El número no puede cambiar durante el día ──
  //
  // Contaba sobre los INSTANTES, así que la resta cruzaba un múltiplo exacto de
  // veinticuatro horas en algún momento de la jornada y el mismo certificado
  // decía «28 días» a la mañana y «27» a la tarde.
  //
  // Nadie mira un número así dos veces seguidas y concluye «cambió la hora».
  // Concluye que el sistema no está seguro. Y de este número cuelga la severidad
  // del aviso, así que el mismo certificado podía verse amarillo a la mañana y
  // rojo a la tarde.
  describe('el número no se mueve a lo largo del día', () => {
    const VENCE = '2026-09-03T13:22:11.000Z'

    /** El mismo día, a esa hora local. */
    const aLasHoras = (hora) => new Date(2026, 7, 6, hora, 0, 0)

    it('a las 8, a las 13 y a las 20 dice lo mismo', () => {
      const mañana = diasHastaVencer(VENCE, aLasHoras(8))
      const mediodia = diasHastaVencer(VENCE, aLasHoras(13))
      const tarde = diasHastaVencer(VENCE, aLasHoras(20))

      expect(mediodia).toBe(mañana)
      expect(tarde).toBe(mañana)
    })

    it('y a lo largo de las veinticuatro horas tampoco', () => {
      // Barrer el día entero y no tres horas sueltas: el instante donde la
      // cuenta saltaba depende de la hora exacta del vencimiento, y tres puntos
      // elegidos a mano pueden caer todos del mismo lado.
      const delDia = new Set(
        Array.from({ length: 24 }, (_, hora) => diasHastaVencer(VENCE, aLasHoras(hora)))
      )

      expect([...delDia]).toHaveLength(1)
    })

    it('y al día siguiente baja EXACTAMENTE uno', () => {
      // El contra-caso. Un número que nunca se mueve pasaría los dos de arriba
      // —devolver una constante los pasa— y el aviso no llegaría nunca.
      const hoy = diasHastaVencer(VENCE, new Date(2026, 7, 6, 9, 0, 0))
      const mañana = diasHastaVencer(VENCE, new Date(2026, 7, 7, 9, 0, 0))

      expect(mañana).toBe(hoy - 1)
    })

    it('cuenta igual que el Panel, que ya contaba sobre el día', () => {
      // `services/dashboardService.js` hace `round((venceUTC − hoyUTC) / DÍA)` y
      // su comentario dice este mismo motivo. Las dos pantallas hablan del mismo
      // certificado: si dieran números distintos, una de las dos miente y no hay
      // forma de saber cuál.
      //
      // Se reproduce la cuenta del servidor acá en vez de importarla: son dos
      // aplicaciones distintas y el front no puede requerir del back. Lo que se
      // afirma es que los dos resultados coinciden.
      //
      // ⚠ El servidor le pasa a esa cuenta la fecha del vencimiento **en la zona
      // del negocio**, no en UTC. Escribir el test comparando contra la fecha
      // UTC fue lo que destapó que el Panel tenía además su propio defecto: un
      // certificado que muere el 7 a las 02:00 UTC muere el 6 a las 23:00 acá, y
      // el Panel decía «te queda 1 día» sobre algo que se apagaba esa noche.
      const DIA = 24 * 60 * 60 * 1000
      const comoUtc = (iso) => new Date(`${iso}T00:00:00Z`)
      const comoElPanel = (venceEnZonaDelNegocio, hoyISO) =>
        Math.round((comoUtc(venceEnZonaDelNegocio).getTime() - comoUtc(hoyISO).getTime()) / DIA)

      expect(diasHastaVencer('2026-09-03T13:22:11.000Z', new Date(2026, 7, 6, 9, 0, 0)))
        .toBe(comoElPanel('2026-09-03', '2026-08-06'))

      // El caso de borde: instante del 7 en UTC, día 6 en la zona del negocio.
      // Los dos tienen que decir 0 —«se te vence hoy»— y no 1.
      expect(diasHastaVencer('2026-08-07T02:00:00.000Z', new Date(2026, 7, 6, 22, 0, 0)))
        .toBe(comoElPanel('2026-08-06', '2026-08-06'))
    })

    it('el que vence hoy dice 0, y el que vencio ayer dice -1', () => {
      // Los dos bordes. «0» es «se te vence hoy», que es el aviso mas urgente
      // que existe, y tiene que distinguirse de «-1», que es «ya no podes
      // facturar».
      expect(diasHastaVencer('2026-08-06T23:00:00.000Z', new Date(2026, 7, 6, 9, 0, 0))).toBe(0)
      expect(diasHastaVencer('2026-08-05T23:00:00.000Z', new Date(2026, 7, 6, 9, 0, 0))).toBe(-1)
    })
  })
})

describe('el CUIT del certificado se compara con el configurado', () => {
  it('un certificado de otro CUIT pone el paso 1 en rojo y nombra los dos números', () => {
    // FR-088 del lado de la pantalla. El dato ya salía por `GET /afip/cert-info`
    // y ya se mostraba: lo que faltaba era alguien que los comparara. Sin esto
    // falla recién al pedir el ticket, con un mensaje de AFIP que no nombra
    // ningún número y manda a revisar el certificado equivocado.
    const resultado = puestaEnMarchaAfip({
      ...COMPLETA,
      certificado: { ...COMPLETA.certificado, cuit: 'CUIT 20999999997' },
    })

    const cuit = paso(resultado, 'cuit')

    expect(cuit.estado).toBe('error')
    expect(cuit.detalle).toContain('20999999997')
    expect(cuit.detalle).toContain('30111111118')
  })

  it('un CUIT de diez dígitos es un problema, no un paso cumplido', () => {
    const resultado = puestaEnMarchaAfip({
      ...COMPLETA,
      configuracion: { ...COMPLETA.configuracion, afip_cuit: '3011111111' },
      certificado: null,
    })

    expect(paso(resultado, 'cuit').estado).toBe('error')
  })

  it('el CUIT con guiones se cuenta igual que sin ellos', () => {
    // La ficha lo guarda como lo tipeó el usuario. Contar los guiones dejaría el
    // paso en rojo por un formato que el servidor limpia solo.
    const resultado = puestaEnMarchaAfip({
      ...COMPLETA,
      configuracion: { ...COMPLETA.configuracion, afip_cuit: '30-11111111-8' },
    })

    expect(paso(resultado, 'cuit').estado).toBe('listo')
  })
})

describe('el paso 4 es del circuito verificado, y de este punto de venta', () => {
  it('sin ninguna verificación el paso está pendiente y dice que no emite nada', () => {
    const resultado = puestaEnMarchaAfip({ ...COMPLETA, verificacion: null })
    const circuito = paso(resultado, 'circuito')

    expect(circuito.estado).toBe('pendiente')
    expect(circuito.detalle).toMatch(/no emite nada/i)
  })

  it('una verificación con error se ve distinta de no haber verificado nunca', () => {
    // «Probé y no anduvo» es un estado, no la ausencia de uno: pide arreglar algo
    // en ARCA, no apretar el botón por primera vez.
    const resultado = puestaEnMarchaAfip({
      ...COMPLETA,
      verificacion: { resultado: 'error', paso: 'punto_de_venta', cuit: '30111111118', pv: 5 },
    })

    expect(paso(resultado, 'circuito').estado).toBe('error')
    expect(paso(resultado, 'circuito').detalle).toMatch(/punto de venta/i)
  })

  it('el mensaje distingue cuál de los dos pasos falló', () => {
    const wsaa = puestaEnMarchaAfip({
      ...COMPLETA,
      verificacion: { resultado: 'error', paso: 'ticket_wsaa', cuit: '30111111118', pv: 5 },
    })

    expect(paso(wsaa, 'circuito').detalle).toMatch(/ticket de acceso/i)
    expect(paso(wsaa, 'circuito').detalle).not.toMatch(/punto de venta/i)
  })

  it('una verificación de OTRO punto de venta no cumple el paso', () => {
    // Es la mitad del circuito que el paso 2 de la verificación prueba: cambiar
    // el punto de venta después de verificar deja sin probar justamente lo que
    // origina la mitad de las llamadas «no puedo facturar».
    const resultado = puestaEnMarchaAfip({
      ...COMPLETA,
      verificacion: { ...COMPLETA.verificacion, pv: 3 },
    })

    expect(paso(resultado, 'circuito').estado).toBe('pendiente')
    expect(paso(resultado, 'circuito').detalle).toMatch(/verificá de nuevo/i)
  })

  it('«se verificó con otro certificado» avisa, pero NO deja el paso incumplido', () => {
    // ⚠ Avisa y no bloquea. El pase a producción implica cambiar el certificado:
    // si la evidencia se invalidara ahí, el paso 4 nunca se podría cumplir justo
    // cuando hace falta (ajuste 3 del plan).
    const resultado = puestaEnMarchaAfip({
      ...COMPLETA,
      circuito: { ...COMPLETA.circuito, otro_certificado: true },
    })

    const circuito = paso(resultado, 'circuito')

    expect(circuito.estado).toBe('atencion')
    expect(circuito.cumplido).toBe(true)
    expect(circuito.detalle).toMatch(/certificado distinto/i)
  })

  // ── Las dos fixtures que separan la huella de la heurística de fechas ──
  //
  // Esto se deducía acá comparando el `validFrom` del certificado contra
  // `verificado_en`: «si empezó a valer después, el que se verificó era otro».
  // Los dos casos de abajo son los que esa cuenta contesta al revés, y por eso
  // llevan el `validFrom` **peleado** con el veredicto del servidor: con fechas
  // que acompañaran, los dos pasarían con y sin la corrección.

  it('un certificado que empezó a valer ANTES de la verificación pero se cargó después', () => {
    // **El caso caro.** El certificado nuevo tiene `validFrom` de hace 200 días
    // —ARCA los emite con vigencia hacia atrás— y se subió ayer, después de la
    // verificación de anteayer. La heurística de fechas decía «es el mismo» y
    // dejaba el paso en VERDE afirmando que se verificó con el certificado en
    // uso, que es exactamente lo que nadie comprobó. La huella SHA-256 de la
    // evidencia contesta eso exacto, y el servidor la manda ya calculada.
    const resultado = puestaEnMarchaAfip({
      ...COMPLETA,
      certificado: { ...COMPLETA.certificado, validFrom: enDias(-200) },
      circuito: { ...COMPLETA.circuito, otro_certificado: true },
    })

    expect(paso(resultado, 'circuito').estado).toBe('atencion')
  })

  it('un certificado con validFrom posterior a la verificación NO avisa si es el mismo', () => {
    // El reverso, y es igual de real: se verificó, y después se recargó **el
    // mismo** certificado. La heurística ponía el paso en amarillo y mandaba a
    // repetir un trámite que no hacía falta. El servidor compara huellas y dice
    // que es el mismo.
    const resultado = puestaEnMarchaAfip({
      ...COMPLETA,
      certificado: { ...COMPLETA.certificado, validFrom: enDias(-1) },
      circuito: { ...COMPLETA.circuito, otro_certificado: false },
    })

    expect(paso(resultado, 'circuito').estado).toBe('listo')
  })
})

describe('la empresa que YA facturó tiene el paso 4 cumplido, sin verificar nada', () => {
  it('con la vía del CAE previo el paso está cumplido aunque no haya ninguna evidencia', () => {
    // **La rama que esta pantalla no veía.** El servidor la calcula —una venta
    // con `afip_cae` es la prueba más fuerte que existe de que el circuito
    // funciona— y le contesta 200 al pase a producción. Acá el paso se leía
    // «pendiente», con un texto que decía que hasta verificar no se podía pasar a
    // producción: falso, y falso justo para la empresa que más factura.
    const resultado = puestaEnMarchaAfip({
      ...COMPLETA,
      verificacion: null,
      circuito: { cumplido: true, via: 'cae_previo', otro_certificado: false },
    })

    const circuito = paso(resultado, 'circuito')

    expect(circuito.estado).toBe('listo')
    expect(circuito.cumplido).toBe(true)
    expect(circuito.detalle).toMatch(/comprobantes autorizados/i)
    expect(circuito.detalle).not.toMatch(/todavía no se probó/i)
    expect(resultado.completa).toBe(true)
  })

  it('un CAE previo con la última verificación fallida está cumplido, pero avisa', () => {
    // Las dos cosas son ciertas a la vez y las dos hay que decirlas: el paso no
    // bloquea nada —el servidor la deja pasar— y la verificación falló de verdad.
    // Dibujarlo «listo» a secas taparía la falla; dibujarlo «error» contradiría
    // al servidor y mandaría a arreglar un bloqueo que no existe.
    const resultado = puestaEnMarchaAfip({
      ...COMPLETA,
      verificacion: { resultado: 'error', paso: 'ticket_wsaa', cuit: '30111111118', pv: 5 },
      circuito: { cumplido: true, via: 'cae_previo', otro_certificado: false },
    })

    const circuito = paso(resultado, 'circuito')

    expect(circuito.estado).toBe('atencion')
    expect(circuito.cumplido).toBe(true)
    expect(circuito.detalle).toMatch(/verificación\s+falló/i)
  })

  it('sin la vía del CAE previo, una verificación fallida sigue siendo un paso en rojo', () => {
    // El contrapeso: sin este caso, una implementación que devolviera «cumplido»
    // ante cualquier `circuito` pasaría los dos de arriba y el paso 4 dejaría de
    // bloquear nada.
    const resultado = puestaEnMarchaAfip({
      ...COMPLETA,
      verificacion: { resultado: 'error', paso: 'ticket_wsaa', cuit: '30111111118', pv: 5 },
      circuito: { cumplido: false, via: null, otro_certificado: false },
    })

    expect(paso(resultado, 'circuito').estado).toBe('error')
    expect(paso(resultado, 'circuito').cumplido).toBe(false)
  })
})

describe('el checklist no dice que está completo si no lo está', () => {
  it('con los cuatro pasos cumplidos, dice que está completo', () => {
    const resultado = puestaEnMarchaAfip(COMPLETA)

    expect(resultado.completa).toBe(true)
    expect(resultado.pendientes).toBe(0)
  })

  it('con un paso pendiente, el checklist NO dice que está completo', () => {
    // FR-085. Y se prueba con el paso 4 justamente porque es el que se agregó: un
    // `completa` calculado sobre los tres viejos diría que sí.
    const resultado = puestaEnMarchaAfip({ ...COMPLETA, verificacion: null })

    expect(resultado.completa).toBe(false)
    expect(resultado.pendientes).toBe(1)
  })

  it('un paso en rojo tampoco lo deja completo', () => {
    const resultado = puestaEnMarchaAfip({
      ...COMPLETA,
      certificado: { ...COMPLETA.certificado, validTo: enDias(-1) },
    })

    expect(resultado.completa).toBe(false)
  })

  it('el amarillo NO deja el checklist incompleto', () => {
    // «Vence en veinte días» es algo que hay que hacer, no algo que falta hacer:
    // la empresa está facturando. Contarlo como pendiente diría que la puesta en
    // marcha no terminó cuando hace meses que terminó.
    const resultado = puestaEnMarchaAfip({
      ...COMPLETA,
      certificado: { ...COMPLETA.certificado, validTo: enDias(20) },
    })

    expect(resultado.completa).toBe(true)
    expect(resultado.pendientes).toBe(0)
  })

  it('sin nada configurado, los cuatro están pendientes', () => {
    const resultado = puestaEnMarchaAfip()

    expect(resultado.completa).toBe(false)
    expect(resultado.pendientes).toBe(4)
  })
})
