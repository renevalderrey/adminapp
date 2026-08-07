'use strict';

/**
 * ════════════════════════════════════════════
 *  fixed_expenses: los gastos sin sucursal, a la sucursal por defecto
 *  Migración 23 — decisión 4 de `docs/specs/014-panel-gastos-equipo-afip`.
 * ════════════════════════════════════════════
 *
 * ── El problema ──
 *
 * Un gasto fijo con `punto_de_venta_id` nulo **no se dibujaba en ninguna
 * pantalla y seguía moviendo el punto de equilibrio**. El agrupado viejo del
 * navegador repartía por `'gf' + indice`: con una sola sucursal, `'gf0'` no
 * matcheaba nada y `'gf1'` —el `defaultValue` del modelo— quedaba excluido del
 * bucket «General». Mientras tanto `dashboardService` y `cashflowService` suman
 * `FixedExpense` por `empresa_id` a secas: la plata que la pantalla no mostraba
 * igual movía el BEP y el flujo de caja.
 *
 * El corte anterior ya arregló **la pantalla**: hoy un gasto sin sucursal se ve
 * en «General», sin tocar un dato. Esta migración es el segundo paso y es de
 * otra clase: **mueve datos de un cliente**. Por eso archiva, informa fila por
 * fila y se puede revertir.
 *
 * El orden entre las dos no es casual: la corrección que hace visible la plata
 * **no puede depender de esta migración**, porque si esta se revierte el gasto
 * tiene que seguir viéndose.
 *
 * ── A dónde va cada uno, y qué NO se mira ──
 *
 * A la **sucursal por defecto de su empresa**, calculada con `elegirPorDefecto`
 * de `utils/sucursalDeStock.js`: tres escalones —`code = 'principal'`, el activo
 * de menor id, el de menor id— que ya usan las ventas, el import y TiendaNube.
 * Se **importa** en vez de reescribirse en SQL: una regla escrita dos veces son
 * dos reglas. `puntos_de_venta` no tiene `is_default` ni nada parecido, y no se
 * crea: sería una cuarta respuesta a una pregunta que ya tiene una.
 *
 * **El `group` no se mira.** Una fila con `group = 'gf2'` va a la sucursal por
 * defecto igual que una con `'gf1'`. La alternativa —mapear `gf1` y `gf2` a la
 * primera y la segunda sucursal— **solo es cierta para Comprafit**
 * (`legacy:3011`, `:3017`: `gf1` era Ortiz de Ocampo y `gf2` era 25 de Mayo), y
 * una migración que adivina no puede distinguir esa empresa de otra.
 *
 * ⚠ **Consecuencia que hay que decir en voz alta**: para una empresa con dos
 * sucursales que ya migró del legacy, **esta migración junta los gastos de las
 * dos bajo una sola**. Hoy esos gastos no se dibujan en ninguna parte, así que
 * no hay número que se mueva en pantalla; lo que se mueve es dónde van a
 * aparecer a partir de ahora. Por eso el informe los lista **uno por uno con su
 * nombre y su importe**: es lo único que le permite a alguien reasignarlos a
 * mano en cinco minutos.
 *
 * ── Las empresas sin ninguna sucursal ──
 *
 * **No se tocan, y no es un error.** Sus gastos se quedan en `NULL` y la
 * pantalla los dibuja en «General», que existe desde el corte anterior. Se
 * informan aparte para que no se lean como un olvido.
 *
 * ── Qué promete, ejecutado y no prometido ──
 *
 * Que **ningún total se mueve**: la suma de `amount` por empresa tiene que ser
 * idéntica antes y después. Se toma la foto en una `TEMP TABLE … ON COMMIT DROP`
 * antes de tocar nada y se compara **antes del commit**; si difiere, no hay
 * commit. Es barato —esta migración no crea ni borra filas, solo escribe una
 * columna— y es la promesa más fuerte que se puede hacer acá.
 *
 * ── Por qué informa por consola ──
 *
 * Igual que `20260809-unico-de-insumo-por-receta`: **modifica datos de un
 * cliente**, y el `stdio: 'inherit'` de `scripts/migrar.js` deja estas líneas en
 * el log del contenedor junto al resto del arranque. El informe sale
 * **siempre**, también con cero filas movidas: «leí 412 gastos y ninguno estaba
 * sin sucursal» es distinto de no decir nada, que se lee igual que «no miré».
 *
 * ── Reversible ──
 *
 * El `down` devuelve cada fila archivada a lo que tenía —`punto_de_venta_id` y
 * `updated_at`— y borra el archivo. Igual que el `down` de `20260804` y el del
 * molde, **pisa lo que haya pasado después**: si entre el deploy y el rollback
 * alguien reasignó ese gasto a mano, la reasignación se pierde. Es para volver
 * atrás minutos después de un deploy, no meses.
 */

const { elegirPorDefecto } = require('../utils/sucursalDeStock');
const { sumaEnCentavos } = require('../utils/centavos');

/** Dónde queda lo que se movió. Se crea SIEMPRE: ver el paso 1. */
const ARCHIVO = 'fixed_expenses_sin_sucursal';

/** Cuántas filas se listan por consola antes de mandar a leer el archivo. */
const MAXIMO_A_LISTAR = 50;

/**
 * Un importe como lo escribe el país, para el informe.
 *
 * Local y no importado de ningún lado por el mismo motivo que el `enPesos` de
 * `routes/suppliers.js:762`: `apps/api` no tiene un `utils/formato.js`, y esto
 * es una línea de log, no un número que alguien vaya a sumar. Los dos
 * `FractionDigits` van juntos: sin el máximo, `1234.567` sale «1.234,567»; sin
 * el mínimo, `1234` sale «1.234» y la misma lista termina con dos formatos.
 */
function enPesos(n) {
  return `$${(Number(n) || 0).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Qué gasto va a qué sucursal, sin tocar la base.
 *
 * Está separada de `up` —y exportada— por el mismo motivo que
 * `planificarFusiones`: **la decisión de qué pasa con los datos de un cliente
 * tiene que poder testearse sin levantar Postgres**. La prueba está en
 * `src/tests/gastosFijosASuSucursal.test.js`.
 *
 * Las dos listas llegan **de todas las empresas juntas**, que es como las lee
 * una migración: el agrupado por empresa se hace acá adentro. Que un gasto de
 * una empresa no pueda terminar en la sucursal de otra es una propiedad de esta
 * función, no del SQL que la alimenta, y por eso tiene su caso.
 *
 * @param {Array<{id:number, empresa_id:number, name:string, amount:string|number,
 *   punto_de_venta_id:number|null}>} gastos Todas las filas de `fixed_expenses`.
 * @param {Array<{id:number, empresa_id:number, name?:string, code?:string|null,
 *   is_active?:boolean}>} puntosDeVenta Todas las filas de `puntos_de_venta`.
 * @returns {{asignaciones: object[], sinDestino: object[], resumen: object}}
 */
function planificarAsignaciones(gastos = [], puntosDeVenta = []) {
  const porEmpresa = new Map();

  for (const pv of puntosDeVenta) {
    const empresaId = Number(pv.empresa_id);

    if (!porEmpresa.has(empresaId)) porEmpresa.set(empresaId, []);
    porEmpresa.get(empresaId).push(pv);
  }

  const asignaciones = [];
  const huerfanos = new Map();
  let yaTenian = 0;

  for (const gasto of gastos) {
    // `undefined` además de `null` porque un `SELECT` que se olvide la columna
    // no puede leerse como «este gasto no tiene sucursal»: movería filas que ya
    // estaban bien.
    if (gasto.punto_de_venta_id !== null && gasto.punto_de_venta_id !== undefined) {
      yaTenian += 1;
      continue;
    }

    const empresaId = Number(gasto.empresa_id);

    // Solo las sucursales de SU empresa entran a la elección. Es lo que impide
    // que un gasto termine colgado del punto de venta de otro cliente, que es
    // exactamente lo que la FK de `20260604-add-pv-to-fixed-expenses` no
    // alcanza a impedir: no incluye `empresa_id`.
    const destino = elegirPorDefecto(porEmpresa.get(empresaId) || []);

    if (!destino) {
      // Una empresa sin ninguna sucursal cargada no es un error: sus gastos se
      // quedan como están y la pantalla los dibuja en «General». Se juntan
      // aparte para poder informarlos como lo que son.
      if (!huerfanos.has(empresaId)) huerfanos.set(empresaId, []);
      huerfanos.get(empresaId).push(gasto);
      continue;
    }

    asignaciones.push({
      fixed_expense_id: gasto.id,
      empresa_id: empresaId,
      punto_de_venta_id: destino.id,
      // El nombre es para el informe: un id suelto no le sirve a nadie que
      // tenga que ir a mirar la pantalla.
      punto_de_venta_nombre: destino.name || destino.code || `sucursal ${destino.id}`,
      name: gasto.name,
      amount: gasto.amount,
    });
  }

  const sinDestino = [...huerfanos.entries()].map(([empresa_id, suyos]) => ({
    empresa_id,
    cantidad: suyos.length,
    // El total también acá: es lo que dice cuánta plata se queda en «General».
    total: sumaEnCentavos(suyos.map((g) => g.amount)),
  }));

  return {
    asignaciones,
    sinDestino,
    resumen: {
      gastosLeidos: gastos.length,
      empresas: new Set(gastos.map((g) => Number(g.empresa_id))).size,
      movidos: asignaciones.length,
      yaTenian,
      sinSucursalPosible: sinDestino.reduce((acc, e) => acc + e.cantidad, 0),
      // `sumaEnCentavos` y no un `reduce` con `+`: `amount` es DECIMAL(12,2) y
      // vuelve como string, y acumular en punto flotante deja el residuo a la
      // vista en el informe —«$180.000,8500000001»—, que es la clase de número
      // que hace dudar del resto de la línea.
      totalMovido: sumaEnCentavos(asignaciones.map((a) => a.amount)),
    },
  };
}

/** Lo que el operador ve en el log del contenedor. Ver el encabezado. */
function informar(plan, escribir = console.log) {
  const { resumen, asignaciones, sinDestino } = plan;
  const log = (linea) => escribir(`[fixed_expenses] ${linea}`);

  log(`${resumen.gastosLeidos} gasto(s) fijo(s) leídos en ${resumen.empresas} empresa(s).`);

  if (asignaciones.length) {
    log(
      `${resumen.movidos} gasto(s) sin sucursal se asignan a la sucursal por defecto `
      + `(${enPesos(resumen.totalMovido)} en total):`
    );

    for (const a of asignaciones.slice(0, MAXIMO_A_LISTAR)) {
      log(
        `  empresa ${a.empresa_id} · «${a.name}» ${enPesos(a.amount)} `
        + `→ ${a.punto_de_venta_nombre} (id ${a.punto_de_venta_id})`
      );
    }

    if (asignaciones.length > MAXIMO_A_LISTAR) {
      log(`  … y ${asignaciones.length - MAXIMO_A_LISTAR} más. La lista completa está en ${ARCHIVO}.`);
    }
  } else {
    // «Los leí y no había» es distinto de un log mudo, que se lee igual que «no
    // miré».
    log('Ningún gasto fijo estaba sin sucursal: no se movió ningún dato.');
  }

  for (const e of sinDestino) {
    log(
      `⚠ empresa ${e.empresa_id}: ${e.cantidad} gasto(s) sin sucursal por `
      + `${enPesos(e.total)} y la empresa no tiene ninguna cargada.`
    );
    log('  Quedan como estaban y se ven en «General».');
  }

  if (!asignaciones.length) return;

  // Esta línea se imprime DESPUÉS de la verificación del paso 4 —el informe va
  // último a propósito—, así que no es una promesa: es algo que ya se comprobó
  // contra la foto de control y a un commit de distancia.
  log('El total de gastos fijos por empresa no cambió.');
  log(`Todo lo que se movió quedó en ${ARCHIVO}. El down lo restaura.`);
}

module.exports = {
  // Exportadas para el test. `sequelize-cli` solo mira `up` y `down`.
  planificarAsignaciones,
  informar,
  enPesos,
  ARCHIVO,

  async up(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async (transaction) => {
      const q = (sql, bind) => sequelize.query(sql, bind ? { transaction, bind } : { transaction });
      const filasDe = async (sql, bind) => (await q(sql, bind))[0];

      // ════════ Paso 0 · La foto de control ════════
      //
      // Lo que esta migración promete es que NINGÚN total se mueve: la suma de
      // `amount` por empresa —y la cantidad de filas— tiene que ser la misma
      // antes y después. Se verifica adentro de la transacción, en el paso 4;
      // comprobarlo después, con los datos ya cambiados, sería tarde.
      // `ON COMMIT DROP`: muere con la transacción y no deja basura.
      await q(`
        CREATE TEMP TABLE control_gastos_fijos ON COMMIT DROP AS
          SELECT empresa_id,
                 SUM(amount)::numeric AS total,
                 count(*)::int        AS n
            FROM fixed_expenses
           GROUP BY 1
      `);

      // ════════ Paso 1 · El archivo ════════
      //
      // Se crea SIEMPRE, aunque no haya una sola fila que mover: así el `down`
      // es uno solo y no dos según lo que hubiera, y quien pregunte «¿esta
      // migración me tocó los gastos?» encuentra una tabla vacía en vez de un
      // error.
      //
      // Sin FK a `fixed_expenses`: la gracia de esta tabla es sobrevivir a la
      // fila que describe, y un `ON DELETE CASCADE` se la llevaría justo cuando
      // sirve.
      await q(`
        CREATE TABLE IF NOT EXISTS ${ARCHIVO} (
          id                         SERIAL PRIMARY KEY,
          empresa_id                 INTEGER     NOT NULL,
          fixed_expense_id           INTEGER     NOT NULL,
          punto_de_venta_id_asignado INTEGER     NOT NULL,
          fila                       JSONB       NOT NULL,
          created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      await q(`CREATE INDEX IF NOT EXISTS ${ARCHIVO}_empresa_id ON ${ARCHIVO} (empresa_id)`);
      await q(`CREATE UNIQUE INDEX IF NOT EXISTS ${ARCHIVO}_gasto ON ${ARCHIVO} (fixed_expense_id)`);

      // ════════ Paso 2 · El plan ════════
      //
      // ⚠ Las dos fechas salen como TEXTO, y no es un capricho de estilo.
      //
      // La fila archivada se guarda con `JSON.stringify`, y para eso el driver
      // ya convirtió el `timestamptz` en un `Date` de JavaScript, que solo llega
      // al milisegundo. Los microsegundos que Postgres sí guarda se pierden ahí,
      // antes del JSON: `…:58.621389+00` se archiva como `…:58.621Z` y el `down`
      // repondría una fecha que no es la que la fila tenía. Lo encontró
      // `scripts/verificar-reversibilidad.js` en la fusión de recetas comparando
      // la base antes del `up` con la base después del `down` — leyendo el
      // `down` no se ve.
      //
      // `"group"` va entre comillas porque GROUP es palabra reservada de SQL. La
      // columna es dato muerto y esta migración no la mira; se archiva igual
      // porque el archivo guarda **la fila entera antes del cambio**.
      const gastos = await filasDe(`
        SELECT id,
               empresa_id,
               name,
               amount,
               "group",
               punto_de_venta_id,
               created_at::text AS created_at,
               updated_at::text AS updated_at
          FROM fixed_expenses
         ORDER BY empresa_id, id
      `);

      const puntos = await filasDe(`
        SELECT id, empresa_id, name, code, is_active
          FROM puntos_de_venta
         ORDER BY empresa_id, id
      `);

      const plan = planificarAsignaciones(gastos, puntos);

      // ════════ Paso 3 · Mover ════════
      const porId = new Map(gastos.map((g) => [g.id, g]));

      for (const a of plan.asignaciones) {
        // El archivo se escribe ANTES del UPDATE: si algo fallara en el medio,
        // la transacción entera vuelve atrás, pero el orden deja claro que no
        // hay ninguna ventana en la que la fila esté movida y sin archivar.
        await q(`
          INSERT INTO ${ARCHIVO}
            (empresa_id, fixed_expense_id, punto_de_venta_id_asignado, fila, created_at, updated_at)
          VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW())
        `, [
          a.empresa_id,
          a.fixed_expense_id,
          a.punto_de_venta_id,
          JSON.stringify(porId.get(a.fixed_expense_id)),
        ]);

        // El `AND punto_de_venta_id IS NULL` es la última red: un plan mal
        // armado no puede mover una fila que ya estaba asignada. No sustituye al
        // plan, lo acota — y es lo que hace que el gasto que ya tenía sucursal
        // siga donde estaba aunque alguien rompa `planificarAsignaciones`.
        await q(
          'UPDATE fixed_expenses SET punto_de_venta_id = $1, updated_at = NOW() '
          + 'WHERE id = $2 AND punto_de_venta_id IS NULL',
          [a.punto_de_venta_id, a.fixed_expense_id]
        );
      }

      // ════════ Paso 4 · La verificación, adentro de la transacción ════════
      //
      // «Ningún total se movió», ejecutado en vez de prometido. Esta migración
      // escribe una columna: no puede crear filas, ni borrarlas, ni cambiar un
      // importe. Si alguna de las tres cosas pasó, no hay commit.
      const [descuadre] = await filasDe(`
        SELECT count(*)::int AS n
          FROM control_gastos_fijos a
          FULL OUTER JOIN (
                 SELECT empresa_id, SUM(amount)::numeric AS total, count(*)::int AS n
                   FROM fixed_expenses
                  GROUP BY 1
               ) b
            ON b.empresa_id = a.empresa_id
         WHERE a.empresa_id IS NULL
            OR b.empresa_id IS NULL
            OR a.total <> b.total
            OR a.n <> b.n
      `);

      if (descuadre.n > 0) {
        throw new Error(
          `Asignar la sucursal cambió el total de gastos fijos de ${descuadre.n} empresa(s), o `
          + 'hizo aparecer o desaparecer filas. Esta migración solo puede escribir una columna: '
          + 'si el total se movió, algo más se tocó. No se aplicó nada.'
        );
      }

      // ════════ Paso 5 · El informe ════════
      //
      // Va al final y no al principio: si cualquier paso de arriba falla, no se
      // aplica nada, y un informe que dice «moví 9 gastos» arriba del error que
      // revirtió todo es peor que no decir nada.
      informar(plan);
    });
  },

  async down(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async (transaction) => {
      const q = (sql, bind) => sequelize.query(sql, bind ? { transaction, bind } : { transaction });
      const filasDe = async (sql, bind) => (await q(sql, bind))[0];

      const [existe] = await filasDe(`SELECT to_regclass('public.${ARCHIVO}') IS NOT NULL AS hay`);

      if (!existe.hay) {
        // El `up` la crea siempre, así que llegar acá significa que alguien la
        // borró a mano. **No se pone nada en NULL a lo bruto**: sin el archivo
        // no hay forma de distinguir un gasto que esta migración movió de uno
        // que el usuario asignó él mismo, y adivinar le desarmaría el agrupado.
        console.log(
          `[fixed_expenses] No existe ${ARCHIVO}: no hay con qué saber qué gastos movió esta `
          + 'migración, así que no se tocó ninguno. Los que haya que devolver a «General» se '
          + 'reasignan a mano desde la pantalla de Gastos.'
        );
        return;
      }

      // Se restaura **lo que la fila tenía**, no un `NULL` escrito a mano: el
      // archivo es la fuente de verdad de esta reversión, y leerlo de ahí es lo
      // que hace que un `up` que moviera algo sin archivarlo se note —esa fila
      // se queda asignada y `scripts/verificar-reversibilidad.js` reporta la
      // diferencia de datos—.
      //
      // `updated_at` vuelve también: una fila que vuelve con otra fecha de
      // modificación no es la misma fila.
      await q(`
        UPDATE fixed_expenses fe
           SET punto_de_venta_id = (d.fila->>'punto_de_venta_id')::int,
               updated_at        = (d.fila->>'updated_at')::timestamptz
          FROM ${ARCHIVO} d
         WHERE d.fixed_expense_id = fe.id
      `);

      await q(`DROP TABLE IF EXISTS ${ARCHIVO}`);
    });
  },
};
