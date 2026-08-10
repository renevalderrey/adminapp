import {
  ShoppingCart, ClipboardList, Package, Truck, Wallet, BarChart3, AlertTriangle,
  Scale, FileCheck, FileSpreadsheet, Zap, Factory, Users, DollarSign, UserCog,
  CreditCard, Store, ShoppingBag,
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
//
//  ── Las cuatro que NO declaran `modulo`, y por qué ──
//
//  Gastos, Panel de control, Facturación AFIP y Equipo **no llevan `modulo`, y
//  eso es una decisión, no un olvido**: son el esqueleto del sistema y no
//  módulos opcionales. Toda empresa necesita configurar AFIP y manejar su
//  equipo; una empresa que no pueda entrar a Facturación no puede facturar.
//
//  Lo declaraban desde antes de que existiera `RouteGuard`, y el gate nunca
//  llegó a la ruta: escondían el ítem del menú **sin impedir que la URL escrita
//  a mano entrara igual**, que es lo mismo que le pasaba a `/proveedores` y es
//  la mitad inútil del gateo.
//
//  Cerrarlo del otro lado —ponerles el guard— exigía revisar `enabled_modules`
//  empresa por empresa antes del deploy, y una lista mal armada hace
//  desaparecer cuatro pantallas sin aviso. No es hipotético: el ejemplo de
//  `docs/implementation_plan_production.md:249` es
//  `["pos","inventario","proveedores","gastos","equipo","config"]`, que **no
//  tiene `panel` ni `facturacion`**. Una empresa configurada con esa lista hoy
//  no ve el Panel de control ni Facturación AFIP en el menú, y nadie se enteró
//  porque el ítem simplemente no se dibuja.
//
//  Decisión 6 del usuario en `docs/specs/014-panel-gastos-equipo-afip/spec.md`
//  y decisión 14 del plan. **Volver a agregarles `modulo` es reabrir esto**: si
//  algún día hace falta, va con su `RouteGuard` en el mismo cambio y con la
//  revisión de `enabled_modules` hecha antes. Lo ancla
//  `src/tests/marcoDePantalla.test.js`, en los dos lados.
// ════════════════════════════════════════════

export const GRUPOS = [
  {
    label: 'Operaciones',
    items: [
      { to: '/pos', icon: ShoppingCart, label: 'Punto de venta', permission: 'ventas.crear', modulo: 'pos' },
      { to: '/ventas', icon: ClipboardList, label: 'Historial de ventas', permission: 'ventas.ver', modulo: 'ventas' },
      { to: '/clientes', icon: Users, label: 'Clientes', permission: 'clientes.ver', modulo: 'clientes', alcance: 'empresa' },
      { to: '/produccion', icon: Factory, label: 'Producción', permission: 'produccion.ver', modulo: 'produccion' },
    ],
  },
  {
    label: 'Gestión',
    items: [
      { to: '/inventario', icon: Package, label: 'Inventario', permission: 'stock.ver', modulo: 'inventario' },
      { to: '/recetas', icon: Zap, label: 'Fórmulas y recetas', permission: 'recetas.ver', modulo: 'recetas', alcance: 'empresa' },
      { to: '/faltantes', icon: AlertTriangle, label: 'Faltantes', permission: 'stock.ver' },
      { to: '/proveedores', icon: Truck, label: 'Proveedores', permission: 'proveedores.ver', modulo: 'proveedores', alcance: 'empresa' },
      { to: '/comparador', icon: Scale, label: 'Comparador de proveedores', permission: 'proveedores.ver', alcance: 'empresa' },
      { to: '/ordenes-compra', icon: ClipboardList, label: 'Órdenes de compra', permission: 'ordenes_compra.ver', modulo: 'ordenes-compra' },
    ],
  },
  // ── Venta online ──
  //
  // Nace con UN solo ítem, y eso es deliberado: «Pedidos» es del corte
  // siguiente. `marcoDePantalla.test.js` exige que toda ruta cuyo ítem declara
  // `modulo` lleve `RouteGuard` con ese mismo módulo, así que un ítem de menú
  // sin su `<Route>` pondría esa guardia en rojo por un motivo que no es el del
  // hito. El ítem y su ruta van en el mismo cambio o no van.
  {
    label: 'Venta online',
    items: [
      // ⚠ `alcance: 'empresa'` y NO sucursal, y no es un descuido: **el catálogo
      // declara su propio punto de venta adentro** (`punto_de_venta_id`), así
      // que cambiar la sucursal del selector de arriba no cambiaría nada de lo
      // que se ve acá. Un control que se dibuja y no hace nada es exactamente lo
      // que el hito 9 corrigió en ocho pantallas.
      { to: '/catalogos', icon: ShoppingBag, label: 'Catálogos', permission: 'catalogo.ver', modulo: 'catalogo', alcance: 'empresa' },
    ],
  },
  {
    label: 'Finanzas',
    items: [
      // ⚠ Los dos van SIN `modulo` a propósito: son el esqueleto, no módulos
      // opcionales. El porqué completo está en «Las cuatro que NO declaran
      // `modulo`», arriba. Leerlo antes de agregárselo.
      { to: '/gastos', icon: Wallet, label: 'Gastos', permission: 'gastos.ver', alcance: 'empresa' },
      { to: '/panel', icon: BarChart3, label: 'Panel de control', permission: 'dashboard.ver' },
    ],
  },
  {
    label: 'Configuración',
    items: [
      // ⚠ Sin `modulo` a propósito: sin esta pantalla una empresa no puede
      // facturar. Ver «Las cuatro que NO declaran `modulo`», arriba.
      { to: '/facturacion', icon: FileCheck, label: 'Facturación AFIP', permission: 'config.ver', alcance: 'empresa' },
      // ⚠ El módulo y el permiso son los MISMOS que declaran la `<Route>` de
      // App.jsx y las once rutas privadas de `routes/tiendanube.js`. Si difieren,
      // el gateo deja de servir: el menú esconde el ítem y la URL escrita a mano
      // entra igual, que es exactamente lo que pasaba con `/proveedores`.
      //
      // ⚠⚠ **Ninguna empresa tiene `tiendanube` en `enabled_modules` todavía**,
      // así que este ítem no se dibuja para nadie y `/tiendanube` redirige a
      // `/pos` (`App.jsx:58-62`) hasta que alguien lo agregue. Es el paso manual
      // P4 de `docs/specs/013-tiendanube/tasks.md` y el riesgo 2 del plan; NO se
      // arregla sacando el guard.
      { to: '/tiendanube', icon: Store, label: 'TiendaNube', permission: 'config.ver', modulo: 'tiendanube' },
      // ⚠ Sin `modulo` a propósito: es donde se invita y se da de baja gente.
      // Ver «Las cuatro que NO declaran `modulo`», arriba.
      { to: '/team', icon: UserCog, label: 'Equipo', permission: 'equipo.ver', alcance: 'empresa' },
      { to: '/suscripcion', icon: CreditCard, label: 'Suscripción', permission: 'config.ver', modulo: 'suscripcion', alcance: 'empresa' },
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
 * Si el selector de sucursal hace algo en esa pantalla.
 *
 * ── Por qué existe ──
 *
 * El selector estaba dibujado en las DOCE y significaba una cosa distinta en
 * cada una: dos lo usan de filtro, dos lo siembran, y **ocho lo ignoran**. Para
 * Equipo o Facturación eso es correcto —el equipo y el certificado de AFIP son
 * de la empresa, no de una sucursal— pero nada en la pantalla lo decía y el
 * control seguía arriba, activo.
 *
 * Un control global cuyo efecto va de «vuelve a consultar» a «solo siembra un
 * filtro» a «no hace nada», sin ninguna señal. Alguien que cambia de sucursal
 * en Equipo espera ver otro equipo, y ve el mismo: la conclusión razonable es
 * que el sistema no le hizo caso.
 *
 * Con `alcance: 'empresa'` el control **no se dibuja**. La regla queda simple y
 * se puede leer sin pensar: **si está, hace algo.**
 *
 * ⚠ Lo que NO lleva `alcance` mira la sucursal, y esas pantallas lo dicen en su
 * descripción. Esconder el control es la mitad; la otra es que donde sí aplica
 * se sepa sobre qué está filtrando.
 */
export function alcanceDeRuta(to) {
  return ITEMS.find((i) => i.to === to)?.alcance || 'sucursal'
}

/**
 * Cómo se llama la pantalla de esa ruta, tal cual figura en la barra lateral.
 *
 * ── Por qué existe ──
 *
 * El Panel tenía su propia idea de cómo se llaman las otras pantallas: decía
 * «Ver ventas» para `/ventas` —que en el menú es **Historial de ventas**—, «Ir a
 * Facturación» para `/facturacion` —que es **Facturación AFIP**— y «Historial
 * completo» para la misma ruta en otro bloque. Tres nombres para dos pantallas.
 *
 * Alguien que lee «Ver ventas» y busca esa pantalla en el menú no la encuentra:
 * lo que hay es «Historial de ventas». El nombre de una pantalla es cómo se la
 * busca, y un aviso que la nombra distinto manda a buscar algo que no existe.
 *
 * ⚠ Devuelve `null` para una ruta que no está en el menú —`/`, una ruta de
 * detalle— y quien la use decide qué hacer. Devolver la ruta cruda pondría
 * «/ventas» en un botón.
 */
export function nombreDeRuta(to) {
  const item = ITEMS.find((i) => i.to === to)

  return item ? item.label : null
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
