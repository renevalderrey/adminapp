// ════════════════════════════════════════════
//  Los gastos fijos sin sucursal, a la sucursal por defecto
//
//  Un gasto fijo con `punto_de_venta_id` nulo **no se dibujaba en ninguna
//  pantalla y seguía moviendo el punto de equilibrio**: el agrupado viejo
//  repartía por `'gf' + indice` y con una sola sucursal `'gf1'` —el default del
//  modelo— no caía en ningún bucket, mientras `dashboardService` y
//  `cashflowService` lo sumaban igual.
//
//  La pantalla ya está arreglada (corte anterior: esos gastos se ven en
//  «General» sin tocar un dato). Lo que hace la migración
//  `20260813-gastos-fijos-a-su-sucursal` es lo otro: **mover datos de un
//  cliente**. A dónde va cada fila es una decisión de negocio, y por eso vive en
//  una función pura —`planificarAsignaciones`— y no adentro de un SQL: se puede
//  afirmar sobre ella sin levantar Postgres, igual que `planificarFusiones`.
//
//  La decisión, resumida: **a la sucursal por defecto de su empresa**, con
//  `elegirPorDefecto` —la misma función de tres escalones que ya usan las
//  ventas, el import y TiendaNube— y **sin mirar el `group`**, porque `'gf1'`
//  significa «Ortiz de Ocampo» en Comprafit y no significa nada en general.
// ════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const {
  planificarAsignaciones,
  informar,
  ARCHIVO,
  down,
} = require('../migrations/20260813-gastos-fijos-a-su-sucursal');

const EMPRESA = 7;
const OTRA_EMPRESA = 9;

/** Una fila de `fixed_expenses` como la lee la migración. */
const gasto = (id, extra = {}) => ({
  id,
  empresa_id: EMPRESA,
  name: `Gasto ${id}`,
  amount: '1000.00',
  group: 'gf1',
  punto_de_venta_id: null,
  ...extra,
});

/** Una fila de `puntos_de_venta`. */
const sucursal = (id, extra = {}) => ({
  id,
  empresa_id: EMPRESA,
  name: `Sucursal ${id}`,
  code: null,
  is_active: true,
  ...extra,
});

describe('planificarAsignaciones · a qué sucursal va cada gasto', () => {
  it('con tres sucursales gana la de code=\'principal\' aunque no sea la de menor id', async () => {
    // Es el caso que separa `elegirPorDefecto` de un `ORDER BY id LIMIT 1`
    // escrito en SQL. Con una sola sucursal los tres escalones devuelven lo
    // mismo y el orden no se prueba nunca: la `principal` va tercera a propósito.
    const plan = planificarAsignaciones([gasto(1)], [
      sucursal(10, { code: 'deposito' }),
      sucursal(11, { code: 'norte' }),
      sucursal(12, { code: 'principal' }),
    ]);

    expect(plan.asignaciones).toHaveLength(1);
    expect(plan.asignaciones[0].punto_de_venta_id).toBe(12);
  });

  it('una empresa sin ninguna sucursal no produce ninguna asignación, y eso NO es un error', async () => {
    // No se inventa una sucursal ni se corta la migración: el gasto se queda
    // como está y la pantalla lo dibuja en «General». Lo único que se hace es
    // informarlo aparte para que no se lea como un olvido.
    const plan = planificarAsignaciones([gasto(1), gasto(2)], []);

    expect(plan.asignaciones).toEqual([]);
    expect(plan.sinDestino).toEqual([
      { empresa_id: EMPRESA, cantidad: 2, total: 2000 },
    ]);
    expect(plan.resumen.sinSucursalPosible).toBe(2);
  });

  it('con una sola sucursal, el gasto va ahí aunque esté inactiva', async () => {
    // Tercer escalón: una empresa que cerró todos sus locales y todavía tiene
    // gastos cargados no puede quedarse sin destino.
    const plan = planificarAsignaciones(
      [gasto(1)],
      [sucursal(4, { is_active: false })]
    );

    expect(plan.asignaciones[0].punto_de_venta_id).toBe(4);
  });

  it('entre dos activas gana la de MENOR id, no la primera que llega', async () => {
    // El orden de la lista lo decide el planificador de Postgres. Si la regla
    // dependiera de él, dos corridas de la misma migración sobre la misma base
    // podrían repartir distinto.
    const plan = planificarAsignaciones([gasto(1)], [sucursal(9), sucursal(3)]);

    expect(plan.asignaciones[0].punto_de_venta_id).toBe(3);
  });

  it('un gasto que YA tiene sucursal no se toca', async () => {
    // Es lo que separa esta migración de un `UPDATE fixed_expenses SET
    // punto_de_venta_id = …` sin `WHERE`: mover los que ya estaban bien le
    // desarmaría el agrupado a quien lo había hecho a mano.
    const plan = planificarAsignaciones(
      [gasto(1, { punto_de_venta_id: 5 }), gasto(2)],
      [sucursal(5), sucursal(6, { code: 'principal' })]
    );

    expect(plan.asignaciones.map((a) => a.fixed_expense_id)).toEqual([2]);
    expect(plan.resumen.yaTenian).toBe(1);
    expect(plan.resumen.movidos).toBe(1);
  });

  it('el `group` NO decide nada: un gf2 va a la misma sucursal que un gf1', async () => {
    // La alternativa —mapear gf1 y gf2 a la primera y la segunda sucursal— solo
    // es cierta para Comprafit (`legacy:3011`, `:3017`), y una migración que
    // adivina no puede distinguir esa empresa de otra. Sin este caso, un `up`
    // que interpretara la columna pasaría en verde.
    const plan = planificarAsignaciones(
      [gasto(1, { group: 'gf1' }), gasto(2, { group: 'gf2' })],
      [sucursal(1), sucursal(2, { code: 'principal' })]
    );

    expect(plan.asignaciones.map((a) => a.punto_de_venta_id)).toEqual([2, 2]);
  });

  it('un gasto NUNCA va a la sucursal de otra empresa', async () => {
    // Las dos listas llegan de todas las empresas juntas, que es como las lee
    // una migración. La FK de `20260604-add-pv-to-fixed-expenses` **no incluye
    // `empresa_id`**, así que la base aceptaría el id ajeno sin chistar: acá es
    // donde se impide.
    const plan = planificarAsignaciones(
      [gasto(1), gasto(2, { empresa_id: OTRA_EMPRESA })],
      [sucursal(1), sucursal(50, { empresa_id: OTRA_EMPRESA })]
    );

    expect(plan.asignaciones).toEqual([
      expect.objectContaining({ empresa_id: EMPRESA, punto_de_venta_id: 1 }),
      expect.objectContaining({ empresa_id: OTRA_EMPRESA, punto_de_venta_id: 50 }),
    ]);
  });

  it('una empresa sin sucursales no arrastra a las que sí tienen', async () => {
    // Las dos ramas conviven en la misma corrida: cortar la migración porque una
    // empresa no tiene sucursales dejaría a las otras seis sin migrar.
    const plan = planificarAsignaciones(
      [gasto(1), gasto(2, { empresa_id: OTRA_EMPRESA })],
      [sucursal(1)]
    );

    expect(plan.asignaciones.map((a) => a.fixed_expense_id)).toEqual([1]);
    expect(plan.sinDestino).toEqual([
      { empresa_id: OTRA_EMPRESA, cantidad: 1, total: 1000 },
    ]);
    expect(plan.resumen.empresas).toBe(2);
  });

  it('NO lee 180.000,10 + 42.500,20 como 222.500,59999999998', async () => {
    // `amount` es DECIMAL(12,2) y el driver lo entrega como STRING. Acumularlo
    // con `parseFloat` deja el residuo a la vista en el informe —el total que
    // alguien va a comparar contra su planilla— y esa es la clase de número que
    // hace dudar del resto de la línea. Los centavos de la fixture no son
    // decorativos: con importes redondos las dos sumas dan lo mismo y la
    // corrección se puede sacar sin que nada se ponga rojo.
    const plan = planificarAsignaciones([
      gasto(1, { amount: '180000.10' }),
      gasto(2, { amount: '42500.20' }),
      gasto(3, { amount: '0.30' }),
    ], [sucursal(1)]);

    expect(plan.resumen.totalMovido).toBe(222500.6);
    expect([180000.10, 42500.20, 0.30].reduce((s, n) => s + n, 0)).not.toBe(222500.6);
  });

  it('el resumen cuenta lo leído aunque no haya nada que mover', async () => {
    // Ancla: sin esto, un plan vacío por un error de lectura se leería igual que
    // «ninguno estaba sin sucursal», que es la diferencia entre mirar y no
    // mirar.
    const plan = planificarAsignaciones(
      [gasto(1, { punto_de_venta_id: 3 })],
      [sucursal(3)]
    );

    expect(plan.resumen.gastosLeidos).toBe(1);
    expect(plan.resumen.movidos).toBe(0);
    expect(plan.resumen.totalMovido).toBe(0);
  });

  it('el destino se nombra, no solo se numera', async () => {
    // El informe es lo único que le permite a alguien reasignar a mano lo que
    // esta migración juntó. Un id suelto no le sirve a nadie que tenga que ir a
    // buscarlo a la pantalla.
    const plan = planificarAsignaciones(
      [gasto(1)],
      [sucursal(3, { name: 'Ortiz de Ocampo', code: 'principal' })]
    );

    expect(plan.asignaciones[0].punto_de_venta_nombre).toBe('Ortiz de Ocampo');
  });
});

describe('El informe: mover la plata de un cliente en silencio no vale', () => {
  const capturar = (gastos, puntos) => {
    const lineas = [];
    informar(planificarAsignaciones(gastos, puntos), (l) => lineas.push(l));
    return lineas.join('\n');
  };

  it('dice cuántos gastos leyó incluso cuando no hay ninguno que mover', async () => {
    // «Los leí y no había» es distinto de un log mudo, que se lee igual que «no
    // miré». Es la misma distinción que pide `docs/OPERACION.md` para el informe
    // de stock.
    const salida = capturar([gasto(1, { punto_de_venta_id: 3 })], [sucursal(3)]);

    expect(salida).toMatch(/1 gasto\(s\) fijo\(s\) leídos en 1 empresa\(s\)/);
    expect(salida).toMatch(/Ningún gasto fijo estaba sin sucursal/);
  });

  it('nombra cada fila con su nombre, su importe y a dónde fue', async () => {
    const salida = capturar(
      [gasto(1, { name: 'Alquiler', amount: '180000.10' })],
      [sucursal(3, { name: 'Ortiz de Ocampo', code: 'principal' })]
    );

    expect(salida).toMatch(/empresa 7 · «Alquiler» \$180\.000,10 → Ortiz de Ocampo \(id 3\)/);
  });

  it('escribe los importes en argentino: 180.000,10 y no 180,000.10', async () => {
    // `toLocaleString()` sin locale, en un servidor en inglés, convierte
    // $180.000 en $180,000 y no falla nada. Es el error que `CONVENCIONES.md`
    // nombra, en una línea de log que alguien va a comparar contra su planilla.
    const salida = capturar(
      [gasto(1, { amount: '180000.10' }), gasto(2, { amount: '42500.20' })],
      [sucursal(3)]
    );

    expect(salida).toMatch(/\$222\.500,30 en total/);
    expect(salida).not.toMatch(/180,000/);
  });

  it('la empresa sin sucursales sale como aviso y dice dónde se ven esos gastos', async () => {
    // Sin esta línea, dos gastos que la migración deliberadamente no movió se
    // leen como dos gastos que se le escaparon.
    const salida = capturar([gasto(1), gasto(2)], []);

    expect(salida).toMatch(/⚠ empresa 7: 2 gasto\(s\) sin sucursal por \$2\.000,00/);
    expect(salida).toMatch(/no tiene ninguna cargada/);
    expect(salida).toMatch(/se ven en «General»/);
  });

  it('dice que el total no cambió y dónde quedó lo que se movió', async () => {
    // Las dos frases son el contrato de esta migración: no se movió un peso, y
    // todo lo que se tocó se puede deshacer.
    const salida = capturar([gasto(1)], [sucursal(3)]);

    expect(salida).toMatch(/El total de gastos fijos por empresa no cambió/);
    expect(salida).toMatch(new RegExp(`${ARCHIVO}. El down lo restaura`));
  });

  it('con muchas filas manda al archivo en vez de escupir mil líneas', async () => {
    const gastos = [];
    for (let i = 1; i <= 60; i += 1) gastos.push(gasto(i));

    const salida = capturar(gastos, [sucursal(3)]);

    expect(salida).toMatch(/y 10 más/);
    expect(salida).toMatch(new RegExp(ARCHIVO));
  });
});

// ════════════════════════════════════════════
//  Lo que solo se puede afirmar sobre el SQL
//
//  Estas cuatro cosas viven en sentencias, no en una función que se pueda
//  llamar: `planificarAsignaciones` no mira ni las fechas ni el orden de los
//  pasos. Son guardias estáticas, groseras a propósito, y cada una tiene atrás
//  un defecto que este repositorio ya pagó una vez.
// ════════════════════════════════════════════

describe('El archivo y el orden de los pasos', () => {
  const fuente = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '20260813-gastos-fijos-a-su-sucursal.js'),
    'utf8'
  );

  it('el archivo guarda las dos fechas como TEXTO', async () => {
    // Un `Date` de JavaScript no puede transportar los microsegundos de
    // Postgres: `JSON.stringify` los corta al milisegundo **antes** del JSON, y
    // el `down` repondría una fecha que no es la que la fila tenía. Lo encontró
    // el paso P5 en la fusión de recetas; leyendo el `down` no se ve.
    expect(JSON.parse(JSON.stringify(new Date('2026-08-05 23:59:58.621389+00'))))
      .toBe('2026-08-05T23:59:58.621Z');

    expect(fuente).toContain('created_at::text AS created_at');
    expect(fuente).toContain('updated_at::text AS updated_at');
  });

  it('la fila se archiva ANTES de que el UPDATE la mueva', async () => {
    // Al revés, la fila archivada ya tendría la sucursal nueva y el `down` la
    // «restauraría» al estado que quería deshacer.
    const archivado = fuente.indexOf(`INSERT INTO \${ARCHIVO}`);
    const movida = fuente.indexOf('UPDATE fixed_expenses SET punto_de_venta_id');

    expect(archivado).toBeGreaterThanOrEqual(0);
    expect(movida).toBeGreaterThan(archivado);
  });

  it('el UPDATE no puede tocar una fila que YA tenía sucursal', async () => {
    // La última red: un plan mal armado no alcanza para mover un gasto que
    // alguien había asignado a mano.
    expect(fuente).toMatch(/WHERE id = \$2 AND punto_de_venta_id IS NULL/);
  });

  it('la foto de control se toma ANTES de mover y se compara ANTES del commit', async () => {
    // Comparar los totales después del commit sería contarlos, no verificarlos:
    // si no cierran, ya no hay nada que impedir.
    const foto = fuente.indexOf('CREATE TEMP TABLE control_gastos_fijos ON COMMIT DROP');
    const movida = fuente.indexOf('UPDATE fixed_expenses SET punto_de_venta_id');
    const comparacion = fuente.indexOf('FROM control_gastos_fijos a');
    const corte = fuente.indexOf('No se aplicó nada.');

    expect(foto).toBeGreaterThanOrEqual(0);
    expect(movida).toBeGreaterThan(foto);
    expect(comparacion).toBeGreaterThan(movida);
    expect(corte).toBeGreaterThan(comparacion);
  });

  it('el `down` restaura desde el archivo ANTES de borrarlo', async () => {
    // Al revés no hay con qué restaurar, y el `down` terminaría en verde sin
    // haber devuelto una sola fila.
    const restaura = fuente.indexOf('UPDATE fixed_expenses fe');
    const borra = fuente.indexOf(`DROP TABLE IF EXISTS \${ARCHIVO}`);

    expect(restaura).toBeGreaterThanOrEqual(0);
    expect(borra).toBeGreaterThan(restaura);
  });
});

describe('Sin el archivo, el `down` no adivina', () => {
  /**
   * Un `queryInterface` de mentira que contesta «la tabla de archivo NO está».
   *
   * Es lo único que hace falta para llegar a la rama: el `down` pregunta por su
   * tabla con `to_regclass` antes de tocar nada. Un doble alcanza porque acá no
   * hay nada de SQL que probar —es una rama de control de flujo—, que es la
   * misma línea que traza `reversibilidadDeMigraciones.test.js`.
   */
  const sinTablaDeArchivo = () => {
    const sentencias = [];

    const sequelize = {
      transaction: (fn) => fn('transaccion-falsa'),
      query: async (sql) => {
        sentencias.push(sql);

        if (sql.includes('to_regclass')) return [[{ hay: false }]];

        return [[]];
      },
    };

    return { queryInterface: { sequelize }, sentencias };
  };

  it('no pone ningún `punto_de_venta_id` en NULL: avisa y no toca nada', async () => {
    // Sin el archivo no hay forma de distinguir un gasto que esta migración
    // movió de uno que el usuario asignó él mismo. Un `UPDATE … SET
    // punto_de_venta_id = NULL` a lo bruto le desarmaría el agrupado a quien lo
    // había hecho bien, y eso es peor que no revertir.
    const { queryInterface, sentencias } = sinTablaDeArchivo();

    const dicho = [];
    const original = console.log;
    console.log = (linea) => dicho.push(String(linea));

    try {
      await expect(down(queryInterface)).resolves.toBeUndefined();
    } finally {
      console.log = original;
    }

    expect(sentencias.some((sql) => sql.includes('UPDATE fixed_expenses'))).toBe(false);
    expect(dicho.join('\n')).toContain(ARCHIVO);
    expect(dicho.join('\n')).toMatch(/no se tocó ninguno/);
  });
});
