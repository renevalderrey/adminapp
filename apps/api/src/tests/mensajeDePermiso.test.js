// ════════════════════════════════════════════
//  Lo que el usuario lee cuando le falta un permiso
//
//  Un rol de compras arma el pedido entero, aprieta guardar, y lee lo que este
//  archivo protege. **Es lo único de la aplicación que hace que el usuario no
//  pueda seguir**: no es un aviso al pasar, es el final del camino.
//
//  Tenía dos problemas y los dos importan:
//
//   · «No **tienes** permiso» era la única forma verbal en segunda persona de
//     toda la aplicación que no es rioplatense. En una pantalla donde todo lo
//     demás dice «Cargá», «Pegá» y «Revisá», la frase que aparece cuando algo
//     sale mal era la única que sonaba de otro producto.
//
//   · El código del permiso iba entre paréntesis al final, como un detalle
//     técnico. Es lo contrario: **es lo único accionable de la frase.** El
//     usuario no puede pedir lo que no puede nombrar.
// ════════════════════════════════════════════

const checkPermission = require('../middleware/checkPermission');

const { mensajeDeFalta } = checkPermission;

describe('El mensaje del permiso que falta', () => {
  it('NOMBRA el permiso, que es lo único accionable de la frase', () => {
    const texto = mensajeDeFalta('ordenes_compra.crear');

    expect(texto).toContain('ordenes_compra.crear');
  });

  it('tutea rioplatense, como el resto de la aplicación', () => {
    const texto = mensajeDeFalta('products.editar');

    // El defecto exacto: «No tienes permiso». Se afirma la ausencia de la forma
    // peninsular y no solo la presencia de la rioplatense, porque un mensaje que
    // dijera las dos cosas pasaría un `toContain` y seguiría sonando raro.
    expect(texto).not.toMatch(/\btienes\b/);
    expect(texto).toMatch(/\bfalta\b|\btenés\b/);
  });

  it('dice qué hacer, no solo que no se puede', () => {
    // Un mensaje que solo constata deja al usuario sin siguiente paso. La
    // diferencia entre «no podés» y «pedíselo a quien administra» es si la
    // persona resuelve su problema o llama por teléfono.
    const texto = mensajeDeFalta('stock.transferir');

    expect(texto.length).toBeGreaterThan(40);
    expect(texto).toMatch(/ped/i);
  });

  it('sirve para cualquier permiso, sin una lista que mantener', () => {
    // Si esto fuera un mapa de código a frase, el permiso nuevo de la próxima
    // funcionalidad saldría con la frase por defecto y nadie se enteraría.
    for (const codigo of ['ventas.crear', 'config.editar', 'equipo.editar']) {
      expect(mensajeDeFalta(codigo)).toContain(codigo);
    }
  });
});
