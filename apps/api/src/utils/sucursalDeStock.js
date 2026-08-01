// ════════════════════════════════════════════
//  ADMINAPP · Que sucursal le toca a una fila de stock
//
//  Hoy hay diez lugares que escriben en `stock` y cada uno decide la sucursal
//  a su manera: uno mira la cabecera, otro el `location` del cuerpo, otro cae
//  al string 'principal' —que en las empresas sembradas por
//  seedPuntosDeVenta, cuyos codigos son general/ortiz/mayo, no coincide con
//  nada—. El resultado son filas con `punto_de_venta_id` en null que la
//  pantalla no sabe de que sucursal son, y filas duplicadas del mismo
//  producto en la misma sucursal escritas por dos caminos distintos.
//
//  Esta es la unica funcion que contesta esa pregunta (FR-049). El orden es
//  siempre el mismo: el id recibido, el codigo recibido, el por defecto de la
//  empresa.
//
//  Dos cosas que la hacen distinta de lo que habia:
//
//   - Un `punto_de_venta_id` que no es de la empresa **no resuelve**: es la
//     diferencia entre validar y confiar.
//   - Un `code` que no existe **tira ErrorDeNegocio con los codigos validos
//     en el mensaje**, no cae al por defecto (FR-050). Inventar una sucursal
//     es como se cargo stock en lugares que no existen.
//
//  Los modelos se requieren adentro de cada funcion a proposito: asi este
//  modulo se puede cargar sin base de datos, que es lo que necesitan el
//  script de informe y las funciones puras que lo consumen.
// ════════════════════════════════════════════

const { findScoped, assertEmpresaId } = require('./tenantScope');
const { ErrorDeNegocio } = require('./errores');

/** `location` es VARCHAR(30) y `puntos_de_venta.name` es VARCHAR(100). */
const LARGO_LOCATION = 30;

/** El codigo del punto de venta que crea POST /api/empresas (empresas.js:113). */
const CODE_PRINCIPAL = 'principal';

/**
 * Elige el punto de venta por defecto entre los que ya se leyeron.
 *
 * Los tres escalones, en orden (FR-044 mas el que le falta):
 *
 *  1. el de `code = 'principal'`, que es el que crea POST /api/empresas;
 *  2. el **activo** de menor id;
 *  3. el de menor id, activo o no.
 *
 * El tercero no esta en FR-044 y hace falta: una empresa que cerro todos sus
 * locales y todavia tiene stock cargado no tiene ningun activo, y sin este
 * escalon se quedaria sin destino justo en el caso en que hay mercaderia que
 * rescatar.
 *
 * Es una funcion aparte —y pura— porque la usan tres consumidores con las
 * filas ya leidas: la resolucion de sucursal, el plan de consolidacion y el
 * script de informe. Ordenar en SQL dejaria la regla escrita en tres lugares.
 *
 * @param {object[]} puntosDeVenta Todos los de UNA empresa.
 * @returns {object|null}
 */
function elegirPorDefecto(puntosDeVenta = []) {
  const puntos = [...puntosDeVenta].sort((a, b) => Number(a.id) - Number(b.id));

  const principal = puntos.find((pv) => pv.code === CODE_PRINCIPAL);
  if (principal) return principal;

  const activo = puntos.find((pv) => pv.is_active);
  if (activo) return activo;

  return puntos[0] || null;
}

/**
 * El punto de venta por defecto de la empresa, leido de la base.
 *
 * @param {number} empresaId
 * @param {{transaction?: object}} [opciones]
 * @returns {Promise<object>}
 * @throws {ErrorDeNegocio} si la empresa no tiene ninguno.
 */
async function sucursalPorDefecto(empresaId, { transaction } = {}) {
  assertEmpresaId(empresaId);

  const { PuntoDeVenta } = require('../models');

  // Se leen todos y se elige en JS: son un punado por empresa, y la regla de
  // los tres escalones queda en un solo lugar testeable.
  const puntos = await PuntoDeVenta.findAll({
    where: { empresa_id: empresaId },
    transaction,
  });

  const elegido = elegirPorDefecto(puntos);

  if (!elegido) {
    throw new ErrorDeNegocio(
      'La empresa no tiene ninguna sucursal cargada. Hay que crear al menos una ' +
      'antes de poder cargar stock.'
    );
  }

  return elegido;
}

/**
 * Resuelve la sucursal de una escritura de stock.
 *
 * @param {object} opciones
 * @param {number} opciones.empresaId
 * @param {number|string} [opciones.puntoDeVentaId] El id recibido: manda.
 * @param {string} [opciones.code] El codigo recibido, si no vino el id.
 * @param {object} [opciones.transaction]
 * @returns {Promise<object>} El punto de venta. **Nunca null** (FR-052).
 * @throws {ErrorDeNegocio}
 */
async function resolverSucursal({ empresaId, puntoDeVentaId, code, transaction } = {}) {
  assertEmpresaId(empresaId);

  const { PuntoDeVenta } = require('../models');

  if (puntoDeVentaId !== null && puntoDeVentaId !== undefined && puntoDeVentaId !== '') {
    // findScoped y no findByPk: el id viene del cliente, y uno de otra empresa
    // tiene que no resolver en vez de mover mercaderia entre empresas.
    const porId = await findScoped(PuntoDeVenta, puntoDeVentaId, empresaId, { transaction });

    if (!porId) throw new ErrorDeNegocio('Punto de venta inválido');

    return porId;
  }

  const codigo = typeof code === 'string' ? code.trim() : '';

  if (codigo) {
    // Comparacion exacta y sensible a mayusculas, igual que
    // seedPuntosDeVenta.js:88 y stock.js:30. Cambiarla aca haria que la
    // escritura mapee distinto de como mapea la migracion, que es peor que
    // mapear poco.
    const porCode = await PuntoDeVenta.findOne({
      where: { empresa_id: empresaId, code: codigo },
      transaction,
    });

    if (!porCode) throw await errorDeCodigo(codigo, empresaId, transaction);

    return porCode;
  }

  return sucursalPorDefecto(empresaId, { transaction });
}

/**
 * El error de un codigo que no resuelve, con los que si existen.
 *
 * El mensaje es lo unico que hace arreglable el problema: despues de FR-050
 * una planilla que "funcionaba" puede informar trescientos errores de fila, y
 * "sucursal invalida" a secas no dice que poner (riesgo 3 del plan).
 */
async function errorDeCodigo(codigo, empresaId, transaction) {
  const { PuntoDeVenta } = require('../models');

  const puntos = await PuntoDeVenta.findAll({
    where: { empresa_id: empresaId },
    transaction,
  });

  const validos = puntos.map((pv) => pv.code).filter(Boolean);

  const detalle = validos.length
    ? `Códigos válidos: ${validos.join(', ')}.`
    : 'Ninguna sucursal de la empresa tiene código cargado.';

  return new ErrorDeNegocio(`La sucursal "${codigo}" no existe. ${detalle}`);
}

/**
 * El par que se escribe en una fila de stock.
 *
 * `location` queda como espejo del punto de venta (FR-041): lo escribe el
 * servidor, nunca el cliente. Se recorta a 30 porque la columna es
 * VARCHAR(30) y `name` es VARCHAR(100); el dato autoritativo es el id, asi
 * que recortar el espejo no pierde nada, y sin el recorte el INSERT de la
 * fila de stock falla (riesgo 4 del plan).
 *
 * @param {{id: number, code?: string|null, name?: string}} pv
 * @returns {{punto_de_venta_id: number, location: string}}
 */
function ubicacionDeStock(pv) {
  if (!pv || pv.id === null || pv.id === undefined) {
    // No es un ErrorDeNegocio: si llego aca sin punto de venta es un bug de
    // quien llama, no algo que el usuario pueda corregir.
    throw new Error('ubicacionDeStock necesita un punto de venta con id');
  }

  return {
    punto_de_venta_id: pv.id,
    location: String(pv.code || pv.name || '').slice(0, LARGO_LOCATION),
  };
}

module.exports = {
  CODE_PRINCIPAL,
  LARGO_LOCATION,
  elegirPorDefecto,
  sucursalPorDefecto,
  resolverSucursal,
  ubicacionDeStock,
};
