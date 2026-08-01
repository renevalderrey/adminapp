// ════════════════════════════════════════════
//  El plan de consolidacion: que filas se fusionan y con que valores
//
//  Esta es la funcion de la que dependen el informe y la migracion. Si esta
//  mal, el informe dice que esta todo bien y la migracion rompe el inventario
//  de un cliente. Por eso cada regla del paso 4 de data-model.md tiene su
//  test, uno por uno, y cada uno falla si se revierte la regla que prueba.
//
//  Los dos casos que hay que tener siempre presentes al leer esto:
//
//   - **Dos pilas.** 40 unidades en el deposito y 12 en el mostrador, anotadas
//     con `location` distinto porque no habia sucursales de verdad. Sumar es
//     correcto.
//   - **Una pila anotada dos veces.** El operador cargo 100 por la pantalla y
//     despues importo la lista del proveedor con las mismas 100. Sumar da 200
//     sobre una estanteria que tiene 100.
//
//  No hay forma de distinguirlas con certeza —en la fila de stock no queda
//  quien la escribio—, asi que se suma y se **marca**. Lo que estos tests
//  protegen es que la marca aparezca cuando hay senal y no aparezca cuando no
//  la hay: una marca que aparece siempre no se mira, y una que no aparece
//  nunca no sirve.
// ════════════════════════════════════════════

const { planificar } = require('../utils/consolidacionDeStock');

const PUNTOS_DE_VENTA = [
  { id: 3, empresa_id: 7, name: 'Sucursal Principal', code: 'principal', is_active: true },
  { id: 5, empresa_id: 7, name: 'Depósito', code: 'deposito', is_active: true },
];

/** Una fila de stock con todo neutro: ninguna senal se dispara por accidente. */
function fila(extra = {}) {
  return {
    id: 1,
    empresa_id: 7,
    product_id: 100,
    punto_de_venta_id: null,
    location: 'sin-codigo',
    quantity: 0,
    available: 0,
    min_stock: 0,
    current_batch: null,
    expiration_date: null,
    purchase_date: null,
    updated_at: null,
    ...extra,
  };
}

/**
 * Dos filas que son claramente dos pilas distintas: cantidades distintas,
 * lotes distintos y no nulos, sin `updated_at` que las acerque. Es la base
 * sobre la que se agrega **una** senal por vez.
 */
function dosPilas(a = {}, b = {}) {
  return [
    fila({ id: 1, punto_de_venta_id: 3, quantity: 40, available: 40, current_batch: 'L-A', ...a }),
    fila({ id: 2, punto_de_venta_id: 3, quantity: 12, available: 12, current_batch: 'L-B', ...b }),
  ];
}

function planDe(filas, puntosDeVenta = PUNTOS_DE_VENTA) {
  return planificar({ filas, puntosDeVenta });
}

/** La unica fusion del plan, para no repetir `fusiones[0]` en cada test. */
function unicaFusion(filas, puntosDeVenta = PUNTOS_DE_VENTA) {
  const { fusiones } = planDe(filas, puntosDeVenta);
  expect(fusiones).toHaveLength(1);
  return fusiones[0];
}

// ════════════════════════════════════════════
//  A dónde va cada fila (pasos 1 a 3)
// ════════════════════════════════════════════

describe('a que sucursal va cada fila', () => {
  it('la que ya tiene sucursal se queda donde esta', () => {
    const { asignaciones } = planDe([fila({ id: 1, punto_de_venta_id: 5, location: 'viejo' })]);

    expect(asignaciones[0]).toMatchObject({
      motivo: 'ya_tenia',
      punto_de_venta_id_anterior: 5,
      punto_de_venta_id_nuevo: 5,
      location_anterior: 'viejo',
      location_nueva: 'deposito',
    });
  });

  it('sin sucursal, mapea por coincidencia exacta entre location y code', () => {
    const { asignaciones } = planDe([fila({ id: 1, location: 'deposito' })]);

    expect(asignaciones[0]).toMatchObject({ motivo: 'code', punto_de_venta_id_nuevo: 5 });
  });

  it('la coincidencia es sensible a mayusculas: "Deposito" NO mapea a "deposito"', () => {
    // Es la misma comparacion que hacen seedPuntosDeVenta.js y stock.js.
    // Aflojarla aca haria que la migracion mapee distinto de como mapean las
    // rutas, que es peor que mapear poco.
    const { asignaciones } = planDe([fila({ id: 1, location: 'Deposito' })]);

    expect(asignaciones[0]).toMatchObject({ motivo: 'por_defecto', punto_de_venta_id_nuevo: 3 });
  });

  it('lo que no coincide cae al por defecto de la empresa', () => {
    const { asignaciones } = planDe([fila({ id: 1, location: 'mostrador' })]);

    expect(asignaciones[0]).toMatchObject({
      motivo: 'por_defecto',
      punto_de_venta_id_nuevo: 3,
      location_anterior: 'mostrador',
      location_nueva: 'principal',
    });
  });

  it('una sucursal con code nulo no se come las filas: el espejo cae al name', () => {
    const soloConNombre = [{ id: 9, empresa_id: 7, name: 'Local Único', code: null, is_active: true }];
    const { asignaciones } = planDe([fila({ id: 1, location: 'lo que sea' })], soloConNombre);

    expect(asignaciones[0]).toMatchObject({
      punto_de_venta_id_nuevo: 9,
      location_nueva: 'Local Único',
    });
  });

  it('el espejo se recorta a 30 caracteres, que es el largo de la columna', () => {
    const largo = [{ id: 9, empresa_id: 7, name: 'Depósito Central de Mercadería Zona Norte', code: null, is_active: true }];
    const { asignaciones } = planDe([fila({ id: 1 })], largo);

    expect(asignaciones[0].location_nueva).toHaveLength(30);
  });
});

describe('la empresa que tiene stock y ninguna sucursal', () => {
  it('avisa que hay que crearle la principal antes de migrar', () => {
    const { avisos } = planDe([fila({ id: 1, empresa_id: 12 })], []);

    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({
      tipo: 'pv_a_crear',
      empresa_id: 12,
      sucursal: { name: 'Sucursal Principal', code: 'principal' },
    });
  });

  it('sus filas quedan marcadas como destino a crear, sin id todavia', () => {
    const { asignaciones } = planDe([fila({ id: 1, empresa_id: 12 })], []);

    expect(asignaciones[0]).toMatchObject({
      motivo: 'pv_a_crear',
      punto_de_venta_id_nuevo: null,
      destino_a_crear: true,
      location_nueva: 'principal',
    });
  });

  it('y sus duplicados se detectan igual, aunque la sucursal todavia no exista', () => {
    // Si no se agruparan, la migracion crearia la sucursal, mandaria las dos
    // filas ahi y recien el indice unico descubriria el problema — adentro de
    // la transaccion, con un error de Postgres que no dice que revisar.
    const fusion = unicaFusion([
      fila({ id: 1, empresa_id: 12, quantity: 40, current_batch: 'L-A' }),
      fila({ id: 2, empresa_id: 12, quantity: 12, current_batch: 'L-B' }),
    ], []);

    expect(fusion.destino).toMatchObject({ id: null, a_crear: true });
    expect(fusion.resultado.quantity).toBe(52);
  });
});

describe('una fila que apunta a la sucursal de otra empresa', () => {
  it('se avisa en vez de moverla en silencio', () => {
    // La FK garantiza que el punto de venta existe, pero no que sea de esta
    // empresa. Es una fuga anterior y hay que verla ANTES de migrar.
    const { avisos, asignaciones } = planDe([fila({ id: 1, empresa_id: 7, punto_de_venta_id: 77 })],
      [...PUNTOS_DE_VENTA, { id: 77, empresa_id: 99, name: 'Ajena', code: 'ajena', is_active: true }]);

    expect(avisos[0]).toMatchObject({ tipo: 'sucursal_de_otra_empresa', stock_id: 1 });
    expect(asignaciones[0].punto_de_venta_id_nuevo).toBe(77);
  });
});

// ════════════════════════════════════════════
//  Los seis campos del paso 4
// ════════════════════════════════════════════

describe('los seis campos de la fila fusionada', () => {
  it('quantity: la suma', () => {
    expect(unicaFusion(dosPilas()).resultado.quantity).toBe(52);
  });

  it('available: la suma', () => {
    const fusion = unicaFusion(dosPilas({ available: 30 }, { available: 5 }));

    expect(fusion.resultado.available).toBe(35);
  });

  it('min_stock: el maximo, que es el criterio conservador', () => {
    // Avisa antes de mas, no de menos. Con el minimo la unica forma de
    // equivocarse barato es pedir de mas.
    const fusion = unicaFusion(dosPilas({ min_stock: 3 }, { min_stock: 10 }));

    expect(fusion.resultado.min_stock).toBe(10);
  });

  it('expiration_date: el MAS PROXIMO, no el de la fila con mas cantidad', () => {
    // La spec pedia el de la fila mayor. Si la fila de 40 vence en diciembre y
    // la de 12 vence el mes que viene, quedarse con diciembre saca esas 12
    // unidades de la alerta de vencimientos de los proximos 30 dias
    // (general.js:360-366): mercaderia que se vence sin que nadie la vea.
    const fusion = unicaFusion(dosPilas(
      { expiration_date: '2026-12-31' },
      { expiration_date: '2026-09-15' }
    ));

    expect(fusion.resultado.expiration_date).toBe('2026-09-15');
  });

  it('expiration_date: ignora los nulos en vez de tomarlos como "sin vencimiento"', () => {
    const fusion = unicaFusion(dosPilas(
      { expiration_date: null },
      { expiration_date: '2026-09-15' }
    ));

    expect(fusion.resultado.expiration_date).toBe('2026-09-15');
  });

  it('purchase_date: la mas antigua de las no nulas', () => {
    const fusion = unicaFusion(dosPilas(
      { purchase_date: '2026-05-10' },
      { purchase_date: '2026-02-01' }
    ));

    expect(fusion.resultado.purchase_date).toBe('2026-02-01');
  });

  it('current_batch: el de la fila con mas cantidad', () => {
    // Un lote es una identidad, no una magnitud: no hay forma de fusionar dos.
    const fusion = unicaFusion(dosPilas({ quantity: 40, current_batch: 'L-GANA' },
      { quantity: 12, current_batch: 'L-PIERDE' }));

    expect(fusion.resultado.current_batch).toBe('L-GANA');
  });

  it('los lotes descartados quedan escritos, no se pierden en silencio', () => {
    // Un lote que desaparece sin dejar rastro es lo que rompe un retiro de
    // producto: no hay con que saber que mercaderia hay que sacar de la gondola.
    const fusion = unicaFusion(dosPilas({ current_batch: 'L-GANA' }, { current_batch: 'L-PIERDE' }));

    expect(fusion.lotes_descartados).toEqual(['L-PIERDE']);
    expect(fusion.nota).toContain('Lotes descartados: L-PIERDE');
  });
});

// ════════════════════════════════════════════
//  Cuál sobrevive, y que dos corridas digan lo mismo
// ════════════════════════════════════════════

describe('cual fila sobrevive', () => {
  it('la de mayor cantidad', () => {
    expect(unicaFusion(dosPilas({ id: 1, quantity: 12 }, { id: 2, quantity: 40 })).sobreviviente_id)
      .toBe(2);
  });

  it('a igualdad de cantidad, la de menor id', () => {
    const fusion = unicaFusion([
      fila({ id: 9, punto_de_venta_id: 3, quantity: 20, current_batch: 'L-A' }),
      fila({ id: 4, punto_de_venta_id: 3, quantity: 20, current_batch: 'L-B' }),
    ]);

    expect(fusion.sobreviviente_id).toBe(4);
  });

  it('el orden en que vienen las filas no cambia el resultado', () => {
    // El informe y la migracion son dos corridas distintas y Postgres no
    // garantiza el orden sin ORDER BY. Si el resultado dependiera del orden,
    // el informe que se aprobo no seria el que se aplica.
    const filas = dosPilas({ id: 1, quantity: 20 }, { id: 2, quantity: 20 });

    const primera = planDe(filas).fusiones[0];
    const segunda = planDe([...filas].reverse()).fusiones[0];

    expect(segunda.sobreviviente_id).toBe(primera.sobreviviente_id);
    expect(segunda.resultado).toEqual(primera.resultado);
  });
});

// ════════════════════════════════════════════
//  Las cinco señales de «revisar», una por una
// ════════════════════════════════════════════

describe('la marca «revisar»', () => {
  it('NO se marca cuando las dos filas tienen lotes distintos y no nulos', () => {
    // Dos lotes son dos entradas de mercaderia distintas: es la unica
    // evidencia fuerte de que son dos pilas y no una anotada dos veces. Si
    // esto se marcara, se marcaria todo y la lista no se miraria.
    const fusion = unicaFusion(dosPilas());

    expect(fusion.revisar).toBe(false);
    expect(fusion.senales).toEqual([]);
  });

  it('1) las dos tienen la MISMA cantidad y es mayor que cero', () => {
    // Dos caminos que escribieron el mismo numero absoluto sobre la misma
    // estanteria. Es la forma tipica de "una pila anotada dos veces".
    const fusion = unicaFusion(dosPilas({ quantity: 100 }, { quantity: 100 }));

    expect(fusion.revisar).toBe(true);
    expect(fusion.senales).toContain('dos filas tienen exactamente la misma cantidad');
  });

  it('dos filas en cero NO cuentan como la misma cantidad', () => {
    // Dos filas vacias son dos filas vacias; sumar cero no infla nada.
    const fusion = unicaFusion(dosPilas({ quantity: 0, available: 0 }, { quantity: 0, available: 0 }));

    expect(fusion.senales).not.toContain('dos filas tienen exactamente la misma cantidad');
  });

  it('2a) las dos tienen el lote en NULO', () => {
    // Sin lote no hay ninguna evidencia de que sean pilas distintas.
    const fusion = unicaFusion(dosPilas({ current_batch: null }, { current_batch: null }));

    expect(fusion.revisar).toBe(true);
    expect(fusion.senales).toContain('no hay dos lotes distintos que las separen');
  });

  it('2b) las dos tienen el MISMO lote', () => {
    const fusion = unicaFusion(dosPilas({ current_batch: 'L-1' }, { current_batch: 'L-1' }));

    expect(fusion.revisar).toBe(true);
  });

  it('2c) una tiene lote y la otra no: tampoco hay evidencia', () => {
    const fusion = unicaFusion(dosPilas({ current_batch: 'L-1' }, { current_batch: null }));

    expect(fusion.revisar).toBe(true);
  });

  it('3) las dos se escribieron con menos de 24 horas de diferencia', () => {
    const fusion = unicaFusion(dosPilas(
      { updated_at: '2026-07-30T09:00:00.000Z' },
      { updated_at: '2026-07-30T18:30:00.000Z' }
    ));

    expect(fusion.revisar).toBe(true);
    expect(fusion.senales).toContain('se escribieron con menos de 24 horas de diferencia');
  });

  it('con mas de 24 horas de diferencia NO se marca por eso', () => {
    const fusion = unicaFusion(dosPilas(
      { updated_at: '2026-07-01T09:00:00.000Z' },
      { updated_at: '2026-07-30T09:00:00.000Z' }
    ));

    expect(fusion.revisar).toBe(false);
  });

  it('4) alguna fila tiene cantidad NEGATIVA', () => {
    // Sumar un negativo tapa una sobreventa: la fila resultante queda en un
    // numero razonable y el faltante desaparece de la vista.
    const fusion = unicaFusion(dosPilas({ quantity: -5, available: -5 }));

    expect(fusion.revisar).toBe(true);
    expect(fusion.senales).toContain('alguna fila tiene cantidad negativa');
  });

  it('5) alguna fila tiene disponible MAYOR que la cantidad', () => {
    // Ya estaban desincronizadas antes de fusionar; la suma conserva la
    // anomalia y ademas la esconde adentro de una fila nueva.
    const fusion = unicaFusion(dosPilas({ quantity: 40, available: 90 }));

    expect(fusion.revisar).toBe(true);
    expect(fusion.senales).toContain('alguna fila tiene disponible mayor que la cantidad');
  });

  it('la nota dice por que se marco, para que el informe se pueda leer', () => {
    const fusion = unicaFusion(dosPilas({ quantity: 100 }, { quantity: 100 }));

    expect(fusion.nota).toContain('Revisar:');
    expect(fusion.nota).toContain('misma cantidad');
  });

  it('sin senales, la nota no dice «Revisar» aunque tenga lotes descartados', () => {
    // Las dos cosas van a la misma nota y no son lo mismo: el lote descartado
    // es informacion, la marca es un pedido de recuento. Confundirlas haria
    // que se revise todo o que no se revise nada.
    const fusion = unicaFusion(dosPilas());

    expect(fusion.revisar).toBe(false);
    expect(fusion.nota).not.toContain('Revisar:');
    expect(fusion.nota).toContain('Lotes descartados:');
  });
});

// ════════════════════════════════════════════
//  Qué NO se fusiona
// ════════════════════════════════════════════

describe('lo que no se toca', () => {
  it('dos filas del mismo producto en sucursales DISTINTAS no se fusionan', () => {
    const { fusiones } = planDe([
      fila({ id: 1, punto_de_venta_id: 3, quantity: 40 }),
      fila({ id: 2, punto_de_venta_id: 5, quantity: 12 }),
    ]);

    expect(fusiones).toEqual([]);
  });

  it('dos productos distintos en la misma sucursal no se fusionan', () => {
    const { fusiones } = planDe([
      fila({ id: 1, product_id: 100, punto_de_venta_id: 3 }),
      fila({ id: 2, product_id: 200, punto_de_venta_id: 3 }),
    ]);

    expect(fusiones).toEqual([]);
  });

  it('dos empresas distintas nunca se mezclan, aunque compartan product_id', () => {
    const { fusiones } = planDe([
      fila({ id: 1, empresa_id: 7, punto_de_venta_id: 3 }),
      fila({ id: 2, empresa_id: 8, punto_de_venta_id: 30 }),
    ], [...PUNTOS_DE_VENTA, { id: 30, empresa_id: 8, name: 'Otra', code: 'otra', is_active: true }]);

    expect(fusiones).toEqual([]);
  });

  it('dos empresas SIN sucursales no se fusionan entre si', () => {
    // El caso que puede colarse: las dos van a "la sucursal que se va a crear",
    // que todavia no tiene id. Si la agrupacion no lleva el empresa_id, las
    // filas de dos empresas cliente terminan sumadas en una sola — una fuga
    // entre empresas escrita por la migracion.
    const { fusiones } = planDe([
      fila({ id: 1, empresa_id: 12, product_id: 100, quantity: 40 }),
      fila({ id: 2, empresa_id: 13, product_id: 100, quantity: 12 }),
    ], []);

    expect(fusiones).toEqual([]);
  });

  it('no modifica las filas que recibe', () => {
    // El informe se corre dos veces seguidas y tiene que dar lo mismo. Y la
    // migracion planifica sobre las filas que despues escribe.
    const filas = dosPilas();
    const copia = JSON.parse(JSON.stringify(filas));

    planDe(filas);

    expect(filas).toEqual(copia);
  });
});

// ════════════════════════════════════════════
//  Idempotencia (FR-048)
// ════════════════════════════════════════════

describe('idempotencia: la segunda corrida no tiene nada que hacer', () => {
  /** Aplica el plan sobre las filas, como haria la migracion. */
  function aplicar(filas, plan) {
    const porId = new Map(filas.map((f) => [f.id, { ...f }]));

    for (const asignacion of plan.asignaciones) {
      const f = porId.get(asignacion.stock_id);
      f.punto_de_venta_id = asignacion.punto_de_venta_id_nuevo;
      f.location = asignacion.location_nueva;
    }

    for (const fusion of plan.fusiones) {
      Object.assign(porId.get(fusion.sobreviviente_id), fusion.resultado);
      for (const f of fusion.filas) if (!f.sobrevive) porId.delete(f.id);
    }

    return [...porId.values()];
  }

  it('sobre filas ya consolidadas no propone ninguna fusion', () => {
    const yaConsolidadas = [
      fila({ id: 1, punto_de_venta_id: 3, location: 'principal', quantity: 52 }),
      fila({ id: 2, punto_de_venta_id: 5, location: 'deposito', quantity: 8 }),
    ];

    expect(planDe(yaConsolidadas).fusiones).toEqual([]);
  });

  it('aplicar el plan y volver a planificar no vuelve a sumar', () => {
    // Esta es la prueba de FR-048 que importa: no que "no haga nada", sino que
    // no vuelva a duplicar la cantidad de un producto.
    const filas = dosPilas();
    const primera = planDe(filas);
    const despues = aplicar(filas, primera);

    const segunda = planDe(despues);

    expect(segunda.fusiones).toEqual([]);
    expect(despues.reduce((acc, f) => acc + f.quantity, 0)).toBe(52);
  });

  it('la suma de cantidades por producto se conserva: ningun dato se pierde', () => {
    // Es el criterio de exito 5 de la spec, que la migracion verifica sola
    // adentro de la transaccion. Aca se verifica el plan que ella aplica.
    const filas = [
      fila({ id: 1, punto_de_venta_id: 3, quantity: 40, available: 38, current_batch: 'A' }),
      fila({ id: 2, punto_de_venta_id: null, location: 'principal', quantity: 12, available: 12, current_batch: 'B' }),
      fila({ id: 3, punto_de_venta_id: null, location: 'mostrador', quantity: 7, available: 7, current_batch: 'C' }),
    ];

    const fusion = unicaFusion(filas);

    expect(fusion.resultado.quantity).toBe(59);
    expect(fusion.resultado.available).toBe(57);
    expect(fusion.filas).toHaveLength(3);
  });
});

describe('sin nada que hacer devuelve listas vacias, no rompe', () => {
  it('sin filas', () => {
    expect(planificar({ filas: [], puntosDeVenta: PUNTOS_DE_VENTA }))
      .toEqual({ asignaciones: [], fusiones: [], avisos: [] });
  });

  it('sin argumentos', () => {
    expect(planificar()).toEqual({ asignaciones: [], fusiones: [], avisos: [] });
  });
});
