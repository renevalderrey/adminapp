const { Permiso, Rol, RolPermiso, UsuarioEmpresa, sequelize } = require('./models');
const logger = require('./utils/logger');

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
    const permisosExistentes = await Permiso.count();

    if (permisosExistentes === 0) {
      logger.info('Seeding permissions...');

      await Permiso.bulkCreate(PERMISOS, { ignoreDuplicates: true });

      const rolesData = [
        { nombre: 'admin', is_system: true },
        { nombre: 'gerente', is_system: true },
        { nombre: 'vendedor', is_system: true },
        { nombre: 'produccion', is_system: true },
        { nombre: 'compras', is_system: true },
      ];

      for (const r of rolesData) {
        const [rol] = await Rol.findOrCreate({
          where: { nombre: r.nombre, is_system: true },
          defaults: { ...r, empresa_id: null },
        });

        const permisoCodigos = ROLE_PERMISOS[r.nombre] || [];
        const rolPermisos = permisoCodigos.map(codigo => ({
          rol_id: rol.id,
          permiso_codigo: codigo,
        }));

        await RolPermiso.bulkCreate(rolPermisos, { ignoreDuplicates: true });
      }

      logger.info('Permissions seeded successfully');
    } else {
      logger.info('Permissions already seeded');
    }

    // Always fix any UsuarioEmpresa records with missing rol_id
    await fixMissingRolIds();
    logger.info('UsuarioEmpresa rol_id fix completed');
  } catch (err) {
    logger.error({ err }, 'Error seeding permissions');
  }
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
    logger.error({ err }, 'Error fixing missing rol_ids');
  }
}

module.exports = seedPermissions;
