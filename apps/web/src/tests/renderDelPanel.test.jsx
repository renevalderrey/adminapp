import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import api from '@/services/api'
import useStore from '@/store/useStore'
import Dashboard from '@/pages/Dashboard'
import RequiereTuAtencion from '@/components/RequiereTuAtencion'
import TarjetaDeIndicador from '@/components/TarjetaDeIndicador'

// ════════════════════════════════════════════
//  ADMINAPP · /panel, renderizado
//
//  Las reglas —severidad, orden, etiqueta y alturas del sparkline— están en
//  `panel.test.js`, que es cien veces más barato. Acá se verifica lo único que
//  se ve montando, y es todo de la misma familia: **que la pantalla no invente
//  un número**.
//
//   · que un bloque que el servidor NO mandó no se dibuje como `$0,00`;
//   · que se diga, con nombre, qué indicadores no se ven y por qué;
//   · que una tarjeta sin serie no dibuje doce barras en cero;
//   · que el simulador no arranque con 7.000.000 ni con 2.400.000, y que un
//     campo vacío no muestre `NaN`;
//   · que un pedido fallido muestre un aviso en vez de seis tarjetas en `-`;
//   · y que la pantalla pida UN solo endpoint, que es lo que hace que un rol sin
//     `stock.ver` la siga viendo entera.
//
//  ── Cómo se monta ──
//
//  No se mockea `@/services/api` entero: el grafo de imports de esta pantalla
//  arrastra decenas de exportaciones nombradas y la lista se desactualiza sola.
//  Se espía la instancia de axios (`CONVENCIONES.md`, punto 2).
//
//  ⚠ El doble **rechaza cualquier URL que no sea `/dashboard/kpis`**. Es lo que
//  hace que el caso del rol sin `stock.ver` pueda ponerse en rojo: con un doble
//  permisivo, volver a pedir `/alerts` se vería igual que no pedirlo.
//
//  ⚠ Lo que este archivo NO puede afirmar: que el sparkline no desborde su
//  tarjeta y que las cuatro tarjetas arranquen en el mismo píxel. jsdom devuelve
//  CERO en `scrollWidth`, `clientWidth` y `getBoundingClientRect`, así que un
//  test que los mire pasa con y sin el cambio. Eso vive en
//  `pruebas-de-navegador/maquetadoDelPanel.navegador.js`.
// ════════════════════════════════════════════

/** Doce meses de serie, distintos entre sí para que un orden mal armado se vea. */
const DOCE = [10, 20, 15, 40, 35, 60, 55, 80, 70, 90, 85, 100]

/**
 * El payload de un `admin`: los cuatro bloques de plata y las cuatro series.
 *
 * ⚠ Los importes NO son redondos y NINGUNO es cero: un `$0,00` en la pantalla
 * tiene que poder atribuirse a un bloque ausente y no a un dato que da cero.
 */
const KPIS_ADMIN = {
  sales_30d: { total: 812345.67, count: 91, avg_ticket: 8926, by_method: { ef: 500000.5, tc1: 312345.17 } },
  sales_current_month: { total: 345678.9, count: 40 },
  sales_previous_month: { total: 300000, count: 35 },
  comparacion_parcial: true,
  customers: { active: 12, with_debt: 3 },
  products: { active: 40, low_stock: 5 },
  alerts: { low_stock: [], expiring: [] },
  cashflow: { balance: 123456.78, projected_30d: 200000.5, projected_60d: 260000.25 },
  supuesto_crecimiento: 1.1,
  receivables: { total: 45678.9, aging: { '0_30': 45678.9, '31_60': 0, '61_90': 0, '90_plus': 0 } },
  payables: { total: 23456.78, aging: { '0_30': 23456.78, '31_60': 0, '61_90': 0, '90_plus': 0 } },
  fixed_expenses: 98765.43,
  requiere_atencion: [
    { tipo: 'faltantes', cantidad: 12, alcance: 'sucursal', ruta: '/faltantes' },
    { tipo: 'vencimientos', cantidad: 3, alcance: 'sucursal', ruta: '/inventario', dias: 30 },
  ],
  ultimas_ventas: [
    { id: 'V-881', fecha: '2026-08-06', hora: '14:12', vendedor: 'Ana', total: 12500.5 },
  ],
  series: { ventas: DOCE, cashflow: DOCE, receivables: DOCE, payables: DOCE },
}

/**
 * El payload que recibe el rol `produccion`: **sin los cuatro bloques de plata**.
 *
 * No vienen en `null` ni en cero: **la clave no está** (decisión 8 del plan). Es
 * la fixture sin la cual el defecto que este corte cierra no se puede
 * distinguir: con `cashflow: null`, `kpis.cashflow?.balance || 0` da lo mismo
 * que con la clave ausente.
 */
const KPIS_PRODUCCION = {
  sales_30d: KPIS_ADMIN.sales_30d,
  sales_current_month: KPIS_ADMIN.sales_current_month,
  sales_previous_month: KPIS_ADMIN.sales_previous_month,
  comparacion_parcial: false,
  customers: { active: 12 },
  products: { active: 40, low_stock: 5 },
  alerts: { low_stock: [], expiring: [] },
  requiere_atencion: [{ tipo: 'faltantes', cantidad: 12, alcance: 'sucursal', ruta: '/faltantes' }],
  series: { ventas: DOCE },
}

/** Todo lo que salió por la red, en orden. */
let pedidos = []

beforeEach(() => {
  pedidos = []
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function montar({ kpis = KPIS_ADMIN, falla = null, settings = {} } = {}) {
  useStore.setState({
    // `initialize` se reemplaza porque la pantalla la llama en un `useEffect` al
    // montar y saldría a la red de verdad.
    initialize: vi.fn(),
    settings: { ...settings },
    permisos: ['dashboard.ver'],
  })

  vi.spyOn(api, 'get').mockImplementation((url) => {
    pedidos.push(url)

    if (url === '/dashboard/kpis') {
      if (falla) return Promise.reject(falla)
      return Promise.resolve({ data: { ok: true, data: kpis } })
    }

    // Cualquier otra URL es un endpoint que esta pantalla ya no pide.
    return Promise.reject(new Error(`La pantalla pidió ${url}, que no tiene que pedir`))
  })

  await act(async () => {
    render(
      <MemoryRouter initialEntries={['/panel']}>
        <Dashboard />
      </MemoryRouter>
    )
  })
}

/** Las tarjetas de indicador dibujadas, por su etiqueta. */
function tarjetas() {
  return [...document.querySelectorAll('[data-indicador]')]
    .map((n) => n.getAttribute('data-indicador'))
}

// ════════════════════════════════════════════
//  T1381 · «no tenés permiso» NO es «cero pesos»
// ════════════════════════════════════════════

describe('El Panel con un kpis recortado por permisos', () => {
  it('con el payload del rol produccion dibuja UNA tarjeta y ninguna en $0', async () => {
    await montar({ kpis: KPIS_PRODUCCION })

    expect(tarjetas()).toEqual(['Ventas del mes'])

    // El defecto que este corte cierra: `kpis.cashflow?.balance || 0` dibujaba
    // «$0,00» donde la respuesta honesta es «no lo podés ver».
    expect(screen.queryByText('$0,00')).toBeNull()
    expect(screen.queryByText(/^\$0(,00)?$/)).toBeNull()
  })

  it('dice CUÁLES indicadores no se ven y por qué, en un solo lugar', async () => {
    await montar({ kpis: KPIS_PRODUCCION })

    const aviso = document.querySelector('[data-bloques-ocultos]')

    expect(aviso).not.toBeNull()
    expect(aviso.textContent).toContain('el saldo de caja')
    expect(aviso.textContent).toContain('las cuentas por cobrar')
    expect(aviso.textContent).toContain('las cuentas por pagar')
    expect(aviso.textContent).toContain('los gastos fijos')
    // Y dice que no es un cero: es lo que separa «no lo ves» de «da cero».
    expect(aviso.textContent).toContain('No es que estén en cero')
  })

  it('con el payload completo dibuja las cuatro tarjetas y no el aviso de permisos', async () => {
    await montar()

    expect(tarjetas()).toEqual([
      'Ventas del mes', 'Saldo de caja', 'Por cobrar', 'Por pagar',
    ])
    expect(document.querySelector('[data-bloques-ocultos]')).toBeNull()
  })

  it('cada tarjeta lleva su nota al pie con la definición del número', async () => {
    await montar()

    // Es la parte durable de la decisión 7: cinco números se movieron el día del
    // deploy del corte 2, y la nota al pie es lo que hace que el dueño pueda
    // explicar el suyo sin abrir `OPERACION.md`.
    expect(screen.getByText(/Ventas no anuladas del mes/)).toBeInTheDocument()
    expect(screen.getByText(/Los gastos fijos se descuentan enteros/)).toBeInTheDocument()
    expect(screen.getByText(/Las ventas de contado no cuentan/)).toBeInTheDocument()
    expect(screen.getByText(/deuda menos pagos/)).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════
//  T1382 · un solo endpoint
// ════════════════════════════════════════════

describe('De dónde salen los datos del Panel', () => {
  it('un rol sin stock.ver ve el Panel completo: la pantalla pide UN solo endpoint', async () => {
    // `GET /api/alerts` pedía `stock.ver` mientras `/kpis` pide `dashboard.ver`.
    // Un rol con uno y sin el otro rechazaba el `Promise.all` y dejaba el Panel
    // entero en `-` y `0`, sin un cartel (hallazgo P9).
    await montar()

    expect(pedidos).toEqual(['/dashboard/kpis'])
    expect(tarjetas()).toHaveLength(4)
    expect(screen.queryByText(/No se pudieron cargar/)).toBeNull()
  })
})

// ════════════════════════════════════════════
//  T1381 · un pedido que falla no vacía la pantalla en silencio
// ════════════════════════════════════════════

describe('Cuando la API falla', () => {
  it('muestra el mensaje del servidor y ofrece reintentar, en vez de seis tarjetas en «-»', async () => {
    await montar({
      falla: {
        response: { data: { error: 'La empresa no tiene una suscripción activa.' } },
        message: 'Request failed with status code 402',
      },
    })

    // El mensaje del servidor, no el de axios: `err.message` sería «Request
    // failed with status code 402», que no se puede dictar por teléfono.
    expect(screen.getByText('La empresa no tiene una suscripción activa.')).toBeInTheDocument()
    expect(screen.queryByText(/Request failed/)).toBeNull()

    // Y no quedan tarjetas inventadas.
    expect(tarjetas()).toEqual([])
    expect(screen.getByText('Reintentar')).toBeInTheDocument()
  })

  it('el aviso no se dibuja cuando el pedido salió bien', async () => {
    // Sin esto, un cartel de error permanente pasaría este archivo entero.
    await montar()

    expect(screen.queryByText('Reintentar')).toBeNull()
  })
})

// ════════════════════════════════════════════
//  T1381 · el simulador no arranca con números inventados
// ════════════════════════════════════════════

describe('El simulador de punto de equilibrio', () => {
  const campoMeta = () => screen.getByLabelText('Facturación mensual')
  const campoGastos = () => screen.getByLabelText('Gastos fijos por mes')

  it('NO arranca con 7.000.000 ni con 2.400.000', async () => {
    // Eran dos literales de `Dashboard.jsx:49-50`. `target_sales` no existía en
    // ningún default y `fixed_expenses_total` tenía default `0`, que es falsy:
    // toda empresa que no lo hubiera cargado veía precios recomendados
    // calculados sobre plata inventada.
    await montar({ kpis: KPIS_PRODUCCION, settings: {} })

    expect(campoMeta().value).toBe('')
    expect(campoGastos().value).toBe('')
    expect(screen.queryByDisplayValue('7000000')).toBeNull()
    expect(screen.queryByDisplayValue('2400000')).toBeNull()
  })

  // ⚠ El nombre decía «sin datos» y `KPIS_PRODUCCION` **no trae la clave**
  // `fixed_expenses`: lo que se ejercita acá es el camino SIN PERMISO, no el de
  // una empresa que tiene el permiso y todavía no cargó ningún gasto. Ese otro
  // caso —la clave presente y en cero— pasaba con y sin corrección y está más
  // abajo, en «D1 · gastos fijos en $0».
  it('sin el permiso de gastos NO simula: dice qué falta y adónde cargarlo', async () => {
    await montar({ kpis: KPIS_PRODUCCION, settings: {} })

    expect(screen.getByText('Falta un dato para calcular.')).toBeInTheDocument()
    // Dos veces: la franja de gastos fijos dice que no se ven, y el simulador
    // dice qué hacer igual —se pueden escribir a mano—. Son dos mensajes
    // distintos para dos preguntas distintas y por eso se afirman por separado.
    expect(screen.getByText(/Podés escribirlos a mano/)).toBeInTheDocument()
    // ⚠ Se afirma el CÓDIGO y no la paráfrasis. Decía «el permiso de gastos»,
    // que el usuario no puede reenviarle a quien administra la empresa: lo que
    // esa persona busca en la lista de permisos es `gastos.ver`.
    expect(screen.getAllByText(/gastos\.ver/).length).toBeGreaterThan(0)
    // Y no hay ningún porcentaje recomendado sobre datos que no existen.
    expect(screen.queryByText(/recargo mínimo sobre el costo/)).toBeNull()
  })

  it('los gastos fijos salen de kpis.fixed_expenses, la MISMA fuente que la franja de arriba', async () => {
    await montar({ settings: { target_sales: 1000000 } })

    expect(campoGastos().value).toBe('98765.43')
    expect(campoMeta().value).toBe('1000000')
  })

  it('un campo vacío no muestra NaN', async () => {
    await montar({ settings: { target_sales: 1000000 } })

    fireEvent.change(campoMeta(), { target: { value: '' } })

    expect(document.body.textContent).not.toContain('NaN')
    expect(screen.getByText('Falta un dato para calcular.')).toBeInTheDocument()
  })

  it('cuando los gastos se llevan toda la facturación lo dice, y no muestra un precio', async () => {
    await montar({ settings: { target_sales: 1000000 } })

    fireEvent.change(campoGastos(), { target: { value: '1000000' } })

    expect(screen.getByText('No hay precio que cierre.')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('NaN')
  })

  // ── D1 · gastos fijos en $0 ──
  //
  // ⚠ El test de «sin el permiso de gastos NO simula», de acá arriba, **no
  // cubría este caso**: monta `KPIS_PRODUCCION`, que NO trae la clave
  // `fixed_expenses`, así que ejercita el camino «sin permiso» y pasa con y sin
  // esta corrección —de ahí el nombre que ahora lleva—. La
  // fixture que distingue el defecto es la clave PRESENTE y en cero: es lo que
  // devuelve el servidor cuando el usuario tiene `gastos.ver` y la empresa
  // todavía no cargó ningún gasto fijo.
  it('con fixed_expenses en 0 dice qué falta, y NO que los gastos se llevan todo lo que entra', async () => {
    await montar({
      kpis: { ...KPIS_ADMIN, fixed_expenses: 0 },
      settings: { target_sales: 1000000 },
    })

    expect(screen.getByText('Falta un dato para calcular.')).toBeInTheDocument()
    expect(screen.getByText(/Cargá tus gastos fijos en Gastos/)).toBeInTheDocument()

    // La frase que la spec reserva para gastos ≥ facturación. Con los gastos en
    // cero afirma lo contrario de lo que pasa.
    expect(screen.queryByText('No hay precio que cierre.')).toBeNull()
    expect(document.body.textContent).not.toContain('los gastos se llevan todo lo que entra')

    // Y el campo arranca vacío: un cero traído del servidor no es un importe con
    // el que simular, igual que un `target_sales` en cero.
    expect(campoGastos().value).toBe('')
  })

  it('escribir 0 en gastos fijos tampoco dispara «No hay precio que cierre»', async () => {
    // El campo vacío no alcanza: el usuario puede escribir el cero a mano, y ahí
    // el número entra por `gastosEscritos` sin pasar por `textoDeImporte`.
    await montar({ settings: { target_sales: 1000000 } })

    fireEvent.change(campoGastos(), { target: { value: '0' } })

    expect(screen.queryByText('No hay precio que cierre.')).toBeNull()
    expect(screen.getByText('Falta un dato para calcular.')).toBeInTheDocument()
    expect(screen.getByText(/Cargá tus gastos fijos en Gastos/)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('NaN')
  })
})

// ════════════════════════════════════════════
//  T1379 · la tarjeta de indicador
// ════════════════════════════════════════════

describe('La tarjeta de indicador', () => {
  const barras = () => document.querySelectorAll('[data-barra]')

  function montarTarjeta(props) {
    render(<TarjetaDeIndicador etiqueta="Ventas" valor="$1,2M" nota="Definición" {...props} />)
  }

  it('sin serie NO dibuja doce barras en cero', async () => {
    // Doce barras en cero para un negocio de cinco meses dibujan una caída que
    // nunca pasó. El servidor omite la clave justamente para que se pueda
    // distinguir «no hay doce meses» de «doce meses en cero» (FR-068).
    montarTarjeta({ serie: undefined })

    expect(barras()).toHaveLength(0)
    expect(document.querySelector('[data-sparkline]')).toBeNull()
    // Y la tarjeta sigue existiendo, con su número y su nota.
    expect(screen.getByText('$1,2M')).toBeInTheDocument()
    expect(screen.getByText('Definición')).toBeInTheDocument()
  })

  it('con doce puntos dibuja doce barras', async () => {
    montarTarjeta({ serie: DOCE })

    expect(barras()).toHaveLength(12)
  })

  it('sin variación no dibuja «+0.0%»', async () => {
    // `null` es «no se puede comparar» —el mes anterior fue cero— y NO «no
    // cambió». Dibujar «+0,0 %» afirmaría que el negocio quedó igual.
    montarTarjeta({ variacion: null })

    expect(screen.queryByText(/%$/)).toBeNull()
  })

  it('con variación la dibuja con su signo', async () => {
    montarTarjeta({ variacion: 15.23 })

    expect(screen.getByText('+15.2%')).toBeInTheDocument()
  })
})

// ════════════════════════════════════════════
//  T1380 · «Requiere tu atención»
// ════════════════════════════════════════════

describe('El bloque «Requiere tu atención»', () => {
  function montarBloque(avisos) {
    render(
      <MemoryRouter>
        <RequiereTuAtencion avisos={avisos} />
      </MemoryRouter>
    )
  }

  it('sin avisos NO se dibuja vacío: dice que no hay nada que atender', async () => {
    montarBloque([])

    expect(screen.getByText('No hay nada que atender ahora mismo.')).toBeInTheDocument()
    // Y el contador no dice «0»: un badge en cero al lado del título es la forma
    // más rápida de que el bloque deje de leerse.
    const bloque = document.querySelector('[data-bloque="requiere-atencion"]')

    expect(within(bloque).queryByText('0')).toBeNull()
  })

  it('cada aviso lleva a la pantalla que lo detalla', async () => {
    montarBloque([
      { tipo: 'faltantes', cantidad: 12, alcance: 'sucursal', ruta: '/faltantes' },
      { tipo: 'certificado_afip', dias: 3, alcance: 'empresa', ruta: '/facturacion' },
    ])

    const enlaces = [...document.querySelectorAll('a')].map((a) => a.getAttribute('href'))

    expect(enlaces).toContain('/faltantes')
    expect(enlaces).toContain('/facturacion')
  })

  it('el aviso de faltantes dice que el número es de la sucursal activa', async () => {
    montarBloque([{ tipo: 'faltantes', cantidad: 12, alcance: 'sucursal', ruta: '/faltantes' }])

    expect(screen.getByText('12 productos por debajo del mínimo')).toBeInTheDocument()
    expect(screen.getByText('en esta sucursal')).toBeInTheDocument()
  })

  it('los urgentes se dibujan primero', async () => {
    montarBloque([
      { tipo: 'vencimientos', cantidad: 30, alcance: 'empresa', ruta: '/inventario' },
      { tipo: 'faltantes', cantidad: 1, alcance: 'empresa', ruta: '/faltantes' },
    ])

    const titulos = [...document.querySelectorAll('li')].map((li) => li.textContent)

    expect(titulos[0]).toContain('por debajo del mínimo')
    expect(titulos[1]).toContain('vencen dentro de')
  })
})

// ════════════════════════════════════════════
//  T1381 · lo que la pantalla NO promete
// ════════════════════════════════════════════

describe('Lo que el Panel dice de sí mismo', () => {
  it('rotula «Últimas ventas» y no «Actividad reciente»', async () => {
    // No hay tabla de auditoría: de los cuatro tipos de evento que dibuja la
    // maqueta solo las ventas tienen autor guardado (decisión 19).
    await montar()

    expect(screen.getByText('Últimas ventas')).toBeInTheDocument()
    expect(screen.queryByText('Actividad reciente')).toBeNull()
  })

  it('dice que la proyección supone un 10 % de crecimiento', async () => {
    await montar()

    expect(screen.getByText(/10 % de crecimiento/)).toBeInTheDocument()
    expect(screen.getByText(/No es un dato\s*histórico/)).toBeInTheDocument()
  })

  it('avisa que la variación compara un mes parcial contra uno completo', async () => {
    await montar()

    expect(screen.getByText(/La variación compara un mes parcial/)).toBeInTheDocument()
  })
})
