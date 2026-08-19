import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import useStore from '@/store/useStore'
import api from '@/services/api'
import Billing from '@/pages/Billing'
import CatalogoDelPos from '@/components/pos/CatalogoDelPos'
import TicketDelPos from '@/components/pos/TicketDelPos'

// ════════════════════════════════════════════
//  FAVALIO · Las cantidades del mostrador, después de migrar la columna (016)
//
//  `stock.quantity` y `stock.available` pasaron de `INTEGER` a `NUMERIC(14,4)`
//  y el driver de Postgres entrega un `NUMERIC` **como texto con la escala
//  puesta**: un disponible de 5 llega `"5.0000"`. Los tres puntos del punto de
//  venta lo escribían crudo, así que la baldosa del catálogo decía «5.0000 u.»
//  y el aviso de stock, «hay 5.0000 en esta sucursal».
//
//  Lo que se afirma acá es que **no cambió nada**: con datos enteros la pantalla
//  se ve carácter por carácter como antes de migrar.
//
//  ── Por qué este archivo existe aparte de `renderDelPuntoDeVenta.test.jsx` ──
//
//  Ése monta la pantalla entera para afirmar EFECTOS —qué dispara una tecla,
//  qué manda el cobro—. Acá se afirma un dibujo, y dos de los tres casos no
//  necesitan la pantalla: `CatalogoDelPos` y `TicketDelPos` reciben todo por
//  props y no leen el store, que es justamente lo que una guardia de
//  `guardiasDeDiseno.test.js` protege. Montarlos solos cuesta una fracción.
// ════════════════════════════════════════════

const CENTRO = { id: 1, name: 'Centro', code: 'centro', is_active: true }

const SETTINGS = {
  margin_efectivo: 0,
  recargo_tarjeta: 20,
  descuento_alianza: 10,
  tax_condition: 'Monotributo',
  afip_cuit: '20304050607',
  afip_pv: '5',
}

/**
 * El producto tal como llega de la API con la columna ya migrada.
 *
 * ⚠ El stock se siembra con STRINGS y no con números a propósito: es lo que
 * devuelven las dos puntas que escriben esta fila —`GET /api/products` y el
 * arreglo `stock` de `POST /api/sales`—. Con números, el caso pasa con y sin la
 * corrección y no prueba nada.
 */
const COLAGENO = {
  id: 10,
  name: 'Colágeno 300g',
  sku: 'COL-300',
  cost: '1000',
  category: 'colageno',
  brand: { name: 'Star' },
  stock: [{ id: 100, punto_de_venta_id: 1, quantity: '5.0000', available: '5.0000' }],
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// ════════════════════════════════════════════
//  Punto 2 · La baldosa del catálogo
// ════════════════════════════════════════════

describe('el disponible del catálogo se escribe como antes de migrar', () => {
  const filaDe = (disponible) => ({
    id: 10,
    nombre: 'Colágeno 300g',
    marca: 'Star',
    sku: 'COL-300',
    disponible,
    agotado: Number(disponible) <= 0,
    sinCosto: false,
    efectivo: 1500,
    tarjeta: 1800,
    alianza: 1350,
  })

  const montarCatalogo = (disponible) => render(
    <CatalogoDelPos filas={[filaDe(disponible)]} />
  )

  it('NO dibuja «5.0000 u.»: el disponible que llega como texto se ve «5 u.»', () => {
    montarCatalogo('5.0000')

    expect(screen.getByText(/5 u\./)).toBeInTheDocument()
    expect(screen.queryByText(/5\.0000/)).not.toBeInTheDocument()
  })

  it('un disponible fraccionario lleva coma: «9,6 u.» y nunca «9.6 u.»', () => {
    // En es-AR el punto es el separador de MILES: «9.6 u.» se lee nueve mil
    // seiscientas unidades de un producto del que hay nueve y medio.
    montarCatalogo('9.6000')

    expect(screen.getByText(/9,6 u\./)).toBeInTheDocument()
    expect(screen.queryByText(/9\.6/)).not.toBeInTheDocument()
  })

  it('un stock de cuatro cifras sigue siendo «1234 u.» y no «1.234 u.»', () => {
    // El caso que obligó a apagar la agrupación de `enEsAr`: con el separador
    // de miles puesto, el formateador que vino a que nada cambiara le cambiaría
    // el número a todo stock de cuatro cifras.
    montarCatalogo('1234.0000')

    expect(screen.getByText(/1234 u\./)).toBeInTheDocument()
    expect(screen.queryByText(/1\.234 u\./)).not.toBeInTheDocument()
  })
})

// ════════════════════════════════════════════
//  FR-034a · La cantidad de la línea del ticket
//
//  No es una regresión del día de la migración —`qty` sale del carrito del
//  navegador—, pero es la misma función por el mismo motivo: la coma.
// ════════════════════════════════════════════

describe('la cantidad de una línea del ticket', () => {
  const montarTicket = (qty) => render(
    <TicketDelPos
      lineas={[{ id: 10, name: 'Colágeno 300g', price: 1500, qty, method: 'ef' }]}
      total={1500 * Number(qty)}
    />
  )

  it('con un entero muestra exactamente lo mismo que hoy', () => {
    montarTicket(3)

    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('con 9,6 escribe «9,6» y no «9.6»', () => {
    montarTicket(9.6)

    expect(screen.getByText('9,6')).toBeInTheDocument()
    expect(screen.queryByText('9.6')).not.toBeInTheDocument()
  })
})

// ════════════════════════════════════════════
//  Punto 3 · El aviso de que el ticket pasa el disponible
//
//  Éste sí necesita la pantalla: el texto lo arma `Billing.jsx` con lo que
//  `filaDeStock` saca del store, y es la única forma de que el `available` de
//  verdad llegue a la frase.
// ════════════════════════════════════════════

describe('el aviso de stock del punto de venta', () => {
  async function montarPantalla({ productos = [COLAGENO], cart = [] } = {}) {
    useStore.setState({
      products: productos,
      brands: [],
      sucursales: [CENTRO],
      permisos: ['ventas.crear'],
      settings: SETTINGS,
      usuario: { id: 1, es_superadmin: false },
      empresaActiva: { id: 1, name: 'Comprafit', puntosDeVenta: [CENTRO] },
      puntoDeVentaActivo: CENTRO,
      cart,
      loading: false,
      error: null,
      initialize: vi.fn(),
    })

    await act(async () => {
      render(<Billing />)
      // El `ScrollArea` del carrito se mide desde un `setTimeout` y actualiza su
      // estado ahí: sin el turno, esa actualización cae fuera de `act`.
      await new Promise((seguir) => setTimeout(seguir, 0))
    })
  }

  beforeEach(() => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: { ok: true, data: [] } })
    vi.spyOn(api, 'post').mockResolvedValue({ data: { ok: true, data: {}, stock: [] } })
  })

  it('NO dice «hay 5.0000 en esta sucursal»', async () => {
    // Cinco disponibles —como texto, que es como los manda la API con la
    // columna migrada— y seis en el ticket.
    await montarPantalla({
      cart: [{ id: 10, name: 'Colágeno 300g', price: 1500, qty: 6, method: 'ef' }],
    })

    // Se mira el texto del AVISO y no todo el documento: la baldosa del
    // catálogo dibuja el mismo disponible, y una aserción sobre `screen` entero
    // se pondría en rojo por el punto 2 cuando lo que se está verificando es el
    // 3. Cada uno tiene que poder romperse solo.
    const aviso = screen.getByText(/en esta sucursal y el ticket lleva 6/)

    expect(aviso.textContent).toContain('hay 5 en esta sucursal')
    expect(aviso.textContent).not.toContain('5.0000')
  })
})
