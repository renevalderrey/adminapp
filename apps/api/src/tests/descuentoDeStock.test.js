// ════════════════════════════════════════════
//  Las rutas que descuentan stock tienen que encontrar la fila
//
//  Después de la migración 14, `stock.punto_de_venta_id` es NOT NULL. Una
//  consulta que busque `punto_de_venta_id: null` —o `req.puntoDeVentaId || null`,
//  que es lo mismo cuando no vino la cabecera— **no matchea ninguna fila
//  jamás**.
//
//  Los tres caminos que descuentan inventario buscaban así:
//
//    · `POST /api/sales`            (venta desde el POS)
//    · `PUT /api/sales/:id/void`    (anulación)
//    · `tiendanubeService`          (pedido de la tienda online)
//
//  Es el riesgo 1 del plan, y lo grave no es que falle: es que **no falla**.
//  La venta se registra, el comprobante sale, el cliente paga, y el inventario
//  no baja. Lo único que avisa es una línea de log que nadie lee, y el problema
//  aparece en un recuento físico tres meses después, cuando ya no se puede
//  reconstruir qué pasó.
//
//  Por eso esto es una guardia estática y no una nota en la spec: el error no
//  tiene síntoma, así que la única forma de detectarlo es impedir que se
//  escriba.
// ════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');
const leer = (relativo) => fs.readFileSync(path.join(SRC, relativo), 'utf8');

/**
 * Los bloques de una búsqueda de Stock: la línea de la llamada y las
 * siguientes, hasta cerrar el objeto `where`.
 */
function bloquesDeBusquedaDeStock(contenido) {
  const lineas = contenido.split('\n');
  const bloques = [];

  lineas.forEach((linea, i) => {
    if (!/Stock\.(findOne|findAll|findOrCreate)\s*\(/.test(linea)) return;
    if (linea.trim().startsWith('//') || linea.trim().startsWith('*')) return;

    bloques.push({ n: i + 1, texto: lineas.slice(i, i + 9).join('\n') });
  });

  return bloques;
}

/** Lo que no puede aparecer como sucursal de una búsqueda de stock. */
const NUNCA = [
  // La cabecera cruda: sin ella, `|| null` no matchea nada.
  /punto_de_venta_id:\s*req\.puntoDeVentaId/,
  // La columna de la venta: está en null en todas las ventas anteriores.
  /punto_de_venta_id:\s*sale\.punto_de_venta_id/,
  // Cualquier caída explícita a null.
  /punto_de_venta_id:\s*[^,\n]*\|\|\s*null/,
  /punto_de_venta_id:\s*null/,
];

describe('POST /api/sales y PUT /api/sales/:id/void descuentan de una sucursal real', () => {
  const sales = leer('routes/sales.js');
  const bloques = bloquesDeBusquedaDeStock(sales);

  it('encuentra las dos búsquedas de stock que tiene que vigilar', () => {
    // El ancla. Una guardia que pasa porque no encontró nada que mirar es peor
    // que no tenerla: nadie vuelve a mirarla. Si este número cambia, hay una
    // búsqueda de stock nueva y **hay que leerla**, no ajustar el número.
    expect(bloques.length).toBeGreaterThan(0);
    expect(bloques.length).toBe(2);
  });

  it('ninguna busca la fila por una sucursal que puede ser nula', () => {
    const malas = bloques
      .filter(({ texto }) => NUNCA.some((patron) => patron.test(texto)))
      .map(({ n }) => `L${n}`);

    expect(malas).toEqual([]);
  });

  it('las dos filtran por sucursal: buscar sin ella traería la fila de otra', () => {
    const sinSucursal = bloques
      .filter(({ texto }) => !/punto_de_venta_id:/.test(texto))
      .map(({ n }) => `L${n}`);

    expect(sinSucursal).toEqual([]);
  });

  it('la sucursal sale de utils/sucursalDeStock y no de una regla propia', () => {
    // Diez lugares escriben stock y cada uno decidía la sucursal a su manera.
    // Que la decida siempre la misma función es FR-049; si acá se vuelve a
    // resolver a mano, las rutas y la migración pueden mapear distinto.
    expect(sales).toMatch(/require\('\.\.\/utils\/sucursalDeStock'\)/);
    expect(sales).toMatch(/resolverSucursal\(/);
    expect(sales).toMatch(/sucursalPorDefecto\(/);
  });

  it('la anulación prueba los tres escalones antes de rendirse', () => {
    // `sale.punto_de_venta_id` → `sale.location` → por defecto. Sin el
    // segundo y el tercero, anular una venta anterior a esta funcionalidad
    // devuelve el dinero y no la mercadería.
    const anulacion = sales.slice(sales.indexOf('async function sucursalDeAnulacion'));
    const cuerpo = anulacion.slice(0, anulacion.indexOf('\n}\n'));

    expect(cuerpo).toMatch(/sale\.punto_de_venta_id/);
    expect(cuerpo).toMatch(/code:\s*sale\.location/);
    expect(cuerpo).toMatch(/sucursalPorDefecto\(/);
  });
});

describe('un pedido de TiendaNube también descuenta stock', () => {
  const tiendanube = leer('services/tiendanubeService.js');
  const bloques = bloquesDeBusquedaDeStock(tiendanube);

  it('encuentra la búsqueda de stock que tiene que vigilar', () => {
    // El ancla, igual que arriba.
    expect(bloques.length).toBeGreaterThan(0);
    expect(bloques.length).toBe(1);
  });

  it('no busca la fila por una sucursal que puede ser nula', () => {
    // Un pedido de la tienda NUNCA trae cabecera de punto de venta: acá
    // `|| null` no era un caso raro, era el caso normal.
    const malas = bloques
      .filter(({ texto }) => NUNCA.some((patron) => patron.test(texto))
        || /punto_de_venta_id:\s*puntoDeVentaId/.test(texto))
      .map(({ n }) => `L${n}`);

    expect(malas).toEqual([]);
  });

  it('la sucursal sale de utils/sucursalDeStock', () => {
    expect(tiendanube).toMatch(/require\('\.\.\/utils\/sucursalDeStock'\)/);
    expect(tiendanube).toMatch(/resolverSucursal\(/);
  });
});

