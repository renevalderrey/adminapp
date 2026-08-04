'use strict';

/**
 * ════════════════════════════════════════════
 *  El esquema de permisos, que ninguna migración creaba
 *  Migración 16, aditiva
 * ════════════════════════════════════════════
 *
 * ── El problema ──
 *
 * Cuatro tablas tenían modelo y ninguna migración las creaba: `roles`,
 * `permisos`, `rol_permisos` y `usuario_permisos`. Tampoco existía
 * `usuario_empresas.rol_id`, que es de donde sale el rol de cada persona en cada
 * empresa.
 *
 * Una base creada SOLO con migraciones arranca igual —el servidor levanta y
 * `/api/health` devuelve `ok`— pero `seedPermissions()` se cae contra el `catch`
 * que traga el error, `middleware/auth.js:196-212` deja `req.usuarioPermisos`
 * vacío, y `checkPermission` le niega todo a todos. Falla cerrado, que es lo
 * correcto, pero **nada señala la causa**: la aplicación deja entrar y después
 * ninguna acción funciona.
 *
 * Producción anda porque su base se creó con `sequelize.sync()` antes de que
 * existieran las migraciones. Lo que no se puede es **volver a crearla**: una
 * recuperación ante desastre, una réplica de staging o el entorno local de
 * cualquiera que empiece de cero.
 *
 * ── Por qué es segura sobre producción ──
 *
 * Producción YA tiene estas tablas, con datos reales adentro: los roles del
 * sistema, qué permiso tiene cada rol y los overrides por usuario. Esta
 * migración va a correr sobre ese esquema.
 *
 * Por eso todo es `IF NOT EXISTS` y no hay un solo `DROP`, `ALTER COLUMN` ni
 * `UPDATE`. Si la tabla está, la migración no la mira: no la modifica, no la
 * valida y no le toca una fila.
 *
 * ── Por qué el DDL está escrito a mano y no con `queryInterface.createTable` ──
 *
 * Porque la forma tiene que ser **idéntica** a la que dejó `sequelize.sync()` en
 * producción, hasta el nombre de las constraints. Se obtuvo corriendo
 * `sequelize.sync()` sobre una base limpia y volcando el DDL con `pg_dump`; lo
 * que sigue es esa salida, no una reconstrucción de memoria.
 *
 * Las diferencias que eso fija, y que un `createTable` de estilo repositorio
 * habría cambiado:
 *
 * - `created_at` / `updated_at` van **sin** `DEFAULT CURRENT_TIMESTAMP`. El
 *   resto de las migraciones sí se lo pone, pero producción —creada por sync—
 *   no lo tiene. Si una base recreada tuviera el default y producción no, las
 *   dos dejarían de ser la misma base, que es justo lo que esta migración viene
 *   a arreglar. Sequelize escribe las dos columnas en cada `INSERT`, así que el
 *   default no hace falta.
 * - Los nombres de las foreign keys son los que pone Postgres solo
 *   (`roles_empresa_id_fkey`), no los `_fk` que usa `20260531-initial-schema`.
 * - `permisos` y `rol_permisos` **no llevan timestamps**: los modelos declaran
 *   `timestamps: false`.
 * - No hay foreign key de `rol_permisos.permiso_codigo` ni de
 *   `usuario_permisos.permiso_codigo` hacia `permisos.codigo`. No es un olvido:
 *   `models/index.js` no declara esa asociación, así que producción tampoco la
 *   tiene, y agregarla acá haría que una base nueva rechazara filas que la base
 *   vieja acepta.
 *
 * ── Por qué NO siembra ──
 *
 * `seedPermissions()` corre en cada arranque del servidor (`server.js:416`),
 * después de las migraciones, y ya siembra el catálogo entero de permisos, los
 * cinco roles del sistema y sus `rol_permisos` con `findOrCreate` —o sea, es
 * idempotente y no pisa nada.
 *
 * Duplicar ese contenido acá tendría un costo concreto: el catálogo de permisos
 * cambia cada vez que se agrega una funcionalidad, y una migración es un
 * archivo congelado. El día que alguien sume `ventas.exportar` a la lista de
 * `seedPermissions.js`, esta migración quedaría vieja y la base estaría bien
 * solo porque además corrió el seed. Dos mecanismos para lo mismo, uno de ellos
 * siempre equivocado.
 *
 * **Consecuencia asumida**: `node scripts/migrar.js` a secas —CI, un
 * `npm run db:migrate` a mano, una restauración— deja las tablas creadas y
 * VACÍAS. Está bien: el esquema es lo que la migración tiene que garantizar, y
 * el primer arranque del servidor las llena. `fixMissingRolIds()` cierra el
 * hueco del medio: un usuario creado antes de ese primer arranque se queda con
 * `rol_id` en NULL y el seed se lo completa después.
 */

const TABLA_MEMBRESIAS = 'usuario_empresas';

/** Si `usuario_empresas` ya tiene una foreign key sobre `rol_id`. */
async function existeFkDeRol(queryInterface, transaction) {
  const [filas] = await queryInterface.sequelize.query(`
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
     WHERE c.contype = 'f'
       AND t.relname = '${TABLA_MEMBRESIAS}'
       AND a.attname = 'rol_id'
  `, { transaction });

  return filas.length > 0;
}

module.exports = {
  async up(queryInterface) {
    const q = (sql, transaction) => queryInterface.sequelize.query(sql, { transaction });

    await queryInterface.sequelize.transaction(async (transaction) => {
      // ── roles ──
      // `empresa_id` es NULL para los roles del sistema, que son de todas las
      // empresas. Por eso la FK va con ON DELETE SET NULL y no CASCADE: dar de
      // baja una empresa no puede llevarse puesto un rol compartido.
      await q(`
        CREATE TABLE IF NOT EXISTS roles (
          id          serial PRIMARY KEY,
          empresa_id  integer REFERENCES empresas(id) ON UPDATE CASCADE ON DELETE SET NULL,
          nombre      varchar(100) NOT NULL,
          is_system   boolean DEFAULT false,
          created_at  timestamp with time zone NOT NULL,
          updated_at  timestamp with time zone NOT NULL
        )
      `, transaction);

      await q('CREATE INDEX IF NOT EXISTS roles_empresa_id ON roles (empresa_id)', transaction);

      // ── permisos ──
      // El catálogo. La clave primaria es el código (`ventas.anular`), no un id:
      // así lo declara el modelo y así lo consultan `auth.js` y `empresas.js`,
      // que arman la lista de permisos con `attributes: ['codigo']`.
      await q(`
        CREATE TABLE IF NOT EXISTS permisos (
          codigo       varchar(100) PRIMARY KEY,
          nombre       varchar(200) NOT NULL,
          modulo       varchar(50) NOT NULL,
          descripcion  text
        )
      `, transaction);

      // ── rol_permisos ──
      // La combinación (rol, permiso) es la clave primaria: es lo que hace que
      // el `findOrCreate` de `seedPermissions.js:138` no pueda duplicar una
      // concesión al re-sembrar en cada arranque.
      await q(`
        CREATE TABLE IF NOT EXISTS rol_permisos (
          rol_id          integer NOT NULL REFERENCES roles(id) ON UPDATE CASCADE ON DELETE CASCADE,
          permiso_codigo  varchar(100) NOT NULL,
          PRIMARY KEY (rol_id, permiso_codigo)
        )
      `, transaction);

      // ── usuario_permisos ──
      // Los overrides por persona: `granted = true` suma un permiso que el rol
      // no da, `granted = false` le saca uno que sí da (`auth.js:213-219`).
      // `punto_de_venta_id` en NULL significa "en toda la empresa".
      await q(`
        CREATE TABLE IF NOT EXISTS usuario_permisos (
          id                  serial PRIMARY KEY,
          usuario_empresa_id  integer NOT NULL REFERENCES usuario_empresas(id) ON UPDATE CASCADE ON DELETE CASCADE,
          punto_de_venta_id   integer REFERENCES puntos_de_venta(id) ON UPDATE CASCADE ON DELETE SET NULL,
          permiso_codigo      varchar(100) NOT NULL,
          granted             boolean DEFAULT true NOT NULL,
          created_at          timestamp with time zone NOT NULL,
          updated_at          timestamp with time zone NOT NULL
        )
      `, transaction);

      // El único que declara el modelo con nombre propio (`uq_usuario_permisos`).
      // Se respeta el nombre porque es el que tiene producción: crearlo con otro
      // dejaría dos índices iguales sobre la misma tabla.
      await q(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_usuario_permisos
            ON usuario_permisos (usuario_empresa_id, punto_de_venta_id, permiso_codigo)
      `, transaction);

      // El de lectura: `auth.js` busca los overrides por `usuario_empresa_id` en
      // cada request.
      await q(`
        CREATE INDEX IF NOT EXISTS usuario_permisos_usuario_empresa_id
            ON usuario_permisos (usuario_empresa_id)
      `, transaction);

      // ── usuario_empresas.rol_id ──
      // La columna y la foreign key se agregan por separado a propósito: si una
      // base quedó a medio camino —la columna sí, la constraint no— el
      // `ADD COLUMN IF NOT EXISTS` la saltearía y la FK nunca aparecería.
      await q(`ALTER TABLE ${TABLA_MEMBRESIAS} ADD COLUMN IF NOT EXISTS rol_id integer`, transaction);

      if (!await existeFkDeRol(queryInterface, transaction)) {
        // SET NULL y no CASCADE: borrar un rol no puede borrar la membresía de
        // la persona. Se queda sin rol —y sin permisos, que es fallar cerrado—
        // hasta que alguien le asigne otro.
        await q(`
          ALTER TABLE ${TABLA_MEMBRESIAS}
            ADD CONSTRAINT ${TABLA_MEMBRESIAS}_rol_id_fkey
            FOREIGN KEY (rol_id) REFERENCES roles(id)
            ON UPDATE CASCADE ON DELETE SET NULL
        `, transaction);
      }
    });
  },

  /**
   * ── Esta migración no se puede revertir ──
   *
   * No es una omisión ni una excusa: es la respuesta honesta.
   *
   * En una base creada solo con migraciones, `down` significaría "borrar cuatro
   * tablas que acabo de crear vacías" y sería inofensivo. En producción —donde
   * las tablas existen desde antes de que esta migración existiera, porque las
   * creó `sequelize.sync()`— significaría **borrar el modelo de permisos entero
   * con sus datos**: qué puede hacer cada rol, los overrides por persona, y el
   * `rol_id` de cada membresía, que es de donde sale el rol de todo el mundo.
   * Después de ese `down` nadie puede hacer nada en el sistema, y no hay forma
   * de recuperarlo salvo un backup.
   *
   * Y la migración **no puede distinguir los dos casos**: cuando corre ya es
   * tarde para saber si encontró las tablas o las creó.
   *
   * Ante la duda, se elige no destruir. `npm run db:migrate:undo` deshace la
   * última migración aplicada —que apenas se despliegue esto va a ser ésta—, así
   * que un undo reflejo después de un deploy raro es exactamente el escenario
   * que hay que impedir.
   *
   * Si de verdad hace falta volver atrás sobre una base descartable, las cuatro
   * `DROP TABLE` y el `DROP COLUMN` se escriben a mano en diez segundos, con
   * alguien mirando.
   */
  async down() {
    throw new Error(
      'La migración del esquema de permisos no es reversible. En producción estas ' +
      'tablas existen desde antes (las creó sequelize.sync()) y contienen los roles, ' +
      'los permisos de cada rol y los overrides por usuario: un down las borraría y ' +
      'dejaría a todos los usuarios sin poder hacer nada. Si hace falta revertir sobre ' +
      'una base descartable, borrá a mano roles, permisos, rol_permisos, ' +
      'usuario_permisos y usuario_empresas.rol_id.'
    );
  },
};
