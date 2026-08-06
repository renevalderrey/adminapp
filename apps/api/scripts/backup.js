#!/usr/bin/env node
/**
 * ════════════════════════════════════════════
 *  Respaldo de los datos de una empresa
 *
 *  El plan de análisis marcaba backups como un pendiente antes del primer
 *  cliente real, y no había nada: ni script, ni endpoint, ni mención en el
 *  README. Lo único que existía era la retención de Neon, que en el plan
 *  gratuito es corta y no está bajo control de nadie del equipo.
 *
 *  Esto NO reemplaza un backup de la base. Un dump de Postgres
 *  (`pg_dump`) sigue siendo lo correcto para recuperación ante desastre. Esto
 *  resuelve otra cosa, más frecuente y más urgente:
 *
 *   - "Alguien borró los productos de un cliente y hay que devolvérselos."
 *   - "El cliente se va y pide sus datos." (Y tiene derecho a pedirlos: son
 *     registros fiscales que está obligado a conservar.)
 *   - "Quiero mirar los datos de una empresa sin entrar a la base."
 *
 *  ── Uso ──
 *
 *    node scripts/backup.js <empresaId> [--salida ./respaldos]
 *    node scripts/backup.js --todas [--salida ./respaldos]
 *
 *  Genera un JSON por empresa con todas sus tablas.
 *
 *  ── Qué NO incluye ──
 *
 *  El certificado y la clave privada de AFIP se excluyen a propósito. Son
 *  material fiscal sensible y un archivo de respaldo suele terminar en un
 *  drive compartido o en un mail. Si hace falta migrarlos, se hace aparte y
 *  con cuidado.
 * ════════════════════════════════════════════
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const {
  sequelize,
  Empresa, PuntoDeVenta, Usuario, UsuarioEmpresa, Suscripcion,
  Brand, Product, Stock, StockMovement, StockTransfer,
  Sale, SaleItem,
  Customer, CustomerPayment,
  Supplier, SupplierOrder, SupplierMovement, SupplierDocument,
  Recipe, RecipeItem, ProductCostHistory,
  ProductionOrder, ProductionOrderItem,
  CashFlowEntry, FixedExpense,
  TaxConfig, TaxPayment,
  Setting,
  Rol, RolPermiso, UsuarioPermiso,
  Invitacion,
  TiendanubeMapping,
} = require('../src/models');

// La lista vive en `src/utils/settingsSecretos.js` y la importan los dos: este
// script y `routes/general.js`. Estuvo escrita solo acá durante meses, mientras
// `GET /api/settings` mandaba la clave privada de AFIP al navegador — dos listas
// iguales en dos archivos empiezan iguales y terminan distintas, y ésta ni
// siquiera llegó a existir del otro lado.
const { SETTINGS_SECRETOS: SETTINGS_EXCLUIDOS } = require('../src/utils/settingsSecretos');

/**
 * Tablas que se respaldan, con cómo filtrarlas por empresa.
 *
 * Las que no tienen empresa_id se filtran por su relación: por ejemplo, los
 * items de una venta se traen por los ids de las ventas de esa empresa.
 */
async function recolectar(empresaId) {
  const porEmpresa = { where: { empresa_id: empresaId }, raw: true };

  const empresa = await Empresa.findByPk(empresaId, { raw: true });
  if (!empresa) return null;

  const ventas = await Sale.findAll(porEmpresa);
  const idsVentas = ventas.map((v) => v.id);

  const recetas = await Recipe.findAll(porEmpresa);
  const idsRecetas = recetas.map((r) => r.id);

  const ordenesProduccion = await ProductionOrder.findAll(porEmpresa);
  const idsOrdenesProduccion = ordenesProduccion.map((o) => o.id);

  const settings = await Setting.findAll(porEmpresa);

  const roles = await Rol.findAll(porEmpresa);
  const idsRoles = roles.map((r) => r.id);

  const usuariosEmpresa = await UsuarioEmpresa.findAll(porEmpresa);
  const idsUsuariosEmpresa = usuariosEmpresa.map((ue) => ue.id);
  const idsUsuarios = [...new Set(usuariosEmpresa.map((ue) => ue.usuario_id))];

  return {
    _meta: {
      generado: new Date().toISOString(),
      empresa_id: empresaId,
      empresa: empresa.name,
      nota: 'El certificado y la clave privada de AFIP se excluyen a proposito.',
    },

    empresa,
    puntos_de_venta: await PuntoDeVenta.findAll(porEmpresa),
    suscripcion: await Suscripcion.findAll(porEmpresa),

    // Usuarios: solo los que pertenecen a esta empresa, y sin datos de otras.
    usuarios: idsUsuarios.length
      ? await Usuario.findAll({ where: { id: idsUsuarios }, raw: true })
      : [],
    usuarios_empresa: usuariosEmpresa,
    roles,
    roles_permisos: idsRoles.length
      ? await RolPermiso.findAll({ where: { rol_id: idsRoles }, raw: true })
      : [],
    usuarios_permisos: idsUsuariosEmpresa.length
      ? await UsuarioPermiso.findAll({ where: { usuario_empresa_id: idsUsuariosEmpresa }, raw: true })
      : [],
    invitaciones: await Invitacion.findAll(porEmpresa),

    marcas: await Brand.findAll(porEmpresa),
    productos: await Product.findAll(porEmpresa),
    stock: await Stock.findAll(porEmpresa),
    movimientos_stock: await StockMovement.findAll(porEmpresa),
    transferencias_stock: await StockTransfer.findAll(porEmpresa),

    ventas,
    items_de_venta: idsVentas.length
      ? await SaleItem.findAll({ where: { sale_id: idsVentas }, raw: true })
      : [],

    clientes: await Customer.findAll(porEmpresa),
    pagos_de_clientes: await CustomerPayment.findAll(porEmpresa),

    proveedores: await Supplier.findAll(porEmpresa),
    ordenes_de_compra: await SupplierOrder.findAll(porEmpresa),
    movimientos_proveedores: await SupplierMovement.findAll(porEmpresa),
    documentos_proveedores: await SupplierDocument.findAll(porEmpresa),

    recetas,
    items_de_receta: idsRecetas.length
      ? await RecipeItem.findAll({ where: { recipe_id: idsRecetas }, raw: true })
      : [],
    historial_de_costos: await ProductCostHistory.findAll(porEmpresa),

    ordenes_de_produccion: ordenesProduccion,
    items_de_produccion: idsOrdenesProduccion.length
      ? await ProductionOrderItem.findAll({ where: { production_order_id: idsOrdenesProduccion }, raw: true })
      : [],

    movimientos_de_caja: await CashFlowEntry.findAll(porEmpresa),
    gastos_fijos: await FixedExpense.findAll(porEmpresa),

    config_impuestos: await TaxConfig.findAll(porEmpresa),
    pagos_de_impuestos: await TaxPayment.findAll(porEmpresa),

    configuracion: settings.filter((s) => !SETTINGS_EXCLUIDOS.includes(s.key)),
    mapeos_tiendanube: await TiendanubeMapping.findAll(porEmpresa),
  };
}

function contarRegistros(datos) {
  let total = 0;

  for (const [clave, valor] of Object.entries(datos)) {
    if (clave === '_meta') continue;
    if (Array.isArray(valor)) total += valor.length;
    else if (valor) total += 1;
  }

  return total;
}

async function respaldar(empresaId, directorio) {
  const datos = await recolectar(empresaId);

  if (!datos) {
    console.error(`No existe la empresa ${empresaId}.`);
    return false;
  }

  fs.mkdirSync(directorio, { recursive: true });

  const marca = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const nombre = `empresa-${empresaId}-${marca}.json`;
  const destino = path.join(directorio, nombre);

  fs.writeFileSync(destino, JSON.stringify(datos, null, 2), 'utf8');

  const tamanoKb = Math.round(fs.statSync(destino).size / 1024);
  console.log(`  ${String(empresaId).padStart(4)}  ${datos._meta.empresa.slice(0, 28).padEnd(30)} ${String(contarRegistros(datos)).padStart(7)} registros   ${tamanoKb} KB   ${nombre}`);

  return true;
}

const AYUDA = `
Respaldo de los datos de una empresa.

  node scripts/backup.js <empresaId> [--salida ./respaldos]
  node scripts/backup.js --todas [--salida ./respaldos]

Genera un JSON por empresa con todas sus tablas.

El certificado y la clave privada de AFIP se excluyen a proposito: son
material fiscal sensible y un archivo de respaldo suele terminar compartido.

Esto NO reemplaza un dump de Postgres para recuperacion ante desastre.
Resuelve el caso frecuente: devolverle los datos a un cliente, o recuperar
algo que alguien borro por error.
`;

async function main() {
  const args = process.argv.slice(2);

  if (!args.length || args.includes('--ayuda') || args.includes('-h')) {
    console.log(AYUDA);
    return;
  }

  const iSalida = args.indexOf('--salida');
  const directorio = iSalida >= 0 ? args[iSalida + 1] : './respaldos';

  console.log('');
  console.log('    ID  EMPRESA                        REGISTROS   TAMAÑO   ARCHIVO');
  console.log('─'.repeat(94));

  if (args.includes('--todas')) {
    const empresas = await Empresa.findAll({ attributes: ['id'], raw: true, order: [['id', 'ASC']] });

    if (!empresas.length) {
      console.log('  (no hay empresas)');
      return;
    }

    for (const e of empresas) await respaldar(e.id, directorio);
  } else {
    const empresaId = parseInt(args[0], 10);

    if (!Number.isInteger(empresaId)) {
      console.error(`"${args[0]}" no es un id de empresa valido.`);
      console.log(AYUDA);
      process.exitCode = 1;
      return;
    }

    const ok = await respaldar(empresaId, directorio);
    if (!ok) process.exitCode = 1;
  }

  console.log('');
  console.log(`Respaldos en ${path.resolve(directorio)}`);
  console.log('');
}

main()
  .catch((err) => {
    console.error('Error:', err.message);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
