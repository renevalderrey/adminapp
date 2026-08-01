import {
  ShoppingCart, ClipboardList, Package, Truck, Wallet, BarChart3, AlertTriangle,
  Scale, FileCheck, FileSpreadsheet, Zap, Factory, Users, DollarSign, UserCog,
  CreditCard,
} from 'lucide-react'

// ════════════════════════════════════════════
//  Navegación
//
//  Una sola definición para las dos cosas que la usan: la barra lateral y la
//  miga de pan del encabezado. Tenerlas separadas garantizaba que tarde o
//  temprano el título de una pantalla dijera algo distinto en cada lado.
//
//  `modulo` es la clave con la que la empresa habilita o deshabilita la
//  sección (empresa.settings.enabled_modules).
// ════════════════════════════════════════════

export const GRUPOS = [
  {
    label: 'Operaciones',
    items: [
      { to: '/pos', icon: ShoppingCart, label: 'Punto de venta', permission: 'ventas.crear', modulo: 'pos' },
      { to: '/ventas', icon: ClipboardList, label: 'Historial de ventas', permission: 'ventas.ver', modulo: 'ventas' },
      { to: '/clientes', icon: Users, label: 'Clientes', permission: 'clientes.ver', modulo: 'clientes' },
      { to: '/produccion', icon: Factory, label: 'Producción', permission: 'produccion.ver', modulo: 'produccion' },
    ],
  },
  {
    label: 'Gestión',
    items: [
      { to: '/inventario', icon: Package, label: 'Inventario', permission: 'stock.ver', modulo: 'inventario' },
      { to: '/recetas', icon: Zap, label: 'Fórmulas y recetas', permission: 'recetas.ver', modulo: 'recetas' },
      { to: '/faltantes', icon: AlertTriangle, label: 'Faltantes', permission: 'stock.ver' },
      { to: '/proveedores', icon: Truck, label: 'Proveedores', permission: 'proveedores.ver', modulo: 'proveedores' },
      { to: '/comparador', icon: Scale, label: 'Comparar proveedores', permission: 'proveedores.ver' },
      { to: '/ordenes-compra', icon: ClipboardList, label: 'Órdenes de compra', permission: 'ordenes_compra.ver', modulo: 'ordenes-compra' },
    ],
  },
  {
    label: 'Finanzas',
    items: [
      { to: '/gastos', icon: Wallet, label: 'Gastos', permission: 'gastos.ver', modulo: 'gastos' },
      { to: '/panel', icon: BarChart3, label: 'Panel de control', permission: 'dashboard.ver', modulo: 'panel' },
    ],
  },
  {
    label: 'Configuración',
    items: [
      { to: '/facturacion', icon: FileCheck, label: 'Facturación AFIP', permission: 'config.ver', modulo: 'facturacion' },
      { to: '/team', icon: UserCog, label: 'Equipo', permission: 'equipo.ver', modulo: 'equipo' },
      { to: '/suscripcion', icon: CreditCard, label: 'Suscripción', permission: 'config.ver', modulo: 'suscripcion' },
    ],
  },

  // ── Nuevas funcionalidades ──
  //
  // Terminadas y probadas, pero todavía no liberadas a los clientes: el
  // sistema que vienen usando no las tenía y liberarlas es una decisión
  // comercial, no técnica.
  //
  // Marcar el ítem acá NO alcanza para ocultarlo: el gate real está en la API
  // (requireSuperadmin) y en RouteGuard. Esto solo evita dibujarlo.
  {
    label: 'Nuevas funcionalidades',
    soloSuperadmin: true,
    items: [
      { to: '/clientes', icon: Users, label: 'Clientes', permission: 'clientes.ver', soloSuperadmin: true },
      { to: '/recetas', icon: Zap, label: 'Fórmulas y recetas', permission: 'recetas.ver', soloSuperadmin: true },
      { to: '/produccion', icon: Factory, label: 'Producción', permission: 'produccion.ver', soloSuperadmin: true },
      { to: '/caja', icon: DollarSign, label: 'Flujo de caja', permission: 'caja.ver', soloSuperadmin: true },
      { to: '/impuestos', icon: FileCheck, label: 'Impuestos', permission: 'config.ver', soloSuperadmin: true },
      { to: '/reportes', icon: FileSpreadsheet, label: 'Reportes', permission: 'reportes.ver', soloSuperadmin: true },
    ],
  },
]

/** Las rutas que solo existen para un operador de la plataforma. */
export const RUTAS_SOLO_SUPERADMIN = GRUPOS
  .flatMap((g) => g.items)
  .filter((i) => i.soloSuperadmin)
  .map((i) => i.to)

/** Todos los ítems, aplanados. Para resolver la ruta actual. */
export const ITEMS = GRUPOS.flatMap((g) => g.items.map((i) => ({ ...i, grupo: g.label })))

/**
 * A qué ítem corresponde una ruta.
 *
 * Coincidencia por prefijo para que `/inventario/algo` siga marcando
 * Inventario. Se prueba primero la coincidencia exacta: sin eso, `/` marcaría
 * cualquier cosa.
 */
export function itemDeRuta(pathname) {
  return (
    ITEMS.find((i) => i.to === pathname) ||
    ITEMS.find((i) => i.to !== '/' && pathname.startsWith(`${i.to}/`)) ||
    null
  )
}

/**
 * Filtra la navegación.
 *
 * Tres gates, del más restrictivo al menos:
 *
 *   1. `soloSuperadmin` — existe para toda la plataforma o no existe.
 *   2. `modulo`         — lo contrató esta empresa.
 *   3. `permission`     — lo puede hacer este usuario en esta empresa.
 *
 * @param {(codigo: string) => boolean} can
 * @param {object} opciones
 * @param {boolean} [opciones.esSuperadmin]
 * @param {string[]} [opciones.modulosHabilitados] Si no viene, no se gatea nada.
 * @param {boolean} [opciones.esDueño] El dueño ve todo, aunque el módulo esté apagado.
 */
export function gruposVisibles(can, { esSuperadmin, modulosHabilitados, esDueño } = {}) {
  return GRUPOS
    .filter((grupo) => !grupo.soloSuperadmin || esSuperadmin)
    .map((grupo) => ({
      ...grupo,
      items: grupo.items.filter((item) => {
        if (item.soloSuperadmin && !esSuperadmin) return false
        if (item.permission && !can(item.permission)) return false
        if (esDueño) return true
        if (Array.isArray(modulosHabilitados) && item.modulo) {
          return modulosHabilitados.includes(item.modulo)
        }
        return true
      }),
    }))
    .filter((grupo) => grupo.items.length > 0)
}
