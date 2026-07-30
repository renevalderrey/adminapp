// ════════════════════════════════════════════
//  Tests de los helpers de scoping por empresa
//
//  Estos helpers son la defensa contra el error que aparecio repetido en toda
//  la auditoria: consultar por id sin filtrar por empresa_id. Si dejan de
//  funcionar, las fugas entre empresas cliente vuelven en silencio.
// ════════════════════════════════════════════

const {
  findScoped,
  findScopedOrFail,
  scoped,
  assertEmpresaId,
} = require('../utils/tenantScope');

/** Modelo falso que registra con que argumentos lo llamaron. */
function modeloFalso(devuelve = null) {
  return {
    llamadas: [],
    async findOne(opciones) {
      this.llamadas.push(opciones);
      return devuelve;
    },
  };
}

describe('assertEmpresaId', () => {
  it('acepta un entero positivo', () => {
    expect(() => assertEmpresaId(1)).not.toThrow();
    expect(() => assertEmpresaId(42)).not.toThrow();
  });

  // El patron viejo era `req.empresaId || 1`: ante un contexto no resuelto se
  // operaba sobre la empresa 1, un cliente real. Preferimos romper el request.
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['cero', 0],
    ['negativo', -1],
    ['string', '1'],
    ['NaN', NaN],
  ])('rechaza %s', (_nombre, valor) => {
    expect(() => assertEmpresaId(valor)).toThrow(/Scoping por empresa invalido/);
  });

  it('el error lleva status 500, porque es un bug de programacion y no del cliente', () => {
    try {
      assertEmpresaId(undefined);
      throw new Error('deberia haber lanzado');
    } catch (err) {
      expect(err.status).toBe(500);
    }
  });
});

describe('scoped', () => {
  it('agrega empresa_id al where', () => {
    expect(scoped({ is_active: true }, 7)).toEqual({ is_active: true, empresa_id: 7 });
  });

  it('funciona con un where vacio', () => {
    expect(scoped({}, 7)).toEqual({ empresa_id: 7 });
    expect(scoped(undefined, 7)).toEqual({ empresa_id: 7 });
  });

  // Sin esto, pasar empresa_id en el body de un request permitiria elegir sobre
  // que empresa se consulta.
  it('el empresa_id del scope pisa el que venga en el where', () => {
    expect(scoped({ empresa_id: 999 }, 7)).toEqual({ empresa_id: 7 });
  });

  it('falla si el empresaId no sirve', () => {
    expect(() => scoped({}, undefined)).toThrow(/Scoping por empresa invalido/);
  });
});

describe('findScoped', () => {
  it('consulta filtrando por id y empresa_id', async () => {
    const Model = modeloFalso({ id: 5 });
    await findScoped(Model, 5, 7);

    expect(Model.llamadas[0].where).toEqual({ id: 5, empresa_id: 7 });
  });

  it('acepta el id como string, que es como llega en req.params', async () => {
    const Model = modeloFalso({ id: 5 });
    await findScoped(Model, '5', 7);

    expect(Model.llamadas[0].where).toEqual({ id: 5, empresa_id: 7 });
  });

  it('preserva las opciones extra de Sequelize', async () => {
    const Model = modeloFalso({ id: 5 });
    const include = [{ model: 'Brand' }];
    await findScoped(Model, 5, 7, { include, transaction: 'tx' });

    expect(Model.llamadas[0].include).toBe(include);
    expect(Model.llamadas[0].transaction).toBe('tx');
  });

  // Un id no numerico no debe llegar a la base: Sequelize lo rechazaria con un
  // error de tipo que se filtraria al cliente como un 500.
  it.each([['texto', 'abc'], ['vacio', ''], ['undefined', undefined]])(
    'devuelve null sin consultar si el id es %s',
    async (_nombre, id) => {
      const Model = modeloFalso({ id: 1 });
      const resultado = await findScoped(Model, id, 7);

      expect(resultado).toBeNull();
      expect(Model.llamadas).toHaveLength(0);
    }
  );

  it('falla si falta el empresaId, en vez de consultar sin filtro', async () => {
    const Model = modeloFalso({ id: 5 });
    await expect(findScoped(Model, 5, undefined)).rejects.toThrow(/Scoping por empresa invalido/);
    expect(Model.llamadas).toHaveLength(0);
  });
});

describe('findScopedOrFail', () => {
  it('devuelve el registro cuando existe', async () => {
    const registro = { id: 5 };
    const Model = modeloFalso(registro);

    await expect(findScopedOrFail(Model, 5, 7)).resolves.toBe(registro);
  });

  // 404 y no 403: un 403 confirmaria que el id existe en otra empresa, lo que
  // permitiria mapear la base ajena enumerando ids.
  it('lanza 404 cuando el recurso es de otra empresa', async () => {
    const Model = modeloFalso(null);

    await expect(findScopedOrFail(Model, 5, 7)).rejects.toMatchObject({ status: 404 });
  });
});
