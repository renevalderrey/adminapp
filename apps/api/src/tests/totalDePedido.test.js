const { totalDePedido } = require('../utils/totalDePedido');

// ════════════════════════════════════════════
//  El total, y el borde del envío gratis
//
//  El envío gratis se prueba **en el borde** —un subtotal exactamente igual al
//  umbral— porque es el único caso que distingue `>=` de `>`, y los dos pasan
//  todos los demás.
// ════════════════════════════════════════════

const CON_ENVIO = { envio: true, envio_costo: '2500.00', envio_gratis_desde: '50000.00' };

const linea = (precio, cantidad) => ({ precio_unitario: precio, cantidad });

describe('totalDePedido', () => {
  it('suma las líneas por su cantidad', () => {
    const r = totalDePedido([linea('38868.00', 1), linea('21900.00', 2)], {}, 'retiro_local');

    expect(r.subtotal).toBe(82668);
    expect(r.total).toBe(82668);
  });

  it('con el subtotal exactamente igual al umbral el envío es gratis', () => {
    // «Envío gratis desde $50.000» incluye los $50.000. Es lo que dice el
    // cartel, y el que compró exactamente eso lo va a reclamar.
    const r = totalDePedido([linea('50000.00', 1)], CON_ENVIO, 'envio');

    expect(r.envio_gratis).toBe(true);
    expect(r.envio_costo).toBe(0);
    expect(r.total).toBe(50000);
  });

  it('un centavo abajo del umbral paga el envío', () => {
    const r = totalDePedido([linea('49999.99', 1)], CON_ENVIO, 'envio');

    expect(r.envio_gratis).toBe(false);
    expect(r.envio_costo).toBe(2500);
    expect(r.total).toBe(52499.99);
  });

  it('umbral en cero no regala el envío', () => {
    // Con `subtotal >= 0` todo pedido tendría el envío gratis, y el comercio no
    // cobraría un envío que sí hace.
    for (const umbral of [0, '0.00', null, undefined, '']) {
      const r = totalDePedido([linea('1000.00', 1)], { ...CON_ENVIO, envio_gratis_desde: umbral }, 'envio');

      expect(r.envio_gratis).toBe(false);
      expect(r.envio_costo).toBe(2500);
    }
  });

  it('no cobra envío cuando el comprador retira o coordina', () => {
    // Un cargo de envío en un pedido que se retira es plata que el cliente
    // reclama y nadie sabe explicar.
    for (const entrega of ['retiro_socio', 'retiro_local', 'coordinar']) {
      const r = totalDePedido([linea('1000.00', 1)], CON_ENVIO, entrega);

      expect(r.envio_costo).toBe(0);
      expect(r.total).toBe(1000);
    }
  });

  it('no cobra envío si el catálogo lo tiene apagado, aunque lo pidan', () => {
    const r = totalDePedido([linea('1000.00', 1)], { ...CON_ENVIO, envio: false }, 'envio');

    expect(r.envio_costo).toBe(0);
  });

  it('un pedido vacío da cero y no NaN', () => {
    const r = totalDePedido([], CON_ENVIO, 'retiro_local');

    expect(r).toEqual({ subtotal: 0, envio_costo: 0, total: 0, envio_gratis: false });
  });

  it('redondea a dos decimales, que es lo que entra en la columna', () => {
    const r = totalDePedido([linea('333.33', 3)], {}, 'retiro_local');

    expect(r.total).toBe(999.99);
  });
});
