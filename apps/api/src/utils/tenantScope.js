// ════════════════════════════════════════════
//  ADMINAPP · Scoping por empresa
//
//  AdminApp es multi-empresa: todas las empresas cliente comparten base de
//  datos y se separan por la columna empresa_id. Si una consulta se olvida de
//  filtrar por empresa_id, una empresa ve los datos de otra.
//
//  Estos helpers existen para que el filtro sea dificil de olvidar y facil de
//  auditar. La regla de oro en rutas y services:
//
//      NUNCA usar Model.findByPk(idQueVinoDelCliente)
//
//  findByPk busca por clave primaria y nada mas: ignora empresa_id por
//  definicion. Usar findScoped en su lugar.
// ════════════════════════════════════════════

/**
 * Busca un registro por id, restringido a una empresa.
 *
 * Reemplaza a Model.findByPk(id) en cualquier caso donde el id venga del
 * cliente (params, query o body).
 *
 * @param {import('sequelize').ModelStatic<any>} Model
 * @param {number|string} id
 * @param {number} empresaId
 * @param {object} [options] Opciones extra de Sequelize (include, transaction, attributes).
 * @returns {Promise<any|null>} El registro, o null si no existe o es de otra empresa.
 */
async function findScoped(Model, id, empresaId, options = {}) {
  assertEmpresaId(empresaId);

  const parsedId = typeof id === 'string' ? parseInt(id, 10) : id;
  if (!Number.isInteger(parsedId)) return null;

  return Model.findOne({
    ...options,
    where: { ...(options.where || {}), id: parsedId, empresa_id: empresaId },
  });
}

/**
 * Igual que findScoped pero lanza un error tipado si no encuentra nada.
 *
 * El error lleva status 404 y no 403 a proposito: responder 403 confirmaria
 * que el recurso existe en otra empresa, lo que permite enumerar ids ajenos.
 * Un 404 no distingue "no existe" de "no es tuyo".
 *
 * @throws {Error & { status: number }}
 */
async function findScopedOrFail(Model, id, empresaId, options = {}) {
  const registro = await findScoped(Model, id, empresaId, options);

  if (!registro) {
    const err = new Error('Recurso no encontrado');
    err.status = 404;
    throw err;
  }

  return registro;
}

/**
 * Fusiona un where con el filtro de empresa.
 *
 * Para consultas de listado, donde no hay un id puntual.
 *
 * @example
 *   Product.findAll({ where: scoped({ is_active: true }, req.empresaId) })
 */
function scoped(where = {}, empresaId) {
  assertEmpresaId(empresaId);
  return { ...where, empresa_id: empresaId };
}

/**
 * Falla ruidosamente si el empresaId no es utilizable.
 *
 * El patron viejo era `req.empresaId || 1`, que ante un contexto no resuelto
 * caia silenciosamente sobre la empresa 1 — un cliente real en produccion.
 * Preferimos romper el request antes que tocar los datos de otra empresa.
 */
function assertEmpresaId(empresaId) {
  if (!Number.isInteger(empresaId) || empresaId <= 0) {
    const err = new Error(
      `Scoping por empresa invalido: se recibio ${JSON.stringify(empresaId)}. ` +
      'Falta el middleware requireEmpresa en esta ruta.'
    );
    err.status = 500;
    throw err;
  }
}

module.exports = { findScoped, findScopedOrFail, scoped, assertEmpresaId };
