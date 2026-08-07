const { Permiso, Rol, RolPermiso, UsuarioEmpresa, sequelize } = require('./models');
const logger = require('./utils/logger');
const { esErrorDeEsquema } = require('./utils/errores');
const { reportarError } = require('./config/sentry');

const PERMISOS = [
  // Productos
  { codigo: 'products.ver', nombre: 'Ver productos', modulo: 'products' },
  { codigo: 'products.crear', nombre: 'Crear productos', modulo: 'products' },
  { codigo: 'products.editar', nombre: 'Editar productos', modulo: 'products' },
  { codigo: 'products.eliminar', nombre: 'Eliminar productos', modulo: 'products' },
  // Stock
  { codigo: 'stock.ver', nombre: 'Ver stock', modulo: 'stock' },
  { codigo: 'stock.editar', nombre: 'Ajustar stock', modulo: 'stock' },
  { codigo: 'stock.transferir', nombre: 'Transferir stock', modulo: 'stock' },
  // Ventas
  { codigo: 'ventas.ver', nombre: 'Ver ventas', modulo: 'ventas' },
  { codigo: 'ventas.crear', nombre: 'Crear ventas (POS)', modulo: 'ventas' },
  { codigo: 'ventas.anular', nombre: 'Anular ventas', modulo: 'ventas' },
  // Clientes
  { codigo: 'clientes.ver', nombre: 'Ver clientes', modulo: 'clientes' },
  { codigo: 'clientes.crear', nombre: 'Crear clientes', modulo: 'clientes' },
  { codigo: 'clientes.editar', nombre: 'Editar clientes', modulo: 'clientes' },
  { codigo: 'clientes.eliminar', nombre: 'Eliminar clientes', modulo: 'clientes' },
  // Proveedores
  { codigo: 'proveedores.ver', nombre: 'Ver proveedores', modulo: 'proveedores' },
  { codigo: 'proveedores.crear', nombre: 'Crear proveedores', modulo: 'proveedores' },
  { codigo: 'proveedores.editar', nombre: 'Editar proveedores', modulo: 'proveedores' },
  { codigo: 'proveedores.eliminar', nombre: 'Eliminar proveedores', modulo: 'proveedores' },
  // Órdenes de compra
  { codigo: 'ordenes_compra.ver', nombre: 'Ver órdenes de compra', modulo: 'ordenes_compra' },
  { codigo: 'ordenes_compra.crear', nombre: 'Crear órdenes de compra', modulo: 'ordenes_compra' },
  { codigo: 'ordenes_compra.editar', nombre: 'Editar órdenes de compra', modulo: 'ordenes_compra' },
  { codigo: 'ordenes_compra.recibir', nombre: 'Recibir órdenes de compra', modulo: 'ordenes_compra' },
  { codigo: 'ordenes_compra.anular', nombre: 'Anular órdenes de compra', modulo: 'ordenes_compra' },
  // Producción
  { codigo: 'produccion.ver', nombre: 'Ver producción', modulo: 'produccion' },
  { codigo: 'produccion.crear', nombre: 'Crear órdenes de producción', modulo: 'produccion' },
  { codigo: 'produccion.anular', nombre: 'Anular producción', modulo: 'produccion' },
  // Recetas
  { codigo: 'recetas.ver', nombre: 'Ver recetas/fórmulas', modulo: 'recetas' },
  { codigo: 'recetas.crear', nombre: 'Crear recetas', modulo: 'recetas' },
  { codigo: 'recetas.editar', nombre: 'Editar recetas', modulo: 'recetas' },
  { codigo: 'recetas.eliminar', nombre: 'Eliminar recetas', modulo: 'recetas' },
  // Caja
  { codigo: 'caja.ver', nombre: 'Ver movimientos de caja', modulo: 'caja' },
  { codigo: 'caja.crear', nombre: 'Registrar movimiento', modulo: 'caja' },
  { codigo: 'caja.eliminar', nombre: 'Eliminar movimiento', modulo: 'caja' },
  // Gastos
  { codigo: 'gastos.ver', nombre: 'Ver gastos fijos', modulo: 'gastos' },
  { codigo: 'gastos.crear', nombre: 'Crear gastos', modulo: 'gastos' },
  { codigo: 'gastos.editar', nombre: 'Editar gastos', modulo: 'gastos' },
  { codigo: 'gastos.eliminar', nombre: 'Eliminar gastos', modulo: 'gastos' },
  // Reportes
  { codigo: 'reportes.ver', nombre: 'Ver reportes', modulo: 'reportes' },
  // Dashboard
  { codigo: 'dashboard.ver', nombre: 'Ver dashboard', modulo: 'dashboard' },
  // Configuración
  { codigo: 'config.ver', nombre: 'Ver configuración', modulo: 'config' },
  { codigo: 'config.editar', nombre: 'Editar configuración', modulo: 'config' },
  // Equipo
  { codigo: 'equipo.ver', nombre: 'Ver equipo', modulo: 'equipo' },
  { codigo: 'equipo.invitar', nombre: 'Invitar usuarios', modulo: 'equipo' },
  // Cambiar el rol de un miembro y activarlo o desactivarlo. Hasta la 014 eso
  // pedia `config.editar`, que es el permiso de la CONFIGURACION de la empresa:
  // el nombre no decia lo que abria, y quien revisaba el catalogo no tenia como
  // saber que ese codigo tambien repartia roles. El cambio es de NOMBRE y no de
  // alcance — `config.editar` hoy lo tiene solo `admin`, y `equipo.editar`
  // tambien, porque `ROLE_PERMISOS.admin` es el catalogo entero y ningun otro
  // rol lo enumera.
  { codigo: 'equipo.editar', nombre: 'Cambiar roles del equipo', modulo: 'equipo' },
  { codigo: 'equipo.eliminar', nombre: 'Eliminar usuarios', modulo: 'equipo' },
  // Sucursales
  { codigo: 'sucursales.ver', nombre: 'Ver sucursales', modulo: 'sucursales' },
  { codigo: 'sucursales.crear', nombre: 'Crear sucursales', modulo: 'sucursales' },
  { codigo: 'sucursales.editar', nombre: 'Editar sucursales', modulo: 'sucursales' },
  { codigo: 'sucursales.eliminar', nombre: 'Eliminar sucursales', modulo: 'sucursales' },
  // Vista empresa (ver datos consolidados de todas las sucursales)
  { codigo: 'vista_empresa', nombre: 'Ver datos consolidados de toda la empresa', modulo: 'empresa' },
];

const ROLE_PERMISOS = {
  admin: PERMISOS.map(p => p.codigo),
  gerente: [
    'products.ver', 'stock.ver', 'stock.transferir',
    'ventas.ver', 'ventas.crear',
    'clientes.ver', 'clientes.crear', 'clientes.editar',
    'proveedores.ver', 'proveedores.crear', 'proveedores.editar',
    'ordenes_compra.ver', 'ordenes_compra.crear',
    'produccion.ver', 'produccion.crear',
    'recetas.ver', 'recetas.crear', 'recetas.editar',
    'caja.ver', 'caja.crear',
    'gastos.ver', 'gastos.crear', 'gastos.editar',
    'reportes.ver', 'dashboard.ver',
    'config.ver',
    'equipo.ver',
    'sucursales.ver',
    'vista_empresa',
  ],
  vendedor: [
    'products.ver', 'stock.ver',
    'ventas.ver', 'ventas.crear',
    'clientes.ver', 'clientes.crear',
    'caja.ver',
    'dashboard.ver',
  ],
  produccion: [
    'products.ver', 'stock.ver',
    'produccion.ver', 'produccion.crear', 'produccion.anular',
    'recetas.ver',
    'dashboard.ver',
  ],
  compras: [
    'products.ver', 'stock.ver',
    'proveedores.ver', 'proveedores.crear', 'proveedores.editar',
    'ordenes_compra.ver', 'ordenes_compra.crear', 'ordenes_compra.recibir',
    'dashboard.ver',
  ],
};

async function seedPermissions() {
  try {
    // Always upsert permissions that don't exist yet
    for (const permiso of PERMISOS) {
      await Permiso.findOrCreate({
        where: { codigo: permiso.codigo },
        defaults: permiso,
      });
    }

    // Always upsert roles
    const rolesData = [
      { nombre: 'admin', is_system: true },
      { nombre: 'gerente', is_system: true },
      { nombre: 'vendedor', is_system: true },
      { nombre: 'produccion', is_system: true },
      { nombre: 'compras', is_system: true },
    ];

    for (const r of rolesData) {
      const [rol] = await Rol.findOrCreate({
        where: { nombre: r.nombre, empresa_id: null },
        defaults: { ...r, empresa_id: null },
      });

      const permisoCodigos = ROLE_PERMISOS[r.nombre] || [];
      for (const codigo of permisoCodigos) {
        await RolPermiso.findOrCreate({
          where: { rol_id: rol.id, permiso_codigo: codigo },
          defaults: { rol_id: rol.id, permiso_codigo: codigo },
        });
      }
    }

    logger.info('Permissions seeded/updated successfully');

    // Always fix any UsuarioEmpresa records with missing rol_id
    await fixMissingRolIds();
    logger.info('UsuarioEmpresa rol_id fix completed');
  } catch (err) {
    avisarQueLaSiembraFallo(err, 'seedPermissions');
  }
}

/**
 * Deja constancia de que la siembra de permisos fallo, con el peso que
 * corresponde.
 *
 * ── Que estaba mal ──
 *
 * El catch original era `logger.error({ err }, 'Error seeding permissions')` y
 * nada mas. Cuando faltaban las cuatro tablas de permisos, eso producia un
 * arranque APARENTEMENTE normal: `Server started`, `/api/health` en `ok`, y una
 * aplicacion donde ningun usuario podia hacer absolutamente nada porque
 * `checkPermission` le negaba todo. Una linea de log entre cientos, en el nivel
 * que se usa para cosas que se reintentan solas.
 *
 * ── Que cambia ──
 *
 * Se separan dos casos que no son el mismo problema:
 *
 * - **El esquema no tiene las tablas** (42P01/42703). No es transitorio y no se
 *   arregla reintentando: falta una migracion, y la aplicacion NO va a servir
 *   para nada hasta que se corra. Va como `fatal` y se reporta a Sentry, con el
 *   nombre del script que lo arregla.
 * - **Cualquier otra cosa** —la base tardo, se corto la conexion, se perdio una
 *   carrera con otra instancia sembrando lo mismo—. Eso si puede resolverse
 *   solo en el proximo arranque. Queda en `error` y tambien se reporta, porque
 *   antes no se reportaba nada.
 *
 * ── Por que NO tumba el arranque ──
 *
 * Seria lo mas contundente: si el esquema esta roto, no arrancar. Y es
 * tentador, porque un servidor que arranca inservible es peor que uno que no
 * arranca.
 *
 * No se hace, y el motivo es de riesgo, no de gusto. Hoy `seedPermissions()`
 * jamas impide arrancar. Convertirlo en una condicion de arranque significa que
 * cualquier caso que este chequeo clasifique de mas —un `search_path` raro, una
 * base que responde a medias durante un failover, un permiso de Postgres
 * cambiado— deja a produccion sin API, y produccion hoy anda. La restriccion es
 * clara: nada de lo que se agregue puede hacer que no arranque un despliegue
 * que hoy arranca.
 *
 * El lugar donde el esquema incompleto SI tiene que ser un freno duro es antes
 * de llegar a produccion: `scripts/verificar-esquema.js`, que corre en CI
 * despues de migrar y pone el build en rojo. Ahi el costo de equivocarse es un
 * pipeline fallado, no un cliente sin sistema.
 */
function avisarQueLaSiembraFallo(err, donde) {
  if (esErrorDeEsquema(err)) {
    logger.fatal(
      { err, donde },
      'El esquema de permisos no existe en esta base. NINGUN usuario va a tener ' +
      'permisos y ninguna accion del sistema va a funcionar, aunque el servidor ' +
      'arranque y el health check de en verde. Corre las migraciones: ' +
      'node scripts/migrar.js'
    );
  } else {
    logger.error({ err, donde }, 'Fallo la siembra de permisos');
  }

  reportarError(err, { ruta: `seedPermissions/${donde}` });
}

async function fixMissingRolIds() {
  try {
    const { Rol, UsuarioEmpresa } = require('./models');
    const ues = await UsuarioEmpresa.findAll({ where: { rol_id: null } });
    for (const ue of ues) {
      if (ue.role) {
        const rol = await Rol.findOne({ where: { nombre: ue.role, empresa_id: null } });
        if (rol) {
          await ue.update({ rol_id: rol.id });
        }
      }
    }
  } catch (err) {
    avisarQueLaSiembraFallo(err, 'fixMissingRolIds');
  }
}

module.exports = seedPermissions;
