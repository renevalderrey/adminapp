// ════════════════════════════════════════════
//  La unica funcion que decide en que sucursal va una fila de stock
//
//  Lo que estos tests protegen:
//
//   - Que un punto de venta de OTRA empresa no resuelva. Confiar en el id que
//     mando el cliente es como se mueve mercaderia entre empresas cliente.
//   - Que un codigo que no existe falle CON los codigos validos en el
//     mensaje, en vez de caer al por defecto. Caer al por defecto es como se
//     cargo stock en sucursales que no son.
//   - Que la empresa que cerro todos sus locales igual tenga a donde mandar
//     su stock: es el caso que FR-044 no cubria y donde justamente hay
//     mercaderia que rescatar.
//   - Que el espejo `location` se recorte a 30: la columna es VARCHAR(30) y
//     el nombre de la sucursal es VARCHAR(100). Sin el recorte, el INSERT de
//     la fila de stock falla.
// ════════════════════════════════════════════

const { crearModelo } = require('./helpers/modelosFalsos');

/**
 * findScoped mira el tipo de la clave primaria para decidir si el id se parsea
 * como entero. El doble de modelosFalsos no lo trae, y sin eso buscaria por
 * el id como string y no encontraria nada nunca.
 */
function modeloDePuntosDeVenta(filas) {
  return Object.assign(crearModelo(filas), {
    primaryKeyAttribute: 'id',
    rawAttributes: { id: { type: { key: 'INTEGER' } } },
  });
}

const mockPuntosDeVenta = modeloDePuntosDeVenta([]);

jest.mock('../models', () => ({ PuntoDeVenta: mockPuntosDeVenta }));

const {
  elegirPorDefecto,
  sucursalPorDefecto,
  resolverSucursal,
  ubicacionDeStock,
} = require('../utils/sucursalDeStock');

/** Reemplaza el contenido del modelo falso sin perder la referencia. */
function cargar(filas) {
  mockPuntosDeVenta.filas.length = 0;
  mockPuntosDeVenta.filas.push(...filas);
}

const PRINCIPAL = { id: 3, empresa_id: 7, name: 'Sucursal Principal', code: 'principal', is_active: true };
const DEPOSITO = { id: 5, empresa_id: 7, name: 'Depósito', code: 'deposito', is_active: false };
const AJENA = { id: 9, empresa_id: 99, name: 'De otra empresa', code: 'ajena', is_active: true };

beforeEach(() => cargar([PRINCIPAL, DEPOSITO, AJENA]));

describe('resolverSucursal · el orden de resolucion', () => {
  it('el id recibido manda sobre el codigo y sobre el por defecto', async () => {
    const pv = await resolverSucursal({ empresaId: 7, puntoDeVentaId: 5, code: 'principal' });

    expect(pv.id).toBe(5);
  });

  it('sin id, resuelve por el codigo recibido', async () => {
    const pv = await resolverSucursal({ empresaId: 7, code: 'deposito' });

    expect(pv.id).toBe(5);
  });

  it('sin id ni codigo, cae al por defecto de la empresa', async () => {
    const pv = await resolverSucursal({ empresaId: 7 });

    expect(pv.id).toBe(3);
  });

  it('acepta el id como string, que es como llega de un formulario', async () => {
    const pv = await resolverSucursal({ empresaId: 7, puntoDeVentaId: '5' });

    expect(pv.id).toBe(5);
  });

  it('un codigo vacio o en blanco no cuenta como codigo: cae al por defecto', async () => {
    expect((await resolverSucursal({ empresaId: 7, code: '' })).id).toBe(3);
    expect((await resolverSucursal({ empresaId: 7, code: '   ' })).id).toBe(3);
  });
});

describe('resolverSucursal · validar y no confiar', () => {
  it('un punto de venta de OTRA empresa no resuelve', async () => {
    // El id 9 existe, pero es de la empresa 99. Si esto resolviera, una
    // empresa escribiria stock en la sucursal de otra.
    await expect(resolverSucursal({ empresaId: 7, puntoDeVentaId: 9 }))
      .rejects.toThrow('Punto de venta inválido');
  });

  it('un id inexistente tampoco resuelve, y NO cae al por defecto', async () => {
    // Caer al por defecto seria escribir la mercaderia en otro lado sin decir
    // nada, que es exactamente el defecto que esta funcion viene a cerrar.
    await expect(resolverSucursal({ empresaId: 7, puntoDeVentaId: 4242 }))
      .rejects.toThrow('Punto de venta inválido');
  });

  it('el error del id invalido es un ErrorDeNegocio 400, no un 500', async () => {
    try {
      await resolverSucursal({ empresaId: 7, puntoDeVentaId: 9 });
      throw new Error('deberia haber lanzado');
    } catch (err) {
      expect(err.name).toBe('ErrorDeNegocio');
      expect(err.status).toBe(400);
      expect(err.publico).toBe(true);
    }
  });

  it('sin empresaId rompe el request en vez de operar sobre cualquier empresa', async () => {
    await expect(resolverSucursal({ puntoDeVentaId: 3 }))
      .rejects.toThrow(/Scoping por empresa invalido/);
  });
});

describe('resolverSucursal · un codigo que no existe falla y dice cuales valen', () => {
  it('tira ErrorDeNegocio en vez de caer al por defecto', async () => {
    await expect(resolverSucursal({ empresaId: 7, code: 'Deposito Norte' }))
      .rejects.toThrow('La sucursal "Deposito Norte" no existe');
  });

  it('el mensaje trae los codigos validos de ESA empresa', async () => {
    // Sin esto, una planilla que "funcionaba" informa 300 errores de fila y no
    // hay forma de saber que escribir. Y los codigos de otra empresa no se
    // filtran: seria contar cuantas sucursales tiene el vecino.
    try {
      await resolverSucursal({ empresaId: 7, code: 'Deposito Norte' });
      throw new Error('deberia haber lanzado');
    } catch (err) {
      expect(err.message).toContain('Códigos válidos: principal, deposito.');
      expect(err.message).not.toContain('ajena');
    }
  });

  it('la comparacion es sensible a mayusculas, igual que el resto del sistema', async () => {
    // Aflojarla aca haria que la escritura mapee distinto de como mapea la
    // migracion, que es peor que mapear poco.
    await expect(resolverSucursal({ empresaId: 7, code: 'Principal' }))
      .rejects.toThrow('no existe');
  });

  it('si ninguna sucursal tiene codigo, lo dice en vez de listar vacio', async () => {
    cargar([{ id: 1, empresa_id: 7, name: 'Local', code: null, is_active: true }]);

    await expect(resolverSucursal({ empresaId: 7, code: 'x' }))
      .rejects.toThrow('Ninguna sucursal de la empresa tiene código cargado.');
  });
});

describe('sucursalPorDefecto · los tres escalones', () => {
  it('1) el de code "principal", que es el que crea POST /api/empresas', async () => {
    cargar([
      { id: 1, empresa_id: 7, name: 'Depósito', code: 'deposito', is_active: true },
      { id: 8, empresa_id: 7, name: 'Principal', code: 'principal', is_active: true },
    ]);

    expect((await sucursalPorDefecto(7)).id).toBe(8);
  });

  it('el "principal" gana incluso si esta inactivo y hay otro activo', async () => {
    // Es la sucursal que el sistema creo como cabecera de la empresa: darla de
    // baja no la convierte en cualquier otra.
    cargar([
      { id: 1, empresa_id: 7, name: 'Principal', code: 'principal', is_active: false },
      { id: 2, empresa_id: 7, name: 'Depósito', code: 'deposito', is_active: true },
    ]);

    expect((await sucursalPorDefecto(7)).id).toBe(1);
  });

  it('2) sin "principal", el ACTIVO de menor id', async () => {
    cargar([
      { id: 4, empresa_id: 7, name: 'Mayo', code: 'mayo', is_active: true },
      { id: 2, empresa_id: 7, name: 'Ortiz', code: 'ortiz', is_active: false },
      { id: 3, empresa_id: 7, name: 'General', code: 'general', is_active: true },
    ]);

    expect((await sucursalPorDefecto(7)).id).toBe(3);
  });

  it('3) con TODOS inactivos, el de menor id igual', async () => {
    // El escalon que FR-044 no tenia: la empresa que cerro todos sus locales y
    // todavia tiene stock cargado es justo donde hay mercaderia que rescatar.
    // Sin este escalon, la migracion se queda sin destino ahi.
    cargar([
      { id: 6, empresa_id: 7, name: 'Mayo', code: 'mayo', is_active: false },
      { id: 2, empresa_id: 7, name: 'Ortiz', code: 'ortiz', is_active: false },
    ]);

    expect((await sucursalPorDefecto(7)).id).toBe(2);
  });

  it('solo mira las sucursales de la empresa que se pidio', async () => {
    cargar([AJENA, { id: 20, empresa_id: 7, name: 'Local', code: null, is_active: true }]);

    expect((await sucursalPorDefecto(7)).id).toBe(20);
  });

  it('sin ninguna sucursal lo dice, en vez de devolver null', async () => {
    // Devolver null es lo que deja filas de stock con punto_de_venta_id nulo.
    cargar([AJENA]);

    await expect(sucursalPorDefecto(7))
      .rejects.toThrow('La empresa no tiene ninguna sucursal cargada');
  });
});

describe('elegirPorDefecto · la misma regla, sin base', () => {
  // La usan tambien el plan de consolidacion y el script de informe: si la
  // regla viviera en SQL, habria tres versiones de FR-044.
  it('es determinista: el orden en que vienen las filas no cambia el resultado', () => {
    const puntos = [
      { id: 9, code: 'mayo', is_active: true },
      { id: 4, code: 'ortiz', is_active: true },
      { id: 7, code: 'general', is_active: true },
    ];

    expect(elegirPorDefecto(puntos).id).toBe(4);
    expect(elegirPorDefecto([...puntos].reverse()).id).toBe(4);
  });

  it('sin puntos de venta devuelve null y deja decidir a quien llama', () => {
    expect(elegirPorDefecto([])).toBeNull();
    expect(elegirPorDefecto()).toBeNull();
  });
});

describe('ubicacionDeStock · el espejo lo escribe el servidor', () => {
  it('devuelve el id y el code como location', () => {
    expect(ubicacionDeStock({ id: 5, code: 'deposito', name: 'Depósito' }))
      .toEqual({ punto_de_venta_id: 5, location: 'deposito' });
  });

  it('sin code cae al name, porque el unico indice de puntos_de_venta admite dos codes nulos', () => {
    expect(ubicacionDeStock({ id: 5, code: null, name: 'Depósito Central' }))
      .toEqual({ punto_de_venta_id: 5, location: 'Depósito Central' });
  });

  it('recorta el espejo a 30 caracteres', () => {
    // `location` es VARCHAR(30) y `puntos_de_venta.name` es VARCHAR(100). Sin
    // el recorte, el INSERT de la fila de stock falla y no se carga nada.
    const largo = 'Depósito Central de Mercadería Zona Norte';
    const { location } = ubicacionDeStock({ id: 5, code: null, name: largo });

    expect(location).toHaveLength(30);
    expect(location).toBe(largo.slice(0, 30));
  });

  it('sin punto de venta rompe fuerte: es un bug de quien llama', () => {
    expect(() => ubicacionDeStock(null)).toThrow('necesita un punto de venta con id');
    expect(() => ubicacionDeStock({ code: 'x' })).toThrow('necesita un punto de venta con id');
  });
});
