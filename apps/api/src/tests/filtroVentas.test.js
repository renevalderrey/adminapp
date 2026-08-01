// ════════════════════════════════════════════
//  El filtro del historial de ventas
//
//  Es la unica parte de la consulta que se puede probar sin una base. Lo que
//  se protege: que el rango no se pueda pedir invertido ni abierto, que
//  «Todas las sucursales» realmente desactive el filtro, que el orden lleve un
//  tercer criterio determinístico, y —lo mas importante— que esta funcion NO
//  agregue empresa_id, porque eso lo hace la ruta.
// ════════════════════════════════════════════

const { Op } = require('sequelize');
const {
  filtroVentas,
  numeroDeComprobante,
  FILAS_POR_PAGINA,
} = require('../utils/filtroVentas');

const HOY = '2026-08-01';
const base = (query = {}, opciones = {}) =>
  filtroVentas(query, { hoy: HOY, ...opciones });

describe('El rango de fechas', () => {
  it('sin parametros consulta el dia de hoy del negocio', () => {
    const { rango, where } = base();

    expect(rango).toEqual({ desde: HOY, hasta: HOY });
    expect(where.date).toEqual({ [Op.between]: [HOY, HOY] });
  });

  it('con desde y hasta consulta el rango completo', () => {
    expect(base({ desde: '2026-07-01', hasta: '2026-07-31' }).rango)
      .toEqual({ desde: '2026-07-01', hasta: '2026-07-31' });
  });

  // Pedir «desde el 1» sin hasta es un dia, no medio año abierto.
  it('si falta un extremo se usa el otro', () => {
    expect(base({ desde: '2026-07-01' }).rango)
      .toEqual({ desde: '2026-07-01', hasta: '2026-07-01' });
    expect(base({ hasta: '2026-07-31' }).rango)
      .toEqual({ desde: '2026-07-31', hasta: '2026-07-31' });
  });

  // `date` es el parametro de cuando el listado era de un dia por vez.
  it('el alias date equivale a desde = hasta = date', () => {
    expect(base({ date: '2026-06-15' }).rango)
      .toEqual({ desde: '2026-06-15', hasta: '2026-06-15' });
  });

  it('si vienen desde/hasta, el alias date se ignora', () => {
    expect(base({ date: '2026-06-15', desde: '2026-07-01', hasta: '2026-07-05' }).rango)
      .toEqual({ desde: '2026-07-01', hasta: '2026-07-05' });
  });

  // Una fecha con formato raro no devuelve cero filas: hace que Postgres
  // aborte la consulta y el listado responda 500.
  it('una fecha con formato invalido NO llega a la consulta: cae en hoy', () => {
    expect(base({ desde: 'ayer', hasta: '31/07/2026' }).rango)
      .toEqual({ desde: HOY, hasta: HOY });
  });

  it('una fecha con formato correcto pero inexistente tampoco llega', () => {
    expect(base({ desde: '2026-02-31' }).rango).toEqual({ desde: HOY, hasta: HOY });
  });

  it('sin la fecha del negocio rompe, en vez de caer en la fecha UTC del servidor', () => {
    expect(() => filtroVentas({}, {})).toThrow(/fecha de hoy del negocio/);
  });
});

describe('Rangos que no se consultan', () => {
  it('rango invertido: avisa y no arma consulta', () => {
    expect(() => base({ desde: '2026-08-10', hasta: '2026-08-01' }))
      .toThrow(/invertido/i);
  });

  it('el rango invertido lleva codigo RANGO_INVERTIDO y status 400', () => {
    try {
      base({ desde: '2026-08-10', hasta: '2026-08-01' });
      throw new Error('tenia que fallar');
    } catch (err) {
      expect(err.codigo).toBe('RANGO_INVERTIDO');
      expect(err.status).toBe(400);
      // Es un mensaje para el usuario, no de Postgres.
      expect(err.publico).toBe(true);
    }
  });

  it('rango de mas de un año: avisa y no arma consulta', () => {
    try {
      base({ desde: '2025-01-01', hasta: '2026-01-02' });
      throw new Error('tenia que fallar');
    } catch (err) {
      expect(err.codigo).toBe('RANGO_DEMASIADO_LARGO');
      expect(err.status).toBe(400);
    }
  });

  it('un año exacto SI se consulta: el tope es «mas de un año»', () => {
    expect(base({ desde: '2025-01-01', hasta: '2026-01-01' }).rango)
      .toEqual({ desde: '2025-01-01', hasta: '2026-01-01' });
  });

  it('un año bisiesto de punta a punta entra', () => {
    expect(base({ desde: '2024-02-29', hasta: '2025-02-28' }).rango.hasta)
      .toBe('2025-02-28');
  });
});

describe('El filtro de sucursal', () => {
  it('con punto_de_venta_id filtra por esa sucursal', () => {
    expect(base({ punto_de_venta_id: '3' }).where.punto_de_venta_id).toBe(3);
  });

  // El defecto que corrige: la cabecera pisaba el parametro en silencio, asi
  // que con una sucursal activa en el encabezado no habia forma de ver todas.
  it('«todas» NO filtra por sucursal, ni aunque la cabecera traiga una', () => {
    const { where } = base({ punto_de_venta_id: 'todas' }, { puntoDeVentaId: 7 });

    expect(where).not.toHaveProperty('punto_de_venta_id');
  });

  it('la query manda sobre la cabecera', () => {
    const { where } = base({ punto_de_venta_id: '3' }, { puntoDeVentaId: 7 });

    expect(where.punto_de_venta_id).toBe(3);
  });

  it('sin parametro se respeta la cabecera, que es el comportamiento de hoy', () => {
    expect(base({}, { puntoDeVentaId: 7 }).where.punto_de_venta_id).toBe(7);
  });

  it('sin parametro ni cabecera no filtra: las ventas viejas sin sucursal no desaparecen', () => {
    expect(base({}).where).not.toHaveProperty('punto_de_venta_id');
  });

  // `location` es texto historico de antes de multi-sucursal.
  it('location solo se aplica si no hubo filtro real de sucursal', () => {
    expect(base({ location: 'ortiz' }).where.location).toBe('ortiz');
    expect(base({ location: 'ortiz', punto_de_venta_id: '3' }).where)
      .not.toHaveProperty('location');
    expect(base({ location: 'ortiz' }, { puntoDeVentaId: 7 }).where)
      .not.toHaveProperty('location');
  });

  it('con «todas» tampoco se cuela location por la ventana', () => {
    expect(base({ location: 'ortiz', punto_de_venta_id: 'todas' }).where)
      .not.toHaveProperty('location');
  });
});

describe('El filtro de tipo de comprobante', () => {
  it.each([['1', 1], ['6', 6], ['11', 11]])('tipo %s filtra por afip_type %s', (entrada, esperado) => {
    expect(base({ tipo: entrada }).where.afip_type).toBe(esperado);
  });

  it('«sin_cae» busca las que no tienen comprobante fiscal', () => {
    expect(base({ tipo: 'sin_cae' }).where.afip_type).toEqual({ [Op.is]: null });
  });

  it('un tipo que no existe se ignora en vez de devolver cero filas', () => {
    expect(base({ tipo: '99' }).where).not.toHaveProperty('afip_type');
    expect(base({ tipo: '' }).where).not.toHaveProperty('afip_type');
  });
});

describe('La busqueda', () => {
  it('sin q no agrega condiciones de busqueda', () => {
    expect(base({}).where[Op.or]).toBeUndefined();
    expect(base({ q: '   ' }).where[Op.or]).toBeUndefined();
  });

  it('un texto sin digitos busca por CAE, nombre libre y nombre de la ficha', () => {
    const condiciones = base({ q: 'vega' }).where[Op.or];

    expect(condiciones).toHaveLength(3);
    expect(condiciones[0]).toEqual({ afip_cae: { [Op.iLike]: '%vega%' } });
    expect(condiciones[1]).toEqual({ customer_name: { [Op.iLike]: '%vega%' } });
    expect(condiciones[2]).toEqual({ '$customer.name$': { [Op.iLike]: '%vega%' } });
  });

  it('con digitos suma la busqueda por numero de comprobante', () => {
    const condiciones = base({ q: '14882' }).where[Op.or];

    expect(condiciones).toHaveLength(4);
    expect(condiciones[3]).toEqual({ afip_nro: 14882 });
  });

  // Un comprobante se dicta y se copia entero. Lo que identifica es el segundo
  // grupo: la numeracion es correlativa por punto de venta.
  it('«0005-00014882» busca el numero 14882, no 500014882', () => {
    expect(numeroDeComprobante('0005-00014882')).toBe(14882);
    expect(base({ q: '0005-00014882' }).where[Op.or][3]).toEqual({ afip_nro: 14882 });
  });

  it('los ceros de la izquierda no cuentan', () => {
    expect(numeroDeComprobante('00014882')).toBe(14882);
  });

  // Pegar un CAE de 14 digitos en el buscador es lo normal. afip_nro es
  // INTEGER: sin este corte Postgres aborta la consulta con "value out of
  // range" y la busqueda devuelve 500 en vez de la fila que coincide por CAE.
  it('un CAE de 14 digitos NO se busca como numero de comprobante', () => {
    expect(numeroDeComprobante('75412339018264')).toBeNull();

    const condiciones = base({ q: '75412339018264' }).where[Op.or];
    expect(condiciones).toHaveLength(3);
    expect(condiciones[0]).toEqual({ afip_cae: { [Op.iLike]: '%75412339018264%' } });
  });

  it('un texto sin ningun digito no produce busqueda por numero', () => {
    expect(numeroDeComprobante('vega')).toBeNull();
    expect(numeroDeComprobante('')).toBeNull();
    expect(numeroDeComprobante(null)).toBeNull();
  });

  it('la busqueda se combina con el resto de los filtros, no los reemplaza', () => {
    const { where } = base({ q: 'vega', tipo: '6', punto_de_venta_id: '3', desde: '2026-07-01' });

    expect(where.afip_type).toBe(6);
    expect(where.punto_de_venta_id).toBe(3);
    expect(where.date).toEqual({ [Op.between]: ['2026-07-01', '2026-07-01'] });
    expect(where[Op.or]).toBeDefined();
  });
});

describe('El orden', () => {
  it('es fecha y hora descendente, lo mas nuevo arriba', () => {
    const { order } = base();

    expect(order[0]).toEqual(['date', 'DESC']);
    expect(order[1]).toEqual(['time', 'DESC']);
  });

  // Dos ventas de la misma sucursal en el mismo minuto tienen date y time
  // iguales. Sin un tercer criterio determinístico, Postgres puede devolverlas
  // en orden distinto entre dos consultas, y con paginacion eso es una fila
  // repetida en la pagina 2 y otra que no aparece nunca.
  it('lleva un tercer criterio determinístico para que la paginacion sea estable', () => {
    expect(base().order).toHaveLength(3);
    expect(base().order[2]).toEqual(['id', 'DESC']);
  });
});

describe('La paginacion', () => {
  it('25 filas por pagina por defecto, empezando en la 1', () => {
    const { limit, offset, page } = base();

    expect(limit).toBe(FILAS_POR_PAGINA);
    expect(limit).toBe(25);
    expect(offset).toBe(0);
    expect(page).toBe(1);
  });

  it('el offset sale de la pagina pedida', () => {
    expect(base({ page: '3' }).offset).toBe(50);
  });

  it('el limit se acota a 100: nadie baja el listado entero por esta puerta', () => {
    expect(base({ limit: '5000' }).limit).toBe(100);
  });

  it('una pagina o un limit absurdos no producen un offset negativo', () => {
    expect(base({ page: '0' }).offset).toBe(0);
    expect(base({ page: '-4' }).offset).toBe(0);
    expect(base({ limit: '0' }).limit).toBe(FILAS_POR_PAGINA);
    expect(base({ limit: 'muchas' }).limit).toBe(FILAS_POR_PAGINA);
  });
});

describe('El aislamiento entre empresas', () => {
  // Es la decision de diseño de esta funcion y su motivo: empresa_id lo pone
  // la ruta con scoped(where, req.empresaId). Que la funcion pura NO pueda
  // ponerlo es lo que hace imposible que se olvide en un camino de salida
  // temprano que alguien agregue despues.
  it('el filtro NO agrega empresa_id: lo pone la ruta', () => {
    const combinaciones = [
      {},
      { q: 'vega' },
      { punto_de_venta_id: 'todas' },
      { punto_de_venta_id: '3', tipo: 'sin_cae', desde: '2026-01-01', hasta: '2026-06-30' },
    ];

    for (const query of combinaciones) {
      expect(base(query).where).not.toHaveProperty('empresa_id');
    }
  });

  // Un punto de venta de otra empresa no filtra hacia afuera: el where lleva
  // las dos condiciones y devuelve cero filas.
  it('un punto_de_venta_id ajeno queda como condicion, para sumarse a empresa_id', () => {
    expect(base({ punto_de_venta_id: '99999' }).where.punto_de_venta_id).toBe(99999);
  });
});
