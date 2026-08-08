// ⚠ baseDePruebas va PRIMERO: arma la conexión contra la base de integración.
const { app, modelos, limpiarLaBase, conectarOFallar, cerrar } = require('./baseDePruebas');
const request = require('supertest');
const { sembrarDosEmpresas } = require('./fixtures');

// ════════════════════════════════════════════
//  Buscar «Perez» tiene que encontrar «Pérez»
//
//  ── Por qué esto NO se puede probar sin Postgres ──
//
//  La corrección es una función de SQL: `translate(lower(columna), acentos, sin
//  acentos)`. Contra los dobles de `tests/helpers/modelosFalsos.js` esa función
//  **no se ejecuta nunca** — el doble ni siquiera entiende un `where(fn(...))`—,
//  así que un test unitario puede verificar la FORMA de la condición y no que
//  encuentre una fila.
//
//  Y hay dos formas de romperla que solo se ven acá:
//
//   1. **El nombre de la columna.** `col('Sale.customer_name')` y
//      `col('customer.name')` son texto: si el alias del include cambia o el
//      modelo se renombra, Sequelize arma el SQL igual y Postgres contesta
//      «column does not exist». El test unitario, que compara strings, sigue
//      verde.
//
//   2. **El `limit` con `include`.** Con las dos cosas juntas Sequelize arma una
//      SUBCONSULTA sobre la tabla principal, y adentro de esa subconsulta la
//      tabla del `include` NO está en alcance. La condición sobre
//      `customer.name` que antes iba como `$customer.name$` —que Sequelize sabe
//      leer y por eso desactiva la subconsulta sola— ahora va como un `col()`
//      opaco. Si esto no está resuelto, la búsqueda por nombre de ficha revienta
//      con «missing FROM-clause entry».
//
//  El defecto que cierra: buscar sin acento no encontraba nada, y de ahí el
//  usuario no concluye que le faltó el acento — concluye que **la venta no
//  está**. Es el peor final de una búsqueda, porque el sistema contesta con
//  seguridad y se equivoca.
// ════════════════════════════════════════════

const { Sale, Customer } = modelos;

let datos;

beforeAll(async () => {
  await conectarOFallar();
});

beforeEach(async () => {
  await limpiarLaBase();
  datos = await sembrarDosEmpresas();
});

afterAll(async () => {
  await cerrar();
});

const HOY = '2026-07-15';

/** Una venta con nombre escrito a mano, sin ficha de cliente. */
async function ventaConNombreLibre(id, nombre) {
  return Sale.create({
    id,
    empresa_id: datos.empresaA.id,
    punto_de_venta_id: datos.centroA.id,
    date: HOY,
    time: '12:00',
    total: 1000,
    payment_method: 'ef',
    status: 'active',
    customer_name: nombre,
  });
}

/** Una venta atada a una ficha de cliente, que es la otra columna que se busca. */
async function ventaConFicha(id, nombre) {
  const cliente = await Customer.create({
    empresa_id: datos.empresaA.id,
    name: nombre,
  });

  const venta = await Sale.create({
    id,
    empresa_id: datos.empresaA.id,
    punto_de_venta_id: datos.centroA.id,
    date: HOY,
    time: '12:00',
    total: 2000,
    payment_method: 'ef',
    status: 'active',
    customer_id: cliente.id,
  });

  return { cliente, venta };
}

/** Los ids que devuelve el listado para una búsqueda. */
async function buscar(q) {
  const res = await request(app)
    .get('/api/sales')
    .query({ q, desde: HOY, hasta: HOY, punto_de_venta_id: 'todas' });

  // Se afirma el 200 acá adentro: sin esto, un 500 por SQL mal armado se lee
  // como «no encontró nada», que es justo el síntoma del defecto original.
  expect(res.status).toBe(200);

  return (res.body.data || []).map((v) => v.id);
}

describe('El nombre escrito a mano en la venta', () => {
  it('«Perez» encuentra a «Pérez»', async () => {
    await ventaConNombreLibre('VENTA-ACENTO-1', 'Juan Pérez');

    expect(await buscar('Perez')).toContain('VENTA-ACENTO-1');
  });

  it('y «Pérez» también, que es la otra mitad', async () => {
    // Sin este caso, una corrección que rompiera la búsqueda CON acento pasaría
    // el test de arriba, y quien escribe bien dejaría de encontrar sus ventas.
    await ventaConNombreLibre('VENTA-ACENTO-2', 'Juan Pérez');

    expect(await buscar('Pérez')).toContain('VENTA-ACENTO-2');
  });

  it('la ñ y la ç también, no solo las cinco vocales', async () => {
    // Son las dos que una lista de acentos armada a ojo se olvida, y las dos
    // que aparecen en apellidos de acá.
    await ventaConNombreLibre('VENTA-ENYE', 'Ñandú Goncalves');
    await ventaConNombreLibre('VENTA-CEDILLA', 'Françoise Roça');

    expect(await buscar('nandu')).toContain('VENTA-ENYE');
    expect(await buscar('Francoise')).toContain('VENTA-CEDILLA');
  });

  it('sigue sin encontrar lo que de verdad no está', async () => {
    // El caso testigo. Sin él, «encontrar sin acentos» se cumple devolviendo
    // TODO, y una búsqueda que devuelve todo no es una búsqueda.
    await ventaConNombreLibre('VENTA-ACENTO-3', 'Juan Pérez');

    expect(await buscar('Gomez')).toEqual([]);
  });
});

describe('El nombre de la ficha del cliente', () => {
  it('«Perez» encuentra la venta cuyo CLIENTE se llama «Pérez»', async () => {
    // ⚠ Éste es el que revienta si el `limit` con `include` arma la subconsulta:
    // la tabla `customers` no está en alcance ahí adentro y Postgres contesta
    // «missing FROM-clause entry for table customer».
    await ventaConFicha('VENTA-FICHA-1', 'María Pérez');

    expect(await buscar('Perez')).toContain('VENTA-FICHA-1');
  });

  it('encuentra por las DOS columnas en la misma búsqueda', async () => {
    // Van en OR: el usuario escribe lo que se acuerda, no elige por qué campo
    // busca. Si una de las dos ramas se rompiera, esto lo dice.
    await ventaConNombreLibre('VENTA-LIBRE', 'Ana Pérez');
    await ventaConFicha('VENTA-CON-FICHA', 'Ana Pérez');

    const encontradas = await buscar('Perez');

    expect(encontradas).toContain('VENTA-LIBRE');
    expect(encontradas).toContain('VENTA-CON-FICHA');
  });
});

describe('La búsqueda sigue sin cruzar empresas', () => {
  it('un nombre de la empresa B no aparece buscando desde la A', async () => {
    // `empresa_id` lo agrega la ruta con `scoped()`, no `filtroVentas`. Tocar
    // las condiciones de búsqueda es exactamente el cambio que podría hacer que
    // el `Op.or` se coma el filtro de empresa, y eso no se ve en un unitario.
    await Sale.create({
      id: 'VENTA-B-PEREZ',
      empresa_id: datos.empresaB.id,
      punto_de_venta_id: datos.localB.id,
      date: HOY,
      time: '12:00',
      total: 999,
      payment_method: 'ef',
      status: 'active',
      customer_name: 'Juan Pérez',
    });

    expect(await buscar('Perez')).toEqual([]);
  });
});

describe('El CAE se sigue buscando entero', () => {
  it('un CAE se encuentra por su número, sin que translate lo estorbe', async () => {
    // El CAE no pasa por `translate`: son dígitos. Este caso está para que
    // «sacar los acentos» no se lleve puesta la búsqueda por comprobante, que
    // es la que más se usa cuando alguien tiene el papel en la mano.
    await Sale.create({
      id: 'VENTA-CAE',
      empresa_id: datos.empresaA.id,
      punto_de_venta_id: datos.centroA.id,
      date: HOY,
      time: '12:00',
      total: 500,
      payment_method: 'ef',
      status: 'active',
      afip_cae: '75123456789012',
    });

    expect(await buscar('75123456789012')).toContain('VENTA-CAE');
  });
});
