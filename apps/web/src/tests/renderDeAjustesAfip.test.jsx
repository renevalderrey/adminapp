import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { toast } from 'sonner'
import api from '@/services/api'
import useStore from '@/store/useStore'
import Settings from '@/pages/Settings'

// ════════════════════════════════════════════
//  ADMINAPP · /facturacion, renderizado
//
//  Lo que se afirma acá es EL DIBUJO Y EL EFECTO. Las reglas —qué estado tiene
//  cada paso del checklist, cuándo un certificado está vencido, cuántos días
//  faltan— ya están en `puestaEnMarchaAfip.test.js`, que es cien veces más barato
//  y no se rompe cuando alguien mueve un `<div>`.
//
//  ── Los cuatro defectos que este archivo existe para que no vuelvan ──
//
//   1. **«Conectado: API operativa» era el único camino posible.** La pantalla
//      hacía `setAfipStatus(res.data)` sobre un `{ ok, data }` y después evaluaba
//      `afipStatus.error`, que en una respuesta exitosa **no existe nunca**. Y el
//      dato de atrás era `FEDummy`, que **no lleva `Auth`**: responde OK con el
//      certificado vencido, con la clave equivocada y sin ningún certificado
//      cargado.
//   2. **La maqueta dice que las llaves se guardan cifradas y que el `.key` queda
//      en el servidor. Las dos son falsas**, y `GUIA_AFIP.md` las repetía.
//      Copiarlas sería escribir una propiedad de seguridad que el sistema no
//      tiene, en la pantalla donde alguien decide si sube su material fiscal.
//   3. **En homologación nada avisaba** que los comprobantes no tienen validez
//      fiscal. Un comercio podía estar emitiendo contra el servidor de pruebas y
//      creyendo que facturaba.
//   4. **`config.cert` y `config.key` no se limpiaban después de guardar**, así
//      que la clave privada quedaba en el estado de React hasta recargar.
//
//  ── Cómo se monta ──
//
//  No se mockea `@/services/api` entero: el grafo de imports de esta pantalla
//  arrastra decenas de exportaciones nombradas y la lista se desactualiza sola.
//  Se espía la instancia de axios, que es lo que manda `CONVENCIONES.md`.
// ════════════════════════════════════════════

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const RAIZ = path.join(AQUI, '..', '..', '..', '..')

/**
 * ⚠ **Esta cadena no aparece en ninguna respuesta de la API**, y es a propósito:
 * `GET /api/settings` excluye `afip_key` (`utils/settingsSecretos.js`). Se usa
 * acá para que el caso pueda fallar de verdad: si mañana alguien volviera a
 * devolverla y la pantalla la pintara, este archivo lo dice.
 */
const CLAVE_PRIVADA = '-----BEGIN PRIVATE KEY-----MIIEvQIBADANBg-----END PRIVATE KEY-----'

const CONFIGURACION = {
  afip_cuit: '30111111118',
  afip_pv: '5',
  afip_environment: 'homologation',
  tax_condition: 'Monotributo',
  afip_cert_cargado: true,
  afip_key_cargado: true,
}

const CERTIFICADO = {
  issuer: 'AFIP',
  isProduction: false,
  subject: 'Panadería del Centro',
  cuit: 'CUIT 30111111118',
  validFrom: '2025-01-01T00:00:00.000Z',
  validTo: '2099-01-01T00:00:00.000Z',
}

/**
 * `FEDummy` en OK y **ninguna verificación**.
 *
 * Es la fixture que decide el defecto 1: con los tres servidores de ARCA
 * respondiendo, una pantalla que sacara el estado de ahí diría «Conectado».
 */
const SERVIDORES_ARRIBA = {
  servidores_afip: { AppServer: 'OK', DbServer: 'OK', AuthServer: 'OK' },
  error_servidores: null,
  verificacion: null,
  ambiente: 'homologation',
}

const VERIFICADO = {
  resultado: 'ok',
  cuit: '30111111118',
  pv: 5,
  ambiente: 'homologation',
  verificado_en: '2026-08-04T12:00:00.000Z',
}

const TODOS = ['config.ver', 'config.editar', 'ventas.ver', 'dashboard.ver']

/**
 * Una afirmación de que el material fiscal está cifrado.
 *
 * ⚠ **El patrón NO es «cifrad»**, y la diferencia importa: la frase que existía
 * de verdad —en la maqueta (`:730`) y en `GUIA_AFIP.md:45`— era «El sistema
 * **cifra** tu clave privada», sin la d. Una guardia que buscara «cifrad» pasaría
 * en verde sobre el texto exacto que viene a prohibir, que es la forma más cara
 * de tener una guardia.
 *
 * Lo que sí queda afuera, a propósito, son las formas en INFINITIVO —«sin
 * cifrar», «cifrarlos en reposo es un proyecto abierto»—: son las que dicen la
 * verdad, y una guardia que las prohibiera obligaría a callarse, que es
 * exactamente lo contrario de lo que se busca.
 */
const AFIRMA_CIFRADO = /\bcifra\b|\bcifrad[ao]s?\b|\bencripta\b|\bencriptad[ao]s?\b/i

/** Las líneas que afirman cifrado, con su número. Vacío = no lo afirma. */
function afirmaCifrado(texto) {
  return String(texto || '')
    .split('\n')
    .map((linea, i) => ({ n: i + 1, t: linea.trim() }))
    .filter(({ t }) => AFIRMA_CIFRADO.test(t))
    .map(({ n, t }) => `L${n}: ${t}`)
}

let pedidos = []
let interaccion

const respuesta = (data) => Promise.resolve({ data })

async function montar({
  configuracion = CONFIGURACION,
  certificado = CERTIFICADO,
  status = SERVIDORES_ARRIBA,
  avisos = [],
  permisos = TODOS,
  alVerificar = { ok: true, data: VERIFICADO },
  alGuardar = { ok: true },
} = {}) {
  useStore.setState({ permisos })

  vi.spyOn(api, 'get').mockImplementation((url) => {
    pedidos.push({ metodo: 'get', url })

    if (url === '/settings') return respuesta({ ok: true, data: configuracion })
    if (url === '/afip/cert-info') {
      return certificado
        ? respuesta({ ok: true, data: certificado })
        : respuesta({ ok: false, error: 'No hay certificado cargado' })
    }
    if (url === '/afip/status') return respuesta({ ok: true, data: status })
    if (url === '/dashboard/kpis') {
      return respuesta({ ok: true, data: { requiere_atencion: avisos } })
    }

    return respuesta({ ok: true, data: {} })
  })

  vi.spyOn(api, 'post').mockImplementation((url, cuerpo) => {
    pedidos.push({ metodo: 'post', url, cuerpo })

    const elegida = url === '/afip/verificar' ? alVerificar : alGuardar

    return elegida?.response ? Promise.reject(elegida) : respuesta(elegida)
  })

  vi.spyOn(api, 'delete').mockImplementation((url) => {
    pedidos.push({ metodo: 'delete', url })
    return respuesta({ ok: true })
  })

  await act(async () => {
    render(<MemoryRouter><Settings /></MemoryRouter>)
  })
}

// El store se vacía en el `beforeEach` y NO en el `afterEach`: vitest corre los
// `afterEach` en orden inverso al de registro, así que el de este archivo
// correría ANTES del `cleanup()` de `preparacion.js` —con la pantalla montada— y
// cada prueba terminaría imprimiendo «An update … was not wrapped in act(...)».
beforeEach(() => {
  pedidos = []
  interaccion = userEvent.setup()
  useStore.setState({ permisos: [] })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ════════════════════════════════════════════
//  El defecto 1: el banner salía de FEDummy
// ════════════════════════════════════════════

describe('el estado de la facturación no sale de FEDummy', () => {
  it('el banner no dice «Conectado» sobre un FEDummy', async () => {
    // **El caso completo.** Los tres servidores de ARCA en OK y ninguna
    // verificación: una pantalla que sacara el estado de ahí diría que está todo
    // bien sobre una empresa que nunca probó el circuito.
    await montar({ status: SERVIDORES_ARRIBA })

    expect(screen.queryByText(/Conectado/i)).toBeNull()

    const banner = document.querySelector('[data-estado-de-facturacion]')

    expect(banner.getAttribute('data-estado-de-facturacion')).toBe('sin_verificar')
    expect(banner.textContent).toMatch(/todavía no se verificó/i)
  })

  it('lo que FEDummy sí contesta se dibuja aparte, y dice que no habla del certificado', async () => {
    // El contrapeso: el dato sirve —distingue «AFIP está caído» de «tu
    // configuración está mal»— y por eso no se tira. Lo que no puede es decidir
    // el banner.
    await montar({ status: SERVIDORES_ARRIBA })

    const servidores = screen.getByRole('heading', { name: 'Servidores de ARCA' })
      .closest('section')

    expect(servidores.textContent).toContain('AppServer: OK')
    expect(servidores.textContent).toMatch(/No.+dice si tu certificado sirve/i)
  })

  it('con el circuito verificado y en producción, el banner sí lo dice', async () => {
    // Sin este caso, una pantalla que nunca dijera nada bueno pasaría los dos de
    // arriba: «no dice Conectado» se leería igual sobre una que no dibuja nada.
    await montar({
      status: { ...SERVIDORES_ARRIBA, verificacion: VERIFICADO, ambiente: 'production' },
    })

    const banner = document.querySelector('[data-estado-de-facturacion]')

    expect(banner.getAttribute('data-estado-de-facturacion')).toBe('produccion')
    expect(banner.textContent).toMatch(/Circuito verificado/i)
  })
})

// ════════════════════════════════════════════
//  El defecto 3: la validez fiscal de los comprobantes
// ════════════════════════════════════════════

describe('el ambiente se dice, y en homologación se dice qué significa', () => {
  it('en homologación dice que los comprobantes no tienen validez fiscal', async () => {
    // Es el aviso que evita que un comercio emita contra el servidor de pruebas
    // durante semanas creyendo que factura. `afipAuth.js` ya lo registra en el
    // log del servidor; el log no lo lee el dueño de la panadería.
    await montar()

    const banner = document.querySelector('[data-estado-de-facturacion]')

    expect(banner.textContent).toMatch(/homologación/i)
    expect(banner.textContent).toMatch(/NO tienen validez fiscal/i)
  })

  it('en producción NO dice que no tienen validez fiscal', async () => {
    await montar({
      status: { ...SERVIDORES_ARRIBA, verificacion: VERIFICADO, ambiente: 'production' },
    })

    const banner = document.querySelector('[data-estado-de-facturacion]')

    expect(banner.textContent).toMatch(/producción/i)
    expect(banner.textContent).not.toMatch(/NO tienen validez fiscal/i)
  })
})

// ════════════════════════════════════════════
//  El defecto 2: lo que la pantalla afirma sobre el material fiscal
// ════════════════════════════════════════════

describe('la pantalla dice la verdad sobre dónde queda el material fiscal', () => {
  it('la pantalla no muestra la clave privada de ninguna forma, ni enmascarada', async () => {
    // La API no la manda —`GET /settings` la excluye— y la pantalla tampoco la
    // pide. Se siembra igual en la respuesta para que el caso pueda fallar: si
    // alguien volviera a devolverla y la pantalla la pintara, esto lo dice.
    await montar({
      configuracion: { ...CONFIGURACION, afip_key: CLAVE_PRIVADA, afip_cert: CLAVE_PRIVADA },
    })

    expect(document.body.textContent).not.toContain('BEGIN PRIVATE KEY')
    expect(document.body.textContent).not.toContain('MIIEvQIBADANBg')

    // Ni enmascarada: un valor con asteriscos sigue siendo un campo que alguien
    // manda de vuelta en un `PUT` creyendo que lo conserva, y termina guardando
    // los asteriscos encima de la clave.
    expect(document.body.textContent).not.toContain('••••')
    expect(document.body.textContent).not.toContain('****')

    // Y el pedido tampoco se hace por la puerta de atrás.
    expect(pedidos.map((p) => p.url)).not.toContain('/settings/afip_key')
  })

  it('la pantalla no afirma que la clave se guarda cifrada', async () => {
    // ⚠ Se afirma sobre el TEXTO RENDERIZADO, con el detector de más abajo.
    //
    // El plan proponía buscar «cifrad», y **no alcanza**: la frase que había de
    // verdad en la maqueta y en la guía era «El sistema **cifra** tu clave
    // privada», que no tiene la d. Una guardia escrita así habría pasado en verde
    // sobre exactamente el texto que existe para prohibir. Está comprobado con
    // muestras sintéticas en «el detector de afirmaciones de cifrado».
    await montar()

    expect(afirmaCifrado(document.body.textContent)).toEqual([])

    // Y dice lo que SÍ es cierto: sin esta mitad, una pantalla que no dijera nada
    // sobre el tema pasaría igual, y el silencio es lo que hoy tapan las frases
    // falsas.
    expect(document.body.textContent).toMatch(/sin cifrar/i)
  })

  it('dice que la clave del CSR NO se guarda: se descarga y hay que conservarla', async () => {
    // La segunda frase falsa de la maqueta. `afipService.createCSR` la genera, la
    // devuelve una vez y no la persiste: quien la pierda tiene que rehacer el
    // trámite entero en ARCA, y eso hay que saberlo ANTES de cerrar la pestaña.
    await montar()

    expect(document.body.textContent).toMatch(/no se guarda acá: se descarga/i)
    expect(document.body.textContent).toMatch(/rehacer el trámite/i)
  })
})

// ════════════════════════════════════════════
//  El checklist y el botón que lo cumple
// ════════════════════════════════════════════

describe('la puesta en marcha muestra los cuatro pasos con su estado real', () => {
  it('con todo cargado y sin verificar, el paso 4 es el único pendiente', async () => {
    await montar()

    expect(document.querySelector('[data-paso="cuit"]').getAttribute('data-estado-del-paso'))
      .toBe('listo')
    expect(document.querySelector('[data-paso="circuito"]').getAttribute('data-estado-del-paso'))
      .toBe('pendiente')
    expect(document.querySelector('[data-puesta-en-marcha]').getAttribute('data-puesta-en-marcha'))
      .toBe('pendiente')
  })

  it('«Verificar circuito» llama al endpoint que NO emite nada', async () => {
    // El endpoint que emitía —`POST /afip/invoice`— se borró en el corte 3. Lo
    // que este botón llama consulta el último comprobante autorizado: no consume
    // numeración y no genera ningún CAE.
    await montar()

    await interaccion.click(screen.getByRole('button', { name: /Verificar circuito/ }))

    expect(pedidos.some((p) => p.metodo === 'post' && p.url === '/afip/verificar')).toBe(true)
    expect(pedidos.some((p) => p.url === '/afip/invoice')).toBe(false)
  })

  it('sin config.editar el botón queda deshabilitado CON su explicación', async () => {
    // La regla del repositorio es «deshabilitado con su explicación, no ausente»:
    // un botón que desaparece se lee como que la pantalla está rota.
    await montar({ permisos: ['config.ver'] })

    const boton = screen.getByRole('button', { name: /Verificar circuito/ })

    expect(boton).toBeDisabled()
    expect(boton.getAttribute('title')).toMatch(/config\.editar/)
  })
})

// ════════════════════════════════════════════
//  El defecto 4, y los mensajes del servidor
// ════════════════════════════════════════════

describe('guardar limpia el material fiscal y muestra el mensaje del servidor', () => {
  it('un error de la API muestra el mensaje del servidor y no «Request failed»', async () => {
    // Los mensajes que la API escribe en castellano —«El certificado y la clave
    // privada no son pareja»— no llegaban nunca: la pantalla mostraba
    // `err.message` de axios.
    const error = vi.spyOn(toast, 'error')

    await montar({
      alGuardar: {
        response: {
          status: 400,
          data: { error: 'El certificado y la clave privada no son pareja: esa clave no firma ese certificado.' },
        },
        message: 'Request failed with status code 400',
      },
    })

    await interaccion.click(screen.getByRole('button', { name: /^Guardar$/ }))

    expect(error).toHaveBeenCalledWith(expect.stringContaining('no son pareja'))
    expect(error).not.toHaveBeenCalledWith(expect.stringContaining('Request failed'))
  })

  it('el bloqueo del pase a producción llega con su explicación y no con el código', async () => {
    // El servidor responde `{ error: 'CIRCUITO_NO_VERIFICADO', message: '…' }`.
    // Leer `error` a ciegas pondría «CIRCUITO_NO_VERIFICADO» adentro de un toast:
    // no es «Request failed with status code 400», pero es igual de ilegible.
    const error = vi.spyOn(toast, 'error')

    await montar({
      alGuardar: {
        response: {
          status: 400,
          data: {
            error: 'CIRCUITO_NO_VERIFICADO',
            message: 'Antes de pasar a producción hay que verificar el circuito contra AFIP.',
          },
        },
      },
    })

    await interaccion.click(screen.getByRole('button', { name: /^Guardar$/ }))

    expect(error).toHaveBeenCalledWith(expect.stringContaining('verificar el circuito'))
    expect(error).not.toHaveBeenCalledWith(expect.stringContaining('CIRCUITO_NO_VERIFICADO'))
  })

  it('los dos inputs de archivo declaran accept', async () => {
    // Sin `accept` el selector ofrece cualquier archivo y el error aparece recién
    // al guardar, como «El certificado no es un PEM válido» sobre un PDF.
    await montar()

    expect(screen.getByLabelText('Archivo del certificado').getAttribute('accept'))
      .toContain('.crt')
    expect(screen.getByLabelText('Archivo de la clave privada').getAttribute('accept'))
      .toContain('.key')
  })
})

// ════════════════════════════════════════════
//  Ventas rechazadas y desvinculación
// ════════════════════════════════════════════

describe('las ventas que AFIP rechazó y la desvinculación', () => {
  it('dice cuántas ventas rechazó AFIP y lleva a reintentarlas', async () => {
    await montar({
      avisos: [{ tipo: 'sin_cae', cantidad: 3, alcance: 'empresa', ruta: '/ventas' }],
    })

    expect(screen.getByText(/AFIP rechazó y siguen sin/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: /Ver ventas/ }).getAttribute('href')).toBe('/ventas')
  })

  it('sin ninguna rechazada NO dibuja el aviso', async () => {
    // Un aviso que sale siempre es un aviso que nadie mira.
    await montar({ avisos: [] })

    expect(screen.queryByText(/AFIP rechazó y siguen sin/i)).toBeNull()
  })

  it('desvincular pide confirmación y dice que la clave no se puede recuperar', async () => {
    await montar()

    await interaccion.click(screen.getByRole('button', { name: /Desvincular AFIP/ }))

    // Todavía no se llamó a la API: primero hay que confirmar.
    expect(pedidos.some((p) => p.metodo === 'delete')).toBe(false)
    expect(screen.getByText(/la clave no se puede recuperar de acá/i)).toBeTruthy()
    expect(screen.getByText(/ventas ya facturadas conservan su CAE/i)).toBeTruthy()

    await interaccion.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect(pedidos.some((p) => p.metodo === 'delete' && p.url === '/afip/vinculacion')).toBe(true)
  })
})

// ════════════════════════════════════════════
//  T1408 · la guía y la pantalla dicen lo mismo
//
//  Es una guardia barata sobre dos afirmaciones exactas que hoy están mal, y vive
//  acá y no en un archivo propio porque lo que sostiene es la CONSISTENCIA entre
//  la guía y la pantalla: una guía que dice lo contrario de la pantalla es peor
//  que una guía desactualizada — la pantalla la lee quien está configurando, y la
//  guía la lee quien está decidiendo si configurar.
// ════════════════════════════════════════════

describe('la guía y la pantalla dicen lo mismo sobre la clave privada', () => {
  const GUIA = fs.readFileSync(path.join(RAIZ, 'docs', 'GUIA_AFIP.md'), 'utf8')

  it('la guía se leyó de verdad y no vino vacía', () => {
    // El ancla: un `readFileSync` con la ruta mal armada devolvería una cadena
    // vacía y las dos afirmaciones de abajo pasarían sin haber mirado nada. Es la
    // forma en que dos guardias de este repositorio ya murieron.
    expect(GUIA.length).toBeGreaterThan(1000)
    expect(GUIA).toContain('Facturación Electrónica')
  })

  it('la guía NO dice que el sistema cifra la clave privada', () => {
    // Decía, textual: «El sistema cifra tu clave privada» (`:45`). Es falso —se
    // guarda en `settings` en texto plano— y era lo primero que leía quien iba a
    // subir su material fiscal.
    expect(afirmaCifrado(GUIA)).toEqual([])
  })

  it('la guía dice lo que SÍ pasa: en texto plano, y la del CSR no se guarda', () => {
    // Sin esta mitad, borrar el párrafo entero también pondría la guardia en
    // verde — y el silencio en el documento que alguien lee antes de subir su
    // material fiscal es de lo que esta pantalla viene.
    expect(GUIA).toMatch(/en texto plano/i)
    expect(GUIA).toMatch(/no se guarda/i)
  })

  it('la guía NO dice que la clave del CSR se guarda en el servidor', () => {
    // La segunda: «guardará la clave privada de forma segura». No la guarda: la
    // devuelve al navegador una sola vez.
    expect(GUIA).not.toMatch(/guardar[áa] la clave privada/i)
  })

  it('el detector encuentra la frase que había DE VERDAD, no solo «cifrada»', () => {
    // **La muestra sintética, y no es ceremonia.** El plan proponía buscar
    // «cifrad»; el texto real era «El sistema **cifra** tu clave privada», sin la
    // d. Con el patrón del plan, esta guardia habría nacido en verde sobre el
    // documento que venía a corregir. Se ejercita contra las tres formas.
    expect(afirmaCifrado('> **Seguridad**: El sistema cifra tu clave privada.')).toHaveLength(1)
    expect(afirmaCifrado('La clave se guarda cifrada en la base.')).toHaveLength(1)
    expect(afirmaCifrado('El certificado queda encriptado en el servidor.')).toHaveLength(1)
  })

  it('el detector NO se queja de decir que NO se cifra', () => {
    // Sin esto la guardia podría estar fallando siempre, que es tan inútil como
    // no fallar nunca: nadie convive con una guardia que le prohíbe escribir la
    // verdad. Las dos formas de abajo son las que la guía y la pantalla usan.
    expect(afirmaCifrado('Se guardan en la base de datos de AdminApp, sin cifrar.')).toEqual([])
    expect(afirmaCifrado('Cifrarlos en reposo es un proyecto abierto.')).toEqual([])
  })

  it('la guía tiene una sección del certificado de HOMOLOGACIÓN', () => {
    // Es el trámite que el bloqueo del pase a producción vuelve obligatorio y que
    // la guía **no documentaba**: presentaba el ambiente como un interruptor sobre
    // el mismo material, y no lo es. Sin esta sección el bloqueo es un callejón
    // sin salida para cualquiera que siga la guía.
    const encabezados = GUIA.split('\n').filter((linea) => linea.trim().startsWith('#'))

    expect(encabezados.some((h) => /homologaci[óo]n/i.test(h))).toBe(true)
  })
})
