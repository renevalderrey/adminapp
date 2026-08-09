import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import useStore from '@/store/useStore'
import { AppTopbar } from '@/components/app-topbar'
import { GRUPOS, alcanceDeRuta } from '@/components/navegacion'

// ════════════════════════════════════════════
//  ADMINAPP · El selector de sucursal de la barra superior
//
//  ── El defecto ──
//
//  Estaba dibujado en las DOCE pantallas y significaba una cosa distinta en cada
//  una: dos lo usan de filtro, dos lo siembran, y **ocho lo ignoraban**.
//
//  Para Equipo o Facturación AFIP eso es correcto —el equipo y el certificado
//  son de la empresa, no de una sucursal— pero **nada en la pantalla lo decía y
//  el control seguía arriba, activo**. Alguien que cambia de sucursal en Equipo
//  espera ver otro equipo y ve el mismo: la conclusión razonable no es «esta
//  pantalla no filtra por sucursal», es que el sistema no le hizo caso.
//
//  Un control global cuyo efecto va de «vuelve a consultar» a «solo siembra un
//  filtro» a «no hace nada», sin ninguna señal.
//
//  ── La regla, que ahora se puede leer sin pensar ──
//
//  **Si está, hace algo.** El alcance lo declara `navegacion.js` al lado del
//  nombre y del permiso de cada pantalla, así que agregar una pantalla obliga a
//  decidirlo.
// ════════════════════════════════════════════

const DOS_SUCURSALES = [
  { id: 1, name: 'Ortiz de Ocampo' },
  { id: 2, name: 'Depósito' },
]

function montar(ruta) {
  useStore.setState({
    empresaActiva: { id: 1, name: 'Comprafit', puntosDeVenta: DOS_SUCURSALES },
    empresas: [{ id: 1, name: 'Comprafit' }],
    puntoDeVentaActivo: DOS_SUCURSALES[0],
  })

  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <AppTopbar sidebarAbierta onAlternarSidebar={() => {}} />
    </MemoryRouter>
  )
}

/** El selector, si está dibujado. */
const selector = () => screen.queryByRole('combobox', { name: '' })
  || screen.queryByText('Ortiz de Ocampo')

afterEach(() => {
  cleanup()
  useStore.setState({ empresaActiva: null, puntoDeVentaActivo: null })
})

describe('El selector aparece donde filtra algo', () => {
  it.each([
    ['/inventario', 'el stock es por sucursal'],
    ['/ventas', 'el historial se filtra por sucursal'],
    ['/faltantes', 'lo que falta depende de la sucursal'],
    ['/pos', 'la venta se registra en una sucursal'],
    ['/ordenes-compra', 'la recepción entra en una sucursal'],
  ])('en %s se dibuja, porque %s', (ruta) => {
    montar(ruta)

    expect(selector()).not.toBeNull()
  })
})

describe('Y NO aparece donde no hace nada', () => {
  it.each([
    ['/team', 'el equipo es de la empresa'],
    ['/facturacion', 'el certificado de AFIP es de la empresa'],
    ['/suscripcion', 'el plan es de la empresa'],
    ['/gastos', 'los gastos fijos son de la empresa'],
    ['/comparador', 'las listas de precios son de la empresa'],
    ['/proveedores', 'la cuenta corriente es de la empresa'],
  ])('en %s no se dibuja, porque %s', (ruta) => {
    montar(ruta)

    expect(selector()).toBeNull()
  })

  it('el nombre de la empresa SÍ sigue estando', () => {
    // El contra-caso. Esconder el selector no puede llevarse puesto el resto de
    // la barra: quien tiene dos empresas necesita saber en cuál está.
    montar('/team')

    expect(screen.getByText('Comprafit')).toBeInTheDocument()
  })
})

describe('Toda pantalla del menú declara su alcance', () => {
  it('el alcance es «empresa» o «sucursal», nunca otra cosa', () => {
    // `alcanceDeRuta` cae a «sucursal» si no está declarado, así que un valor
    // mal escrito —«Empresa», «global»— dibujaría el selector en una pantalla
    // donde no hace nada, en silencio.
    const declarados = GRUPOS
      .flatMap((g) => g.items)
      .filter((i) => i.alcance !== undefined)
      .map((i) => i.alcance)

    expect(declarados.length).toBeGreaterThan(5)
    expect([...new Set(declarados)]).toEqual(['empresa'])
  })

  it('las cuatro que filtran de verdad NO están declaradas como empresa', () => {
    // El ancla por el otro lado: si alguien marcara Inventario como `empresa`,
    // el selector desaparecería de la pantalla que más lo usa.
    for (const ruta of ['/inventario', '/ventas', '/faltantes', '/pos']) {
      expect(alcanceDeRuta(ruta)).toBe('sucursal')
    }
  })
})
