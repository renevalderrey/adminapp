// El modelo se dobla: lo que este archivo verifica es **qué le pide** el
// resolvedor a la base y **qué devuelve**, no que Postgres conteste. Que la
// consulta encuentre la fila correcta con dos empresas sembradas se verifica en
// `tests/integracion/catalogoPublico.integracion.test.js`, que es el único lugar
// donde eso significa algo.
jest.mock('../models', () => ({
  Catalogo: { findOne: jest.fn() },
}));

const { Catalogo } = require('../models');
const { resolverCatalogoPorSlug, COLUMNAS } = require('../utils/tenantDeSlug');

// ════════════════════════════════════════════
//  El resolvedor de empresa sin sesión
//
//  Es la pieza que rompe el supuesto sobre el que está escrito todo el
//  aislamiento del sistema: hasta acá, `empresa_id` salía siempre de la
//  membresía del usuario. Por eso lo que más importa de estos casos no es que
//  resuelva bien, sino **lo que no puede hacer**.
// ════════════════════════════════════════════

beforeEach(() => {
  Catalogo.findOne.mockReset();
});

describe('lo que el resolvedor NO puede hacer', () => {
  it('no recibe `req`: no puede leer una cabecera aunque alguien quiera', () => {
    // Es una restricción del tipo de la función, no una promesa de un
    // comentario. Recibe el slug y las opciones de transacción, y nada más.
    expect(resolverCatalogoPorSlug.length).toBeLessThanOrEqual(2);
  });

  it('pide exactamente cuatro columnas, y son las cuatro que se usan', () => {
    // La primera proyección explícita del camino público. Si mañana `catalogos`
    // gana una columna con el teléfono del dueño, no puede salir de acá.
    expect(COLUMNAS).toEqual(['id', 'empresa_id', 'punto_de_venta_id', 'estado']);
  });
});

describe('la consulta', () => {
  it('busca el slug NORMALIZADO, con la misma función que el formulario', async () => {
    Catalogo.findOne.mockResolvedValue(null);

    // Alguien copiando de un cartel escribe con mayúsculas y espacios. Si acá se
    // buscara el texto crudo, daría 404 sobre un catálogo que existe.
    await resolverCatalogoPorSlug('  Comprafit-Fitnet  ');

    expect(Catalogo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: COLUMNAS,
        where: { slug: 'comprafit-fitnet' },
      })
    );
  });

  it('un slug vacío no llega a consultar la base', async () => {
    expect(await resolverCatalogoPorSlug('')).toBeNull();
    expect(await resolverCatalogoPorSlug(null)).toBeNull();
    expect(await resolverCatalogoPorSlug(undefined)).toBeNull();

    expect(Catalogo.findOne).not.toHaveBeenCalled();
  });

  it('un slug que se normaliza a nada tampoco', async () => {
    // `///` o `- - -` no son slugs: son basura que llegó por la URL.
    expect(await resolverCatalogoPorSlug('///')).toBeNull();
    expect(Catalogo.findOne).not.toHaveBeenCalled();
  });

  it('pasa la transacción cuando se la dan', async () => {
    Catalogo.findOne.mockResolvedValue(null);
    const transaction = { id: 'tx' };

    await resolverCatalogoPorSlug('x-y-z', { transaction });

    expect(Catalogo.findOne).toHaveBeenCalledWith(expect.objectContaining({ transaction }));
  });
});

describe('lo que devuelve', () => {
  it('devuelve null para un slug inexistente y NO tira', async () => {
    // Un slug inventado es el caso NORMAL de una superficie pública: alguien
    // escribe mal la dirección de un cartel. No es un error del sistema, así que
    // no puede salir por el camino de los 500.
    Catalogo.findOne.mockResolvedValue(null);

    await expect(resolverCatalogoPorSlug('no-existe')).resolves.toBeNull();
  });

  it('devuelve los cuatro datos con nombres propios, no la fila', async () => {
    Catalogo.findOne.mockResolvedValue({
      id: 12, empresa_id: 3, punto_de_venta_id: 8, estado: 'publicado',
    });

    const resuelto = await resolverCatalogoPorSlug('comprafit-fitnet');

    expect(resuelto).toEqual({
      empresaId: 3,
      catalogoId: 12,
      puntoDeVentaId: 8,
      estado: 'publicado',
    });
  });

  it('el estado viaja: es lo que decide si se dibuja la tienda o la pausa', async () => {
    Catalogo.findOne.mockResolvedValue({
      id: 1, empresa_id: 1, punto_de_venta_id: 1, estado: 'borrador',
    });

    expect((await resolverCatalogoPorSlug('x-y-z')).estado).toBe('borrador');
  });
});
