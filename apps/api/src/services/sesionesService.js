// ════════════════════════════════════════════
//  ADMINAPP · Sesiones: registrar, listar y cerrar
//
//  ── ⚠ El aislamiento NO sale de una columna, sale de la membresía ──
//
//  `sesiones` no tiene `empresa_id` (decisión 3 de la 014): una sesión es de un
//  **dispositivo de una persona**, y esa persona puede cambiar de empresa con el
//  selector sin cerrar nada. Poner la columna obligaría a elegir cuál —¿la de
//  cuando entró?— y quedaría mintiendo apenas use el selector.
//
//  Entonces el filtro es
//  `usuario_id IN (SELECT usuario_id FROM usuario_empresas WHERE empresa_id = :id
//  AND is_active = true)`, y vive **acá y en un solo lugar** (`idsDeMiembros`).
//  Una sesión de alguien que no es miembro activo da cero filas y el endpoint
//  responde **404**, igual que `findScoped` con un recurso ajeno.
//
//  Que el filtro esté encapsulado es la mitad de la decisión: repartido por los
//  tres endpoints, el cuarto se olvida de ponerlo.
//
//  ── Consecuencia que la pantalla dice con esas palabras ──
//
//  Cerrar una sesión la cierra en **todas** las empresas a las que esa persona
//  tenga acceso. No hay forma de cerrarla «solo en esta empresa» porque no es una
//  sesión de esta empresa.
// ════════════════════════════════════════════

const { Op } = require('sequelize');
const { Sesion, Usuario, UsuarioEmpresa } = require('../models');
const { assertEmpresaId, normalizarId } = require('../utils/tenantScope');
const { ErrorDeNegocio } = require('../utils/errores');
const logger = require('../utils/logger');

/**
 * Cada cuánto se refresca `vista_en` (FR-124).
 *
 * Sin esta ventana, **cada request sería una escritura**: el Panel dispara varios
 * al montar y una caja hace decenas por venta. Con cinco minutos, «último acceso»
 * sigue siendo útil —nadie mira ese dato con precisión de segundos— y la tabla
 * que más se lee deja de ser también la que más se escribe.
 */
const VENTANA_DE_VISTA_MS = 5 * 60 * 1000;

/**
 * Los `usuario_id` de los miembros **activos** de una empresa.
 *
 * Se resuelve con una consulta propia y no con un `literal` interpolado: el
 * `empresaId` sale del contexto del request, pero un `sequelize.literal` con una
 * variable adentro es exactamente la forma que un día alguien copia con un valor
 * del cliente. Dos consultas simples valen más que una que hay que auditar.
 *
 * ⚠ Esto no está en el camino caliente: `registrar` no lo llama. Solo lo usan el
 * listado y el cierre, que son acciones de una pantalla.
 */
async function idsDeMiembros(empresaId) {
  assertEmpresaId(empresaId);

  const filas = await UsuarioEmpresa.findAll({
    where: { empresa_id: empresaId, is_active: true },
    attributes: ['usuario_id'],
  });

  return filas.map((f) => f.usuario_id);
}

/**
 * Deja registrado que este dispositivo pidió datos, y dice si puede seguir.
 *
 * Es lo que corre en **todos** los requests con token. El costo tiene que ser
 * exactamente un `SELECT` sobre `uq_sesion_dispositivo` en el caso normal, y
 * está medido con `capturarConsultas` en
 * `tests/integracion/sesiones.integracion.test.js`.
 *
 * ── Por qué NO se usa `findOrCreate` ──
 *
 * `findOrCreate` de Sequelize abre una transacción propia cuando no se le pasa
 * una: son un `BEGIN`, el `SELECT`, y un `COMMIT` — **cuatro viajes en el caso
 * que ya existe**, que es el 99,99 % de los requests. El plan compró «+1
 * consulta», no «+4». Acá el camino normal es un `findOne` pelado y la carrera la
 * arbitra el índice único, con el mismo molde que la idempotencia de
 * `POST /api/sales` (`routes/sales.js:610`) y la del webhook de TiendaNube.
 *
 * @returns {Promise<{sesion: object|null, cerrada: boolean}>} `cerrada` es la
 *   única respuesta que corta el request: alguien apretó «cerrar sesión en ese
 *   dispositivo» desde la pantalla de Equipo.
 */
async function registrar({ usuarioId, dispositivo, userAgent = null, ip = null }) {
  if (!usuarioId || !dispositivo) return { sesion: null, cerrada: false };

  const existente = await Sesion.findOne({ where: { usuario_id: usuarioId, dispositivo } });

  if (existente) {
    if (existente.cerrada_en) return { sesion: existente, cerrada: true };

    const desdeLaUltimaVista = Date.now() - new Date(existente.vista_en).getTime();

    if (desdeLaUltimaVista > VENTANA_DE_VISTA_MS) {
      await existente.update({ vista_en: new Date() });
    }

    return { sesion: existente, cerrada: false };
  }

  try {
    const creada = await Sesion.create({
      usuario_id: usuarioId,
      dispositivo,
      user_agent: userAgent,
      ip,
    });

    return { sesion: creada, cerrada: false };
  } catch (err) {
    // ── La mitad que sostiene la garantía ──
    //
    // El `findOne` de arriba NO es atómico: el Panel dispara varios requests al
    // montar y los primeros dos del mismo navegador pasan los dos por «no
    // existe». El que pierde choca contra `uq_sesion_dispositivo`.
    //
    // Se **relee** en vez de confiar en el nombre del constraint: si el choque
    // hubiera sido por otra cosa, no se encuentra nada y el error sale como
    // cualquier otro. Cuando el que perdió llega hasta acá, el que ganó ya
    // commiteó —Postgres lo hizo esperar en el índice—, así que la fila está.
    //
    // Sin este catch, el segundo request del arranque responde 500 con el error
    // del driver. **Un test secuencial no toca esta rama nunca.**
    if (err.name !== 'SequelizeUniqueConstraintError') throw err;

    const yaCreada = await Sesion.findOne({ where: { usuario_id: usuarioId, dispositivo } });

    if (!yaCreada) throw err;

    // Este log es lo ÚNICO que distingue desde afuera «lo frenó el índice único»
    // de «lo frenó el findOne»: las dos ramas devuelven lo mismo. El test de
    // integración lo espía, igual que el de la idempotencia de ventas.
    logger.info(
      { usuarioId, dispositivo },
      'sesiones: dos requests del mismo dispositivo a la vez, lo frenó la restricción única'
    );

    return { sesion: yaCreada, cerrada: Boolean(yaCreada.cerrada_en) };
  }
}

/**
 * Las sesiones **abiertas** de los miembros activos de una empresa.
 *
 * Las cerradas no se listan: una lista de sesiones muertas no contesta ninguna
 * pregunta y solo hace más difícil encontrar la notebook que quedó abierta.
 */
async function sesionesDeLaEmpresa(empresaId) {
  const ids = await idsDeMiembros(empresaId);

  if (!ids.length) return [];

  return Sesion.findAll({
    where: { usuario_id: { [Op.in]: ids }, cerrada_en: null },
    include: [{ model: Usuario, as: 'usuario', attributes: ['id', 'nombre', 'email'] }],
    // Por último acceso, con el id como desempate: sin él, dos sesiones vistas
    // en el mismo minuto pueden salir en orden distinto en cada carga y la lista
    // «se mueve sola».
    order: [['vista_en', 'DESC'], ['id', 'DESC']],
  });
}

/**
 * Cierra una sesión ajena. Devuelve `null` si no es de la empresa → **404**.
 *
 * Los tres argumentos son ids y van en un objeto a propósito: posicionales, tres
 * enteros seguidos se pueden intercambiar sin que nada falle, y el que se
 * intercambiaría es justamente el que decide si esta sesión se puede tocar.
 */
async function cerrar({ id, empresaId, porUsuarioId }) {
  const idSesion = normalizarId(Sesion, id);

  // Un id que no es un entero se corta acá: mandarlo a Postgres tira un error de
  // casteo, que el handler responde como un 500 cuando la respuesta correcta es
  // la misma que para una sesión ajena.
  if (idSesion === null) return null;

  const ids = await idsDeMiembros(empresaId);

  if (!ids.length) return null;

  const sesion = await Sesion.findOne({
    where: { id: idSesion, usuario_id: { [Op.in]: ids } },
  });

  if (!sesion) return null;

  // Cerrar una sesión ya cerrada no es un error: dos personas pueden apretar el
  // botón a la vez, o alguien puede recargar. Se devuelve la fila como está para
  // no pisar quién la cerró de verdad.
  if (sesion.cerrada_en) return sesion;

  await sesion.update({ cerrada_en: new Date(), cerrada_por: porUsuarioId || null });

  return sesion;
}

/**
 * «Cerrar todas menos ésta», de las **propias**.
 *
 * ⚠ Nunca cierra la del dispositivo que hace el pedido: si la cerrara, la
 * respuesta llegaría a un navegador que en su próximo request recibe 401 y vuelve
 * al login. El botón dice «todas menos ésta» y tiene que ser cierto.
 *
 * @returns {Promise<number>} Cuántas se cerraron.
 */
async function cerrarLasDemas({ usuarioId, dispositivoActual }) {
  if (!usuarioId) return 0;

  // Sin saber cuál es «ésta» no se puede cumplir «menos ésta», y hacerlo igual
  // dejaría a quien apretó el botón afuera de su propia sesión. Es un
  // ErrorDeNegocio y no un 500: el mensaje es la respuesta útil.
  if (!dispositivoActual) {
    throw new ErrorDeNegocio(
      'No se puede cerrar «todas menos ésta» sin saber cuál es ésta. ' +
      'Recargá la página e intentá de nuevo.'
    );
  }

  const [cerradas] = await Sesion.update(
    { cerrada_en: new Date(), cerrada_por: usuarioId },
    {
      where: {
        usuario_id: usuarioId,
        cerrada_en: null,
        dispositivo: { [Op.ne]: dispositivoActual },
      },
    }
  );

  return cerradas;
}

module.exports = {
  registrar,
  sesionesDeLaEmpresa,
  cerrar,
  cerrarLasDemas,
  idsDeMiembros,
  VENTANA_DE_VISTA_MS,
};
