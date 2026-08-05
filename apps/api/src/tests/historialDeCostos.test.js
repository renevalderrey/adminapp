// ════════════════════════════════════════════
//  La unica funcion que escribe en product_cost_history
//
//  Lo que estos tests protegen:
//
//   - Que un cambio por debajo del centavo NO deje fila. Los costos son
//     DECIMAL(12,2): registrar que un costo paso de 1200.00 a 1200.00 llena el
//     historial de ruido y tapa los cambios que si importan.
//   - Que toda fila escrita lleve `empresa_id` y el autor. Sin empresa,
//     cualquier consulta global del historial es una consulta sin scoping.
//   - Que los cuatro textos que YA estan guardados en la base no cambiaron,
//     incluidas sus faltas de acento. Reescribirlos haria que dos filas del
//     mismo origen se lean distinto segun cuando se grabaron, y quien abre el
//     panel no tiene forma de saber que son lo mismo.
//   - Que el motivo sea tipado. Con textos libres, "cuantos costos cambiaron
//     por importacion" no se puede contestar.
// ════════════════════════════════════════════

const { crearModelo } = require('./helpers/modelosFalsos');

const mockHistorial = crearModelo([]);

jest.mock('../models', () => ({ ProductCostHistory: mockHistorial }));

const {
  UMBRAL_DE_CAMBIO,
  MOTIVOS,
  motivoActualizacionMasiva,
  motivoDeshacerMasiva,
  esCambioSignificativo,
  registrarCambioDeCosto,
} = require('../utils/historialDeCostos');

const PRODUCTO = { id: 88, empresa_id: 7, name: 'Colágeno 300g' };

beforeEach(() => {
  mockHistorial.filas.length = 0;
  mockHistorial.llamadas.length = 0;
});

describe('el umbral: que cuenta como cambio de costo', () => {
  it('NO escribe nada cuando el costo pasa de 1200.00 a 1200.004', async () => {
    const fila = await registrarCambioDeCosto({
      producto: PRODUCTO,
      costoAnterior: 1200.00,
      costoNuevo: 1200.004,
      motivo: MOTIVOS.EDICION_MANUAL,
    });

    expect(fila).toBeNull();
    expect(mockHistorial.filas).toHaveLength(0);
  });

  it('SI escribe cuando pasa de 1200.00 a 1200.01', async () => {
    const fila = await registrarCambioDeCosto({
      producto: PRODUCTO,
      costoAnterior: 1200.00,
      costoNuevo: 1200.01,
      motivo: MOTIVOS.EDICION_MANUAL,
    });

    expect(fila).not.toBeNull();
    expect(mockHistorial.filas).toHaveLength(1);
  });

  it('el umbral es exactamente 0.01, el mismo que ya usaba products.js', () => {
    expect(UMBRAL_DE_CAMBIO).toBe(0.01);
    expect(esCambioSignificativo(1200, 1200.01)).toBe(true);
    expect(esCambioSignificativo(1200, 1200.004)).toBe(false);
  });

  it('un centavo de diferencia cuenta SIEMPRE, no según la magnitud del costo', () => {
    // `Math.abs(1200 - 1200.01)` en punto flotante da 0.009999999999999787:
    // con la resta directa que estaba escrita en los cinco lugares, subir un
    // costo de $1.200,00 a $1.200,01 NO quedaba registrado, mientras que de
    // $10,00 a $10,01 sí. El historial se salteaba filas para unos productos y
    // no para otros, sin ningún patrón visible.
    for (const base of [10, 1200, 99999.99, 0.99, 123456.78]) {
      expect(esCambioSignificativo(base, base + 0.01)).toBe(true);
    }
  });

  it('lee los DECIMAL que Postgres devuelve como texto', () => {
    // `old_cost` y `new_cost` son DECIMAL(12,2) y el driver los devuelve como
    // string. Restar dos strings da NaN, y `NaN >= 0.01` es false: el cambio
    // no se registraria NUNCA y nada avisaria.
    expect(esCambioSignificativo('1200.00', '1380.00')).toBe(true);
  });

  it('una baja de costo tambien se registra', () => {
    // Es `Math.abs`: una lista nueva mas barata mueve el margen igual que una
    // mas cara.
    expect(esCambioSignificativo(1380, 1200)).toBe(true);
  });

  it('un producto que no tenia costo cargado cuenta como cambio', () => {
    expect(esCambioSignificativo(null, 1200)).toBe(true);
  });
});

describe('la fila escrita lleva empresa y autor', () => {
  it('guarda empresa_id, usuario_id, producto, costos y motivo', async () => {
    await registrarCambioDeCosto({
      producto: PRODUCTO,
      costoAnterior: 1200,
      costoNuevo: 1380,
      motivo: MOTIVOS.IMPORTACION,
      usuarioId: 4,
    });

    expect(mockHistorial.filas[0]).toMatchObject({
      product_id: 88,
      empresa_id: 7,
      usuario_id: 4,
      old_cost: 1200,
      new_cost: 1380,
      reason: 'Importación de lista de precios',
    });
  });

  it('el empresa_id sale del producto y no de un parametro suelto', async () => {
    // Pedirlo aparte es pedir que alguien lo pase mal: la fila quedaria
    // atribuida a otra empresa y el historial de un cliente aparecería en el
    // panel de otro.
    await registrarCambioDeCosto({
      producto: { id: 5, empresa_id: 99 },
      costoAnterior: 10,
      costoNuevo: 20,
      motivo: MOTIVOS.CARGA_MASIVA,
    });

    expect(mockHistorial.filas[0].empresa_id).toBe(99);
  });

  it('sin autor la fila igual se escribe, con usuario_id en null', async () => {
    // El recosteo en cascada y la recepcion de una orden no siempre tienen
    // usuario. Perder la fila entera por eso seria peor que perder la firma.
    await registrarCambioDeCosto({
      producto: PRODUCTO,
      costoAnterior: 10,
      costoNuevo: 20,
      motivo: MOTIVOS.RECOSTEO_DE_RECETA,
    });

    expect(mockHistorial.filas[0].usuario_id).toBeNull();
  });

  it('un producto SIN empresa_id no escribe nada: rompe ruidosamente', async () => {
    // Una fila de historial sin empresa solo se puede volver a leer con una
    // consulta sin scoping. Es preferible romper el request.
    await expect(registrarCambioDeCosto({
      producto: { id: 5 },
      costoAnterior: 10,
      costoNuevo: 20,
      motivo: MOTIVOS.EDICION_MANUAL,
    })).rejects.toThrow(/Scoping por empresa/);

    expect(mockHistorial.filas).toHaveLength(0);
  });

  it('sin motivo no escribe: una fila que no se puede atribuir no sirve', async () => {
    await expect(registrarCambioDeCosto({
      producto: PRODUCTO,
      costoAnterior: 10,
      costoNuevo: 20,
    })).rejects.toThrow(/motivo/i);

    expect(mockHistorial.filas).toHaveLength(0);
  });

  it('la transaccion de quien llama viaja hasta el create', async () => {
    // Sin esto, la fila de historial se escribiria por otra conexion y
    // sobreviviria al rollback del cambio de costo que dice haber registrado.
    const t = { id: 'transaccion-falsa' };

    await registrarCambioDeCosto({
      producto: PRODUCTO,
      costoAnterior: 10,
      costoNuevo: 20,
      motivo: MOTIVOS.EDICION_MANUAL,
      transaction: t,
    });

    expect(mockHistorial.llamadas.at(-1).transaction).toBe(t);
  });
});

describe('los motivos son tipados y los cuatro viejos no cambiaron', () => {
  it.each([
    ['EDICION_MANUAL', 'Edición manual de costo base'],
    ['ORDEN_DE_PRODUCCION', 'Actualización por orden de producción'],
  ])('%s sigue siendo el texto que ya está guardado', (clave, texto) => {
    expect(MOTIVOS[clave]).toBe(texto);
  });

  it('«Actualizacion masiva» conserva su falta de acento', () => {
    // El texto guardado dice `Actualizacion`, no `Actualización`. El contrato
    // lo escribe con acento, pero lo que manda es lo que la base tiene: si se
    // corrige, las filas viejas y las nuevas dejan de ser el mismo origen.
    expect(motivoActualizacionMasiva({ descripcion: 'Lista Mayo' }))
      .toBe('Actualizacion masiva: Lista Mayo');

    expect(motivoActualizacionMasiva({ porcentaje: 15 }))
      .toBe('Actualizacion masiva de costos (+15%)');

    expect(motivoActualizacionMasiva({ porcentaje: -10 }))
      .toBe('Actualizacion masiva de costos (-10%)');
  });

  it('«Deshacer actualizacion masiva #N» conserva su falta de acento', () => {
    expect(motivoDeshacerMasiva(41)).toBe('Deshacer actualizacion masiva #41');
  });

  it('los dos motivos nuevos existen con el texto del contrato', () => {
    expect(MOTIVOS.IMPORTACION).toBe('Importación de lista de precios');
    expect(MOTIVOS.CARGA_MASIVA).toBe('Carga masiva de productos');
  });

  it('el motivo de la recepción de compra existe en MOTIVOS y no es una cadena escrita a mano', () => {
    // La recepción de una orden de compra es el sexto camino que cambia un
    // costo. Sin la constante, el motivo entra como texto libre y el día que
    // alguien quiera contar «cuántos costos cambiaron por compras» le alcanza
    // una falta de acento para que la mitad de las filas desaparezca del conteo.
    expect(MOTIVOS.RECEPCION_DE_COMPRA).toBe('Actualización por recepción de compra');
  });

  it('estan los ocho origenes, ni uno menos', () => {
    // Si mañana aparece un camino nuevo que cambia costos y escribe un texto
    // suelto, la pregunta «cuántos costos cambiaron por importación» empieza a
    // dar un número que no es.
    expect(Object.keys(MOTIVOS).sort()).toEqual([
      'ACTUALIZACION_MASIVA',
      'CARGA_MASIVA',
      'DESHACER_MASIVA',
      'EDICION_MANUAL',
      'IMPORTACION',
      'ORDEN_DE_PRODUCCION',
      'RECEPCION_DE_COMPRA',
      'RECOSTEO_DE_RECETA',
    ]);
  });

  it('los ocho son distinguibles entre si', () => {
    const textos = Object.values(MOTIVOS);

    expect(new Set(textos).size).toBe(textos.length);
  });
});
