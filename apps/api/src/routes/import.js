const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { Product, Brand, Supplier, Stock, PuntoDeVenta, sequelize } = require('../models');
const checkPermission = require('../middleware/checkPermission');
const logger = require('../utils/logger');
const { fallo } = require('../utils/errores');
const { resolverSucursal, ubicacionDeStock } = require('../utils/sucursalDeStock');
const { aNumero } = require('../utils/importes');
const { aCantidad } = require('../utils/cantidades');
const { registrarCambioDeCosto, MOTIVOS } = require('../utils/historialDeCostos');

const upload = multer({
  dest: path.join(__dirname, '../../uploads'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.csv', '.xlsx', '.xls'].includes(ext)) return cb(null, true);
    cb(new Error('Formato no soportado. Subí CSV o Excel (.xlsx / .xls)'));
  },
});

const BASE_COLUMN_MAP = {
  nombre: 'name',
  name: 'name',
  descripcion: 'description',
  description: 'description',
  sku: 'sku',
  codigo: 'sku',
  codigo_barras: 'barcode',
  barcode: 'barcode',
  costo: 'cost',
  cost: 'cost',
  precio_costo: 'cost',
  marca: 'brand_name',
  brand: 'brand_name',
  proveedor: 'supplier_name',
  supplier: 'supplier_name',
  margen: 'margin_override',
  margen_personalizado: 'margin_override',
  precio_venta: 'price_override',
  precio: 'price_override',
  margen_mayorista: 'wholesale_margin',
  precio_mayorista: 'wholesale_price',
  categoria: 'category',
  category: 'category',
  unidad: 'unit_type',
  unit_type: 'unit_type',
  tamaño_envase: 'unit_size',
  unit_size: 'unit_size',
  gravado: 'taxed',
  taxed: 'taxed',
  imagen: 'image_url',
  image_url: 'image_url',
  activo: 'is_active',
  is_active: 'is_active',
  stock: 'quantity',
  cantidad: 'quantity',
  quantity: 'quantity',
  sucursal: 'location',
  location: 'location',
  lote: 'current_batch',
  vencimiento: 'expiration_date',
  fecha_compra: 'purchase_date',
  stock_minimo: 'min_stock',
};

const TEMPLATES = {
  products: {
    headers: [
      { header: 'nombre', key: 'name', note: 'Obligatorio' },
      { header: 'sku', key: 'sku', note: 'Código interno' },
      { header: 'codigo_barras', key: 'barcode', note: '' },
      { header: 'costo', key: 'cost', note: 'Número, ej: 1500.50' },
      { header: 'marca', key: 'brand_name', note: 'Nombre de la marca' },
      { header: 'proveedor', key: 'supplier_name', note: 'Nombre del proveedor' },
      { header: 'margen_personalizado', key: 'margin_override', note: 'Porcentaje, ej: 40' },
      { header: 'precio_venta', key: 'price_override', note: 'Precio manual, anula margen' },
      { header: 'categoria', key: 'category', note: 'proteina, creatina, pre, etc' },
      { header: 'unidad', key: 'unit_type', note: 'unidad / kg / gr / litro / ml' },
      { header: 'tamaño_envase', key: 'unit_size', note: 'Ej: 500 (gr), 1 (kg)' },
      { header: 'gravado', key: 'taxed', note: 'true / false' },
      { header: 'stock', key: 'quantity', note: 'Cantidad en inventario' },
      { header: 'sucursal', key: 'location', note: 'Código de sucursal. Default: principal' },
      { header: 'lote', key: 'current_batch', note: '' },
      { header: 'vencimiento', key: 'expiration_date', note: 'YYYY-MM-DD' },
    ],
  },
  sales: {
    headers: [
      { header: 'fecha', key: 'date', note: 'YYYY-MM-DD, Obligatorio' },
      { header: 'hora', key: 'time', note: 'HH:mm' },
      { header: 'producto', key: 'product_name', note: 'Nombre del producto, Obligatorio' },
      // Deja de decir «Número entero»: la columna admite fracciones desde la
      // 016 y la nota de la plantilla es lo único que le dice al usuario qué
      // puede escribir (FR-026).
      { header: 'cantidad', key: 'quantity', note: 'Número, ej: 3 o 0,4' },
      { header: 'precio_unitario', key: 'unit_price', note: 'Precio por unidad' },
      { header: 'total', key: 'total', note: 'Total de la venta' },
      { header: 'metodo_pago', key: 'payment_method', note: 'ef / tr / td / tc1 / qr' },
      { header: 'cliente', key: 'customer_name', note: 'Nombre del cliente' },
      { header: 'sucursal', key: 'location', note: 'Código de sucursal. Default: principal' },
    ],
  },
  customers: {
    headers: [
      { header: 'nombre', key: 'name', note: 'Obligatorio' },
      { header: 'cuit', key: 'tax_id', note: 'Sin guiones' },
      { header: 'email', key: 'email', note: '' },
      { header: 'telefono', key: 'phone', note: '' },
      { header: 'direccion', key: 'address', note: '' },
      { header: 'condicion_iva', key: 'tax_condition', note: 'consumidor_final / responsable_inscripto / monotributo' },
    ],
  },
  suppliers: {
    headers: [
      { header: 'nombre', key: 'name', note: 'Obligatorio' },
      { header: 'cuit', key: 'cuit', note: '' },
      { header: 'email', key: 'email', note: '' },
      { header: 'telefono', key: 'phone', note: '' },
      { header: 'direccion', key: 'address', note: '' },
    ],
  },
};

function buildColumnMap(override) {
  if (!override || typeof override !== 'object') return BASE_COLUMN_MAP;
  const merged = { ...BASE_COLUMN_MAP };
  for (const [userColumn, systemField] of Object.entries(override)) {
    const normalized = userColumn.toLowerCase().trim().replace(/\s+/g, '_').replace(/[áéíóú]/g, (c) => ({ á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u' })[c] || c);
    merged[normalized] = systemField;
  }
  return merged;
}

function mapRow(row, columnMap) {
  const mapped = {};
  for (const [col, val] of Object.entries(row)) {
    const normalized = col.toLowerCase().trim().replace(/\s+/g, '_').replace(/[áéíóú]/g, (c) => ({ á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u' })[c] || c);
    const target = columnMap[normalized];
    if (target) mapped[target] = val;
  }
  return mapped;
}

// GET /api/import/template/:type — Descargar plantilla Excel
router.get('/template/:type', checkPermission('products.crear'), (req, res) => {
  try {
    const type = req.params.type;
    const config = TEMPLATES[type];
    if (!config) return res.status(404).json({ ok: false, error: 'Tipo de plantilla no válido. Usá: products, sales, customers, suppliers' });

    const wb = XLSX.utils.book_new();
    const wsData = [config.headers.map(h => h.header)];
    wsData.push(config.headers.map(h => h.note));
    wsData.push([]);
    const sampleRow = config.headers.reduce((acc, h) => {
      acc[h.header] = '';
      return acc;
    }, {});
    wsData.push(Object.values(sampleRow));

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = config.headers.map(() => ({ wch: 22 }));
    XLSX.utils.book_append_sheet(wb, ws, 'Datos');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', `attachment; filename="plantilla_${type}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    fallo(req, res, err, 'Error al generar la plantilla');
  }
});

// POST /api/import/products — Importar productos desde CSV o Excel
router.post('/products', checkPermission('products.crear'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Subí un archivo CSV o Excel' });

    let userMapping = {};
    if (req.body.mapping) {
      try {
        userMapping = typeof req.body.mapping === 'string' ? JSON.parse(req.body.mapping) : req.body.mapping;
      } catch { /* silent */ }
    }
    logger.info({ userMapping, bodyMapping: req.body.mapping }, 'Import mapping debug');
    const columnMap = buildColumnMap(userMapping);

    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    let rows = [];

    if (ext === '.csv') {
      const content = fs.readFileSync(filePath, 'utf-8');

      // `raw: true` en el CSV, y no `false`. Es lo que hace que `aNumero` sirva
      // para algo: con `raw: false`, el lector de xlsx **adivina el tipo de
      // cada celda antes** de que la veamos, y adivina mal justo con el formato
      // argentino — `"1.234,50"` le sale el número `1.2345`, o sea mil veces
      // menos, y ahí ya no hay texto que interpretar. En un CSV toda celda es
      // texto por definición: el número que infiere es una suposición sobre
      // algo que nunca fue un número.
      //
      // No aplica a `.xlsx`: ahí las celdas numéricas SON números de verdad
      // —`aNumero` las deja pasar tal cual— y las de texto llegan como texto
      // con `raw` en cualquier valor. Por eso la rama de abajo no cambia.
      const wb = XLSX.read(content, { type: 'string', raw: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    } else {
      const wb = XLSX.readFile(filePath, { raw: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    }

    fs.unlinkSync(filePath);

    if (rows.length === 0) return res.status(400).json({ ok: false, error: 'El archivo está vacío' });

    const empresaId = req.empresaId;

    // `defaultLocation` se sigue aceptando, ahora interpretado como **código de
    // sucursal**. Se resuelve acá, antes de escribir una sola fila: es un
    // parámetro que aplica a todas, y descubrir en la fila 300 que no existe
    // sería tarde. Si no viene, va el punto de venta por defecto de la empresa.
    //
    // El `'principal'` literal que había acá era la mitad de un defecto real:
    // en una empresa sembrada por `seedPuntosDeVenta`, cuyos códigos son
    // general/ortiz/mayo, ese texto **no coincide con nada**, y la importación
    // escribía filas en una sucursal inexistente que la pantalla no muestra.
    let sucursalPorDefectoDelArchivo;
    try {
      sucursalPorDefectoDelArchivo = await resolverSucursal({
        empresaId,
        code: req.body.defaultLocation,
      });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }

    // Las sucursales de la empresa se leen UNA vez: una planilla de 300 filas
    // con columna Sucursal haría 300 consultas iguales.
    const sucursales = await PuntoDeVenta.findAll({ where: { empresa_id: empresaId } });
    const porCodigo = new Map(sucursales.filter((pv) => pv.code).map((pv) => [pv.code, pv]));
    const codigosValidos = [...porCodigo.keys()].join(', ');

    // Qué productos trae el archivo más de una vez. Se queda **el último**, que
    // es lo que ya hacía —cada fila pisa a la anterior—, pero ahora se informa:
    // sin esto, importar una lista con el mismo SKU dos veces deja un stock que
    // no es la suma ni el máximo y nadie sabe por qué.
    const vistos = new Set();
    let pisados = 0;

    let created = 0, updated = 0, errors = [];

    for (const [i, raw] of rows.entries()) {
      // `data` se declara FUERA del try. El catch de abajo lo usa para armar el
      // mensaje de la fila que fallo, y estando declarado adentro tiraba
      // ReferenceError justo cuando habia un error que explicar: el catch se
      // rompia, el error salia del bucle y la importacion entera devolvia 500
      // en vez de reportar la fila mala y seguir.
      let data = {};

      try {
        data = mapRow(raw, columnMap);

        // Sanitize: convert empty strings to null so optional fields don't cause validation errors
        for (const k of Object.keys(data)) {
          if (data[k] === '' || data[k] === ' ') data[k] = null;
        }

        if (!data.name && !data.sku) {
          errors.push({ fila: i + 2, error: 'Falta nombre o sku' });
          continue;
        }
        if (!data.name) {
          errors.push({ fila: i + 2, error: 'Falta el nombre del producto' });
          continue;
        }

        // La sucursal se valida ANTES de crear o actualizar el producto: una
        // fila con una sucursal que no existe no tiene por qué dejar el
        // producto a medio importar. Se informa con su número de línea y **con
        // los códigos válidos**, y las demás filas entran igual: después de
        // FR-050 una planilla que «funcionaba» puede informar trescientos
        // errores, y «sucursal inválida» a secas no dice qué poner.
        if (data.location && !porCodigo.has(data.location)) {
          errors.push({
            fila: i + 2,
            error: `La sucursal "${data.location}" no existe. `
              + (codigosValidos
                ? `Códigos válidos: ${codigosValidos}.`
                : 'Ninguna sucursal de la empresa tiene código cargado.'),
          });
          continue;
        }

        // El mismo producto dos veces en el mismo archivo. Se queda el último
        // —cada fila pisa a la anterior— y se cuenta para poder decirlo.
        const clave = data.sku ? `sku:${data.sku}` : `nombre:${data.name}`;
        if (vistos.has(clave)) pisados++;
        vistos.add(clave);

        let brandId = null;
        if (data.brand_name) {
          const [brand] = await Brand.findOrCreate({
            where: { name: data.brand_name, empresa_id: empresaId },
            defaults: { empresa_id: empresaId },
          });
          brandId = brand.id;
        }

        let supplierId = null;
        if (data.supplier_name) {
          const [supplier] = await Supplier.findOrCreate({
            where: { name: data.supplier_name, empresa_id: empresaId },
            defaults: { empresa_id: empresaId },
          });
          supplierId = supplier.id;
        }

        // `aNumero` y no `parseFloat` (FR-095). Un importe argentino se escribe
        // 1.234,50: `parseFloat` corta en la coma y devuelve 1.234, o sea mil
        // veces menos. No falla nada —el producto queda cargado— y el margen
        // que muestra el POS pasa a ser mentira hasta que alguien lo compara
        // contra la factura del proveedor.
        //
        // El `null` de `aNumero` se traduce a `undefined` a propósito: el
        // código de abajo distingue «no vino» (`undefined`, no se toca el
        // campo) de «vino un número». Dejando pasar el `null`, la comparación
        // `cost !== undefined` daría verdadera y una celda de costo vacía
        // pondría el costo en NULL — que es la misma pérdida que ponerlo en
        // cero, y es exactamente lo que `import.js` ya había corregido
        // (FR-099).
        const toNum = (v) => { const n = aNumero(v); return n === null ? undefined : n; };

        // Sin `|| 0`: si la columna costo no viene o esta vacia, toNum
        // devuelve undefined y el campo NO se toca. Antes se forzaba a 0, con
        // lo cual importar una planilla parcial (por ejemplo solo para
        // actualizar stock) ponia en cero el costo de cada producto y se
        // llevaba puestos todos los precios derivados de el.
        const cost = toNum(data.cost);
        const marginOverride = toNum(data.margin_override);
        const priceOverride = toNum(data.price_override);
        const wholesaleMargin = toNum(data.wholesale_margin);
        const wholesalePrice = toNum(data.wholesale_price);
        const unitSize = toNum(data.unit_size);
        const taxed = data.taxed != null && data.taxed !== '' ? (data.taxed === 'true' || data.taxed === true || data.taxed === '1' || data.taxed === 1) : undefined;
        const isActive = data.is_active != null && data.is_active !== '' ? (data.is_active === 'true' || data.is_active === true || data.is_active === '1' || data.is_active === 1) : undefined;

        let product = null;
        if (data.sku) product = await Product.findOne({ where: { sku: data.sku, empresa_id: empresaId } });
        if (!product && data.name) product = await Product.findOne({ where: { name: data.name, empresa_id: empresaId } });

        const productData = {
          name: data.name, description: data.description, sku: data.sku, barcode: data.barcode,
          brand_id: brandId, supplier_id: supplierId,
          category: data.category || 'otro',
          unit_type: ['unidad', 'kg', 'gr', 'litro', 'ml'].includes(data.unit_type) ? data.unit_type : 'unidad',
          unit_size: unitSize,
          taxed, image_url: data.image_url,
          empresa_id: empresaId,
        };

        if (cost !== undefined) productData.cost = cost;
        if (marginOverride !== undefined) productData.margin_override = marginOverride;
        if (priceOverride !== undefined) productData.price_override = priceOverride;
        if (wholesaleMargin !== undefined) productData.wholesale_margin = wholesaleMargin;
        if (wholesalePrice !== undefined) productData.wholesale_price = wholesalePrice;
        if (isActive !== undefined) productData.is_active = isActive;

        if (product) {
          // El costo de antes se lee ANTES del update: después la instancia ya
          // tiene el valor nuevo y `old_cost` saldría igual a `new_cost`.
          const costoAnterior = product.cost;

          await product.update(productData);

          // La importación de listas **no registraba nada** (defecto 2), y es
          // el camino que más costos mueve: una lista de 200 líneas dejaba
          // cero filas de historial. Sin esto la pantalla de la historia 6
          // queda inútil justo en el caso principal, y una pantalla vacía se
          // lee como «nunca cambió nada», no como «esto no se registra».
          //
          // Va fuera de cualquier transacción porque este bucle no tiene
          // ninguna: el servidor escribe fila por fila a propósito (es el
          // motivo del tope de 2.000 líneas). La fila de historial se escribe
          // junto al producto que ya quedó guardado.
          await registrarCambioDeCosto({
            producto: product,
            costoAnterior,
            costoNuevo: product.cost,
            motivo: MOTIVOS.IMPORTACION,
            usuarioId: req.usuario ? req.usuario.id : null,
          });

          updated++;
        } else {
          product = await Product.create(productData);
          created++;
        }

        // Antes alcanzaba con que la columna existiera: una celda vacia es
        // '' , que no es undefined, y parseInt('') || 0 daba 0. Importar una
        // planilla con la columna cantidad en blanco vaciaba el inventario.
        //
        // ⚠ `parseInt` salió además por otra razón: **trunca sin avisar**.
        // `parseInt('0.4')` es `0`, así que una planilla que dice 0,4 kg
        // importaba cero (FR-026). Ahora la lectura es en dos pasos, y son dos
        // preguntas distintas:
        //
        //   1. `aNumero` contesta **si la celda traía un número**. Devuelve
        //      `null` para la celda vacía y para la ilegible, que es la
        //      distinción que este comentario documenta desde antes. Es además
        //      el único lector de números escritos por una persona que hay en
        //      el sistema —el mismo `toNum` que usa la columna Costo en este
        //      mismo handler—, así que un `0,4` argentino se lee igual en las
        //      dos columnas de la misma fila. Que no fuera así es literalmente
        //      lo que cuenta el encabezado de `utils/importes.js`.
        //   2. `aCantidad` contesta **cuánto**, con el redondeo a los 4
        //      decimales de la columna hecho explícito.
        //
        // No se pueden fusionar: para `aCantidad` una celda vacía y una celda
        // que dice cero son el mismo cero, y ahí volvería el defecto de vaciar
        // el inventario con una planilla parcial.
        const cantidadDeLaCelda = aNumero(data.quantity);
        if (cantidadDeLaCelda !== null) {
          const qty = aCantidad(cantidadDeLaCelda);

          // La columna Sucursal se resuelve contra el `code` **de esta
          // empresa**. Antes se escribía como texto en `location`: la
          // importación escribía por `location`, la pantalla lee por
          // `punto_de_venta_id`, y el usuario importaba 300 productos, veía
          // los stocks viejos y no se enteraba de nada. Es el criterio de
          // éxito 7.
          const ubicacion = ubicacionDeStock(
            data.location ? porCodigo.get(data.location) : sucursalPorDefectoDelArchivo
          );

          const [stock] = await Stock.findOrCreate({
            where: {
              product_id: product.id,
              punto_de_venta_id: ubicacion.punto_de_venta_id,
              empresa_id: empresaId,
            },
            defaults: {
              quantity: qty,
              available: qty,
              ...ubicacion,
              empresa_id: empresaId,
              // `min_stock` también migra a DECIMAL(14,4), y también truncaba:
              // un mínimo de 0,5 kg entraba como 0. El `|| 0` de antes lo
              // reemplaza `aCantidad`, que ya devuelve 0 ante el `null` de una
              // celda vacía — acá el cero **sí** es el valor correcto, porque
              // es el default de la columna y no una fila que se pisa.
              min_stock: aCantidad(aNumero(data.min_stock)),
              current_batch: data.current_batch || null,
              expiration_date: data.expiration_date || null,
              purchase_date: data.purchase_date || null,
            },
          });
          if (!stock.isNewRecord) {
            await stock.update({ quantity: qty, available: qty });
          }
        }
      } catch (err) {
        let msg = err.message;
        if (msg.includes('enum_products_unit_type')) msg = `"${data.unit_type || '(vacío)'}" no es válido para Unidad. Usá: unidad, kg, gr, litro, ml`;
        else if (msg === 'Validation error' && err.errors?.length) msg = err.errors.map(e => `${e.path}: ${e.message}`).join('; ');
        else if (msg.includes('null value in column')) msg = `Falta un campo obligatorio (${msg.match(/"([^"]+)"/)?.[1] || ''})`;
        else if (msg.length > 120) msg = msg.substring(0, 120) + '...';
        errors.push({ fila: i + 2, error: msg });
      }
    }

    res.json({
      ok: true,
      created, updated, errors: errors.length > 0 ? errors : undefined,
      pisados,
      total: rows.length,
    });
  } catch (err) {
    fallo(req, res, err, 'Error al importar el archivo');
  }
});

module.exports = router;
