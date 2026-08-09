#!/usr/bin/env node
// ════════════════════════════════════════════
//  FAVALIO · Migracion de datos desde el sistema legacy (Comprafit PHP)
//
//  Reemplaza a src/migrate.js, que quedo inservible y peligroso cuando el
//  sistema paso a ser multi-empresa:
//
//   - Empezaba con sequelize.sync({ force: true }), que BORRA Y RECREA TODAS
//     LAS TABLAS. Corrido contra la base de produccion, se llevaba puestos los
//     datos de todos los clientes. Un script llamado "migrate" que destruye la
//     base es una trampa esperando a que alguien la pise.
//   - No escribia empresa_id en ninguna fila. Con el esquema actual eso falla
//     por NOT NULL, y si no fallara dejaria datos sin dueño.
//   - Buscaba el HTML legacy en "index (8).html", en la raiz del repo, donde
//     ya no esta.
//
//  Este script, en cambio:
//
//   - Exige --empresa=<id> y verifica que exista.
//   - No escribe nada sin --confirmar. Por defecto simula y reporta.
//   - Nunca toca el esquema: las migraciones son responsabilidad de
//     scripts/migrar.js.
//   - Es idempotente: se puede correr dos veces sin duplicar.
//   - Corre dentro de una transaccion: o entra todo, o no entra nada.
//
//  Uso:
//    node scripts/migrar-legacy.js --empresa=1                  # simulacion
//    node scripts/migrar-legacy.js --empresa=1 --confirmar      # escribe
//    node scripts/migrar-legacy.js --empresa=1 --sucursal=principal --confirmar
//
//  Origen de los datos, en orden de preferencia:
//    1. La API PHP, si estan PHP_API_URL y PHP_API_TOKEN.
//    2. El HTML legacy del repo (legacy/index-legacy.html), del que se
//       extraen los arrays semilla.
// ════════════════════════════════════════════

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const {
  sequelize, Empresa, PuntoDeVenta, Brand, Product, Stock, Sale, SaleItem,
  Supplier, SupplierOrder, SupplierMovement, SupplierDocument, FixedExpense, Setting,
} = require('../src/models');

const logger = require('../src/utils/logger');

// ── Argumentos ──

function leerArgumentos(argv) {
  const args = { empresa: null, sucursal: null, confirmar: false };

  for (const a of argv.slice(2)) {
    if (a === '--confirmar') args.confirmar = true;
    else if (a.startsWith('--empresa=')) args.empresa = parseInt(a.split('=')[1], 10);
    else if (a.startsWith('--sucursal=')) args.sucursal = a.split('=')[1];
  }

  return args;
}

// ── Origen de datos ──

const PHP_API_URL = process.env.PHP_API_URL || null;
const PHP_API_TOKEN = process.env.PHP_API_TOKEN || null;

// El HTML legacy vive en el repo. Es el ultimo recurso, pero para un cliente
// que ya apago el hosting viejo suele ser el unico que queda.
const HTML_LEGACY = path.join(__dirname, '..', '..', '..', 'legacy', 'index-legacy.html');

async function traerDeLaApiPhp() {
  if (!PHP_API_URL || !PHP_API_TOKEN) return null;

  try {
    const res = await fetch(`${PHP_API_URL}?action=getall`, {
      headers: { 'X-Token': PHP_API_TOKEN },
      signal: AbortSignal.timeout(30000),
    });

    const data = await res.json();
    if (data && data.ok && data.datos) return data.datos;

    console.warn('   La API PHP respondio sin datos.');
  } catch (err) {
    console.warn(`   No se pudo consultar la API PHP: ${err.message}`);
  }

  return null;
}

/**
 * Extrae los arrays semilla del HTML legacy.
 *
 * Son literales de JavaScript dentro de un <script>, no JSON: claves sin
 * comillas y comas colgando. Se normalizan antes de parsear. Si un array no
 * se puede leer, se devuelve vacio y se avisa — es preferible migrar de menos
 * que inventar datos.
 */
function extraerDelHtml() {
  if (!fs.existsSync(HTML_LEGACY)) return null;

  const html = fs.readFileSync(HTML_LEGACY, 'utf8');

  const extraer = (regex, nombre) => {
    const m = html.match(regex);
    if (!m) {
      console.warn(`   No se encontro ${nombre} en el HTML legacy.`);
      return [];
    }

    try {
      const limpio = m[1]
        .replace(/\/\/[^\n]*$/gm, '')
        .replace(/,(\s*[\]}])/g, '$1')
        .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
        .replace(/'/g, '"');

      return JSON.parse(limpio);
    } catch (err) {
      console.warn(`   ${nombre} no se pudo parsear: ${err.message}`);
      return [];
    }
  };

  return {
    cf_db: extraer(/const STAR_INIT\s*=\s*(\[[\s\S]*?\]);/, 'STAR_INIT (productos)'),
    cf_stock: extraer(/const STOCK_INIT\s*=\s*(\[[\s\S]*?\]);/, 'STOCK_INIT (stock)'),
    cf_gf1: extraer(/let GF1\s*=\s*(\[[\s\S]*?\]);/, 'GF1 (gastos fijos)'),
    cf_gf2: extraer(/let GF2\s*=\s*(\[[\s\S]*?\]);/, 'GF2 (gastos fijos)'),
    cf_marcas: extraer(/const MDEFS\s*=\s*(\[[\s\S]*?\]);/, 'MDEFS (marcas)'),
  };
}

function parsear(valor, porDefecto = []) {
  if (valor === null || valor === undefined) return porDefecto;
  if (typeof valor !== 'string') return valor;

  try {
    return JSON.parse(valor) ?? porDefecto;
  } catch {
    return porDefecto;
  }
}

// ── Categoria inferida por nombre (replica catOf del sistema legacy) ──

function categoriaDe(nombre) {
  const s = String(nombre || '').toLowerCase();

  if (/^pack\b/.test(s) || /\+\s*(creatina|whey|protein)/.test(s)) return 'pack';
  if (/\bbarra\b|ironbar|enargy bar|granola|pancake/.test(s)) return 'barra';
  if (/shaker|botella/.test(s)) return 'acc';
  if (/creatina|creatine/.test(s)) return 'creatina';
  if (/pre.?work|pre.?war|\bpre\b.{0,6}entr|3d.?ripped|pump.v8|pump.3d|lethal|tnt|dynamite/.test(s)) return 'pre';
  if (/whey|proteina|protein|gainer|vegetal|mass\b|isolate|casein|build|just.carbs|just.plant|just.whey|mutant/.test(s)) return 'proteina';
  if (/colageno|colágeno|hydromax|hydroplus|amino|mtor|bcaa|essential|glutamin|arginina|hmb/.test(s)) return 'colageno';
  if (/vitamina|vitamin|omega|zma|l-carni|carnitina|\bcla\b|multivit|k2|magnesio|cafeina|thermo|lipo|quemador/.test(s)) return 'vitamina';

  return 'otro';
}

// ── Migracion ──

async function migrar() {
  const args = leerArgumentos(process.argv);

  console.log('═══════════════════════════════════════════');
  console.log('  Migracion legacy (Comprafit) → Favalio');
  console.log('═══════════════════════════════════════════\n');

  if (!Number.isInteger(args.empresa) || args.empresa <= 0) {
    console.error('Falta --empresa=<id>.');
    console.error('');
    console.error('Los datos del legacy no traen empresa: hay que decir a cual van.');
    console.error('El id se ve en la tabla empresas o en el panel de la aplicacion.');
    console.error('');
    console.error('  node scripts/migrar-legacy.js --empresa=1');
    process.exit(1);
  }

  await sequelize.authenticate();

  const empresa = await Empresa.findByPk(args.empresa);
  if (!empresa) {
    console.error(`No existe la empresa ${args.empresa}. Se aborta.`);
    process.exit(1);
  }

  const empresaId = empresa.id;
  console.log(`Empresa destino: ${empresa.name} (id ${empresaId})`);

  // ── Sucursal destino ──
  //
  // El legacy guardaba el stock en tres claves fijas: cf_stock, cf_stock_ortiz
  // y cf_stock_mayo. Cada una es una sucursal. Se mapean contra los puntos de
  // venta que ya tenga la empresa; si no existe el equivalente, esas filas se
  // saltean con aviso en vez de crear sucursales por las dudas.
  const puntosDeVenta = await PuntoDeVenta.findAll({ where: { empresa_id: empresaId } });

  if (puntosDeVenta.length === 0) {
    console.error('La empresa no tiene ningun punto de venta. Creá al menos uno antes de migrar.');
    process.exit(1);
  }

  const pvPorCodigo = new Map(puntosDeVenta.map((pv) => [String(pv.code).toLowerCase(), pv]));
  const pvPorDefecto = args.sucursal
    ? pvPorCodigo.get(args.sucursal.toLowerCase())
    : puntosDeVenta[0];

  if (!pvPorDefecto) {
    console.error(`No existe el punto de venta "${args.sucursal}" en esta empresa.`);
    console.error(`Disponibles: ${puntosDeVenta.map((p) => p.code).join(', ')}`);
    process.exit(1);
  }

  console.log(`Sucursal por defecto: ${pvPorDefecto.name} (${pvPorDefecto.code})`);
  console.log(args.confirmar
    ? 'Modo: ESCRITURA (--confirmar)\n'
    : 'Modo: SIMULACION. No se escribe nada. Agregá --confirmar para aplicar.\n');

  // ── Datos de origen ──

  console.log('Buscando los datos del sistema legacy...');

  let datos = await traerDeLaApiPhp();
  let origen = 'API PHP';

  if (!datos) {
    datos = extraerDelHtml();
    origen = 'HTML legacy del repo';
  }

  if (!datos) {
    console.error('No se pudo obtener ningun dato. Configurá PHP_API_URL y PHP_API_TOKEN,');
    console.error(`o dejá el HTML legacy en ${HTML_LEGACY}.`);
    process.exit(1);
  }

  console.log(`Origen: ${origen}\n`);

  const resumen = {
    marcas: 0, productos: 0, stock: 0, gastos: 0,
    ventas: 0, proveedores: 0, salteados: 0,
  };

  // Todo dentro de una transaccion. Una migracion a medias es peor que una que
  // no se hizo: deja al cliente con parte de sus datos y sin saber cuales.
  const t = await sequelize.transaction();

  try {
    // ── Marcas ──
    console.log('Marcas...');
    const marcasRaw = parsear(datos.cf_marcas, []);
    const marcaPorNombre = new Map();

    for (const m of Array.isArray(marcasRaw) ? marcasRaw : []) {
      const nombre = (m && (m.n || m.name)) || (typeof m === 'string' ? m : null);
      if (!nombre) continue;

      const [marca] = await Brand.findOrCreate({
        where: { name: nombre, empresa_id: empresaId },
        defaults: { name: nombre, empresa_id: empresaId, color: m.c || '#4d6fff' },
        transaction: t,
      });

      marcaPorNombre.set(nombre.toLowerCase(), marca.id);
      resumen.marcas++;
    }

    // ── Productos ──
    console.log('Productos...');
    const productosRaw = parsear(datos.cf_db, []);
    const productoPorNombre = new Map();

    for (const p of Array.isArray(productosRaw) ? productosRaw : []) {
      const nombre = p && p.n;
      if (!nombre) { resumen.salteados++; continue; }

      // El SKU es unico. Si ya lo usa otro producto de esta empresa, se migra
      // sin SKU en vez de fallar: el nombre alcanza para identificarlo y el
      // dato se puede completar despues.
      let sku = p.sku || null;
      if (sku) {
        const existente = await Product.findOne({
          where: { sku, empresa_id: empresaId },
          transaction: t,
        });
        if (existente) sku = null;
      }

      const [producto] = await Product.findOrCreate({
        where: { name: nombre, empresa_id: empresaId },
        defaults: {
          name: nombre,
          empresa_id: empresaId,
          sku,
          cost: p.c || 0,
          brand_id: marcaPorNombre.get(String(p.marca || '').toLowerCase()) || null,
          margin_override: p._mgOv !== undefined ? p._mgOv : null,
          price_override: p._precioOv !== undefined ? p._precioOv : null,
          category: categoriaDe(nombre),
        },
        transaction: t,
      });

      productoPorNombre.set(nombre.toLowerCase(), producto.id);
      resumen.productos++;
    }

    // ── Stock ──
    console.log('Stock...');
    const juegosDeStock = [
      { clave: 'cf_stock', codigo: null },       // el general va a la sucursal por defecto
      { clave: 'cf_stock_ortiz', codigo: 'ortiz' },
      { clave: 'cf_stock_mayo', codigo: 'mayo' },
    ];

    for (const { clave, codigo } of juegosDeStock) {
      const filas = parsear(datos[clave], []);
      if (!Array.isArray(filas) || filas.length === 0) continue;

      const pv = codigo ? pvPorCodigo.get(codigo) : pvPorDefecto;

      if (!pv) {
        console.warn(`   Sin punto de venta con codigo "${codigo}": ${filas.length} filas de stock salteadas.`);
        resumen.salteados += filas.length;
        continue;
      }

      for (const s of filas) {
        const nombre = s && s.n;
        if (!nombre) { resumen.salteados++; continue; }

        let productoId = productoPorNombre.get(nombre.toLowerCase());

        // Un producto que aparece en el stock pero no en el catalogo igual se
        // crea: perder una fila de inventario es perder mercaderia real.
        if (!productoId) {
          const [producto] = await Product.findOrCreate({
            where: { name: nombre, empresa_id: empresaId },
            defaults: {
              name: nombre,
              empresa_id: empresaId,
              cost: 0,
              brand_id: marcaPorNombre.get(String(s.marca || '').toLowerCase()) || null,
              category: categoriaDe(nombre),
            },
            transaction: t,
          });

          productoId = producto.id;
          productoPorNombre.set(nombre.toLowerCase(), productoId);
          resumen.productos++;
        }

        const cantidad = Number(s.cant) || 0;

        await Stock.findOrCreate({
          where: { product_id: productoId, empresa_id: empresaId, punto_de_venta_id: pv.id },
          defaults: {
            product_id: productoId,
            empresa_id: empresaId,
            punto_de_venta_id: pv.id,
            location: pv.code,
            quantity: cantidad,
            available: s.disp !== undefined ? Number(s.disp) || 0 : cantidad,
            min_stock: 0,
          },
          transaction: t,
        });

        resumen.stock++;
      }
    }

    // ── Gastos fijos ──
    console.log('Gastos fijos...');
    for (const [clave, grupo] of [['cf_gf1', 'gf1'], ['cf_gf2', 'gf2']]) {
      for (const g of parsear(datos[clave], [])) {
        if (!g || !g.n) { resumen.salteados++; continue; }

        await FixedExpense.findOrCreate({
          where: { name: g.n, empresa_id: empresaId, group: grupo },
          defaults: {
            name: g.n,
            amount: Number(g.v) || 0,
            group: grupo,
            empresa_id: empresaId,
          },
          transaction: t,
        });

        resumen.gastos++;
      }
    }

    // ── Ventas ──
    console.log('Ventas...');
    for (const v of parsear(datos.cf_ventas, [])) {
      if (!v) { resumen.salteados++; continue; }

      const pv = v.suc ? (pvPorCodigo.get(String(v.suc).toLowerCase()) || pvPorDefecto) : pvPorDefecto;
      const id = v.id || `legacy_${v.fecha || 'sf'}_${v.hora || '00:00'}`;

      const [venta, creada] = await Sale.findOrCreate({
        where: { id, empresa_id: empresaId },
        defaults: {
          id,
          empresa_id: empresaId,
          punto_de_venta_id: pv.id,
          location: pv.code,
          date: v.fecha || v.date || new Date().toISOString().split('T')[0],
          time: v.hora || v.time || '00:00',
          total: Number(v.total) || 0,
          payment_method: v.metodo || v.mp || 'ef',
          notes: v.obs || null,
          seller: v.vendedor || null,
        },
        transaction: t,
      });

      // Si la venta ya estaba, no se le vuelven a agregar los items.
      if (!creada) continue;

      for (const item of Array.isArray(v.items) ? v.items : []) {
        const nombre = item.n || item.nombre || 'Producto';

        await SaleItem.create({
          sale_id: venta.id,
          empresa_id: empresaId,
          product_name: nombre,
          product_id: productoPorNombre.get(nombre.toLowerCase()) || null,
          quantity: Number(item.qty ?? item.cantidad ?? 1),
          unit_price: Number(item.precio ?? item.price ?? 0),
          payment_method: item.mp || null,
        }, { transaction: t });
      }

      resumen.ventas++;
    }

    // ── Proveedores ──
    console.log('Proveedores...');
    for (const cuenta of parsear(datos.cf_cuentas_prov, [])) {
      if (!cuenta) { resumen.salteados++; continue; }

      const nombre = cuenta.nombre || cuenta.name || 'Sin nombre';

      const [proveedor, creado] = await Supplier.findOrCreate({
        where: { name: nombre, empresa_id: empresaId },
        defaults: { name: nombre, empresa_id: empresaId },
        transaction: t,
      });

      // Los movimientos no tienen id propio en el legacy: si el proveedor ya
      // existia, volver a insertarlos duplicaria la deuda. Se saltean.
      if (!creado) continue;

      for (const m of cuenta.movimientos || cuenta.movements || []) {
        await SupplierMovement.create({
          supplier_id: proveedor.id,
          empresa_id: empresaId,
          type: m.tipo || m.type || 'deuda',
          date: m.fecha || m.date || new Date().toISOString().split('T')[0],
          amount: Number(m.monto ?? m.amount ?? 0),
          payment_method: m.metodo || m.method || null,
          notes: m.obs || m.concepto || null,
        }, { transaction: t });
      }

      for (const p of cuenta.pedidos || []) {
        await SupplierOrder.create({
          supplier_id: proveedor.id,
          empresa_id: empresaId,
          date: p.fecha || p.date || new Date().toISOString().split('T')[0],
          total: Number(p.total) || 0,
          notes: p.obs || null,
          detail: p.items || null,
        }, { transaction: t });
      }

      for (const d of cuenta.facturas || cuenta.documents || []) {
        await SupplierDocument.create({
          supplier_id: proveedor.id,
          empresa_id: empresaId,
          name: d.nombre || d.name || 'Documento',
          type: d.tipo || d.type || 'factura',
          url: d.link || d.url || null,
          date: d.fecha || d.date || null,
        }, { transaction: t });
      }

      resumen.proveedores++;
    }

    // ── Configuraciones ──
    //
    // Los permisos del legacy NO se migran: el modelo de permisos cambio por
    // completo (roles y permisos granulares por empresa). Migrarlos como texto
    // solo dejaria una fila muerta que despues confunde.
    console.log('Configuraciones...');
    const gastosVariables = parsear(datos.cf_gv, null);

    if (gastosVariables) {
      await Setting.findOrCreate({
        where: { key: 'legacy_gastos_variables', empresa_id: empresaId },
        defaults: {
          key: 'legacy_gastos_variables',
          empresa_id: empresaId,
          value: JSON.stringify(gastosVariables),
        },
        transaction: t,
      });

      console.log('   Gastos variables guardados como referencia en settings.');
      console.log('   Favalio todavia no tiene pantalla para gastos variables.');
    }

    // ── Cierre ──
    if (args.confirmar) {
      await t.commit();
      console.log('\nCambios aplicados.');
    } else {
      await t.rollback();
      console.log('\nSimulacion: no se escribio nada.');
    }

    console.log('\n═══════════════════════════════════════════');
    console.log(`  Marcas:       ${resumen.marcas}`);
    console.log(`  Productos:    ${resumen.productos}`);
    console.log(`  Stock:        ${resumen.stock}`);
    console.log(`  Gastos fijos: ${resumen.gastos}`);
    console.log(`  Ventas:       ${resumen.ventas}`);
    console.log(`  Proveedores:  ${resumen.proveedores}`);
    console.log(`  Salteados:    ${resumen.salteados}`);
    console.log('═══════════════════════════════════════════');

    if (!args.confirmar) {
      console.log('\nPara aplicarlo de verdad: agregá --confirmar');
    }

    await sequelize.close();
    process.exit(0);
  } catch (err) {
    await t.rollback();
    logger.error({ err }, 'La migracion legacy fallo');
    console.error(`\nLa migracion fallo y se deshizo entera: ${err.message}`);
    await sequelize.close();
    process.exit(1);
  }
}

if (require.main === module) {
  migrar();
}

module.exports = { categoriaDe, leerArgumentos, parsear, extraerDelHtml };
