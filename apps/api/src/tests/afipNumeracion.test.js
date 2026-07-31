// ════════════════════════════════════════════
//  Serializacion de la numeracion de comprobantes
//
//  La numeracion de AFIP es correlativa por (punto de venta, tipo de
//  comprobante) y se obtiene con un read-then-write: se consulta cual fue el
//  ultimo autorizado con FECompUltimoAutorizado y se pide el siguiente.
//
//  Sin serializar, dos cajas que facturan a la vez leen el mismo "ultimo" y
//  piden el mismo numero: AFIP autoriza uno y rechaza el otro con un error que
//  el cajero no puede interpretar.
// ════════════════════════════════════════════

jest.mock('../models', () => ({
  Setting: { findOne: jest.fn(), findAll: jest.fn() },
  Empresa: { findByPk: jest.fn() },
}));

const afipService = require('../services/afipService');

/** Tarea que registra cuantas corren a la vez y en que orden terminan. */
function crearTareas() {
  const estado = { enVuelo: 0, maxSimultaneas: 0, orden: [] };

  const tarea = (n, demoraMs) => async () => {
    estado.enVuelo++;
    estado.maxSimultaneas = Math.max(estado.maxSimultaneas, estado.enVuelo);

    await new Promise((r) => setTimeout(r, demoraMs));

    estado.orden.push(n);
    estado.enVuelo--;
    return n;
  };

  return { estado, tarea };
}

describe('serializar', () => {
  it('no deja correr dos tareas a la vez sobre la misma clave', async () => {
    const { estado, tarea } = crearTareas();

    await Promise.all(
      [1, 2, 3, 4, 5].map((n) => afipService.serializar('7:5:6', tarea(n, 20 - n * 3)))
    );

    expect(estado.maxSimultaneas).toBe(1);
  });

  // Sin esto, la caja que entra segunda podria terminar primero y pedir un
  // numero anterior al de la que entro antes.
  it('respeta el orden de llegada aunque las tareas tarden distinto', async () => {
    const { estado, tarea } = crearTareas();

    await Promise.all(
      [1, 2, 3, 4, 5].map((n) => afipService.serializar('7:5:6', tarea(n, 20 - n * 3)))
    );

    expect(estado.orden).toEqual([1, 2, 3, 4, 5]);
  });

  // Puntos de venta o tipos de comprobante distintos tienen numeraciones
  // independientes: serializarlos entre si solo agregaria latencia.
  it('deja correr en paralelo las claves distintas', async () => {
    const { estado, tarea } = crearTareas();

    await Promise.all([
      afipService.serializar('7:5:6', tarea(1, 15)),
      afipService.serializar('7:6:6', tarea(2, 15)),
      afipService.serializar('7:5:1', tarea(3, 15)),
    ]);

    expect(estado.maxSimultaneas).toBeGreaterThan(1);
  });

  // Si una emision falla, la cola tiene que seguir funcionando para las
  // siguientes: un rechazo de AFIP no puede dejar la caja bloqueada.
  it('un fallo no bloquea las tareas siguientes de la misma clave', async () => {
    const fallo = afipService.serializar('7:5:6', async () => {
      throw new Error('AFIP rechazo el comprobante');
    });

    await expect(fallo).rejects.toThrow('AFIP rechazo el comprobante');

    await expect(
      afipService.serializar('7:5:6', async () => 'siguiente ok')
    ).resolves.toBe('siguiente ok');
  });

  it('propaga el valor de retorno de la tarea', async () => {
    await expect(
      afipService.serializar('7:5:6', async () => ({ cae: '123' }))
    ).resolves.toEqual({ cae: '123' });
  });
});
