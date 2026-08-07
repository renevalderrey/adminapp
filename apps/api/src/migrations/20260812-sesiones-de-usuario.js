'use strict';

/**
 * ════════════════════════════════════════════
 *  `sesiones`: una fila por (usuario, dispositivo)
 *  Migración 24 — corte 8 de `docs/specs/014-panel-gastos-equipo-afip`
 * ════════════════════════════════════════════
 *
 * ── Qué compra, y qué NO ──
 *
 * El pedido original decía «sesiones activas o último acceso por usuario, que es
 * más simple y cubre el 90 % del caso». No lo cubre: **el último acceso no
 * permite cerrar una sesión**, y cerrar es la mitad de lo que el legacy tenía
 * (`legacy:10064-10088`, «Cerrar» por fila y «Cerrar todas menos yo»).
 *
 * Lo que esta tabla permite es ver desde qué dispositivos entró cada miembro y
 * cerrar uno. Lo que **no** permite —y está escrito acá porque alguien lo va a
 * leer al revés— es revocar un token: sin la Management API de Auth0 eso no se
 * puede hacer desde acá. Cerrar una sesión corta al navegador que **coopera**:
 * recibe 401, borra su identificador y sale. El corte de verdad sigue siendo
 * `usuario_empresas.is_active = false`, que `loadEmpresaContext` relee en cada
 * request y ya funcionaba antes de este hito.
 *
 * ── ⚠ NO tiene `empresa_id`, y es una decisión ──
 *
 * Una sesión es de un **dispositivo de una persona**, y esa persona puede
 * cambiar de empresa con el selector sin cerrar nada. Poner `empresa_id`
 * obligaría a elegir cuál —¿la de cuando entró?— y la columna quedaría mintiendo
 * apenas alguien use el selector. Peor: duplicar el dato invita a filtrar por él
 * y olvidarse de la membresía, que es la que manda.
 *
 * El aislamiento sale de `usuario_empresas`, encapsulado en
 * `sesionesDeLaEmpresa(empresaId)`: una sesión de alguien que no es miembro
 * activo de la empresa da cero filas y **404**, igual que `findScoped`.
 *
 * Consecuencia que la pantalla tiene que decir con esas palabras: cerrar una
 * sesión la cierra en **todas** las empresas a las que esa persona tenga acceso.
 *
 * ── Por qué `dispositivo` es un UUID del cliente y no el hash del token ──
 *
 * El hash del access token sería infalsificable, y no sirve: Auth0 lo rota cada
 * pocas horas. Cada rotación abriría una «sesión» nueva, la lista mostraría siete
 * filas del mismo navegador, y cerrar una no serviría porque la rotación
 * siguiente vuelve a entrar. El UUID lo genera el navegador una vez, vive en
 * `localStorage` y viaja en `X-Sesion-Id`.
 *
 * `VARCHAR(64)` y no `UUID`: lo elige el cliente y el servidor no lo interpreta.
 * Declararlo `UUID` haría que un valor cualquiera —el de un cliente viejo, el de
 * una herramienta— reviente el `INSERT` con un error de tipo en el camino de
 * TODOS los requests, en vez de quedar guardado como el texto opaco que es.
 *
 * ── El único índice, que es el mecanismo y no una optimización ──
 *
 * `UNIQUE (usuario_id, dispositivo)` es el índice del camino caliente —el
 * middleware busca por ahí en cada request— **y** es lo que hace idempotente el
 * alta: el Panel dispara varios requests al montar y los dos primeros entran por
 * «esta sesión no existe». Sin el único, dos filas para el mismo navegador; y
 * cerrar una dejaría la otra abierta.
 *
 * **No se crean** los otros dos que uno tendería a poner:
 *
 *  - `(usuario_id)` a secas: lo cubre el único por prefijo.
 *  - `(vista_en)`: no lo usa ninguna consulta de hoy. Un índice sin lector es
 *    peso de escritura en la tabla que más se escribe del sistema. El día que
 *    haya que barrer sesiones viejas
 *    (`DELETE … WHERE vista_en < NOW() - INTERVAL '180 days'`) se agrega con su
 *    consulta al lado.
 *
 * ── Las dos claves foráneas, con borrados distintos ──
 *
 * `usuario_id` va `ON DELETE CASCADE`: sin la persona, sus sesiones no
 * significan nada. `cerrada_por` va `ON DELETE SET NULL`: la sesión cerrada tiene
 * que seguir existiendo aunque quien la cerró se haya ido — «me cerraron la
 * sesión» necesita respuesta, y perder el autor no puede borrar el hecho.
 *
 * ── Reversibilidad ──
 *
 * `DROP TABLE sesiones`, sin ambigüedad: la tabla nace acá y nada más depende de
 * ella. Revertirla deja a todos los navegadores abriendo una sesión nueva en su
 * próximo request, que es exactamente el estado de antes del deploy.
 *
 * SQL crudo y una sola transacción, con el molde de
 * `20260811-tiendanube-catalogo-pedidos-y-corridas.js`: sin modelos de Sequelize,
 * porque un modelo describe el esquema de HOY y una migración corre contra el de
 * ayer.
 */

/** La tabla que nace acá. El `down` la borra. */
const TABLA = 'sesiones';

/**
 * Los índices, con el mismo `name` que declara `models/Sesion.js`.
 *
 * Sequelize lo llamaría `sesiones_usuario_id_dispositivo`, y sobre una base
 * creada por migraciones un `sync({ alter: true })` de desarrollo crearía un
 * **segundo** índice sobre las mismas columnas. Es el mismo cuidado que documenta
 * `20260808-indices-de-empresa-en-proveedores.js`.
 */
const INDICES = [
  {
    nombre: 'uq_sesion_dispositivo',
    tabla: TABLA,
    columnas: 'usuario_id, dispositivo',
    unico: true,
  },
];

module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;

    await sequelize.transaction(async (transaction) => {
      const q = (sql) => sequelize.query(sql, { transaction });

      await q(`
        CREATE TABLE IF NOT EXISTS ${TABLA} (
          id           SERIAL      PRIMARY KEY,
          usuario_id   INTEGER     NOT NULL
                                   REFERENCES usuarios(id) ON UPDATE CASCADE ON DELETE CASCADE,
          dispositivo  VARCHAR(64) NOT NULL,
          user_agent   TEXT,
          ip           VARCHAR(45),
          iniciada_en  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          vista_en     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          cerrada_en   TIMESTAMPTZ,
          cerrada_por  INTEGER     REFERENCES usuarios(id) ON UPDATE CASCADE ON DELETE SET NULL,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      for (const { nombre, tabla, columnas, unico } of INDICES) {
        await q(
          `CREATE ${unico ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${nombre} ON ${tabla} (${columnas})`
        );
      }
    });
  },

  async down(queryInterface) {
    const { sequelize } = queryInterface;

    // Revertir esto no pierde nada que no se reconstruya solo: cada navegador
    // vuelve a abrir su fila en el request siguiente. Lo que sí desaparece es la
    // marca de las sesiones que alguien cerró a mano — y ése es justamente el
    // estado al que se vuelve: sin la tabla, `registrarSesion` no corre.
    //
    // Los índices se van con la tabla; no hace falta borrarlos aparte.
    await sequelize.query(`DROP TABLE IF EXISTS ${TABLA}`);
  },

  // Lo que compara `src/tests/reversibilidadDeMigraciones.test.js` contra el
  // modelo: el UNIQUE es el que arbitra la carrera del alta, y una guardia que
  // no lo mire dejaría pasar un `CREATE INDEX` sin `UNIQUE` sin que nada avise.
  INDICES,
  TABLA,
};
