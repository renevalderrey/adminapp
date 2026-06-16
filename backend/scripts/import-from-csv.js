require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { sequelize, Brand, Product, Stock } = require('../src/models');

const CSV_PATH = path.resolve('C:\\Users\\renev\\Downloads\\u336213859_comprafit_app.csv');
const EMPRESA_ID = 1;

const LOCATIONS = {
  cf_stock:       { location: 'general', pvCode: 'general' },
  cf_stock_mayo:  { location: 'mayo',    pvCode: 'mayo' },
  cf_stock_ortiz: { location: 'ortiz',   pvCode: 'ortiz' },
};

/**
 * Parse CSV with 3 quoted fields per row, where field 2 may contain
 * newlines and ""-escaped quotes.
 */
function parseCsv(raw) {
  const data = {};
  let i = 0;
  while (i < raw.length) {
    // Skip whitespace/newlines
    while (i < raw.length && raw[i] <= ' ') i++;
    if (i >= raw.length) break;

    // Expect opening "
    if (raw[i] !== '"') { i++; continue; }

    // Find end of field 1 (key)
    let j = i + 1;
    while (j < raw.length && raw[j] !== '"') j++;
    if (j >= raw.length) break;
    const key = raw.substring(i + 1, j);
    if (!key.startsWith('cf_')) { i = j + 1; continue; }

    // Expect comma then " for field 2
    if (raw[j + 1] !== ',') { i = j + 1; continue; }
    if (raw[j + 2] !== '"') { i = j + 1; continue; }

    // Scan field 2 respecting ""-escaped quotes
    let k = j + 3; // start of field 2 content (after opening ")
    let valEnd = -1;
    while (k < raw.length) {
      if (raw[k] === '"') {
        if (k + 1 < raw.length && raw[k + 1] === '"') {
          k += 2; // escaped quote inside value
        } else {
          valEnd = k; // closing quote of field 2
          break;
        }
      } else {
        k++;
      }
    }
    if (valEnd === -1) break;

    const value = raw.substring(j + 3, valEnd);
    // Unescape "" → "
    data[key] = value.replace(/""/g, '"');

    // Advance past remaining fields and newline
    const nl = raw.indexOf('\n', valEnd);
    i = nl !== -1 ? nl + 1 : raw.length;
  }
  return data;
}

async function main() {
  console.log('▶  Reading CSV...');
  const raw = fs.readFileSync(CSV_PATH, 'utf-8');
  const data = parseCsv(raw);
  const keys = Object.keys(data);
  console.log(`  Found keys: ${keys.join(', ')}`);

  // 1. Brands
  console.log('\n▶  Importing brands...');
  if (data.cf_marcas) {
    const marcas = JSON.parse(data.cf_marcas);
    for (const m of marcas) {
      await Brand.findOrCreate({
        where: { name: m.n, empresa_id: EMPRESA_ID },
        defaults: { empresa_id: EMPRESA_ID, name: m.n, color: m.c || '#4d6fff' },
      });
    }
    console.log(`  ✓ ${marcas.length} brands`);
  }

  const allBrands = await Brand.findAll({ where: { empresa_id: EMPRESA_ID } });
  const brandByName = {};
  for (const b of allBrands) brandByName[b.name.toLowerCase().trim()] = b;

  // 2. Products (stored under cf_db key in the CSV export)
  console.log('\n▶  Importing products...');
  let created = 0, updated = 0;
  const prodData = data.cf_db;
  if (prodData) {
    const prods = JSON.parse(prodData);
    for (const p of prods) {
      const name = (p.n || '').trim();
      if (!name) { console.log('  ⚠  Skipping product with empty name'); continue; }

      const brandName = (p.marca || '').trim();
      let brandId = brandByName[brandName.toLowerCase()]?.id || null;
      if (!brandId && brandName) {
        const [newBrand] = await Brand.findOrCreate({
          where: { name: brandName, empresa_id: EMPRESA_ID },
          defaults: { empresa_id: EMPRESA_ID, name: brandName, color: '#888' },
        });
        brandId = newBrand.id;
        brandByName[brandName.toLowerCase()] = newBrand;
      }
      const cost = p.c ? parseFloat((p.c / 100).toFixed(2)) : 0;
      const marginOv = p._mgOv !== undefined ? parseFloat(p._mgOv) : undefined;
      const priceOv = p._precioOv !== undefined ? parseFloat((p._precioOv / 100).toFixed(2)) : undefined;

      let product = await Product.findOne({ where: { name, empresa_id: EMPRESA_ID } });
      if (product) {
        const updates = {};
        if (cost) updates.cost = cost;
        if (brandId) updates.brand_id = brandId;
        if (marginOv !== undefined) updates.margin_override = marginOv;
        if (priceOv !== undefined) updates.price_override = priceOv;
        if (Object.keys(updates).length) await product.update(updates);
        updated++;
      } else {
        await Product.create({
          name,
          sku: (p.sku || '').trim() || null,
          cost,
          brand_id: brandId,
          margin_override: marginOv,
          price_override: priceOv,
          category: 'otro',
          empresa_id: EMPRESA_ID,
        });
        created++;
      }
    }
    console.log(`  ✓ ${created} created, ${updated} updated`);
  }

  // 3. Stock per location
  console.log('\n▶  Importing stock...');

  const allProducts = await Product.findAll({ where: { empresa_id: EMPRESA_ID } });
  const productByName = {};
  for (const p of allProducts) productByName[p.name.toLowerCase().trim()] = p;
  console.log(`  ${allProducts.length} products in DB`);

  const [pvRows] = await sequelize.query(
    'SELECT id, code FROM puntos_de_venta WHERE empresa_id = $1',
    { bind: [EMPRESA_ID] }
  );
  const pvByCode = {};
  for (const pv of pvRows) pvByCode[pv.code] = pv.id;
  console.log(`  Puntos de venta: ${JSON.stringify(pvByCode)}`);

  let stockCount = 0;
  for (const [csvKey, cfg] of Object.entries(LOCATIONS)) {
    if (!data[csvKey]) { console.log(`  ⚠  ${csvKey} not found, skipping`); continue; }
    const items = JSON.parse(data[csvKey]);
    const pvId = pvByCode[cfg.pvCode] || null;
    let n = 0;
    for (const item of items) {
      const name = (item.n || '').trim();
      if (!name) continue;
      const product = productByName[name.toLowerCase()];
      if (!product) {
        console.log(`  ⚠  Product not found in DB: "${name}"`);
        continue;
      }

      const quantity = parseInt(item.cant, 10) || 0;
      const available = item.disp !== undefined ? parseInt(item.disp, 10) : quantity;

      const where = pvId
        ? { product_id: product.id, punto_de_venta_id: pvId, empresa_id: EMPRESA_ID }
        : { product_id: product.id, location: cfg.location, empresa_id: EMPRESA_ID };

      const [stock] = await Stock.findOrCreate({
        where,
        defaults: { quantity, available, location: cfg.location, empresa_id: EMPRESA_ID, punto_de_venta_id: pvId },
      });
      if (!stock.isNewRecord && (stock.quantity !== quantity || stock.available !== available)) {
        await stock.update({ quantity, available });
      }
      n++;
    }
    stockCount += n;
    console.log(`  ✓ ${cfg.location}: ${n} entries`);
  }

  console.log(`\n✅ Done: ${created} created, ${updated} updated, ${stockCount} stock entries`);
  await sequelize.close();
}

main().catch(err => {
  console.error('\n❌ Error:', err);
  sequelize.close().then(() => process.exit(1));
});
