'use strict';

/**
 * ════════════════════════════════════════════
 *  suscripciones.aviso_vencimiento_enviado
 * ════════════════════════════════════════════
 *
 * ── El defecto, medido ──
 *
 * `subscriptionCron.avisarVencimientosProximos` busca los trials que vencen
 * dentro de una ventana y les manda un correo. La ventana se calcula contra
 * `ahora`:
 *
 *     desde = ahora + (dias - 1) * 24h
 *     hasta = ahora + dias * 24h
 *
 * Un trial que vence en T entra en la ventana mientras `ahora` va de `T - 5d`
 * a `T - 4d`, o sea **durante veinticuatro horas seguidas**. Y `tick()` corre
 * cada hora (`CHECK_INTERVAL_MS`), sin llevar ningún registro de qué ya avisó.
 *
 * Resultado: **hasta veinticuatro correos idénticos por empresa y por ventana**,
 * mientras el servicio esté despierto. Con las cuatro suscripciones que hay hoy
 * —las cuatro vencen el 29 y el 30 de agosto de 2026, o sea que cruzan la
 * ventana de cinco días alrededor del 24— eso es del orden de cien correos en
 * un día, todos diciendo lo mismo.
 *
 * ⚠ El comentario que ya estaba en `subscriptionCron.js` describía esto como
 * «puede repetirse dentro del mismo día si el proceso reinicia». **Subestima el
 * síntoma**: no hace falta ningún reinicio, se repite en cada tick.
 *
 * Nunca se vio porque hasta ahora ningún trial cruzó una ventana de aviso con
 * el servicio despierto, y porque el cron externo que lo dispara estuvo
 * fallando desde que se creó: diecisiete corridas, cero exitosas, hasta que se
 * configuraron `API_URL` y `CRON_SECRET`.
 *
 * ── Por qué un entero y no un booleano ──
 *
 * Hay dos avisos —`DIAS_DE_AVISO = [5, 1]`— y el segundo tiene que salir
 * aunque el primero ya haya salido. Un booleano los confunde: o se manda todo
 * dos veces, o el aviso de «te queda un día» no sale nunca.
 *
 * La columna guarda **el aviso más chico que ya se envió**, en días. El cron
 * manda el de `dias` sólo si la columna es `NULL` o mayor que `dias`. Con
 * `[5, 1]` la secuencia es NULL → 5 → 1, y ninguno se repite.
 *
 * El nombre no se inventa acá: lo eligió el comentario de
 * `subscriptionCron.js` cuando escribió «se marca en el registro con
 * `aviso_vencimiento_enviado`. Como esa columna no existe todavía…».
 *
 * ── `NULL` para todas las filas existentes ──
 *
 * Nace en `NULL`, que significa «a esta no se le avisó nada». Es lo correcto:
 * ninguna de las suscripciones de hoy recibió un aviso, porque el cron no
 * corría. Poner un valor las dejaría sin el aviso que sí les corresponde.
 *
 * ── El `down` no pierde nada que importe ──
 *
 * Se pierde qué aviso se mandó. La consecuencia de revertir es que un cliente
 * reciba un correo repetido, no que se pierda un dato del negocio. No hace
 * falta tabla de archivo.
 */

module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async (transaction) => {
      const q = (sql) => sequelize.query(sql, { transaction });

      await q(`
        ALTER TABLE suscripciones
        ADD COLUMN IF NOT EXISTS aviso_vencimiento_enviado INTEGER
      `);

      // La promesa de esta migración, verificada adentro de la misma
      // transacción: NINGUNA suscripción queda marcada. Si alguien le pusiera
      // un `DEFAULT` al `ADD COLUMN`, el error no se vería en ninguna pantalla
      // —se vería el día que a un cliente no le llega el aviso que esperaba—.
      const [filas] = await sequelize.query(
        'SELECT COUNT(*)::int AS n FROM suscripciones WHERE aviso_vencimiento_enviado IS NOT NULL',
        { transaction }
      );

      const marcadas = filas[0]?.n ?? 0;

      if (marcadas !== 0) {
        throw new Error(
          `[suscripciones.aviso_vencimiento_enviado] La migración terminó con ${marcadas} `
          + 'suscripciones marcadas, y tiene que terminar con cero: la columna nace vacía '
          + 'para todas.\n\nSi alguien le puso un DEFAULT al ADD COLUMN, ese es el motivo. '
          + 'No se aplicó nada.'
        );
      }

      console.log('[suscripciones.aviso_vencimiento_enviado] Columna creada, vacía para las que ya existían.');
    });
  },

  async down(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async (transaction) => {
      const [filas] = await sequelize.query(
        'SELECT COUNT(*)::int AS n FROM suscripciones WHERE aviso_vencimiento_enviado IS NOT NULL',
        { transaction }
      );

      const marcadas = filas[0]?.n ?? 0;

      if (marcadas > 0) {
        console.log(
          `[suscripciones.aviso_vencimiento_enviado] Se pierde el rastro de ${marcadas} avisos ya `
          + 'enviados. La consecuencia es un correo repetido, no un dato de negocio perdido.'
        );
      }

      await sequelize.query(
        'ALTER TABLE suscripciones DROP COLUMN IF EXISTS aviso_vencimiento_enviado',
        { transaction }
      );
    });
  },
};
