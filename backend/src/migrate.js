// ════════════════════════════════════════════
//  COMPRAFIT · Script de Migración
//  Migra datos desde la API PHP (MySQL) al nuevo PostgreSQL
//
//  Uso: node src/migrate.js
//
//  Este script:
//  1. Conecta a la API PHP actual para obtener los datos
//  2. Parsea los JSON almacenados en cf_datos
//  3. Inserta todo en las tablas PostgreSQL normalizadas
// ════════════════════════════════════════════

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { sequelize, Brand, Product, Stock, Sale, SaleItem, Supplier, SupplierOrder, SupplierMovement, SupplierDocument, FixedExpense, Setting } = require('./models');

// ── Permitir certificados auto-firmados (para entornos de desarrollo/migración) ──
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// ── Configuración de la API PHP original ──
const PHP_API_URL = process.env.PHP_API_URL || 'https://tu-dominio.com/api.php';
const PHP_API_TOKEN = process.env.PHP_API_TOKEN || 'AdminApp.2025';

// ── Helper para llamar a la API PHP ──
async function phpGet(action, params = '') {
  const url = `${PHP_API_URL}?action=${action}${params}`;
  const res = await fetch(url, {
    headers: { 'X-Token': PHP_API_TOKEN },
  });
  const data = await res.json();
  return data;
}

async function phpGetAll() {
  try {
    const data = await phpGet('getall');
    if (data && data.ok && data.datos) return data.datos;
  } catch (e) {
    console.warn('   ⚠️ No se pudo conectar a la API PHP:', e.message);
  }

  // Fallback a index (8).html si la API falla
  const htmlPath = path.join(__dirname, '..', '..', 'index (8).html');
  if (fs.existsSync(htmlPath)) {
    console.log('   📂 Intentando extraer datos desde index (8).html...');
    try {
      const html = fs.readFileSync(htmlPath, 'utf8');
      
      const extract = (regex, name) => {
        const match = html.match(regex);
        if (!match) return null;
        try {
          let clean = match[1]
            .replace(/\/\/.*$/gm, '')
            .replace(/\s+/g, ' ')
            .replace(/,(\s*[\]}])/g, '$1');
          clean = clean.replace(/'/g, '"').replace(/([{,]\s*)([a-z_][a-z0-9_]*)\s*:/gi, '$1"$2":');
          return JSON.parse(clean);
        } catch {
          try { return eval(match[1]); } catch { return null; }
        }
      };

      const data = {
        cf_db: extract(/const STAR_INIT\s*=\s*(\[[\s\S]*?\]);/, 'STAR_INIT'),
        cf_stock: extract(/const STOCK_INIT\s*=\s*(\[[\s\S]*?\]);/, 'STOCK_INIT'),
        cf_gf1: extract(/let GF1\s*=\s*(\[[\s\S]*?\]);/, 'GF1'),
        cf_gf2: extract(/let GF2\s*=\s*(\[[\s\S]*?\]);/, 'GF2'),
        cf_marcas: extract(/const MDEFS\s*=\s*(\[[\s\S]*?\]);/, 'MDEFS')
      };
      
      if (data.cf_db || data.cf_stock) return data;
    } catch (err) {
      console.warn('   ❌ Error extrayendo de HTML:', err.message);
    }
  }

  return null;
}

function safeParse(str, fallback = null) {
  if (!str) return fallback;
  if (typeof str !== 'string') return str; // Ya es un objeto/array
  try {
    const parsed = JSON.parse(str);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

// ── Categoría inferida por nombre (replica catOf del frontend) ──
function catOf(name) {
  const s = name.toLowerCase();
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

// ════════════════════════════════════════════
//  MIGRACIÓN PRINCIPAL
// ════════════════════════════════════════════
async function migrate() {
  console.log('═══════════════════════════════════════════');
  console.log('  COMPRAFIT · Migración PHP → PostgreSQL');
  console.log('═══════════════════════════════════════════\n');

  // 1. Conectar a PostgreSQL y sincronizar tablas
  console.log('1️⃣  Conectando a PostgreSQL...');
  await sequelize.authenticate();
  await sequelize.sync({ force: true }); // ⚠️ CUIDADO: borra y recrea las tablas
  console.log('   ✅ Tablas creadas\n');

  // 2. Obtener todos los datos de la API PHP
  console.log('2️⃣  Obteniendo datos de la API PHP...');
  const allData = await phpGetAll();
  if (!allData) {
    console.error('   ❌ No se pudo conectar a la API PHP');
    console.log('   Tip: Configurá PHP_API_URL y PHP_API_TOKEN en tu .env');
    process.exit(1);
  }
  console.log(`   ✅ ${Object.keys(allData).length} claves obtenidas\n`);

  // 3. Migrar Marcas
  console.log('3️⃣  Migrando marcas...');
  const marcasRaw = safeParse(allData['cf_marcas'], []);
  const brandMap = new Map(); // nombre → id
  const defaultBrands = [
    { name: 'Star Nutrition', color: '#ff6b4a' },
    { name: 'Gold Nutrition', color: '#fbbf24' },
    { name: 'ENA', color: '#60a5fa' },
    { name: 'One Fit Nutrition', color: '#34d399' },
    { name: 'Hoch Sport', color: '#c084fc' },
    { name: 'Mervick', color: '#f97316' },
    { name: 'XBODY', color: '#22d3ee' },
    { name: 'Ultra Tech', color: '#f472b6' },
    { name: 'Gentech', color: '#4ade80' },
    { name: 'Body Advance', color: '#fb923c' },
  ];
  for (const b of defaultBrands) {
    const [brand] = await Brand.findOrCreate({ where: { name: b.name }, defaults: b });
    brandMap.set(b.name.toLowerCase(), brand.id);
  }
  // Agregar marcas adicionales encontradas en los datos
  if (Array.isArray(marcasRaw)) {
    for (const m of marcasRaw) {
      const name = m.n || m.name || m;
      if (name && !brandMap.has(name.toLowerCase())) {
        const [brand] = await Brand.findOrCreate({
          where: { name },
          defaults: { name, color: m.c || '#4d6fff' },
        });
        brandMap.set(name.toLowerCase(), brand.id);
      }
    }
  }
  console.log(`   ✅ ${brandMap.size} marcas migradas\n`);

  // 4. Migrar Productos (DB[])
  console.log('4️⃣  Migrando productos...');
  const dbRaw = safeParse(allData['cf_db'], []);
  const productMap = new Map(); // nombre → id
  let productCount = 0;
  for (const p of dbRaw) {
    try {
      const brandName = (p.marca || '').toLowerCase();
      const brandId = brandMap.get(brandName) || null;
      
      // Verificar si el SKU ya existe (si tiene uno)
      let sku = p.sku || null;
      if (sku) {
        const existingBySku = await Product.findOne({ where: { sku } });
        if (existingBySku) sku = null; // No duplicar SKU
      }

      const [product] = await Product.findOrCreate({
        where: { name: p.n },
        defaults: {
          name: p.n,
          sku: sku,
          cost: p.c || 0,
          brand_id: brandId,
          margin_override: p._mgOv !== undefined ? p._mgOv : null,
          price_override: p._precioOv !== undefined ? p._precioOv : null,
          category: catOf(p.n),
        }
      });
      productMap.set(p.n.toLowerCase(), product.id);
      productCount++;
    } catch (e) {
      console.warn(`   ⚠️ Producto ${p.n} no se pudo migrar:`, e.message);
    }
  }
  console.log(`   ✅ ${productCount} productos migrados\n`);

  // 5. Migrar Stock
  console.log('5️⃣  Migrando stock...');
  let stockCount = 0;
  const stockSets = [
    { key: 'cf_stock', location: 'general' },
    { key: 'cf_stock_ortiz', location: 'ortiz' },
    { key: 'cf_stock_mayo', location: 'mayo' },
  ];
  for (const { key, location } of stockSets) {
    const stockRaw = safeParse(allData[key], []);
    for (const s of stockRaw) {
      const productName = (s.n || '').toLowerCase();
      let productId = productMap.get(productName);

      // Si no existe el producto, crearlo desde el stock
      if (!productId) {
        try {
          const brandName = (s.marca || '').toLowerCase();
          const brandId = brandMap.get(brandName) || null;
          
          let sku = s.sku || null;
          if (sku) {
            const existingBySku = await Product.findOne({ where: { sku } });
            if (existingBySku) sku = null;
          }

          const [product] = await Product.findOrCreate({
            where: { name: s.n },
            defaults: {
              name: s.n,
              sku: sku,
              cost: 0,
              brand_id: brandId,
              category: catOf(s.n),
            }
          });
          productId = product.id;
          productMap.set(productName, productId);
        } catch (e) {
          console.warn(`   ⚠️ Producto de stock ${s.n} no se pudo crear:`, e.message);
          continue;
        }
      }

      await Stock.findOrCreate({
        where: { product_id: productId, location },
        defaults: {
          quantity: s.cant || 0,
          available: s.disp !== undefined ? s.disp : (s.cant || 0),
        },
      });
      stockCount++;
    }
  }
  console.log(`   ✅ ${stockCount} registros de stock migrados\n`);

  // 6. Migrar Gastos Fijos
  console.log('6️⃣  Migrando gastos fijos...');
  const gf1 = safeParse(allData['cf_gf1'], []);
  const gf2 = safeParse(allData['cf_gf2'], []);
  let expenseCount = 0;
  for (const g of gf1) {
    await FixedExpense.create({ name: g.n, amount: g.v, group: 'gf1' });
    expenseCount++;
  }
  for (const g of gf2) {
    await FixedExpense.create({ name: g.n, amount: g.v, group: 'gf2' });
    expenseCount++;
  }
  console.log(`   ✅ ${expenseCount} gastos fijos migrados\n`);

  // 7. Migrar Ventas
  console.log('7️⃣  Migrando ventas...');
  const ventasRaw = safeParse(allData['cf_ventas'], []);
  let saleCount = 0;
  for (const v of ventasRaw) {
    try {
      const sale = await Sale.create({
        id: v.id || `v_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        date: v.fecha || v.date || new Date().toISOString().split('T')[0],
        time: v.hora || v.time || '00:00',
        total: v.total || 0,
        payment_method: v.metodo || v.mp || 'ef',
        notes: v.obs || null,
        location: v.suc || 'general',
        seller: v.vendedor || null,
      });

      // Migrar items de la venta
      const items = Array.isArray(v.items) ? v.items : [];
      for (const item of items) {
        const productName = item.n || item.nombre || 'Producto';
        const productId = productMap.get(productName.toLowerCase()) || null;
        await SaleItem.create({
          sale_id: sale.id,
          product_name: productName,
          product_id: productId,
          quantity: item.qty || item.cantidad || 1,
          unit_price: item.precio || item.price || 0,
          payment_method: item.mp || null,
        });
      }
      saleCount++;
    } catch (e) {
      console.warn(`   ⚠️ Venta ${v.id} no se pudo migrar:`, e.message);
    }
  }
  console.log(`   ✅ ${saleCount} ventas migradas\n`);

  // 8. Migrar Cuentas de Proveedores
  console.log('8️⃣  Migrando cuentas de proveedores...');
  const cuentasRaw = safeParse(allData['cf_cuentas_prov'], []);
  let supplierCount = 0;
  for (const cuenta of cuentasRaw) {
    const [supplier] = await Supplier.findOrCreate({
      where: { name: cuenta.nombre || cuenta.name || 'Sin nombre' },
    });

    // Migrar movimientos
    const movs = cuenta.movimientos || cuenta.movements || [];
    for (const m of movs) {
      await SupplierMovement.create({
        supplier_id: supplier.id,
        type: m.tipo || m.type || 'deuda',
        date: m.fecha || m.date || new Date().toISOString().split('T')[0],
        amount: m.monto || m.amount || 0,
        payment_method: m.metodo || m.method || null,
        notes: m.obs || m.concepto || null,
      });
    }

    // Migrar pedidos
    const pedidos = cuenta.pedidos || [];
    for (const p of pedidos) {
      await SupplierOrder.create({
        supplier_id: supplier.id,
        date: p.fecha || p.date || new Date().toISOString().split('T')[0],
        total: p.total || 0,
        notes: p.obs || null,
        detail: p.items || null,
      });
    }

    // Migrar documentos/facturas
    const docs = cuenta.facturas || cuenta.documents || [];
    for (const d of docs) {
      await SupplierDocument.create({
        supplier_id: supplier.id,
        name: d.nombre || d.name || 'Documento',
        type: d.tipo || d.type || 'factura',
        url: d.link || d.url || null,
        date: d.fecha || d.date || null,
      });
    }

    supplierCount++;
  }
  console.log(`   ✅ ${supplierCount} proveedores migrados\n`);

  // 9. Migrar Settings (permisos, config general)
  console.log('9️⃣  Migrando configuraciones...');
  const settingsToMigrate = ['cf_permisos', 'cf_gv'];
  for (const key of settingsToMigrate) {
    const value = safeParse(allData[key], null);
    if (value) {
      await Setting.findOrCreate({
        where: { key },
        defaults: { value },
      });
    }
  }
  console.log('   ✅ Configuraciones migradas\n');

  // ── Resumen ──
  console.log('═══════════════════════════════════════════');
  console.log('  ✅ MIGRACIÓN COMPLETADA');
  console.log('═══════════════════════════════════════════');
  console.log(`  Marcas:       ${brandMap.size}`);
  console.log(`  Productos:    ${productCount}`);
  console.log(`  Stock:        ${stockCount}`);
  console.log(`  Gastos fijos: ${expenseCount}`);
  console.log(`  Ventas:       ${saleCount}`);
  console.log(`  Proveedores:  ${supplierCount}`);
  console.log('═══════════════════════════════════════════\n');

  process.exit(0);
}

migrate().catch(err => {
  console.error('❌ Error fatal en la migración:', err);
  process.exit(1);
});
