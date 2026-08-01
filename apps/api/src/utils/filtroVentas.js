// ════════════════════════════════════════════
//  ADMINAPP · El filtro del historial de ventas
//
//  Traduce los parametros de la query en el `where`, el orden y la paginacion
//  de la consulta. Es una funcion pura y esta separada de la ruta por dos
//  motivos:
//
//   1. Es lo unico de esta consulta que se puede testear sin una base. Los
//      dobles de los tests no entienden Op.between ni Op.iLike, asi que un
//      test de la ruta probaria el doble y no el sistema.
//
//   2. `empresa_id` NO lo pone esta funcion. Lo pone la ruta, con
//      scoped(where, req.empresaId). Garantizar que la ruta siempre lo agregue
//      es mas fuerte que confiar en que esta funcion no se lo olvide: si el
//      filtro creciera y alguien agregara un camino de salida temprano, el
//      scoping se perderia sin que nada avise.
//
//  El listado y el export usan el mismo filtro. Dos armadores separados que
//  hay que mantener sincronizados es como el archivo exportado termina
//  diciendo algo distinto de la pantalla.
// ════════════════════════════════════════════

const { Op } = require('sequelize');
const { ErrorDeNegocio } = require('./errores');

/** 25 filas por pagina, igual que Inventario. */
const FILAS_POR_PAGINA = 25;

/** Tope duro del `limit`: nadie puede pedir el listado entero por la puerta
 *  del listado. Para eso esta el endpoint de export, con su propio tope. */
const LIMITE_MAXIMO = 100;

/** afip_nro es INTEGER en la base. Un valor mayor hace que Postgres aborte la
 *  consulta con "value out of range", no que devuelva cero filas. */
const MAXIMO_ENTERO_POSTGRES = 2147483647;

/** El tipo de comprobante puede pedirse por su codigo de AFIP o como
 *  «las que no tienen comprobante fiscal». */
const TIPOS_VALIDOS = [1, 6, 11];
const SIN_COMPROBANTE = 'sin_cae';

/** Valor del filtro de sucursal que significa «no filtres por sucursal». */
const TODAS_LAS_SUCURSALES = 'todas';

/**
 * true si el texto es una fecha YYYY-MM-DD que existe de verdad.
 *
 * Hace falta porque el valor va directo a un Op.between contra una columna
 * DATEONLY: una fecha con formato raro no devuelve cero filas, hace que
 * Postgres aborte la consulta con un error de sintaxis que sale como 500.
 */
function esFecha(valor) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;

  const d = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valor;
}

/** Devuelve el valor solo si es una fecha usable; si no, undefined. */
function fechaONada(valor) {
  return esFecha(valor) ? valor : undefined;
}

/**
 * Resuelve el rango de fechas que se va a consultar.
 *
 * - Si falta uno de los dos extremos, se usa el otro: pedir «desde el 1» sin
 *   hasta es un dia, no medio año abierto.
 * - `date` es el parametro viejo, de cuando el listado era de un dia por vez.
 *   Se conserva como alias y equivale a desde = hasta = date. Si vienen
 *   desde/hasta, manda el rango.
 * - Si no viene nada, es hoy en la zona horaria de la empresa. El «hoy» lo
 *   calcula el servidor con fechaDelNegocio y llega como parametro: hacerlo en
 *   el navegador con toISOString() devuelve UTC y en Argentina, despues de las
 *   21:00, una venta recien cobrada no aparece en su propio listado.
 */
function resolverRango(query, hoy) {
  const desdePedido = fechaONada(query.desde);
  const hastaPedido = fechaONada(query.hasta);
  const alias = fechaONada(query.date);

  let desde = desdePedido || hastaPedido;
  let hasta = hastaPedido || desdePedido;

  if (!desde && !hasta && alias) {
    desde = alias;
    hasta = alias;
  }

  if (!desde || !hasta) {
    desde = hoy;
    hasta = hoy;
  }

  if (desde > hasta) {
    const err = new ErrorDeNegocio(
      `El rango está invertido: «desde» (${desde}) es posterior a «hasta» (${hasta}).`
    );
    err.codigo = 'RANGO_INVERTIDO';
    throw err;
  }

  // Un año es el tope. Sin el, un rango abierto hace un scan de todas las
  // ventas historicas de la empresa por cada busqueda, y la busqueda por CAE y
  // por nombre es un iLike '%…%' que no usa indice.
  const limite = new Date(`${desde}T00:00:00Z`);
  limite.setUTCFullYear(limite.getUTCFullYear() + 1);

  if (new Date(`${hasta}T00:00:00Z`) > limite) {
    const err = new ErrorDeNegocio(
      'El rango no puede ser mayor a un año. Acotá las fechas y volvé a consultar.'
    );
    err.codigo = 'RANGO_DEMASIADO_LARGO';
    throw err;
  }

  return { desde, hasta };
}

/**
 * El numero de comprobante que hay que buscar a partir de lo que se escribio.
 *
 * Un comprobante se dicta y se copia como «0005-00014882», que son dos cosas:
 * el punto de venta y el numero. La numeracion es correlativa POR punto de
 * venta, asi que lo que identifica es el segundo grupo. Se toma el ultimo
 * grupo de digitos y se le sacan los ceros de la izquierda.
 *
 * @returns {number|null} null si no hay nada que buscar por numero.
 */
function numeroDeComprobante(texto) {
  const grupos = String(texto || '').match(/\d+/g);
  if (!grupos) return null;

  const numero = parseInt(grupos[grupos.length - 1], 10);
  if (!Number.isInteger(numero)) return null;

  // Pegar un CAE de 14 digitos en el buscador es lo normal, y ese numero no
  // entra en un INTEGER: sin este corte, Postgres aborta la consulta y la
  // busqueda devuelve un 500 en vez de las filas que coinciden por CAE.
  if (numero > MAXIMO_ENTERO_POSTGRES) return null;

  return numero;
}

/**
 * Condiciones de la busqueda libre.
 *
 * Cubre numero de comprobante, CAE, el nombre libre escrito en la venta y el
 * nombre de la ficha del cliente. Los cuatro van en OR: el usuario escribe lo
 * que se acuerda, no elige por que campo busca.
 *
 * Es insensible a mayusculas (iLike) pero SENSIBLE a acentos: «Perez» no
 * encuentra «Pérez». Quitarlos exige la extension unaccent de Postgres, que
 * necesita permisos de superusuario en la base administrada. Queda afuera a
 * proposito.
 */
function condicionesDeBusqueda(q) {
  const texto = String(q || '').trim();
  if (!texto) return null;

  const patron = `%${texto}%`;

  const condiciones = [
    { afip_cae: { [Op.iLike]: patron } },
    { customer_name: { [Op.iLike]: patron } },
    // La ficha del cliente vive en otra tabla: el $…$ le dice a Sequelize que
    // es una columna del include y no un atributo de Sale.
    { '$customer.name$': { [Op.iLike]: patron } },
  ];

  const numero = numeroDeComprobante(texto);
  if (numero !== null) condiciones.push({ afip_nro: numero });

  return { [Op.or]: condiciones };
}

/**
 * Arma el filtro completo del historial.
 *
 * @param {object} query  req.query
 * @param {{ hoy: string, puntoDeVentaId?: number|null }} opciones
 *   `hoy` es la fecha del negocio, calculada por la ruta con fechaDelNegocio.
 *   `puntoDeVentaId` es la sucursal de la cabecera X-Punto-De-Venta-Id.
 * @returns {{ where: object, order: Array, limit: number, offset: number,
 *   page: number, rango: { desde: string, hasta: string } }}
 * @throws {ErrorDeNegocio} rango invertido o de mas de un año.
 */
function filtroVentas(query = {}, opciones = {}) {
  const { hoy, puntoDeVentaId = null } = opciones;

  if (!esFecha(hoy)) {
    // No es un error del usuario: es la ruta que se olvido de pasar la fecha
    // del negocio. Romper acá es preferible a caer en la fecha del servidor,
    // que es UTC y corre un dia.
    throw new Error('filtroVentas: falta la fecha de hoy del negocio (opciones.hoy).');
  }

  const rango = resolverRango(query, hoy);

  const where = {
    date: { [Op.between]: [rango.desde, rango.hasta] },
  };

  // ── Sucursal ──
  //
  // La query manda sobre la cabecera. Antes la cabecera pisaba el parametro en
  // silencio: con una sucursal activa en el encabezado, elegir «Todas las
  // sucursales» seguia mostrando una sola y no habia forma de ver el total.
  const pedidaPorQuery = query.punto_de_venta_id;
  const decideLaQuery = pedidaPorQuery !== undefined
    && pedidaPorQuery !== null
    && pedidaPorQuery !== '';
  let filtraPorSucursal = false;

  if (decideLaQuery) {
    if (String(pedidaPorQuery) !== TODAS_LAS_SUCURSALES) {
      const id = parseInt(pedidaPorQuery, 10);
      if (Number.isInteger(id)) {
        where.punto_de_venta_id = id;
        filtraPorSucursal = true;
      }
    }
  } else if (Number.isInteger(puntoDeVentaId)) {
    where.punto_de_venta_id = puntoDeVentaId;
    filtraPorSucursal = true;
  }

  // `location` es texto historico de antes de multi-sucursal. Se conserva para
  // no romper un llamador viejo, pero solo se aplica si NADIE hablo de
  // sucursal: si hubo filtro real, filtrar por las dos cosas a la vez no
  // devuelve nada, y si se pidio «todas» el usuario justamente pidio ver todo.
  if (!filtraPorSucursal && !decideLaQuery && query.location) {
    where.location = query.location;
  }

  // ── Tipo de comprobante ──
  if (query.tipo !== undefined && query.tipo !== null && query.tipo !== '') {
    if (String(query.tipo) === SIN_COMPROBANTE) {
      where.afip_type = { [Op.is]: null };
    } else {
      const tipo = parseInt(query.tipo, 10);
      if (TIPOS_VALIDOS.includes(tipo)) where.afip_type = tipo;
    }
  }

  if (query.customer_id) {
    const id = parseInt(query.customer_id, 10);
    if (Number.isInteger(id)) where.customer_id = id;
  }

  const busqueda = condicionesDeBusqueda(query.q);
  if (busqueda) Object.assign(where, busqueda);

  // ── Orden ──
  //
  // `id` como tercer criterio no es decorativo: dos ventas de la misma
  // sucursal en el mismo minuto tienen date y time iguales, y sin un criterio
  // determinístico Postgres puede devolverlas en orden distinto entre dos
  // consultas. Con paginacion eso es una fila repetida en la pagina 2 y otra
  // que no aparece nunca — invisible hasta que alguien compara el archivo
  // exportado contra la pantalla.
  const order = [['date', 'DESC'], ['time', 'DESC'], ['id', 'DESC']];

  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pedido = parseInt(query.limit, 10);
  const limit = Math.min(
    LIMITE_MAXIMO,
    Number.isInteger(pedido) && pedido > 0 ? pedido : FILAS_POR_PAGINA
  );

  return { where, order, limit, offset: (page - 1) * limit, page, rango };
}

module.exports = {
  filtroVentas,
  numeroDeComprobante,
  FILAS_POR_PAGINA,
  LIMITE_MAXIMO,
  TODAS_LAS_SUCURSALES,
  SIN_COMPROBANTE,
};
