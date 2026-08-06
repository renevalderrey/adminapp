// ════════════════════════════════════════════
//  Los endpoints de TiendaNube, contra dobles
//
//  El defecto que abre este archivo es el IDOR de `createMapping`:
//
//      const { product_id, … } = req.body;
//      const mapping = await TiendanubeMapping.create({
//        empresa_id: req.empresaId,
//        product_id,                    // ← nadie verifico de quien es
//        …
//      });
//
//  La empresa B mandaba el `product_id` de la A y recibia **201**. La fila
//  quedaba con el `empresa_id` de B, asi que revisando la tabla no se ve nada
//  raro: es exactamente la forma del defecto 1 de la funcionalidad 012, que
//  dfd7009 cerro en `POST /api/suppliers/:id/payments`.
//
//  Y el choque de cualquiera de los dos indices unicos —«ese producto ya esta
//  mapeado», «esa variante ya esta mapeada»— respondia el mismo 500 generico,
//  con lo cual el usuario no sabia que corregir.
//
//  ── Lo que este nivel NO contesta ──
//
//  Que la fila de la empresa A **siga ahi** despues del intento, y que la
//  unicidad la sostenga de verdad la base y no una comprobacion del handler.
//  Los dobles de `helpers/modelosFalsos.js` no entienden indices unicos —lo
//  dice su propio encabezado— asi que aca la unicidad se simula: lo que se
//  verifica es que el handler **traduzca** el choque a un 409 que nombre contra
//  que choco. Lo otro es el cuarto nivel, en
//  `integracion/tiendanubeAislamiento.integracion.test.js`.
// ════════════════════════════════════════════

const express = require('express');
const crypto = require('crypto');
const request = require('supertest');
const { Op } = require('sequelize');
const { crearModelo, coincide, validarWhere } = require('./helpers/modelosFalsos');
const logger = require('../utils/logger');

const PROPIA = 7;
const AJENA = 9;
// Una tercera empresa, sin token ni tienda en la fixture: es la que recorre el
// OAuth de punta a punta. Sin ella, «no se guardo ningun token» seria
// indistinguible del token que PROPIA ya tiene sembrado.
const NUEVA = 11;

// El token de la fixture NO es hexadecimal, y eso es deliberado: la respuesta
// trae `etag`, que es hexadecimal, y con un token hexadecimal cualquier ventana
// de cuatro caracteres podria coincidir por azar. Un test que falla una vez cada
// cien es un test que alguien termina borrando.
const TOKEN = 'tn_zqxv_kwmrupt_ghslnb_jyzdcvwx_kqmrtp';
const USER_ID = 8899;

/** El largo a partir del cual un pedazo del token ya lo identifica. */
const LARGO_RECONOCIBLE = 4;

/**
 * Los pedazos del token que aparecen en un texto.
 *
 * ⚠ `expect(cuerpo).not.toContain(TOKEN)` **no alcanza**, y es exactamente la
 * fixture con la que este proyecto ya se equivoco: FR-075 dice «ni entero, ni
 * truncado, ni los ultimos cuatro», y una respuesta con `token.slice(-8)`
 * —medido— pasa ese `toContain` sin que nada avise. Lo que hay que preguntar es
 * si queda algun pedazo reconocible, no si quedo el token completo.
 */
function pedazosDelToken(texto) {
  const encontrados = [];

  for (let i = 0; i + LARGO_RECONOCIBLE <= TOKEN.length; i++) {
    const pedazo = TOKEN.slice(i, i + LARGO_RECONOCIBLE);
    if (texto.includes(pedazo)) encontrados.push(pedazo);
  }

  return encontrados;
}

const mockSetting = crearModelo([]);
const mockProduct = crearModelo([]);
const mockPuntoDeVenta = crearModelo([]);
const mockStock = crearModelo([]);
const mockStockMovement = crearModelo([]);
const mockTiendanubeMapping = crearModelo([]);
const mockTiendanubeTienda = crearModelo([]);
const mockTiendanubeEstadoOauth = crearModelo([]);
const mockTiendanubeVariante = crearModelo([]);
const mockTiendanubePedido = crearModelo([]);
const mockTiendanubeCorrida = crearModelo([]);

// findScoped normaliza el id contra la clave primaria del modelo. Sin esto, un
// `product_id` que llega como '501' en el cuerpo no coincidiria nunca con el
// 501 del array y **todo** daria 404 —incluido el caso legitimo—, que es como
// una prueba de aislamiento pasa por el motivo equivocado.
for (const doble of [mockProduct, mockPuntoDeVenta, mockTiendanubeMapping]) {
  doble.primaryKeyAttribute = 'id';
  doble.rawAttributes = { id: { type: { key: 'INTEGER' } } };
}

/**
 * `Modelo.destroy({ where })` y `Modelo.update(valores, { where })` de clase.
 *
 * `helpers/modelosFalsos.js` implementa «el subconjunto de la API de Sequelize
 * que esos services usan realmente», y hasta ahora nadie borraba ni actualizaba
 * por lote: desvincular y encolar son los primeros. Se agregan aca y no en el
 * helper compartido para no cambiarle la superficie a las otras treinta suites
 * en el mismo corte.
 *
 * ⚠ `update` asigna los valores tal cual, asi que un `literal('COALESCE(…)')`
 * queda guardado como el objeto que es: **lo unico que este doble puede
 * contestar es a cuantas filas le pego**, que es justo lo que el contrato del
 * `PUT /sucursal` promete. Que el `COALESCE` conserve el `pendiente_desde`
 * viejo lo tiene que contestar Postgres, no esto.
 */
function conEscriturasPorLote(doble) {
  doble.destroy = async (opciones = {}) => {
    doble.llamadas.push({ metodo: 'destroy', ...opciones });
    validarWhere(opciones.where);

    const quedan = doble.filas.filter((f) => !coincide(f, opciones.where));
    const borradas = doble.filas.length - quedan.length;
    doble.filas.splice(0, doble.filas.length, ...quedan);

    return borradas;
  };

  doble.update = async (valores, opciones = {}) => {
    doble.llamadas.push({ metodo: 'update', valores, ...opciones });
    validarWhere(opciones.where);

    const afectadas = doble.filas.filter((f) => coincide(f, opciones.where));
    for (const fila of afectadas) Object.assign(fila, valores);

    return [afectadas.length];
  };

  return doble;
}

for (const doble of [mockSetting, mockTiendanubeVariante, mockTiendanubeTienda]) {
  conEscriturasPorLote(doble);
}

/**
 * Un `where` que puede traer operadores, y `findAndCountAll` con orden y paginado.
 *
 * ⚠ `coincide` de `modelosFalsos` **solo sabe igualdad y arreglos**, y su
 * encabezado lo dice: un `{ items_sin_descontar: { [Op.gt]: 0 } }` entra por el
 * `fila[campo] === valor`, que compara un numero contra un objeto y da `false`
 * **para toda fila**. O sea que sin esto el doble no devolveria nada por los
 * datos sino por no entender la consulta, y `solo_con_problemas` o `sin_mapear`
 * pasarian «bien» devolviendo una lista vacia — el peor de los verdes.
 *
 * ⚠⚠ **Lo que este doble NO entiende, y por eso no hay ningun caso que lo
 * afirme**: el `Op.and` con el `translate()` de la busqueda por nombre. Es una
 * clave `Symbol`, asi que `Object.entries` la saltea y el filtro **se ignora**:
 * un caso de `?q=` escrito aca devolveria todo y pasaria por no haber filtrado.
 * `CONVENCIONES.md` nombra `translate()` entre lo que va al cuarto nivel, y ahi
 * esta: `integracion/tiendanubeAislamiento.integracion.test.js`.
 *
 * Se extiende aca y no en el helper compartido, igual que
 * `cuentaDeProveedor.test.js` con el rango de fechas y `aislamientoDeProveedores`
 * con el INNER JOIN.
 */
function conOperadoresYPaginacion(doble) {
  const cumple = (fila, where = {}) => {
    for (const [campo, valor] of Object.entries(where)) {
      if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
        for (const op of Object.getOwnPropertySymbols(valor)) {
          if (op === Op.gt && !(fila[campo] > valor[op])) return false;
          if (op === Op.lt && !(fila[campo] < valor[op])) return false;
          if (op === Op.not && !(fila[campo] !== valor[op])) return false;
          // BIGINT: el driver devuelve `int8` como texto y la fixture lo puede
          // tener como numero. Comparar sin normalizar dejaria `Op.in` sin
          // encontrar nunca nada, que es el mismo verde falso de arriba.
          if (op === Op.in && !valor[op].map(String).includes(String(fila[campo]))) return false;
          if (op === Op.notIn && valor[op].map(String).includes(String(fila[campo]))) return false;
        }
        continue;
      }

      if (!coincide(fila, { [campo]: valor })) return false;
    }

    return true;
  };

  const filtrar = (opciones) => {
    validarWhere(opciones.where);
    return doble.filas.filter((f) => cumple(f, opciones.where));
  };

  /**
   * El `order` aplicado de verdad —**con su direccion**, y con desempate por la
   * segunda columna—, porque sin eso «la pagina 2 trae lo que no trajo la 1»
   * seria una afirmacion sobre el orden de un array.
   *
   * ⚠ **Tambien lo usa `findOne`**, y ahi es donde muerde: `GET /corridas/ultima`
   * pide **la ultima** corrida y **la mas vieja** de la cola con un `findOne` +
   * `order`. Un doble que devolviera el primer elemento del array contestaria
   * bien por el orden en que la fixture sembro las filas, con y sin el `order` en
   * la consulta — el peor de los verdes.
   */
  const ordenar = (filas, order) => {
    const [[campo, dirCampo] = [], [desempate, dirDesempate] = []] = order || [];
    const signo = (dir) => (String(dir).toUpperCase() === 'ASC' ? 1 : -1);

    const comparar = (a, b, columna, dir) => {
      if (a[columna] === b[columna]) return 0;
      // Los nulos al final en las dos direcciones: sin esto el orden lo decidiria
      // la comparacion de `null` con un string, que da falso en las dos.
      if (a[columna] === null || a[columna] === undefined) return 1;
      if (b[columna] === null || b[columna] === undefined) return -1;
      return (a[columna] > b[columna] ? 1 : -1) * signo(dir);
    };

    return [...filas].sort((a, b) => {
      const primero = campo ? comparar(a, b, campo, dirCampo) : 0;
      if (primero !== 0) return primero;
      return desempate ? comparar(a, b, desempate, dirDesempate) : 0;
    });
  };

  doble.count = async (opciones = {}) => {
    doble.llamadas.push({ metodo: 'count', ...opciones });
    return filtrar(opciones).length;
  };

  doble.findAll = async (opciones = {}) => {
    doble.llamadas.push({ metodo: 'findAll', ...opciones });
    return ordenar(filtrar(opciones), opciones.order).map((f) => doble._hidratar(f, opciones));
  };

  doble.findOne = async (opciones = {}) => {
    doble.llamadas.push({ metodo: 'findOne', ...opciones });
    return doble._hidratar(ordenar(filtrar(opciones), opciones.order)[0], opciones);
  };

  doble.findAndCountAll = async (opciones = {}) => {
    doble.llamadas.push({ metodo: 'findAndCountAll', ...opciones });

    const filtradas = filtrar(opciones);
    const ordenadas = ordenar(filtradas, opciones.order);

    const desde = opciones.offset || 0;
    const rows = ordenadas.slice(desde, desde + (opciones.limit || ordenadas.length));

    return { count: filtradas.length, rows: rows.map((f) => doble._hidratar(f, opciones)) };
  };

  return doble;
}

for (const doble of [
  mockTiendanubePedido, mockTiendanubeVariante, mockTiendanubeMapping,
  mockProduct, mockStock, mockTiendanubeCorrida,
]) {
  conOperadoresYPaginacion(doble);
}

/**
 * El `INSERT … ON CONFLICT (empresa_id, tiendanube_variant_id) DO UPDATE` del
 * refresco del catalogo.
 *
 * ⚠ **El `conflictAttributes` es lo que se esta ejercitando.** El conflicto va
 * contra `uq_tn_variante`, que NO es la clave primaria: sin esa opcion Sequelize
 * apunta al `id` y **cada refresco inserta el catalogo entero de nuevo**. Este
 * doble usa las mismas claves que le pasen, asi que si alguien las saca, el
 * caso de «refrescar dos veces no duplica» se pone en rojo.
 *
 * Y `updateOnDuplicate` decide **que columnas se pisan**: las de la cola no
 * estan en esa lista a proposito, porque pisarlas borraria el registro de lo que
 * se publico y sacaria de la cola todo lo que estaba esperando.
 *
 * Que la restriccion exista de verdad en la base es otra afirmacion y va al
 * cuarto nivel.
 */
function conUpsertDelCatalogo(doble) {
  doble.bulkCreate = async (filas, opciones = {}) => {
    doble.llamadas.push({ metodo: 'bulkCreate', filas, ...opciones });

    const claves = opciones.conflictAttributes || ['id'];
    const aPisar = opciones.updateOnDuplicate || [];

    for (const fila of filas) {
      const existente = doble.filas.find(
        (f) => claves.every((c) => String(f[c]) === String(fila[c]))
      );

      if (!existente) {
        doble.filas.push({ id: doble.filas.length + 1, ...fila });
        continue;
      }

      // ⚠ Se asigna **aunque la fila no traiga la columna**, porque eso es lo que
      // hace Postgres: `DO UPDATE SET col = EXCLUDED.col` sobre una columna que
      // el INSERT no trajo la pisa con el valor por defecto. Un doble que la
      // dejara como estaba seria mas indulgente que la base y dejaria pasar
      // exactamente el defecto que hay que evitar — meter una columna de la cola
      // en `updateOnDuplicate` y borrarla en cada refresco.
      for (const columna of aPisar) {
        existente[columna] = columna in fila ? fila[columna] : null;
      }
    }

    return filas;
  };

  return doble;
}

conUpsertDelCatalogo(mockTiendanubeVariante);

/** `Setting.upsert`, que es como el service guarda el token del canje. */
mockSetting.upsert = async (datos) => {
  mockSetting.llamadas.push({ metodo: 'upsert', datos });

  const existente = mockSetting.filas.find(
    (f) => f.key === datos.key && f.empresa_id === datos.empresa_id
  );

  if (existente) {
    Object.assign(existente, datos);
    return [existente, false];
  }

  mockSetting.filas.push({ ...datos });
  return [datos, true];
};

/**
 * La PK `empresa_id` y el `UNIQUE (tiendanube_user_id)` de `tiendanube_tiendas`.
 *
 * El segundo es FR-036 y es lo que impide que dos empresas vinculen la misma
 * tienda; sin simularlo, la rama de `tienda_ocupada` —la que borra el token que
 * el canje acaba de guardar— **no se ejecutaria nunca** y el caso pasaria en
 * verde sin haber mirado nada. Que la restriccion exista de verdad en la base es
 * otra afirmacion y va al cuarto nivel.
 */
const crearTienda = mockTiendanubeTienda.create.bind(mockTiendanubeTienda);
mockTiendanubeTienda.create = async (datos, opciones = {}) => {
  const choca = mockTiendanubeTienda.filas.some((f) =>
    f.empresa_id === datos.empresa_id ||
    String(f.tiendanube_user_id) === String(datos.tiendanube_user_id));

  if (choca) {
    const err = new Error('duplicate key value violates unique constraint "tiendanube_tiendas_tiendanube_user_id_key"');
    err.name = 'SequelizeUniqueConstraintError';
    throw err;
  }

  return crearTienda(datos, opciones);
};

/**
 * El `UPDATE … RETURNING` que consume el `state`, interpretado a mano.
 *
 * Es crudo a proposito: **mira que condiciones trae el SQL** en vez de dar por
 * sentado cuales son. Si alguien le saca el `consumido_en IS NULL`, este doble
 * deja de aplicarlo y el caso del `state` reusado se pone en rojo; si el
 * `UPDATE` se cambiara por un `findOne` seguido de un `update`, este doble tira
 * porque no reconoce la sentencia. Lo que NO puede contestar es la carrera de
 * dos callbacks en paralelo —no hay dos transacciones que puedan chocar—, y esa
 * es la mitad que solo el cuarto nivel toca.
 */
const mockSequelize = {
  consultas: [],

  async query(sql, opciones = {}) {
    const texto = String(sql).replace(/\s+/g, ' ').trim();
    mockSequelize.consultas.push({ texto, bind: opciones.bind });

    if (/^UPDATE tiendanube_tiendas/i.test(texto)) return mockSequelize.arrendar(texto, opciones);

    if (!/^UPDATE tiendanube_estados_oauth/i.test(texto)) {
      throw new Error(`El doble de sequelize.query no entiende esta sentencia: ${texto.slice(0, 90)}`);
    }

    const [token] = opciones.bind || [];
    const exigeSinConsumir = /consumido_en IS NULL/i.test(texto);
    const exigeVigente = /expira_en > NOW\(\)/i.test(texto);

    const fila = mockTiendanubeEstadoOauth.filas.find((f) => f.token === token);

    if (!fila) return [[], 0];
    if (exigeSinConsumir && fila.consumido_en) return [[], 0];
    if (exigeVigente && new Date(fila.expira_en).getTime() <= Date.now()) return [[], 0];

    fila.consumido_en = new Date();
    return [[{ empresa_id: fila.empresa_id, usuario_id: fila.usuario_id }], 1];
  },

  /**
   * El `UPDATE` condicional que toma el arriendo de la sincronizacion (FR-044),
   * interpretado a mano.
   *
   * ⚠ Es crudo por el mismo motivo que el del `state`: **mira que condiciones
   * trae el SQL** en vez de darlas por sentadas. Si alguien le saca el
   * `sincronizando_desde IS NULL`, este doble deja de arrendar una tienda libre y
   * toda la suite de la corrida se pone en rojo; si le saca la ventana de diez
   * minutos, deja de reconocer el vencimiento y el caso del arriendo muerto se
   * pone en rojo; y si el `UPDATE` se cambiara por un `findOne` seguido de un
   * `update`, esto tira porque no reconoce la sentencia.
   *
   * Lo que NO puede contestar es la carrera de dos corridas en paralelo: no hay
   * dos transacciones que puedan chocar. Esa es la mitad del cuarto nivel, en
   * `integracion/tiendanubeAislamiento.integracion.test.js`.
   */
  arrendar(texto, opciones = {}) {
    const [empresaId] = opciones.bind || [];
    const fila = mockTiendanubeTienda.filas.find((f) => f.empresa_id === empresaId);

    if (!fila) return [[], 0];

    const aceptaLibre = /sincronizando_desde IS NULL/i.test(texto);
    const ventana = texto.match(/INTERVAL '(\d+) minutes?'/i);

    const libre = fila.sincronizando_desde === null || fila.sincronizando_desde === undefined;
    const vencido = Boolean(ventana) && !libre &&
      Date.now() - new Date(fila.sincronizando_desde).getTime() > Number(ventana[1]) * 60000;

    if (!((aceptaLibre && libre) || vencido)) return [[], 0];

    fila.sincronizando_desde = new Date();
    return [[{ empresa_id: fila.empresa_id }], 1];
  },

  /**
   * Las dos formas de `sequelize.transaction()`: con callback y sin.
   *
   * ⚠ **Los dobles no aislan NADA.** Un `rollback` acá no deshace ninguna
   * escritura, porque las escrituras son `push` a un array. O sea que este doble
   * **no puede** contestar «si el tercer ítem falla no queda ni la fila del
   * pedido» ni «media desvinculación no queda escrita»: las dos son del cuarto
   * nivel, contra Postgres, y están en `integracion/`. Lo que sí se puede
   * verificar acá es que el código pida la transacción y anote lo que anota.
   *
   * `LOCK.UPDATE` existe porque el descuento lo usa; que Postgres bloquee la fila
   * de verdad tampoco lo contesta un array.
   */
  async transaction(fn) {
    const t = {
      doble: true,
      LOCK: { UPDATE: 'UPDATE' },
      async commit() { mockSequelize.transacciones.push('commit'); },
      async rollback() { mockSequelize.transacciones.push('rollback'); },
    };

    if (typeof fn === 'function') return fn(t);

    return t;
  },

  transacciones: [],
};

/**
 * Los dos indices unicos de `tiendanube_mappings`, simulados.
 *
 * `uq_tn_mapping_product` sobre (empresa_id, product_id) y
 * `uq_tn_mapping_variant` sobre (empresa_id, tiendanube_variant_id). El doble
 * no sabe nada de indices: sin esto, el segundo mapeo se crearia sin protestar
 * y la rama del 409 —que es lo que este archivo verifica— **no se ejecutaria
 * nunca**. El test pasaria sin haber mirado nada.
 *
 * Que la restriccion exista de verdad en la base es otra afirmacion y va al
 * cuarto nivel.
 */
const crearMapeo = mockTiendanubeMapping.create.bind(mockTiendanubeMapping);
mockTiendanubeMapping.create = async (datos, opciones = {}) => {
  const choca = mockTiendanubeMapping.filas.some((f) =>
    f.empresa_id === datos.empresa_id &&
    (f.product_id === datos.product_id ||
     f.tiendanube_variant_id === datos.tiendanube_variant_id));

  if (choca) {
    const err = new Error('duplicate key value violates unique constraint "uq_tn_mapping_product"');
    err.name = 'SequelizeUniqueConstraintError';
    throw err;
  }

  return crearMapeo(datos, opciones);
};

jest.mock('axios');

jest.mock('../models', () => ({
  sequelize: mockSequelize,
  Setting: mockSetting,
  Product: mockProduct,
  PuntoDeVenta: mockPuntoDeVenta,
  Stock: mockStock,
  StockMovement: mockStockMovement,
  TiendanubeMapping: mockTiendanubeMapping,
  TiendanubeTienda: mockTiendanubeTienda,
  TiendanubeEstadoOauth: mockTiendanubeEstadoOauth,
  TiendanubeVariante: mockTiendanubeVariante,
  TiendanubePedido: mockTiendanubePedido,
  TiendanubeCorrida: mockTiendanubeCorrida,
}));

const axios = require('axios');

// ⚠ El router se carga ACA y no adentro de `levantarApi`, y no es cosmetico:
// `utils/errores` arrastra `@sentry/node`, que en esta maquina tarda ~4 s en
// cargar. Cuando ese require caia adentro del primer `it`, el primer caso del
// archivo se comia los cinco segundos de jest y fallaba por el reloj —siempre el
// primero, cualquiera fuera— mientras los otros cuarenta y seis pasaban. Un test
// que falla por el orden en que corre es un test que alguien termina marcando
// como inestable y salteando.
//
// La constructora de `tiendanubeService` lee TIENDANUBE_CLIENT_ID al importarse,
// asi que la variable se pone antes; el `beforeEach` la vuelve a poner igual.
process.env.TIENDANUBE_CLIENT_ID = '4321';
const { publico, privado } = require('../routes/tiendanube');

function levantarApi(empresaId, { permisos } = {}) {
  const api = express();
  api.use(express.json());
  api.use((req, _res, siguiente) => {
    req.empresaId = empresaId;
    req.userId = 'auth0|quien-mapea';
    req.id = 'req-de-prueba';
    // Solo cuando el caso lo pide: el resto de la suite corre con BYPASS_AUTH,
    // que hace que checkPermission devuelva next() de entrada.
    if (permisos) req.usuarioPermisos = permisos;
    siguiente();
  });

  api.use('/api/tiendanube', publico);
  api.use('/api/tiendanube', privado);

  return api;
}

const CLIENT_ID_ANTERIOR = process.env.TIENDANUBE_CLIENT_ID;
const CLIENT_SECRET_ANTERIOR = process.env.TIENDANUBE_CLIENT_SECRET;
const FRONTEND_ANTERIOR = process.env.FRONTEND_URL;

/**
 * El secreto con el que se firma el webhook en estas pruebas.
 *
 * ⚠ Lo que este archivo verifica es que **AdminApp valide lo que AdminApp
 * firmo**: no hay entorno de pruebas de TiendaNube (supuesto 11), asi que ni el
 * nombre real de la cabecera ni la forma del cuerpo del tercero los comprueba
 * ningun test. Eso es el paso manual P2 y esta dicho sin adornos en el plan.
 */
const SECRETO = 'secreto-de-prueba-de-tiendanube';

/** El id de tienda que devuelve el canje del OAuth en estas pruebas. */
const USER_ID_DE_LA_TIENDA = 4455667;

/**
 * Cuando se refresco el catalogo de la fixture, y cuando se vio cada variante.
 *
 * ⚠ **Son el MISMO instante a proposito.** `en_la_tienda` compara los dos, y una
 * variante que se acaba de ver tiene que dar `true`: si el refresco fuera
 * posterior por un milisegundo, todo el catalogo recien traido saldria marcado
 * como «ya no esta en tu tienda».
 */
const REFRESCADO_EN = new Date('2026-08-12T09:00:00.000Z');

/** Una fila de la instantanea, con los campos que la respuesta arma. */
function variante(cambios = {}) {
  return {
    tiendanube_product_id: 5544,
    nombre_producto: 'Colágeno hidrolizado',
    nombre_variante: '300 g',
    sku: null,
    stock_en_tienda: 7,
    vista_en: REFRESCADO_EN,
    stock_publicado: null,
    publicado_en: null,
    pendiente_desde: null,
    proximo_intento_en: null,
    intentos: 0,
    ultimo_error: null,
    motivo_no_publicado: null,
    ...cambios,
  };
}

const TODOS_LOS_DOBLES = [
  mockSetting, mockProduct, mockPuntoDeVenta, mockStock, mockStockMovement,
  mockTiendanubeMapping, mockTiendanubeTienda, mockTiendanubeEstadoOauth,
  mockTiendanubeVariante, mockTiendanubePedido, mockTiendanubeCorrida,
];

beforeEach(() => {
  process.env.TIENDANUBE_CLIENT_ID = '4321';
  process.env.TIENDANUBE_CLIENT_SECRET = SECRETO;
  process.env.FRONTEND_URL = 'https://app.pruebas.local';

  mockProduct.filas = [
    { id: 501, empresa_id: PROPIA, name: 'Colágeno 300g' },
    { id: 502, empresa_id: PROPIA, name: 'Creatina 300g' },
    { id: 900, empresa_id: AJENA, name: 'Insumo de otro cliente' },
  ];
  // ⚠ Las sucursales estan elegidas para que «la por defecto» y «la de menor
  // id» NO sean la misma. `elegirPorDefecto` mira primero el code 'principal' y
  // recien despues la activa de menor id: con una sola sucursal por empresa, o
  // con la principal siendo tambien la de menor id, los dos escalones dan el
  // mismo numero y el test pasa con y sin el orden correcto.
  mockPuntoDeVenta.filas = [
    { id: 30, empresa_id: PROPIA, name: 'Centro', code: 'centro', is_active: true },
    { id: 31, empresa_id: PROPIA, name: 'Depósito Mayo', code: 'mayo', is_active: true },
    { id: 40, empresa_id: NUEVA, name: 'Salón', code: 'salon', is_active: true },
    { id: 41, empresa_id: NUEVA, name: 'Casa central', code: 'principal', is_active: true },
    { id: 90, empresa_id: AJENA, name: 'Local de otro cliente', code: 'ajeno', is_active: true },
  ];
  mockSetting.filas = [
    { key: 'tiendanube_access_token', value: TOKEN, empresa_id: PROPIA },
    { key: 'tiendanube_user_id', value: USER_ID, empresa_id: PROPIA },
  ];
  mockStock.filas = [];
  mockStockMovement.filas = [];
  mockTiendanubeMapping.filas = [];
  mockTiendanubeTienda.filas = [];
  mockTiendanubeEstadoOauth.filas = [];
  // ⚠ La instantanea arranca sembrada porque `POST /mapeos` exige que la
  // variante este en el catalogo: un mapeo contra una variante que no existe en
  // la tienda es una fila que la sincronizacion va a intentar publicar y fallar
  // para siempre. La 998877 esta en las DOS empresas a proposito —los indices
  // unicos son (empresa_id, …)— y la 111222 solo en la propia.
  mockTiendanubeVariante.filas = [
    variante({ id: 1, empresa_id: PROPIA, tiendanube_variant_id: 998877, sku: 'COL-300' }),
    variante({ id: 2, empresa_id: PROPIA, tiendanube_variant_id: 111222, sku: 'CRE-300' }),
    variante({ id: 3, empresa_id: AJENA, tiendanube_variant_id: 998877, sku: 'COL-300' }),
  ];
  mockTiendanubePedido.filas = [];
  mockTiendanubeCorrida.filas = [];

  for (const doble of TODOS_LOS_DOBLES) doble.llamadas = [];
  mockSequelize.consultas = [];
  mockSequelize.transacciones = [];

  jest.clearAllMocks();
  axios.get.mockResolvedValue({ data: [] });
  axios.put.mockResolvedValue({ data: {} });
  axios.post.mockResolvedValue({
    data: { access_token: TOKEN, token_type: 'bearer', scope: 'write_products', user_id: USER_ID_DE_LA_TIENDA },
  });
});

// Los espias de `logger` se ponen caso por caso; sin esto, el primero que
// silencie un `warn` se lo silencia a todos los que corren despues.
afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  if (CLIENT_ID_ANTERIOR === undefined) delete process.env.TIENDANUBE_CLIENT_ID;
  else process.env.TIENDANUBE_CLIENT_ID = CLIENT_ID_ANTERIOR;

  if (CLIENT_SECRET_ANTERIOR === undefined) delete process.env.TIENDANUBE_CLIENT_SECRET;
  else process.env.TIENDANUBE_CLIENT_SECRET = CLIENT_SECRET_ANTERIOR;

  if (FRONTEND_ANTERIOR === undefined) delete process.env.FRONTEND_URL;
  else process.env.FRONTEND_URL = FRONTEND_ANTERIOR;
});

const mapear = (empresaId, cuerpo) =>
  request(levantarApi(empresaId)).post('/api/tiendanube/mapeos').send(cuerpo);

describe('POST /api/tiendanube/mapeos · el producto es de quien lo manda', () => {
  it('con un product_id de otra empresa responde 404 y NO crea ninguna fila', async () => {
    const res = await mapear(PROPIA, {
      product_id: 900,
      tiendanube_variant_id: 998877,
      tiendanube_product_id: 5544,
    });

    expect(res.status).toBe(404);
    // La otra mitad, y es la que importa: hoy respondia 201 y dejaba la fila.
    expect(mockTiendanubeMapping.filas).toEqual([]);
  });

  it('responde 404 y no 403: un 403 confirmaria que ese producto existe', async () => {
    const ajeno = await mapear(PROPIA, {
      product_id: 900, tiendanube_variant_id: 998877, tiendanube_product_id: 5544,
    });
    const inexistente = await mapear(PROPIA, {
      product_id: 999999, tiendanube_variant_id: 998877, tiendanube_product_id: 5544,
    });

    expect(ajeno.status).toBe(404);
    expect(ajeno.status).not.toBe(403);
    expect(inexistente.status).toBe(404);
    expect(inexistente.body.error).toBe(ajeno.body.error);
  });

  it('sigue creando el mapeo cuando el producto SI es de la empresa', async () => {
    // Sin este caso la validacion podria estar rechazando siempre, que es tan
    // inutil como no validar nada: dejaria la pantalla de mapeo sin forma de
    // mapear nada.
    const res = await mapear(PROPIA, {
      product_id: 501, tiendanube_variant_id: 998877, tiendanube_product_id: 5544,
    });

    expect(res.status).toBe(201);
    expect(mockTiendanubeMapping.filas).toHaveLength(1);
    expect(mockTiendanubeMapping.filas[0]).toMatchObject({
      empresa_id: PROPIA,
      product_id: 501,
      tiendanube_variant_id: 998877,
      tiendanube_product_id: 5544,
    });
  });
});

describe('POST /api/tiendanube/mapeos · los tres ids son enteros', () => {
  it('un product_id que no es entero responde 400 y no 500', async () => {
    // Antes llegaba hasta Postgres —«invalid input syntax for type integer»— y
    // volvia como el mismo 500 generico que cualquier otra falla: el usuario no
    // tenia forma de saber que lo que estaba mal era el dato que mando.
    const res = await mapear(PROPIA, {
      product_id: 'abc', tiendanube_variant_id: 998877, tiendanube_product_id: 5544,
    });

    expect(res.status).toBe(400);
    expect(mockTiendanubeMapping.filas).toEqual([]);
  });

  it('una variante que no es entera tambien responde 400', async () => {
    const res = await mapear(PROPIA, {
      product_id: 501, tiendanube_variant_id: 'v-998877', tiendanube_product_id: 5544,
    });

    expect(res.status).toBe(400);
    expect(mockTiendanubeMapping.filas).toEqual([]);
  });

  it('los tres ids son obligatorios: sin el producto de TiendaNube responde 400', async () => {
    // La columna es NOT NULL. Sin la validacion, el INSERT fallaba contra la
    // base y salia como 500.
    const res = await mapear(PROPIA, { product_id: 501, tiendanube_variant_id: 998877 });

    expect(res.status).toBe(400);
    expect(mockTiendanubeMapping.filas).toEqual([]);
  });

  it('un id que viaja como texto numerico se acepta', async () => {
    // Un formulario manda strings. Sin esto, la validacion rechazaria el caso
    // normal y la pantalla no podria mapear nada.
    const res = await mapear(PROPIA, {
      product_id: '501', tiendanube_variant_id: '998877', tiendanube_product_id: '5544',
    });

    expect(res.status).toBe(201);
    expect(mockTiendanubeMapping.filas[0].product_id).toBe(501);
  });
});

describe('POST /api/tiendanube/mapeos · el choque dice contra que choca', () => {
  it('el segundo mapeo del mismo producto responde 409 nombrando la variante con la que choca', async () => {
    await mapear(PROPIA, {
      product_id: 501, tiendanube_variant_id: 998877, tiendanube_product_id: 5544,
    });

    const res = await mapear(PROPIA, {
      product_id: 501, tiendanube_variant_id: 111222, tiendanube_product_id: 5544,
    });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('Colágeno 300g');
    // Nombra la variante ocupada: un 409 que dice «ya existe» sin decir cual
    // obliga a buscarla a mano en la tabla.
    expect(res.body.error).toContain('998877');
    expect(mockTiendanubeMapping.filas).toHaveLength(1);
  });

  it('el segundo mapeo de la misma variante responde 409 nombrando el producto con el que choca', async () => {
    await mapear(PROPIA, {
      product_id: 502, tiendanube_variant_id: 998877, tiendanube_product_id: 5544,
    });

    const res = await mapear(PROPIA, {
      product_id: 501, tiendanube_variant_id: 998877, tiendanube_product_id: 5544,
    });

    expect(res.status).toBe(409);
    // El producto que ya tiene esa variante es el 502, no el que se mando.
    expect(res.body.error).toContain('Creatina 300g');
    expect(res.body.error).not.toContain('Colágeno 300g');
    expect(mockTiendanubeMapping.filas).toHaveLength(1);
  });

  it('los dos choques se distinguen entre si, y ninguno es el 500 generico', async () => {
    // Es la diferencia que el usuario tiene que ver: «cambiá la variante» y
    // «ese producto ya está» se corrigen de maneras distintas. Los dos
    // respondian «Error al crear el mapeo de producto» con status 500.
    await mapear(PROPIA, {
      product_id: 501, tiendanube_variant_id: 998877, tiendanube_product_id: 5544,
    });

    const porProducto = await mapear(PROPIA, {
      product_id: 501, tiendanube_variant_id: 111222, tiendanube_product_id: 5544,
    });
    const porVariante = await mapear(PROPIA, {
      product_id: 502, tiendanube_variant_id: 998877, tiendanube_product_id: 5544,
    });

    expect(porProducto.body.error).not.toBe(porVariante.body.error);
    for (const res of [porProducto, porVariante]) {
      expect(res.status).not.toBe(500);
      expect(res.body.error).not.toBe('Error al crear el mapeo de producto');
    }
  });

  it('el mapeo de OTRA empresa sobre la misma variante no choca', async () => {
    // Los dos indices son (empresa_id, …). Si el handler tradujera cualquier
    // fallo a un 409, dos clientes con la misma variante en tiendas distintas
    // se bloquearian entre si.
    await mapear(AJENA, {
      product_id: 900, tiendanube_variant_id: 998877, tiendanube_product_id: 5544,
    });

    const res = await mapear(PROPIA, {
      product_id: 501, tiendanube_variant_id: 998877, tiendanube_product_id: 5544,
    });

    expect(res.status).toBe(201);
  });
});

describe('El token de TiendaNube no sale en ninguna respuesta', () => {
  // FR-075. El token vive en `settings.tiendanube_access_token` **en texto
  // plano** —cifrarlo es el proyecto 6 y no entra aca— asi que lo unico que
  // esta funcionalidad puede garantizar es no empeorarlo: que no salga por la
  // API, ni entero, ni truncado, ni «los ultimos cuatro».
  //
  // El caso donde mas facil se escapa es el error: axios adjunta la respuesta
  // del tercero al error, y el canje del `code` devuelve el token adentro. Por
  // eso la fixture hace fallar la llamada CON el token adentro del error: sin
  // eso, la prueba pasaria por no haber tenido nunca el token cerca.
  const conElTokenAdentro = () => {
    const err = new Error('Request failed with status code 401');
    err.response = { status: 401, data: { access_token: TOKEN, code: 'invalid_grant' } };
    return err;
  };

  it('ninguna respuesta de ningun endpoint contiene la cadena del token', async () => {
    sembrarTienda();
    const api = levantarApi(PROPIA);

    const respuestas = [
      await request(api).get('/api/tiendanube/status'),
      await request(api).get('/api/tiendanube/variantes'),
      await request(api).get('/api/tiendanube/mapeos'),
      await request(api).get('/api/tiendanube/pedidos'),
      await request(api).post('/api/tiendanube/variantes/refrescar'),
      await mapear(PROPIA, {
        product_id: 501, tiendanube_variant_id: 998877, tiendanube_product_id: 5544,
      }),
    ];

    // El ancla: si todas fallaran con 404 —por un montaje mal armado— ninguna
    // podria contener el token y la prueba pasaria sin haber mirado nada.
    expect(respuestas.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 201]);

    for (const res of respuestas) {
      expect(pedazosDelToken(JSON.stringify(res.body))).toEqual([]);
      expect(pedazosDelToken(JSON.stringify(res.headers))).toEqual([]);
    }
  });

  it('tampoco cuando la llamada a TiendaNube falla con el token adentro del error', async () => {
    // El canje del `code` devuelve el token adentro de la respuesta, y axios
    // adjunta esa respuesta al error: es el caso donde mas facil se escapa.
    axios.get.mockRejectedValue(conElTokenAdentro());
    sembrarTienda();

    const api = levantarApi(PROPIA);
    const refresco = await request(api).post('/api/tiendanube/variantes/refrescar');

    // El ancla: tiene que haber fallado de verdad, si no la prueba no ejercita
    // el camino del error. 401 de TiendaNube → 400 «hay que volver a vincular»,
    // que es FR-049 y es distinto de un fallo generico.
    expect(refresco.status).toBe(400);
    expect(refresco.body.error).toContain('volver a vincularla');

    expect(pedazosDelToken(JSON.stringify(refresco.body))).toEqual([]);
    expect(JSON.stringify(refresco.body)).not.toContain('invalid_grant');
    // Y tampoco queda en la fila de la tienda, que la pantalla muestra tal cual.
    expect(pedazosDelToken(String(mockTiendanubeTienda.filas[0].ultimo_error))).toEqual([]);
  });
});

// ════════════════════════════════════════════
//  El OAuth que nunca se pudo completar
//
//  `getAuthUrl` armaba la URL de autorizacion SIN `state` y el callback exige un
//  `state`: el circuito terminaba siempre en `?motivo=sin_empresa`, antes de
//  llamar a `getAccessToken`. O sea que **el codigo que guarda el token jamas se
//  ejecuto** y no hay ni una tienda vinculada en produccion. Nada de lo que
//  verifican estos casos estuvo nunca probado por el uso.
//
//  ── Lo que este nivel NO contesta ──
//
//  Que el `state` sea de un solo uso **cuando dos callbacks llegan a la vez**.
//  Un `findOne` seguido de un `update` pasa todos los casos secuenciales de aca
//  abajo: no hay dos transacciones que puedan chocar contra un array en memoria.
//  Eso es `integracion/tiendanubeAislamiento.integracion.test.js`.
// ════════════════════════════════════════════

/** 32 bytes en hexadecimal: 64 caracteres. */
const HEX_64 = /^[0-9a-f]{64}$/;

/** Una empresa sin ninguna sucursal cargada, que es el motivo `sin_sucursal`. */
const SIN_SUCURSALES = 12;

function sembrarState(cambios = {}) {
  const fila = {
    token: 'f0'.repeat(32),
    empresa_id: NUEVA,
    usuario_id: 'auth0|quien-vincula',
    expira_en: new Date(Date.now() + 10 * 60 * 1000),
    consumido_en: null,
    ...cambios,
  };

  mockTiendanubeEstadoOauth.filas.push(fila);
  return fila;
}

function sembrarTienda(cambios = {}) {
  const fila = {
    empresa_id: PROPIA,
    tiendanube_user_id: USER_ID,
    nombre: 'Comprafit Suplementos',
    punto_de_venta_id: 30,
    vinculada_en: new Date('2026-08-01T10:00:00.000Z'),
    ultima_comunicacion_en: null,
    ultima_comunicacion_ok: null,
    ultimo_error: null,
    catalogo_refrescado_en: null,
    reconciliada_en: null,
    sincronizando_desde: null,
    ...cambios,
  };

  mockTiendanubeTienda.filas.push(fila);
  return fila;
}

const callback = (query) =>
  request(levantarApi(PROPIA)).get('/api/tiendanube/callback').query(query);

/** El `motivo=` de una redireccion de error, o null si redirigio al camino feliz. */
const motivoDe = (res) => new URL(res.headers.location).searchParams.get('motivo');

describe('GET /auth exige config.editar: iniciar una vinculación es escribir', () => {
  // El resto de la suite corre con BYPASS_AUTH, que hace que checkPermission
  // devuelva next() de entrada. Aca se apaga a proposito: sin apagarlo, este
  // caso pasaria en verde con cualquier permiso escrito en la ruta, incluido
  // ninguno.
  async function conPermisos(permisos, verbo, camino) {
    const antes = process.env.BYPASS_AUTH;
    process.env.BYPASS_AUTH = 'false';

    try {
      return await request(levantarApi(PROPIA, { permisos }))[verbo](camino);
    } finally {
      process.env.BYPASS_AUTH = antes;
    }
  }

  it('un usuario con solo config.ver NO puede iniciar la vinculación', async () => {
    const res = await conPermisos(['config.ver'], 'get', '/api/tiendanube/auth');

    expect(res.status).toBe(403);
    // Y no llego a escribir: el endpoint inserta una fila de state.
    expect(mockTiendanubeEstadoOauth.filas).toEqual([]);
  });

  it('ese mismo usuario SÍ puede leer el estado: no es «todo prohibido»', async () => {
    // El ancla. Sin este caso, poner `config.editar` en las dos rutas —o un
    // permiso que nadie tenga— dejaria el primero en verde sin decir nada.
    const res = await conPermisos(['config.ver'], 'get', '/api/tiendanube/status');

    expect(res.status).toBe(200);
  });

  it('con config.editar la vinculación arranca', async () => {
    const res = await conPermisos(['config.ver', 'config.editar'], 'get', '/api/tiendanube/auth');

    expect(res.status).toBe(200);
  });
});

describe('GET /auth · la URL de autorización lleva un state que no se puede adivinar', () => {
  it('sin TIENDANUBE_CLIENT_ID responde 500 con su mensaje', async () => {
    delete process.env.TIENDANUBE_CLIENT_ID;

    const res = await request(levantarApi(PROPIA)).get('/api/tiendanube/auth');

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('TIENDANUBE_CLIENT_ID');
    // «No configurado en el servidor» es un estado distinto de «no vinculada»:
    // colapsarlos deja al usuario intentando vincular algo que el servidor no
    // puede vincular.
    expect(mockTiendanubeEstadoOauth.filas).toEqual([]);
  });

  it('la URL lleva un state y ese state NO es el empresaId', async () => {
    const res = await request(levantarApi(PROPIA)).get('/api/tiendanube/auth');

    expect(res.status).toBe(200);

    const state = new URL(res.body.url).searchParams.get('state');

    expect(state).not.toBeNull();
    // Es el caso que cierra la opcion descartada: con el empresaId en claro,
    // cualquiera completa un OAuth con `state=1` y le cuelga SU tienda a la
    // empresa 1, que en produccion es un cliente real.
    expect(state).not.toBe(String(PROPIA));
    expect(state).toMatch(HEX_64);

    expect(mockTiendanubeEstadoOauth.filas).toHaveLength(1);
    expect(mockTiendanubeEstadoOauth.filas[0]).toMatchObject({
      token: state,
      empresa_id: PROPIA,
      usuario_id: 'auth0|quien-mapea',
    });
  });

  it('el state vence, y vence en el futuro', async () => {
    const antes = Date.now();
    await request(levantarApi(PROPIA)).get('/api/tiendanube/auth');

    const vence = mockTiendanubeEstadoOauth.filas[0].expira_en;

    // Sin vencimiento, un state capturado del historial del navegador sirve
    // para siempre. Con uno en el pasado, no serviria nunca.
    expect(new Date(vence).getTime()).toBeGreaterThan(antes);
    expect(new Date(vence).getTime()).toBeLessThanOrEqual(antes + 16 * 60 * 1000);
  });

  it('dos llamadas seguidas producen dos states distintos', async () => {
    // Dos pestañas iniciando el OAuth a la vez es un caso de borde explicito de
    // la spec: con un state derivado de la empresa, las dos producirian el
    // mismo y consumir uno invalidaria el otro.
    const api = levantarApi(PROPIA);

    const uno = await request(api).get('/api/tiendanube/auth');
    const dos = await request(api).get('/api/tiendanube/auth');

    const estados = [uno, dos].map((r) => new URL(r.body.url).searchParams.get('state'));

    expect(estados[0]).not.toBe(estados[1]);
    expect(mockTiendanubeEstadoOauth.filas).toHaveLength(2);
  });

  it('con una tienda ya vinculada responde 409 y no crea ningún state', async () => {
    sembrarTienda();

    const res = await request(levantarApi(PROPIA)).get('/api/tiendanube/auth');

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('Desvinculala');
    // Hoy `Setting.upsert` pisaba el token en silencio: la empresa quedaba
    // publicando stock en una tienda y hablando con otra.
    expect(mockTiendanubeEstadoOauth.filas).toEqual([]);
  });
});

describe('GET /callback · los seis caminos, con motivos distinguibles', () => {
  it('el callback sin code y el callback con state desconocido redirigen con motivos DISTINTOS', async () => {
    const state = sembrarState();

    const sinCodigo = await callback({ state: state.token });
    const stateDesconocido = await callback({ code: 'abc123', state: 'no-existe-este-token' });

    expect(sinCodigo.status).toBe(302);
    expect(stateDesconocido.status).toBe(302);

    // Hoy el usuario ve «Error al vincular TiendaNube» y nada mas, para los dos
    // casos y para todos los demas.
    expect(motivoDe(sinCodigo)).toBe('sin_codigo');
    expect(motivoDe(stateDesconocido)).toBe('state_invalido');
    expect(motivoDe(sinCodigo)).not.toBe(motivoDe(stateDesconocido));

    expect(axios.post).not.toHaveBeenCalled();
  });

  it('un state vencido no guarda ningún token', async () => {
    const state = sembrarState({ expira_en: new Date(Date.now() - 1000) });

    const res = await callback({ code: 'abc123', state: state.token });

    expect(motivoDe(res)).toBe('state_invalido');
    expect(axios.post).not.toHaveBeenCalled();
    expect(mockTiendanubeTienda.filas).toEqual([]);
    expect(mockSetting.filas.filter((f) => f.empresa_id === NUEVA)).toEqual([]);
  });

  it('un state ya consumido no guarda ningún token', async () => {
    const state = sembrarState({ consumido_en: new Date('2026-08-01T09:00:00.000Z') });

    const res = await callback({ code: 'abc123', state: state.token });

    expect(motivoDe(res)).toBe('state_invalido');
    expect(axios.post).not.toHaveBeenCalled();
    expect(mockTiendanubeTienda.filas).toEqual([]);
  });

  it('el mismo state usado dos veces canjea el code UNA sola vez', async () => {
    const state = sembrarState();

    const primero = await callback({ code: 'abc123', state: state.token });
    const segundo = await callback({ code: 'abc123', state: state.token });

    expect(motivoDe(primero)).toBeNull();
    expect(motivoDe(segundo)).toBe('state_invalido');

    // Es lo que «de un solo uso» tiene que impedir: el usuario recarga la
    // pestaña de vuelta y el `code` se canjea de nuevo.
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(mockTiendanubeTienda.filas).toHaveLength(1);
  });

  it('el callback redirige a /tiendanube y no a /settings', async () => {
    const state = sembrarState();

    const bien = await callback({ code: 'abc123', state: state.token });
    const mal = await callback({ code: 'abc123', state: 'cualquiera' });

    // /settings redirige a /facturacion, donde vive la tarjeta que este hito
    // saca: el usuario volveria de vincular a una pantalla que ya no habla de
    // TiendaNube.
    for (const res of [bien, mal]) {
      expect(new URL(res.headers.location).pathname).toBe('/tiendanube');
      expect(res.headers.location).not.toContain('/settings');
    }

    expect(new URL(bien.headers.location).searchParams.get('estado')).toBe('ok');
  });

  it('ninguna redirección contiene la cadena del token', async () => {
    const bien = await callback({ code: 'abc123', state: sembrarState().token });

    axios.post.mockRejectedValue(Object.assign(new Error('401'), {
      response: { status: 401, data: { access_token: TOKEN } },
    }));
    const otro = sembrarState({ token: 'ab'.repeat(32), empresa_id: NUEVA });
    const mal = await callback({ code: 'abc123', state: otro.token });

    // El ancla: uno vinculo y el otro fallo con el token adentro del error de
    // axios, que es el caso donde mas facil se escapa.
    expect(motivoDe(bien)).toBeNull();
    expect(motivoDe(mal)).toBe('tiendanube');

    for (const res of [bien, mal]) {
      expect(pedazosDelToken(res.headers.location)).toEqual([]);
    }
  });

  it('la tienda queda bajo la empresa del state, NO bajo la de la sesión', async () => {
    // El callback es publico y no tiene sesion; `levantarApi` le pone una igual
    // para que este caso pueda distinguir de donde sale la empresa. Es el `|| 1`
    // que este archivo ya tuvo, con otra forma: si la empresa saliera de
    // cualquier otro lado que no sea el state, el token de una empresa
    // terminaria guardado bajo otra.
    const state = sembrarState({ empresa_id: NUEVA });

    await callback({ code: 'abc123', state: state.token });

    expect(mockTiendanubeTienda.filas).toHaveLength(1);
    expect(mockTiendanubeTienda.filas[0].empresa_id).toBe(NUEVA);
    expect(mockTiendanubeTienda.filas[0].empresa_id).not.toBe(PROPIA);

    const guardadas = mockSetting.filas.filter((f) => f.empresa_id === NUEVA);
    expect(guardadas.map((f) => f.key)).toContain('tiendanube_access_token');
  });

  it('la sucursal designada es la principal de la empresa, no la de menor id', async () => {
    const state = sembrarState({ empresa_id: NUEVA });

    await callback({ code: 'abc123', state: state.token });

    // NUEVA tiene la 40 ('salon') y la 41 ('principal'). El orden de
    // `elegirPorDefecto` es code 'principal' → activa de menor id → menor id:
    // con la 40 aca, la designada saldria del escalon equivocado.
    expect(mockTiendanubeTienda.filas[0].punto_de_venta_id).toBe(41);
  });

  it('una empresa sin ninguna sucursal no vincula, y ni siquiera canjea el code', async () => {
    const state = sembrarState({ empresa_id: SIN_SUCURSALES });

    const res = await callback({ code: 'abc123', state: state.token });

    expect(motivoDe(res)).toBe('sin_sucursal');
    // La sucursal se resuelve ANTES del canje justamente por esto: si se
    // resolviera despues, el token quedaria guardado colgado de una vinculacion
    // que no existe y nada lo nombraria.
    expect(axios.post).not.toHaveBeenCalled();
    expect(mockSetting.filas.filter((f) => f.empresa_id === SIN_SUCURSALES)).toEqual([]);
  });

  it('si esa tienda ya es de otra empresa responde tienda_ocupada y NO deja el token colgado', async () => {
    // El choque lo tira el UNIQUE de `tiendanube_user_id`, que es FR-036
    // llegando desde la base y no desde una comprobacion del handler.
    sembrarTienda({ empresa_id: AJENA, tiendanube_user_id: USER_ID_DE_LA_TIENDA });
    const state = sembrarState({ empresa_id: NUEVA });

    const res = await callback({ code: 'abc123', state: state.token });

    expect(motivoDe(res)).toBe('tienda_ocupada');
    expect(mockTiendanubeTienda.filas).toHaveLength(1);
    expect(mockTiendanubeTienda.filas[0].empresa_id).toBe(AJENA);
    // El canje SI corrio y guardo el token: lo que se verifica es que despues
    // se haya borrado. Sin esto, NUEVA queda con un token valido de la tienda de
    // AJENA guardado en claro y `GET /status` diciendo «no vinculada».
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(mockSetting.filas.filter((f) => f.empresa_id === NUEVA)).toEqual([]);
  });

  it('si el canje del code falla, el motivo lo distingue de un state inválido', async () => {
    axios.post.mockRejectedValue(new Error('TiendaNube no contesta'));
    const state = sembrarState({ empresa_id: NUEVA });

    const res = await callback({ code: 'abc123', state: state.token });

    // Un fallo del otro lado y un state que no sirve se arreglan distinto:
    // reintentar contra volver a empezar la vinculacion.
    expect(motivoDe(res)).toBe('tiendanube');
    expect(mockTiendanubeTienda.filas).toEqual([]);
  });
});

describe('GET /status · cuatro estados, no un booleano', () => {
  const estadoDe = async (empresaId = PROPIA) => {
    const res = await request(levantarApi(empresaId)).get('/api/tiendanube/status');
    expect(res.status).toBe(200);
    return res.body;
  };

  it('sin TIENDANUBE_CLIENT_ID el estado es sin_configurar y NO no_vinculada', async () => {
    delete process.env.TIENDANUBE_CLIENT_ID;
    sembrarTienda();

    const cuerpo = await estadoDe();

    // Son dos problemas con dos soluciones distintas: una la arregla quien
    // opera el servidor y la otra el dueño de la tienda.
    expect(cuerpo.estado).toBe('sin_configurar');
    expect(cuerpo.tienda).toBeNull();
  });

  it('sin fila de tienda el estado es no_vinculada y tienda es null', async () => {
    const cuerpo = await estadoDe();

    expect(cuerpo.estado).toBe('no_vinculada');
    expect(cuerpo.tienda).toBeNull();
    expect(cuerpo.variantes).toEqual({ total: 0, mapeadas: 0, pendientes: 0, con_error: 0 });
  });

  it('con ultima_comunicacion_ok en false el estado es vinculada_con_error', async () => {
    sembrarTienda({ ultima_comunicacion_ok: false, ultimo_error: 'Tu tienda desconectó AdminApp.' });

    const cuerpo = await estadoDe();

    expect(cuerpo.estado).toBe('vinculada_con_error');
    expect(cuerpo.tienda.ultimo_error).toContain('desconectó');
  });

  it('con ultima_comunicacion_ok en null el estado es vinculada: todavía no hablamos, y eso no es un error', async () => {
    // Es el estado de una tienda recien vinculada. Tratarlo como error dejaria
    // toda vinculacion nueva pintada en rojo desde el primer segundo.
    sembrarTienda({ ultima_comunicacion_ok: null });

    expect((await estadoDe()).estado).toBe('vinculada');
  });

  it('la sucursal designada viaja con su nombre, y es la de la tienda', async () => {
    sembrarTienda({ punto_de_venta_id: 31 });

    const cuerpo = await estadoDe();

    // De esta sucursal sale el stock que se publica y ahi se descuenta el
    // pedido: el bloque de estado tiene que decir cual es, no solo que hay una.
    expect(cuerpo.tienda.punto_de_venta).toEqual({ id: 31, name: 'Depósito Mayo', code: 'mayo' });
  });

  it('los conteos son los de la empresa de la sesión y no los de la otra', async () => {
    sembrarTienda();
    mockTiendanubeVariante.filas = [
      { id: 1, empresa_id: PROPIA, tiendanube_variant_id: 111, tiendanube_product_id: 10 },
      { id: 2, empresa_id: PROPIA, tiendanube_variant_id: 222, tiendanube_product_id: 10 },
      { id: 3, empresa_id: AJENA, tiendanube_variant_id: 333, tiendanube_product_id: 20 },
    ];
    mockTiendanubeMapping.filas = [
      { id: 1, empresa_id: PROPIA, product_id: 501, tiendanube_variant_id: 111, tiendanube_product_id: 10 },
      { id: 2, empresa_id: AJENA, product_id: 900, tiendanube_variant_id: 333, tiendanube_product_id: 20 },
    ];

    const cuerpo = await estadoDe();

    // Sin las filas de AJENA, un `count` al que se le escape el `empresa_id`
    // daria exactamente el mismo numero.
    expect(cuerpo.variantes.total).toBe(2);
    expect(cuerpo.variantes.mapeadas).toBe(1);
  });

  it('una sincronización vieja no cuenta como una corriendo', async () => {
    // El arriendo vence a los diez minutos: sin vencimiento, una corrida que
    // murio por la mitad dejaria la sincronizacion bloqueada para siempre.
    sembrarTienda({ sincronizando_desde: new Date(Date.now() - 30 * 60 * 1000) });

    expect((await estadoDe()).tienda.sincronizando).toBe(false);

    mockTiendanubeTienda.filas = [];
    sembrarTienda({ sincronizando_desde: new Date() });

    expect((await estadoDe()).tienda.sincronizando).toBe(true);
  });

  it('la respuesta NO contiene el token de ninguna forma, ni truncado', async () => {
    sembrarTienda();

    const res = await request(levantarApi(PROPIA)).get('/api/tiendanube/status');

    // El ancla: tiene que haber contestado con la tienda, si no la prueba pasa
    // por no haber tenido el token cerca.
    expect(res.body.tienda).not.toBeNull();
    expect(pedazosDelToken(JSON.stringify(res.body))).toEqual([]);
  });
});

describe('PUT /sucursal · la sucursal designada, y lo que arrastra cambiarla', () => {
  const cambiar = (empresaId, cuerpo) =>
    request(levantarApi(empresaId)).put('/api/tiendanube/sucursal').send(cuerpo);

  it('sin punto_de_venta_id responde 400 y no 500', async () => {
    sembrarTienda();

    const res = await cambiar(PROPIA, {});

    expect(res.status).toBe(400);
    expect(mockTiendanubeTienda.filas[0].punto_de_venta_id).toBe(30);
  });

  it('sin tienda vinculada responde 409', async () => {
    const res = await cambiar(PROPIA, { punto_de_venta_id: 31 });

    expect(res.status).toBe(409);
  });

  it('con un punto de venta de otra empresa responde 404 y no cambia nada', async () => {
    sembrarTienda({ punto_de_venta_id: 30 });

    const res = await cambiar(PROPIA, { punto_de_venta_id: 90 });

    // 404 y no 403: un 403 confirmaria que ese punto de venta existe en otra
    // empresa, que es justo lo que permite enumerar ids ajenos.
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
    expect(mockTiendanubeTienda.filas[0].punto_de_venta_id).toBe(30);
  });

  it('devuelve cuántas variantes quedaron encoladas, y encola solo las mapeadas de la empresa', async () => {
    sembrarTienda({ punto_de_venta_id: 30 });
    mockTiendanubeMapping.filas = [
      { id: 1, empresa_id: PROPIA, product_id: 501, tiendanube_variant_id: 111, tiendanube_product_id: 10 },
      { id: 2, empresa_id: PROPIA, product_id: 502, tiendanube_variant_id: 222, tiendanube_product_id: 10 },
      { id: 3, empresa_id: AJENA, product_id: 900, tiendanube_variant_id: 333, tiendanube_product_id: 20 },
    ];
    mockTiendanubeVariante.filas = [
      { id: 1, empresa_id: PROPIA, tiendanube_variant_id: 111, pendiente_desde: null },
      { id: 2, empresa_id: PROPIA, tiendanube_variant_id: 222, pendiente_desde: null },
      // Sin mapear: no se encola, porque no hay a que producto mirarle el stock.
      { id: 3, empresa_id: PROPIA, tiendanube_variant_id: 999, pendiente_desde: null },
      // Mismo id de variante, otra empresa: la fixture existe para que un
      // `where` al que se le escape el empresa_id de un numero distinto.
      { id: 4, empresa_id: AJENA, tiendanube_variant_id: 111, pendiente_desde: null },
    ];

    const res = await cambiar(PROPIA, { punto_de_venta_id: 31 });

    expect(res.status).toBe(200);
    expect(res.body.punto_de_venta).toEqual({ id: 31, name: 'Depósito Mayo', code: 'mayo' });
    // ⚠ No es informativo: cambiar la sucursal mueve TODOS los numeros
    // publicados, y la pantalla usa este numero en la confirmacion antes de que
    // alguien acepte. Si el PUT no encolara, la tienda seguiria publicando el
    // stock de la sucursal vieja hasta el proximo movimiento de cada producto.
    expect(res.body.encoladas).toBe(2);
    expect(mockTiendanubeTienda.filas[0].punto_de_venta_id).toBe(31);
  });

  it('sin ningún mapeo devuelve cero encoladas y no falla', async () => {
    sembrarTienda();

    const res = await cambiar(PROPIA, { punto_de_venta_id: 31 });

    expect(res.status).toBe(200);
    expect(res.body.encoladas).toBe(0);
  });
});

describe('DELETE /vinculacion · qué se borra y qué se conserva', () => {
  const desvincular = (empresaId) =>
    request(levantarApi(empresaId)).delete('/api/tiendanube/vinculacion');

  it('sin tienda vinculada responde 404', async () => {
    const res = await desvincular(PROPIA);

    expect(res.status).toBe(404);
  });

  it('borra el token y la instantánea, y NO borra los mapeos', async () => {
    sembrarTienda();
    mockTiendanubeMapping.filas = [
      { id: 1, empresa_id: PROPIA, product_id: 501, tiendanube_variant_id: 111, tiendanube_product_id: 10 },
      { id: 2, empresa_id: PROPIA, product_id: 502, tiendanube_variant_id: 222, tiendanube_product_id: 10 },
    ];
    mockTiendanubeVariante.filas = [
      { id: 1, empresa_id: PROPIA, tiendanube_variant_id: 111 },
      { id: 2, empresa_id: AJENA, tiendanube_variant_id: 333 },
    ];
    mockSetting.filas.push({ key: 'tiendanube_access_token', value: 'token-de-otro', empresa_id: AJENA });

    const res = await desvincular(PROPIA);

    expect(res.status).toBe(200);
    // La pantalla repite este numero en la confirmacion: «se conservan 2
    // mapeos» es lo que hace que volver a vincular la misma tienda no sea
    // empezar de cero.
    expect(res.body.mapeos_conservados).toBe(2);

    expect(mockTiendanubeMapping.filas).toHaveLength(2);
    expect(mockTiendanubeTienda.filas).toEqual([]);
    expect(mockSetting.filas.filter((f) => f.empresa_id === PROPIA)).toEqual([]);
    // La instantanea es una copia de un catalogo al que ya no tenemos acceso.
    expect(mockTiendanubeVariante.filas.map((f) => f.empresa_id)).toEqual([AJENA]);
    // Y lo de la otra empresa queda intacto: un `where` sin empresa_id se
    // llevaria puesta la vinculacion de otro cliente.
    expect(mockSetting.filas.filter((f) => f.empresa_id === AJENA)).toHaveLength(1);
  });
});

// ════════════════════════════════════════════
//  El webhook, que hasta este hito respondia 401 SIEMPRE
//
//  `server.js:149` montaba `express.json()` para toda la aplicacion antes del
//  router publico. Cuando la peticion llegaba al `express.json({ verify })` del
//  webhook, body-parser veia el cuerpo ya parseado y salia sin ejecutar el
//  `verify`: `req.rawBody` quedaba `undefined`, `firmaValida` cortaba ahi y
//  **ningun pedido de la tienda online desconto stock jamas**.
//
//  ── Lo que este nivel NO contesta, y hay que decirlo ──
//
//  Que TiendaNube firme con esta cabecera y este algoritmo. **No hay entorno de
//  pruebas del tercero** (supuesto 11): aca AdminApp verifica lo que AdminApp
//  firmo, que es el circuito, no el contrato del otro lado. Eso es el paso
//  manual P2.
//
//  Tampoco contesta la atomicidad ni la idempotencia: los dobles no entienden
//  transacciones ni restricciones unicas —lo dice su encabezado— y un `rollback`
//  aca no deshace un `push` a un array. Los cinco casos que importan estan en
//  `integracion/tiendanubeWebhook.integracion.test.js`.
// ════════════════════════════════════════════

/** El id de tienda de PROPIA en los casos del webhook. */
const STORE_ID = 4455667;

/**
 * La API con **solo** el router publico y SIN `express.json()` delante.
 *
 * Es el orden que `server.js` tiene desde este hito, y es el unico con el que el
 * webhook puede funcionar. `levantarApi` monta `express.json()` primero —le hace
 * falta a los endpoints privados— y con ese orden **todos** estos casos darian
 * 401: seria reproducir el defecto en el arnes y llamarlo prueba.
 *
 * Que el orden real de `server.js` sea este lo verifica la guardia de
 * `observabilidad.test.js`; que el cuerpo crudo llegue de punta a punta, el test
 * de integracion.
 */
function levantarWebhook() {
  const api = express();
  api.use('/api/tiendanube', publico);
  return api;
}

/**
 * Postea un webhook firmado con el secreto del servidor.
 *
 * @param {object} cuerpo El pedido.
 * @param {object} [opciones]
 * @param {string} [opciones.evento] La cabecera `x-event`.
 * @param {string|null} [opciones.firma] `null` = no mandar la cabecera; un string
 *   = mandar esa firma en vez de la correcta.
 */
function postearWebhook(cuerpo, { evento = 'order/paid', firma } = {}) {
  const texto = JSON.stringify(cuerpo);
  const secreto = process.env.TIENDANUBE_CLIENT_SECRET;

  const peticion = request(levantarWebhook())
    .post('/api/tiendanube/webhook')
    .set('Content-Type', 'application/json')
    .set('x-event', evento);

  if (firma !== null) {
    const correcta = secreto
      ? crypto.createHmac('sha256', secreto).update(texto).digest('hex')
      : 'da'.repeat(32);

    peticion.set('x-linkedstore-hmac-sha256', firma === undefined ? correcta : firma);
  }

  return peticion.send(texto);
}

/** Un `order/paid` de la tienda de PROPIA. */
function pedido(items, cambios = {}) {
  return { id: 3344556, number: '1043', store_id: STORE_ID, products: items, ...cambios };
}

/**
 * La tienda de PROPIA, con el `tiendanube_user_id` **como texto**.
 *
 * No es un capricho del doble: la columna es BIGINT y el driver de Postgres
 * devuelve `int8` como string, asi que esta es la forma en la que el dato existe
 * cuando el codigo lo compara.
 */
function sembrarTiendaDelWebhook(cambios = {}) {
  return sembrarTienda({ tiendanube_user_id: String(STORE_ID), punto_de_venta_id: 31, ...cambios });
}

describe('POST /webhook · el rechazo por firma dice CUAL de las tres cosas falto', () => {
  it('el webhook con firma inválida responde 401 y loguea el evento y el origen', async () => {
    const avisos = jest.spyOn(logger, 'warn').mockImplementation(() => {});

    const res = await postearWebhook(pedido([]), { firma: 'ab'.repeat(32) });

    // Es el unico camino del webhook que no responde 200: un webhook que no se
    // puede autenticar no es un webhook.
    expect(res.status).toBe(401);

    const rechazo = avisos.mock.calls.find(([, mensaje]) => /firma invalida/.test(mensaje));

    expect(rechazo).toBeDefined();
    expect(rechazo[0].evento).toBe('order/paid');
    expect(rechazo[0].ip).toBeDefined();
    expect(mockTiendanubePedido.filas).toEqual([]);
  });

  it('sin TIENDANUBE_CLIENT_SECRET el log dice que falta el secreto, no que la firma no valida', async () => {
    // Riesgo 10: `firmaValida` devuelve false si falta el secreto, asi que un
    // despliegue mal configurado y un intento de suplantacion producian el mismo
    // 401 y el mismo warn. Quien opera no tenia forma de distinguirlos, y las dos
    // cosas se arreglan distinto.
    delete process.env.TIENDANUBE_CLIENT_SECRET;
    const avisos = jest.spyOn(logger, 'warn').mockImplementation(() => {});

    const res = await postearWebhook(pedido([]));

    expect(res.status).toBe(401);
    expect(avisos.mock.calls[0][0].motivo).toBe('sin_secreto_en_el_servidor');
  });

  it('sin la cabecera de firma el motivo es la cabecera, y no el secreto', async () => {
    const avisos = jest.spyOn(logger, 'warn').mockImplementation(() => {});

    await postearWebhook(pedido([]), { firma: null });

    expect(avisos.mock.calls[0][0].motivo).toBe('sin_cabecera_de_firma');
  });

  it('los tres motivos son distintos entre sí: si no, el log no sirve para nada', async () => {
    // El ancla de los dos casos de arriba. Con un solo `logger.warn` que diga
    // «firma invalida» para los tres, cada caso por separado seguiria pasando si
    // se afirmara solo el 401.
    const avisos = jest.spyOn(logger, 'warn').mockImplementation(() => {});

    await postearWebhook(pedido([]), { firma: 'ab'.repeat(32) });
    await postearWebhook(pedido([]), { firma: null });
    delete process.env.TIENDANUBE_CLIENT_SECRET;
    await postearWebhook(pedido([]));

    const motivos = avisos.mock.calls.map(([contexto]) => contexto.motivo);

    expect(new Set(motivos).size).toBe(3);
    expect(motivos).toContain('no_coincide');
  });
});

describe('POST /webhook · lo que responde 200 sin descontar nada', () => {
  it('un evento que no es order/paid responde 200 sin procesar', async () => {
    // No se agrega `order/created`: un pedido normal dispara los dos y el stock
    // se descontaba DOS veces por la misma venta.
    sembrarTiendaDelWebhook();

    const res = await postearWebhook(pedido([{ variant_id: 111, quantity: 1 }]), {
      evento: 'order/created',
    });

    expect(res.status).toBe(200);
    expect(mockTiendanubePedido.filas).toEqual([]);
  });

  it('un pedido de una tienda no vinculada responde 200 y loguea', async () => {
    // 200 y no 404: TiendaNube deshabilita el webhook ante errores repetidos, y
    // un webhook deshabilitado es una integracion apagada del otro lado que nadie
    // puede volver a prender desde AdminApp.
    const avisos = jest.spyOn(logger, 'warn').mockImplementation(() => {});

    const res = await postearWebhook(pedido([{ variant_id: 111, quantity: 1 }], { store_id: 999999 }));

    expect(res.status).toBe(200);
    expect(avisos.mock.calls[0][0].storeId).toBe(999999);
    expect(mockTiendanubePedido.filas).toEqual([]);
  });
});

describe('POST /webhook · la empresa sale del índice único de la tienda, no de settings', () => {
  it('resuelve por tiendanube_tiendas aunque settings diga otra empresa', async () => {
    // ⚠ La fixture es lo que hace distinguible el cambio: hasta hoy la empresa
    // salia de `Setting.findAll({ key: 'tiendanube_user_id' })` **sobre todas las
    // empresas**, quedandose con el primer match, sobre una tabla cuya PK es
    // (key, empresa_id) — o sea que dos empresas podian guardar el mismo id de
    // tienda y el pedido le descontaba a la que Postgres devolviera primero.
    // Con esta fila de `settings` apuntando a AJENA, la version vieja descuenta
    // en la empresa equivocada.
    mockSetting.filas.push({ key: 'tiendanube_user_id', value: STORE_ID, empresa_id: AJENA });
    sembrarTiendaDelWebhook();

    mockTiendanubeMapping.filas = [
      { id: 1, empresa_id: PROPIA, product_id: 501, tiendanube_variant_id: 111, tiendanube_product_id: 10 },
      { id: 2, empresa_id: AJENA, product_id: 900, tiendanube_variant_id: 111, tiendanube_product_id: 10 },
    ];
    mockStock.filas = [
      { id: 1, empresa_id: PROPIA, product_id: 501, punto_de_venta_id: 31, quantity: 8, available: 6 },
      { id: 2, empresa_id: AJENA, product_id: 900, punto_de_venta_id: 90, quantity: 40, available: 40 },
    ];

    const res = await postearWebhook(pedido([{ variant_id: 111, quantity: 2 }]));

    expect(res.status).toBe(200);
    expect(mockTiendanubePedido.filas).toHaveLength(1);
    expect(mockTiendanubePedido.filas[0].empresa_id).toBe(PROPIA);

    expect(mockStock.filas[0]).toMatchObject({ quantity: 6, available: 4 });
    // Y la empresa de la fila de `settings` no perdio ni una unidad.
    expect(mockStock.filas[1]).toMatchObject({ quantity: 40, available: 40 });
  });
});

describe('POST /webhook · el descuento sale de la sucursal DESIGNADA', () => {
  it('descuenta de la sucursal de la tienda y no de la por defecto', async () => {
    // La designada es la 31 y `sucursalPorDefecto` elegiria la 30 (no hay ninguna
    // con code 'principal', asi que gana la activa de menor id). Con las dos
    // siendo la misma, este caso pasaria con y sin el arreglo: hasta hoy el
    // webhook pasaba `null` y `resolverSucursal` caia al escalon por defecto.
    sembrarTiendaDelWebhook({ punto_de_venta_id: 31 });

    mockTiendanubeMapping.filas = [
      { id: 1, empresa_id: PROPIA, product_id: 501, tiendanube_variant_id: 111, tiendanube_product_id: 10 },
    ];
    mockStock.filas = [
      { id: 1, empresa_id: PROPIA, product_id: 501, punto_de_venta_id: 30, quantity: 10, available: 10 },
      { id: 2, empresa_id: PROPIA, product_id: 501, punto_de_venta_id: 31, quantity: 8, available: 6 },
    ];

    await postearWebhook(pedido([{ variant_id: 111, quantity: 2 }]));

    // Baja `quantity` Y `available`, que es FR-028: son dos numeros distintos
    // —«cant» y «disp»— y en la fixture arrancan distintos a proposito.
    expect(mockStock.filas[1]).toMatchObject({ quantity: 6, available: 4 });
    expect(mockStock.filas[0]).toMatchObject({ quantity: 10, available: 10 });

    // Y el movimiento queda con la sucursal de la que salio la mercaderia.
    expect(mockStockMovement.filas).toHaveLength(1);
    expect(mockStockMovement.filas[0]).toMatchObject({
      punto_de_venta_id: 31,
      tipo: 'tiendanube_sale',
      referencia_id: 'tn_order_3344556',
      cantidad_anterior: 8,
      cantidad_nueva: 6,
      disponible_anterior: 6,
      disponible_nuevo: 4,
    });
  });

  it('la fila del pedido guarda la sucursal designada del momento', async () => {
    // Si la designada cambia la semana que viene, este pedido tiene que seguir
    // diciendo de donde salio la mercaderia.
    sembrarTiendaDelWebhook({ punto_de_venta_id: 31 });

    await postearWebhook(pedido([{ variant_id: 111, quantity: 1 }]));

    expect(mockTiendanubePedido.filas[0].punto_de_venta_id).toBe(31);
    expect(mockTiendanubePedido.filas[0].numero).toBe('1043');
  });
});

describe('POST /webhook · el ítem que no descontó queda ANOTADO, no salteado', () => {
  beforeEach(() => {
    sembrarTiendaDelWebhook();
    mockTiendanubeMapping.filas = [
      { id: 1, empresa_id: PROPIA, product_id: 501, tiendanube_variant_id: 111, tiendanube_product_id: 10 },
    ];
    mockStock.filas = [
      { id: 1, empresa_id: PROPIA, product_id: 501, punto_de_venta_id: 31, quantity: 8, available: 6 },
    ];
  });

  /** Los items del unico pedido que quedo escrito. */
  const itemsDelPedido = () => mockTiendanubePedido.filas[0].items;

  it('un ítem sin variant_id queda anotado con motivo sin_variante y no se saltea en silencio', async () => {
    await postearWebhook(pedido([{ quantity: 3 }]));

    expect(itemsDelPedido()).toEqual([
      { variante: null, cantidad: 3, product_id: null, descontado: false, motivo: 'sin_variante' },
    ]);
    expect(mockTiendanubePedido.filas[0].items_sin_descontar).toBe(1);
  });

  it('un ítem de cantidad cero queda anotado con motivo cantidad_cero', async () => {
    // Hasta hoy el `item.quantity || 1` convertia un cero en un descuento de una
    // unidad que nadie pidio.
    await postearWebhook(pedido([{ variant_id: 111, quantity: 0 }]));

    expect(itemsDelPedido()[0].motivo).toBe('cantidad_cero');
    expect(mockStock.filas[0]).toMatchObject({ quantity: 8, available: 6 });
  });

  it('un ítem sin mapeo y uno sin fila de stock también quedan con su motivo', async () => {
    mockTiendanubeMapping.filas.push(
      { id: 2, empresa_id: PROPIA, product_id: 502, tiendanube_variant_id: 222, tiendanube_product_id: 10 }
    );

    await postearWebhook(pedido([
      { variant_id: 999, quantity: 1 },
      { variant_id: 222, quantity: 1 },
    ]));

    // 502 esta mapeado pero no tiene fila de stock en la sucursal designada: no
    // se inventa una ni se descuenta de otra sucursal.
    expect(itemsDelPedido().map((i) => i.motivo)).toEqual(['sin_mapeo', 'sin_stock_en_sucursal']);
    expect(itemsDelPedido()[1].product_id).toBe(502);
  });

  it('un pedido mezclado cuenta bien los dos lados', async () => {
    // Es lo que hace visible el escenario 7 de US2 desde la pantalla: un pedido
    // que desconto «casi todo» tiene que poder distinguirse de uno que desconto
    // todo, y el numero es el que lista `GET /pedidos`.
    await postearWebhook(pedido([
      { variant_id: 111, quantity: 2 },
      { quantity: 1 },
      { variant_id: 111, quantity: 0 },
    ]));

    const fila = mockTiendanubePedido.filas[0];

    expect(fila.items_descontados).toBe(1);
    expect(fila.items_sin_descontar).toBe(2);
    expect(fila.items.map((i) => i.descontado)).toEqual([true, false, false]);
    expect(mockStock.filas[0]).toMatchObject({ quantity: 6, available: 4 });
  });
});

describe('GET /pedidos · lo que no descontó se puede LEER', () => {
  const sembrarPedidos = () => {
    mockTiendanubePedido.filas = [
      {
        id: 1, empresa_id: PROPIA, tiendanube_order_id: '3344551', numero: '1041',
        recibido_en: '2026-08-10T10:00:00.000Z', punto_de_venta_id: 31,
        items: [{ variante: 111, cantidad: 1, product_id: 501, descontado: true, motivo: null }],
        items_descontados: 1, items_sin_descontar: 0,
      },
      {
        id: 2, empresa_id: PROPIA, tiendanube_order_id: '3344552', numero: '1042',
        recibido_en: '2026-08-11T10:00:00.000Z', punto_de_venta_id: 31,
        items: [{ variante: 333, cantidad: 2, product_id: null, descontado: false, motivo: 'sin_mapeo' }],
        items_descontados: 0, items_sin_descontar: 1,
      },
      {
        id: 3, empresa_id: PROPIA, tiendanube_order_id: '3344553', numero: '1043',
        recibido_en: '2026-08-12T10:00:00.000Z', punto_de_venta_id: 31,
        items: [], items_descontados: 2, items_sin_descontar: 0,
      },
      {
        id: 4, empresa_id: AJENA, tiendanube_order_id: '9999991', numero: '77',
        recibido_en: '2026-08-13T10:00:00.000Z', punto_de_venta_id: 90,
        items: [{ variante: 6000001, cantidad: 1, product_id: 900, descontado: false, motivo: 'sin_mapeo' }],
        items_descontados: 0, items_sin_descontar: 1,
      },
    ];
  };

  const listar = (empresaId, query = '') =>
    request(levantarApi(empresaId)).get(`/api/tiendanube/pedidos${query}`);

  it('sin filtro devuelve todos los de la empresa, del más nuevo al más viejo', async () => {
    // El ancla: sin este caso, un filtro que devuelva siempre cero pasaria el
    // siguiente sin haber mirado nada.
    sembrarPedidos();

    const res = await listar(PROPIA);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.data.map((p) => p.numero)).toEqual(['1043', '1042', '1041']);
  });

  it('solo_con_problemas devuelve únicamente los pedidos con items_sin_descontar > 0', async () => {
    sembrarPedidos();

    const res = await listar(PROPIA, '?solo_con_problemas=true');

    expect(res.body.total).toBe(1);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].numero).toBe('1042');
    expect(res.body.data[0].items[0].motivo).toBe('sin_mapeo');
  });

  it('la empresa B no ve los pedidos de la A', async () => {
    sembrarPedidos();

    const res = await listar(AJENA);

    expect(res.body.total).toBe(1);
    expect(res.body.data[0].numero).toBe('77');
    expect(res.body.data.map((p) => p.numero)).not.toContain('1042');
  });

  it('la segunda página trae lo que la primera no trajo', async () => {
    // Una lista de una sola pagina es la fixture con la que este proyecto ya se
    // equivoco: con tres filas y un limit de dos, un `offset` que no viaje deja
    // la pagina 2 devolviendo lo mismo que la 1.
    sembrarPedidos();

    const primera = await listar(PROPIA, '?limit=2&page=1');
    const segunda = await listar(PROPIA, '?limit=2&page=2');

    expect(primera.body.data.map((p) => p.numero)).toEqual(['1043', '1042']);
    expect(segunda.body.data.map((p) => p.numero)).toEqual(['1041']);
    // El total es el de la consulta y no el de la pagina: de ese numero salen
    // las paginas que dibuja la pantalla.
    expect(segunda.body.total).toBe(3);
  });

  it('el listado NO devuelve el token ni ningún dato de la vinculación', async () => {
    sembrarTiendaDelWebhook();
    sembrarPedidos();

    const res = await listar(PROPIA);

    expect(res.body.data).not.toHaveLength(0);
    expect(pedazosDelToken(JSON.stringify(res.body))).toEqual([]);
    // Los campos son los del contrato y nada mas: devolver la fila cruda haria
    // que la columna que alguien agregue maniana se publique sola.
    expect(Object.keys(res.body.data[0]).sort()).toEqual([
      'id', 'items', 'items_descontados', 'items_sin_descontar',
      'numero', 'recibido_en', 'tiendanube_order_id',
    ]);
  });
});

// ════════════════════════════════════════════
//  El catalogo: TODAS las paginas, y una instantanea sobre la que se puede
//  buscar
//
//  ── Que habia antes ──
//
//  `GET /api/tiendanube/products` pasaba a traves la respuesta cruda de
//  TiendaNube: pedia `/v1/{user_id}/products` **sin `page` ni `per_page`** y
//  devolvia `response.data`. O sea la primera pagina y nada mas, descartando las
//  cabeceras que dicen cuantas hay. Una tienda con mas productos de los que
//  entran en una pagina mostraba los primeros y **el resto no se podia mapear**,
//  sin que nada avisara: la lista se veia completa.
//
//  Y no habia ninguna instantanea, asi que «cuantas variantes hay», «cuales no
//  estan mapeadas» y «busca esto» no se podian contestar: no se puede filtrar
//  sobre una pagina que todavia no se pidio, y filtrar sobre la que llego es el
//  mismo defecto con otro nombre — el que tuvo la pantalla de ordenes de compra,
//  donde buscar una orden que existia devolvia «ninguna coincide» y la red ni se
//  tocaba.
//
//  ── Lo que este nivel NO contesta ──
//
//  La busqueda por `?q=`: se resuelve con `translate()` en SQL y este doble no
//  entiende una clave `Symbol`, asi que un caso escrito aca devolveria TODO y
//  pasaria por no haber filtrado. `CONVENCIONES.md` nombra `translate()` entre
//  lo que va al cuarto nivel, y ahi esta.
//
//  Tampoco que el `ON CONFLICT` sea de verdad: aca se simula.
// ════════════════════════════════════════════

const tiendanubeService = require('../services/tiendanubeService');

/** El tamanio de pagina que pide el servicio. Una pagina mas corta es la ultima. */
const POR_PAGINA = 200;

/** Una pagina del catalogo de TiendaNube, con una variante por producto. */
function paginaDeCatalogo(cantidad, desde) {
  return Array.from({ length: cantidad }, (_, i) => ({
    id: 700000 + desde + i,
    name: { es: `Producto ${desde + i}` },
    variants: [{
      id: 5000000 + desde + i,
      sku: `SKU-${desde + i}`,
      stock: 3,
      values: [{ es: 'unico' }],
    }],
  }));
}

/** Un error de axios con status y, si hace falta, cabeceras. */
function errorHttp(status, headers = {}) {
  const err = new Error(`Request failed with status code ${status}`);
  err.response = { status, headers, data: { code: 'error' } };
  return err;
}

const refrescar = (empresaId = PROPIA) =>
  request(levantarApi(empresaId)).post('/api/tiendanube/variantes/refrescar');

const listarVariantes = (empresaId, query = '') =>
  request(levantarApi(empresaId)).get(`/api/tiendanube/variantes${query}`);

describe('POST /variantes/refrescar · el catalogo entero, no la primera pagina', () => {
  beforeEach(() => {
    sembrarTienda({ catalogo_refrescado_en: null });
  });

  it('el refresco de una tienda de tres paginas deja las variantes de las TRES', async () => {
    // ⚠ Con una sola pagina en la fixture, «trae todo» y «trae la primera» dan
    // el mismo resultado y este caso pasaria con y sin el arreglo. Las dos
    // primeras vienen COMPLETAS —200— porque lo que dice «era la ultima» es que
    // la pagina volvio corta.
    axios.get
      .mockResolvedValueOnce({ data: paginaDeCatalogo(POR_PAGINA, 1) })
      .mockResolvedValueOnce({ data: paginaDeCatalogo(POR_PAGINA, 201) })
      .mockResolvedValueOnce({ data: paginaDeCatalogo(5, 401) });

    const res = await refrescar();

    expect(res.status).toBe(200);
    expect(res.body.paginas).toBe(3);
    expect(res.body.variantes).toBe(405);

    // Y pidio las paginas por numero, no tres veces la misma.
    expect(axios.get.mock.calls.map(([, opciones]) => opciones.params.page)).toEqual([1, 2, 3]);

    // El ancla que muerde: una variante de la TERCERA pagina quedo escrita.
    const deLaTercera = mockTiendanubeVariante.filas.find((v) => v.tiendanube_variant_id === 5000405);
    expect(deLaTercera).toBeDefined();
    expect(deLaTercera.empresa_id).toBe(PROPIA);
  });

  it('no pide una pagina de mas cuando la primera ya vino corta', async () => {
    // El otro lado del corte: sin el, el refresco de una tienda chica gasta una
    // llamada de la cuota por vuelta hasta el tope de cien.
    axios.get.mockResolvedValue({ data: paginaDeCatalogo(3, 1) });

    const res = await refrescar();

    expect(res.body.paginas).toBe(1);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('refrescar dos veces NO duplica: el conflicto es contra (empresa, variante)', async () => {
    // Es lo que hace `conflictAttributes`. Sin el, Sequelize apunta al `id` —la
    // clave primaria— y cada refresco inserta el catalogo entero de nuevo: la
    // pantalla muestra cada variante N veces y el mapeo no sabe cual es cual.
    axios.get.mockResolvedValue({ data: paginaDeCatalogo(3, 1) });

    await refrescar();
    const segundo = await refrescar();

    expect(segundo.body.variantes).toBe(3);
    expect(segundo.body.nuevas).toBe(0);
    expect(mockTiendanubeVariante.filas.filter((v) => v.tiendanube_variant_id === 5000001)).toHaveLength(1);
  });

  it('el refresco NO pisa lo que la variante debe: la cola sobrevive', async () => {
    // `stock_publicado`, `pendiente_desde` e `intentos` son lo que le debemos a
    // la variante, no lo que la tienda dice de ella. Pisarlos una vez por dia
    // borraria el registro de lo que se mando y sacaria de la cola todo lo que
    // estaba esperando, sin que nada avise.
    mockTiendanubeVariante.filas = [variante({
      id: 1, empresa_id: PROPIA, tiendanube_variant_id: 5000001,
      stock_publicado: 12, pendiente_desde: new Date('2026-08-11T10:00:00.000Z'), intentos: 3,
    })];

    axios.get.mockResolvedValue({ data: paginaDeCatalogo(1, 1) });

    await refrescar();

    const fila = mockTiendanubeVariante.filas[0];

    expect(fila.stock_publicado).toBe(12);
    expect(fila.pendiente_desde).not.toBeNull();
    expect(fila.intentos).toBe(3);
    // Y lo que SI se pisa: el nombre y el stock que dice la tienda.
    expect(fila.nombre_producto).toBe('Producto 1');
    expect(fila.stock_en_tienda).toBe(3);
  });

  it('las que ya no estan en el catalogo NO se borran, y se cuentan', async () => {
    // Borrarlas se llevaria el registro de lo que se publico y dejaria al mapeo
    // apuntando a la nada sin ninguna explicacion.
    axios.get.mockResolvedValue({ data: paginaDeCatalogo(1, 1) });

    const res = await refrescar();

    // Las dos de PROPIA que estaban sembradas no vinieron en el catalogo.
    expect(res.body.desaparecidas).toBe(2);
    expect(mockTiendanubeVariante.filas.some((v) => v.tiendanube_variant_id === 998877)).toBe(true);
  });

  it('deja la fecha del refresco, que es lo que la pantalla muestra', async () => {
    axios.get.mockResolvedValue({ data: paginaDeCatalogo(1, 1) });

    const res = await refrescar();

    expect(res.body.refrescado_en).toBeDefined();
    expect(mockTiendanubeTienda.filas[0].catalogo_refrescado_en).toEqual(new Date(res.body.refrescado_en));
    // Una instantanea sin fecha a la vista es una mentira con horario.
    expect(mockTiendanubeTienda.filas[0].ultima_comunicacion_ok).toBe(true);
  });

  it('sin tienda vinculada responde 409', async () => {
    mockTiendanubeTienda.filas = [];

    const res = await refrescar();

    expect(res.status).toBe(409);
    expect(axios.get).not.toHaveBeenCalled();
  });
});

describe('Un fallo de TiendaNube no se ve igual que un fallo de AdminApp', () => {
  beforeEach(() => {
    sembrarTienda();
  });

  /** El texto y el status que ve el usuario cuando el refresco falla. */
  async function refrescoQueFalla(err) {
    axios.get.mockRejectedValue(err);
    const res = await refrescar();
    return { status: res.status, error: res.body.error, tienda: mockTiendanubeTienda.filas[0] };
  }

  it('un 401 de TiendaNube se traduce a «hay que volver a vincular» y no a un fallo generico', async () => {
    const { status, error, tienda } = await refrescoQueFalla(errorHttp(401));

    // No se arregla reintentando: se arregla volviendo a vincular. Sin esta
    // diferencia la pantalla ofrece «reintentar» para siempre sobre un token que
    // ya no vale.
    expect(status).toBe(400);
    expect(error).toContain('volver a vincularla');
    // Y la tienda queda en «vinculada con error», que es el cuarto estado de
    // FR-006: `GET /status` lo dibuja distinto de «vinculada».
    expect(tienda.ultima_comunicacion_ok).toBe(false);
    expect(tienda.ultimo_error).toContain('volver a vincularla');
  });

  it('un 5xx se distingue de un error de AdminApp en el texto', async () => {
    const { status, error } = await refrescoQueFalla(errorHttp(503));

    expect(status).toBe(502);
    expect(error).toContain('TiendaNube tuvo un problema');
    expect(error).toContain('No es de AdminApp');
  });

  it('un timeout se distingue de los dos', async () => {
    const { status, error } = await refrescoQueFalla(
      Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' })
    );

    expect(status).toBe(502);
    expect(error).toContain('no respondió a tiempo');
  });

  it('los tres textos son DISTINTOS entre si: si no, la distincion no existe', async () => {
    // El ancla. Los tres decian «No se pudo sincronizar el stock con TiendaNube»
    // y cada caso por separado seguiria pasando si solo se afirmara el status.
    const textos = [
      (await refrescoQueFalla(errorHttp(401))).error,
      (await refrescoQueFalla(errorHttp(503))).error,
      (await refrescoQueFalla(Object.assign(new Error('x'), { code: 'ECONNABORTED' }))).error,
    ];

    expect(new Set(textos).size).toBe(3);
  });

  it('un fallo de AdminApp NO dice que fue TiendaNube', async () => {
    // Un 4xx que no es 401 ni 429 es una peticion que armamos mal. Decirle
    // «TiendaNube tuvo un problema» a alguien cuyo problema es nuestro lo manda a
    // revisar el lado equivocado durante una tarde.
    const { status, error } = await refrescoQueFalla(errorHttp(422));

    expect(status).toBe(500);
    expect(error).toBe('No se pudo refrescar el catálogo de TiendaNube');
    expect(error).not.toContain('TiendaNube tuvo un problema');
  });

  it('un 429 se reintenta y el refresco no se pierde', async () => {
    // Un 429 no es un error: es «mas despacio». Sin el reintento, la primera
    // pagina que se pase de cuota corta el refresco entero y la instantanea queda
    // a medias — el estado que FR-057 vino a cerrar, con otro nombre.
    const espera = jest.spyOn(tiendanubeService, 'dormir').mockResolvedValue();

    axios.get
      .mockRejectedValueOnce(errorHttp(429, { 'retry-after': '2' }))
      .mockResolvedValueOnce({ data: paginaDeCatalogo(2, 1) });

    const res = await refrescar();

    expect(res.status).toBe(200);
    expect(res.body.variantes).toBe(2);
    // Y respeto lo que pidio la tienda, no un numero inventado.
    expect(espera).toHaveBeenCalledWith(2000);
  });
});

describe('GET /variantes · se lee la instantanea, no la API', () => {
  beforeEach(() => {
    sembrarTienda({ catalogo_refrescado_en: REFRESCADO_EN });
  });

  it('no llama a TiendaNube: la instantanea es lo que hace barata la pantalla', async () => {
    await listarVariantes(PROPIA);

    // Pedirle las ~20 paginas a una API con cuota en cada carga de pantalla no
    // es una opcion, y es lo que un pasamanos obligaria a hacer.
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('devuelve las de la empresa de la sesion y ninguna de la otra', async () => {
    const res = await listarVariantes(PROPIA);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.data.map((v) => v.tiendanube_variant_id).sort()).toEqual([111222, 998877]);
    // La 998877 esta en las dos empresas: sin el `empresa_id`, el total daria 3.
    expect(mockTiendanubeVariante.filas).toHaveLength(3);
  });

  it('una variante que ya no esta en el catalogo queda con en_la_tienda false y NO se borra', async () => {
    mockTiendanubeVariante.filas.push(variante({
      id: 4, empresa_id: PROPIA, tiendanube_variant_id: 777000,
      nombre_producto: 'Producto que se borro de la tienda',
      // Anterior al ultimo refresco: el catalogo se pidio y esta no vino.
      vista_en: new Date('2026-07-01T09:00:00.000Z'),
    }));

    const res = await listarVariantes(PROPIA);

    const vieja = res.body.data.find((v) => v.tiendanube_variant_id === 777000);
    const actual = res.body.data.find((v) => v.tiendanube_variant_id === 998877);

    expect(vieja).toBeDefined();
    expect(vieja.en_la_tienda).toBe(false);
    // El ancla: si `en_la_tienda` fuera false para todas, este caso pasaria por
    // el motivo equivocado y la pantalla marcaria el catalogo entero.
    expect(actual.en_la_tienda).toBe(true);
  });

  it('sin_mapear=true no devuelve las mapeadas', async () => {
    mockTiendanubeMapping.filas = [
      { id: 1, empresa_id: PROPIA, product_id: 501, tiendanube_variant_id: 998877, tiendanube_product_id: 5544 },
    ];

    const todas = await listarVariantes(PROPIA);
    const sinMapear = await listarVariantes(PROPIA, '?sin_mapear=true');

    // El ancla: sin la primera mitad, un filtro que devolviera siempre cero
    // pasaria la segunda sin haber mirado nada.
    expect(todas.body.total).toBe(2);
    expect(sinMapear.body.total).toBe(1);
    expect(sinMapear.body.data[0].tiendanube_variant_id).toBe(111222);
  });

  it('sin_mapear=0 NO filtra: el string y no cualquier valor con verdad', async () => {
    // '0' en JS es verdadero. Sin comparar contra 'true', `?sin_mapear=0`
    // filtraria al reves de lo que dice.
    const res = await listarVariantes(PROPIA, '?sin_mapear=0');

    expect(res.body.total).toBe(2);
  });

  it('la fila mapeada trae el producto del sistema y el disponible de la sucursal DESIGNADA', async () => {
    mockTiendanubeMapping.filas = [
      { id: 1, empresa_id: PROPIA, product_id: 501, tiendanube_variant_id: 998877, tiendanube_product_id: 5544 },
    ];
    mockStock.filas = [
      // La designada de la fixture es la 30. La 31 tiene otro numero a proposito:
      // con las dos iguales, «salio de la designada» y «salio de la primera fila»
      // darian lo mismo.
      { id: 1, empresa_id: PROPIA, product_id: 501, punto_de_venta_id: 30, quantity: 9, available: 6 },
      { id: 2, empresa_id: PROPIA, product_id: 501, punto_de_venta_id: 31, quantity: 40, available: 40 },
    ];

    const res = await listarVariantes(PROPIA);
    const mapeada = res.body.data.find((v) => v.tiendanube_variant_id === 998877);

    expect(mapeada.mapeo).toMatchObject({ id: 1, product_id: 501, product_name: 'Colágeno 300g' });
    // `available` y no `quantity`: son dos numeros distintos y en la fixture
    // arrancan distintos a proposito.
    expect(mapeada.disponible).toBe(6);
    expect(mapeada.motivo_no_publicado).toBeNull();
  });

  it('mapeada y SIN fila de stock en la sucursal designada: se anota, no se publica cero', async () => {
    // FR-046. Publicar cero agota en la tienda una variante que si tiene
    // mercaderia: el producto deja de venderse y nadie entiende por que.
    mockTiendanubeMapping.filas = [
      { id: 1, empresa_id: PROPIA, product_id: 501, tiendanube_variant_id: 998877, tiendanube_product_id: 5544 },
    ];
    mockStock.filas = [
      // Stock, pero en OTRA sucursal.
      { id: 1, empresa_id: PROPIA, product_id: 501, punto_de_venta_id: 31, quantity: 40, available: 40 },
    ];

    const res = await listarVariantes(PROPIA);
    const mapeada = res.body.data.find((v) => v.tiendanube_variant_id === 998877);

    expect(mapeada.disponible).toBeNull();
    expect(mapeada.motivo_no_publicado).toBe('sin_stock_en_sucursal');
  });

  it('la variante sin mapear trae la sugerencia por SKU, y con dos coincidencias no propone', async () => {
    // [PENDIENTE N3]: propone, no mapea. La 998877 tiene SKU 'COL-300' y hay UN
    // producto con ese SKU; la 111222 tiene 'CRE-300' y hay DOS.
    mockProduct.filas = [
      { id: 501, empresa_id: PROPIA, name: 'Colágeno 300g', sku: 'col-300' },
      { id: 502, empresa_id: PROPIA, name: 'Creatina 300g', sku: 'CRE-300' },
      { id: 503, empresa_id: PROPIA, name: 'Creatina 300g (bidón)', sku: 'CRE-300' },
    ];

    const res = await listarVariantes(PROPIA);

    const unica = res.body.data.find((v) => v.tiendanube_variant_id === 998877);
    const repetida = res.body.data.find((v) => v.tiendanube_variant_id === 111222);

    // Sin distinguir capitalizacion: 'col-300' contra 'COL-300'.
    expect(unica.sugerencia).toEqual({
      coincidencias: 1,
      producto: { id: 501, name: 'Colágeno 300g', sku: 'col-300' },
    });
    // Mapear el primero de dos es como se mapea el producto equivocado sin que
    // nadie lo mire.
    expect(repetida.sugerencia.coincidencias).toBe(2);
    expect(repetida.sugerencia.producto).toBeNull();
  });

  it('limit=999999 se recorta a 200 y no rechaza', async () => {
    mockTiendanubeVariante.filas = Array.from({ length: 205 }, (_, i) => variante({
      id: i + 1, empresa_id: PROPIA, tiendanube_variant_id: 900000 + i,
      nombre_producto: `Producto ${String(i).padStart(3, '0')}`,
    }));

    const res = await listarVariantes(PROPIA, '?limit=999999');

    // Se recorta, no se rechaza: un limit gigante es alguien que quiere ver
    // todo, no un ataque. Lo que no se puede es servir la tabla entera por HTTP.
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(205);
    expect(res.body.data).toHaveLength(200);
  });

  it('la segunda pagina trae lo que la primera no trajo, y el orden desempata', async () => {
    // Tres variantes del MISMO producto: sin el desempate por variante, la misma
    // fila puede salir en la pagina 1 y en la 2, o en ninguna.
    mockTiendanubeVariante.filas = [
      variante({ id: 1, empresa_id: PROPIA, tiendanube_variant_id: 3003, nombre_producto: 'Harina' }),
      variante({ id: 2, empresa_id: PROPIA, tiendanube_variant_id: 1001, nombre_producto: 'Harina' }),
      variante({ id: 3, empresa_id: PROPIA, tiendanube_variant_id: 2002, nombre_producto: 'Harina' }),
    ];

    const primera = await listarVariantes(PROPIA, '?limit=2&page=1');
    const segunda = await listarVariantes(PROPIA, '?limit=2&page=2');

    expect(primera.body.data.map((v) => v.tiendanube_variant_id)).toEqual([1001, 2002]);
    expect(segunda.body.data.map((v) => v.tiendanube_variant_id)).toEqual([3003]);
    expect(segunda.body.total).toBe(3);
  });

  it('sin tienda vinculada responde 409', async () => {
    mockTiendanubeTienda.filas = [];

    const res = await listarVariantes(PROPIA);

    expect(res.status).toBe(409);
  });
});

describe('GET, POST y DELETE de /mapeos', () => {
  const listarMapeos = (empresaId) =>
    request(levantarApi(empresaId)).get('/api/tiendanube/mapeos');

  const borrarMapeo = (empresaId, id) =>
    request(levantarApi(empresaId)).delete(`/api/tiendanube/mapeos/${id}`);

  beforeEach(() => {
    sembrarTienda({ catalogo_refrescado_en: REFRESCADO_EN });
    mockTiendanubeMapping.filas = [
      { id: 1, empresa_id: PROPIA, product_id: 501, tiendanube_variant_id: 998877, tiendanube_product_id: 5544 },
      { id: 9, empresa_id: AJENA, product_id: 900, tiendanube_variant_id: 998877, tiendanube_product_id: 5544 },
    ];
  });

  it('el listado de la empresa B no trae ninguno de la A', async () => {
    const propia = await listarMapeos(PROPIA);
    const ajena = await listarMapeos(AJENA);

    expect(propia.body.total).toBe(1);
    expect(propia.body.data[0]).toMatchObject({ id: 1, product_id: 501, product_name: 'Colágeno 300g' });

    expect(ajena.body.total).toBe(1);
    expect(ajena.body.data[0].id).toBe(9);
    // El ancla: los dos ven UNO, y no el mismo. Un `where` sin `empresa_id`
    // devolveria dos a cada uno.
    expect(propia.body.data[0].id).not.toBe(ajena.body.data[0].id);
  });

  it('el listado dice si la variante mapeada sigue estando en la tienda', async () => {
    // Vincular OTRA tienda sin borrar los mapeos ([PENDIENTE N9]) los deja
    // apuntando a variantes que ya no existen, y la sincronizacion va a fallar
    // ahi para siempre si nadie lo ve.
    mockTiendanubeVariante.filas = [
      variante({
        id: 1, empresa_id: PROPIA, tiendanube_variant_id: 998877,
        vista_en: new Date('2026-07-01T09:00:00.000Z'),
      }),
    ];

    const res = await listarMapeos(PROPIA);

    expect(res.body.data[0].en_la_tienda).toBe(false);
    expect(res.body.data[0].nombre_variante).toBe('Colágeno hidrolizado · 300 g');
  });

  it('DELETE de un mapeo de otra empresa responde 404', async () => {
    const res = await borrarMapeo(PROPIA, 9);

    // 404 y no 403: un 403 confirmaria que ese mapeo existe en otra empresa.
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
    // Y la fila ajena sigue ahi. Que eso pase contra Postgres lo contesta el
    // cuarto nivel; aca lo que se verifica es que el handler no la toco.
    expect(mockTiendanubeMapping.filas.map((m) => m.id)).toEqual([1, 9]);
  });

  it('DELETE del propio lo borra y saca la variante de la cola', async () => {
    // Sin esto queda una fila pendiente de empujar sin ningun producto al que
    // mirarle el stock: reintentaria hasta agotar los ocho intentos y quedaria
    // en rojo en la pantalla por un mapeo que alguien borro a proposito.
    mockTiendanubeVariante.filas = [
      variante({
        id: 1, empresa_id: PROPIA, tiendanube_variant_id: 998877,
        pendiente_desde: new Date('2026-08-11T10:00:00.000Z'), intentos: 4,
        ultimo_error: 'TiendaNube tuvo un problema. No es de AdminApp.',
      }),
      // La misma variante en la otra empresa: un `update` sin `empresa_id` la
      // sacaria de la cola de un cliente ajeno.
      variante({
        id: 2, empresa_id: AJENA, tiendanube_variant_id: 998877,
        pendiente_desde: new Date('2026-08-11T10:00:00.000Z'), intentos: 4,
      }),
    ];

    const res = await borrarMapeo(PROPIA, 1);

    expect(res.status).toBe(200);
    expect(mockTiendanubeMapping.filas.map((m) => m.id)).toEqual([9]);

    expect(mockTiendanubeVariante.filas[0]).toMatchObject({
      pendiente_desde: null, intentos: 0, ultimo_error: null, motivo_no_publicado: 'sin_mapeo',
    });
    expect(mockTiendanubeVariante.filas[1].pendiente_desde).not.toBeNull();
  });

  it('POST /mapeos con una variante que NO esta en el catalogo responde 400', async () => {
    // Un mapeo contra una variante que no existe en la tienda es una fila que la
    // sincronizacion va a intentar publicar y fallar para siempre, y el 404 de
    // TiendaNube llega variante por variante sin que nadie sepa de donde salio
    // ese id.
    const res = await mapear(PROPIA, {
      product_id: 502, tiendanube_variant_id: 424242, tiendanube_product_id: 5544,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Refrescá el catálogo');
    expect(mockTiendanubeMapping.filas.map((m) => m.id)).toEqual([1, 9]);
  });

  it('las tres rutas viejas ya no existen', async () => {
    const api = levantarApi(PROPIA);

    const viejas = [
      await request(api).get('/api/tiendanube/products'),
      await request(api).post('/api/tiendanube/mapping').send({}),
      await request(api).post('/api/tiendanube/sync-stock').send({}),
    ];

    // `/products` traia una sola pagina, `/mapping` colgaba una fila de un
    // producto que nadie validaba y `/sync-stock` mandaba un PUT por fila de
    // stock. Borrarlas no rompe la web: `services/api.js` no tenia ni un helper
    // de TiendaNube.
    expect(viejas.map((r) => r.status)).toEqual([404, 404, 404]);
  });
});

// ════════════════════════════════════════════
//  La corrida explicita: un PUT por variante, y el resultado que sobrevive
//
//  ── Que hacia antes ──
//
//  `POST /sync-stock` recorria **todas las filas de `Stock` de la empresa** y
//  mandaba un PUT por cada una cuyo producto estuviera mapeado
//  (`controllers/tiendanube.js:183-192`). Con tres sucursales son tres PUT a la
//  misma variante con tres numeros distintos y **gana el ultimo**, en el orden
//  que devuelva la consulta — que nadie definio. Comprafit tiene tres
//  sucursales. Y mandaba `quantity`, no `available`.
//
//  Ante el primer fallo, el `catch` respondia 502 y el `synced` que se venia
//  contando **se perdia**: el usuario no sabia cuantas variantes se habian
//  actualizado ni cuales faltaban. Del lado de TiendaNube quedaban «las primeras
//  N, no se cuales».
//
//  Y no quedaba **ningun** registro: ni cuando corrio, ni quien la disparo, ni
//  con que resultado. El pedido de la seccion 4.10 nombra «el resultado de la
//  ultima corrida» y no habia donde leerlo.
//
//  ── Como esta armada la fixture, y por que asi ──
//
//  Las tres cosas que la hacen capaz de distinguir los defectos:
//
//   1. **La designada es la 31 y NO la 30.** La 30 es la que elegiria
//      `sucursalPorDefecto` (activa de menor id) y es la que tiene el numero
//      grande: si la corrida leyera la sucursal equivocada, publicaria 20.
//   2. **El colageno tiene fila de stock en las DOS sucursales.** Es lo unico
//      que hace visible el defecto de recorrer `Stock`: con una sola fila por
//      producto, «un PUT por mapeo» y «un PUT por fila de stock» dan lo mismo.
//   3. **`available` (5) es distinto de `quantity` (7)** en la designada. Con los
//      dos numeros iguales —que es como quedan los ocho caminos que escriben
//      stock— publicar uno u otro da el mismo resultado.
//
//  ── Lo que este nivel NO contesta ──
//
//  Que dos `POST /sincronizar` **en paralelo** no se pisen: no hay dos
//  transacciones que puedan chocar contra un array, asi que aca el arriendo se
//  interpreta a mano. Esa mitad esta en
//  `integracion/tiendanubeAislamiento.integracion.test.js`.
// ════════════════════════════════════════════

/** La sucursal designada de la tienda. NO es la que elegiria sucursalPorDefecto. */
const DESIGNADA = 31;

/** La otra, con el numero grande: es la que se publicaria si se leyera de mas. */
const OTRA_SUCURSAL = 30;

const sincronizar = (empresaId = PROPIA) =>
  request(levantarApi(empresaId)).post('/api/tiendanube/sincronizar');

const ultimaCorrida = (empresaId = PROPIA) =>
  request(levantarApi(empresaId)).get('/api/tiendanube/corridas/ultima');

/** Los ids de variante a los que se les mando un PUT, en orden. */
const variantesEmpujadas = () =>
  axios.put.mock.calls.map(([url]) => Number(String(url).split('/').pop()));

/** Lo que se le mando a cada variante: `{ '998877': 5, … }`. */
function stockEmpujado() {
  return Object.fromEntries(
    axios.put.mock.calls.map(([url, cuerpo]) => [String(url).split('/').pop(), cuerpo.stock])
  );
}

/**
 * Tres mapeos, tres situaciones distintas: con stock en la designada y en otra,
 * con stock solo en la designada, y **sin ninguna fila de stock**.
 */
function sembrarParaSincronizar() {
  sembrarTienda({ punto_de_venta_id: DESIGNADA });

  mockProduct.filas.push({ id: 503, empresa_id: PROPIA, name: 'Magnesio 200g', is_active: true });

  mockTiendanubeVariante.filas.push(
    variante({ id: 4, empresa_id: PROPIA, tiendanube_variant_id: 333444, sku: 'MAG-200' })
  );

  mockStock.filas = [
    // La de la sucursal que NO es la designada, y con el numero mas grande.
    { id: 1, empresa_id: PROPIA, product_id: 501, punto_de_venta_id: OTRA_SUCURSAL, quantity: 20, available: 20 },
    // La designada, con available distinto de quantity.
    { id: 2, empresa_id: PROPIA, product_id: 501, punto_de_venta_id: DESIGNADA, quantity: 7, available: 5 },
    { id: 3, empresa_id: PROPIA, product_id: 502, punto_de_venta_id: DESIGNADA, quantity: 12, available: 12 },
    // La 503 no tiene ninguna: es FR-046.
    // Y una de la otra empresa sobre la misma variante, para que un `where` sin
    // `empresa_id` publique el numero de un cliente en la tienda de otro.
    { id: 4, empresa_id: AJENA, product_id: 900, punto_de_venta_id: 90, quantity: 99, available: 99 },
  ];

  mockTiendanubeMapping.filas = [
    { id: 1, empresa_id: PROPIA, product_id: 501, tiendanube_variant_id: 998877, tiendanube_product_id: 5544 },
    { id: 2, empresa_id: PROPIA, product_id: 502, tiendanube_variant_id: 111222, tiendanube_product_id: 5544 },
    { id: 3, empresa_id: PROPIA, product_id: 503, tiendanube_variant_id: 333444, tiendanube_product_id: 5545 },
    { id: 9, empresa_id: AJENA, product_id: 900, tiendanube_variant_id: 998877, tiendanube_product_id: 5544 },
  ];
}

describe('POST /sincronizar · un PUT por variante, con el available de la designada', () => {
  beforeEach(() => {
    sembrarParaSincronizar();
  });

  it('cada variante mapeada recibe EXACTAMENTE UN PUT, con dos sucursales sembradas', async () => {
    const res = await sincronizar();

    expect(res.status).toBe(200);

    // El ancla, y es lo que se pone en rojo si alguien vuelve a recorrer `Stock`:
    // el colageno tiene DOS filas de stock y tiene que recibir UN PUT.
    const empujadas = variantesEmpujadas();

    expect(empujadas).toHaveLength(2);
    expect(new Set(empujadas).size).toBe(2);
    expect([...empujadas].sort()).toEqual([111222, 998877]);

    expect(res.body.mandadas).toBe(2);
    expect(res.body.fallidas).toBe(0);
  });

  it('manda available y NO quantity, y el de la sucursal DESIGNADA', async () => {
    await sincronizar();

    // 5 es `available` de la designada. 7 seria `quantity` de la misma fila y 20
    // seria la otra sucursal: los tres numeros son distintos a proposito.
    expect(stockEmpujado()['998877']).toBe(5);
    expect(stockEmpujado()['998877']).not.toBe(7);
    expect(stockEmpujado()['998877']).not.toBe(20);
  });

  it('publica igual cuando el numero no cambio: el boton existe para arreglar la tienda', async () => {
    // La variante ya tiene `stock_publicado` igual a lo que hay. Saltearla
    // convertiria el boton en un adorno justo en el caso para el que existe:
    // alguien edito el stock a mano en el panel de TiendaNube y lo que hay que
    // hacer es volver a mandarlo. Nuestro registro de lo que mandamos no dice
    // nada sobre lo que la tienda muestra hoy.
    mockTiendanubeVariante.filas.find((v) => v.tiendanube_variant_id === 998877).stock_publicado = 5;

    const res = await sincronizar();

    expect(variantesEmpujadas()).toContain(998877);
    expect(res.body.mandadas).toBe(2);
  });

  it('un producto sin fila de stock en la sucursal designada NO se publica como cero', async () => {
    await sincronizar();

    // Publicar cero por omision agota en la tienda una variante que si tiene
    // mercaderia: el producto deja de venderse y nadie entiende por que.
    expect(variantesEmpujadas()).not.toContain(333444);
    expect(Object.values(stockEmpujado())).not.toContain(0);

    const magnesio = mockTiendanubeVariante.filas.find((v) => v.tiendanube_variant_id === 333444);

    expect(magnesio.motivo_no_publicado).toBe('sin_stock_en_sucursal');
    expect(magnesio.stock_publicado).toBeNull();
    // Y sale de la cola: dejarla pendiente la haria reintentar para siempre sin
    // llegar a hacer ninguna llamada, con el contador clavado.
    expect(magnesio.pendiente_desde).toBeNull();
  });

  it('una variante que falla NO corta la corrida y el resultado dice cual entro', async () => {
    // Hoy el primer fallo responde 502 y el conteo se pierde: el usuario no sabe
    // cuantas entraron ni cuales faltan.
    axios.put
      .mockRejectedValueOnce(errorHttp(503))
      .mockResolvedValue({ data: {} });

    const res = await sincronizar();

    expect(res.status).toBe(200);
    expect(res.body.mandadas).toBe(1);
    expect(res.body.fallidas).toBe(1);
    // La segunda se intento igual: sin esto, «no corta» seria una intencion.
    expect(variantesEmpujadas()).toEqual([998877, 111222]);
  });

  it('la que fallo queda encolada con su error, y la que entro sale de la cola', async () => {
    axios.put
      .mockRejectedValueOnce(errorHttp(503))
      .mockResolvedValue({ data: {} });

    await sincronizar();

    const fallada = mockTiendanubeVariante.filas.find((v) => v.tiendanube_variant_id === 998877);
    const publicada = mockTiendanubeVariante.filas.find((v) => v.tiendanube_variant_id === 111222);

    expect(fallada.intentos).toBe(1);
    expect(fallada.ultimo_error).toContain('TiendaNube tuvo un problema');
    // Un 5xx es reintentable, asi que queda con fecha de proximo intento.
    expect(fallada.proximo_intento_en).not.toBeNull();
    expect(fallada.stock_publicado).toBeNull();

    expect(publicada.stock_publicado).toBe(12);
    expect(publicada.publicado_en).not.toBeNull();
    expect(publicada.pendiente_desde).toBeNull();
    expect(publicada.ultimo_error).toBeNull();
  });

  it('sin ningun mapeo no manda ninguna llamada y lo dice', async () => {
    mockTiendanubeMapping.filas = [];

    const res = await sincronizar();

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('mapeado');
    expect(axios.put).not.toHaveBeenCalled();
    // Y no deja una corrida vacia que la pantalla dibuje como «se corto por la
    // mitad»: una corrida sin mapeos no es una corrida, es un aviso.
    expect(mockTiendanubeCorrida.filas).toEqual([]);
  });

  it('sin tienda vinculada responde 409 y no llama a nadie', async () => {
    mockTiendanubeTienda.filas = [];

    const res = await sincronizar();

    expect(res.status).toBe(409);
    expect(axios.put).not.toHaveBeenCalled();
  });

  it('el 401 corta la corrida y deja la tienda en «vinculada con error»', async () => {
    // Con el token revocado, TODAS las que faltan van a fallar igual: seguir
    // seria gastar la cuota de la tienda para juntar el mismo error N veces.
    axios.put.mockRejectedValue(errorHttp(401));

    const res = await sincronizar();

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('volver a vincularla');
    expect(axios.put).toHaveBeenCalledTimes(1);

    const tienda = mockTiendanubeTienda.filas[0];
    expect(tienda.ultima_comunicacion_ok).toBe(false);
    expect(tienda.ultimo_error).toContain('volver a vincularla');

    // Y la corrida quedo escrita igual: el usuario tiene que poder ver cuantas
    // entraron antes de que el token dejara de valer.
    expect(mockTiendanubeCorrida.filas).toHaveLength(1);
    expect(mockTiendanubeCorrida.filas[0].terminada_en).not.toBeNull();
  });

  it('un 404 de una variante borrada del otro lado se nombra, no sale como error generico', async () => {
    axios.put
      .mockRejectedValueOnce(errorHttp(404))
      .mockResolvedValue({ data: {} });

    await sincronizar();

    const res = await ultimaCorrida();

    expect(res.body.corrida.fallas).toHaveLength(1);
    expect(res.body.corrida.fallas[0]).toMatchObject({ variante: 998877, sku: 'COL-300' });
    // «La variante ya no existe» dice que hay que refrescar el catalogo y borrar
    // el mapeo. El generico de AdminApp manda a abrir un ticket.
    expect(res.body.corrida.fallas[0].motivo).toContain('ya no existe');

    // Y no se reintenta sola: un 404 no se arregla esperando.
    const fallada = mockTiendanubeVariante.filas.find((v) => v.tiendanube_variant_id === 998877);
    expect(fallada.proximo_intento_en).toBeNull();
  });

  it('no publica el stock de otra empresa en la tienda de esta', async () => {
    // La empresa AJENA tiene una fila de stock de 99 sobre la MISMA variante
    // 998877. Un `where` sin `empresa_id` publicaria el numero de un cliente en
    // la tienda de otro.
    await sincronizar();

    expect(Object.values(stockEmpujado())).not.toContain(99);
    expect(variantesEmpujadas()).toHaveLength(2);
  });

  it('un producto mapeado INACTIVO se publica igual, y la fila queda marcada', async () => {
    // [PENDIENTE N10]: publicar cero por estar inactivo agota una variante que la
    // tienda podria estar vendiendo, y no publicarla la congela en el ultimo
    // numero. Se publica y se marca.
    mockProduct.filas.find((p) => p.id === 501).is_active = false;

    await sincronizar();

    expect(stockEmpujado()['998877']).toBe(5);

    const colageno = mockTiendanubeVariante.filas.find((v) => v.tiendanube_variant_id === 998877);
    expect(colageno.motivo_no_publicado).toBe('producto_inactivo');
  });
});

describe('POST /sincronizar · el arriendo, que es una fila y no una bandera', () => {
  beforeEach(() => {
    sembrarParaSincronizar();
  });

  it('con una sincronizacion en curso responde 409 y no manda ninguna llamada', async () => {
    mockTiendanubeTienda.filas[0].sincronizando_desde = new Date();

    const res = await sincronizar();

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('en curso');
    expect(axios.put).not.toHaveBeenCalled();
  });

  it('el arriendo se SUELTA al terminar: dos corridas seguidas funcionan', async () => {
    // ⚠ El defecto que este caso agarra es sutil: soltar el arriendo con
    // `tienda.update({ sincronizando_desde: null })` sobre una instancia cargada
    // ANTES del UPDATE que lo tomo no emite ninguna sentencia —para Sequelize el
    // valor no cambio— y la fila queda arrendada diez minutos con la corrida ya
    // terminada. El sintoma seria «hay una sincronizacion en curso» sobre una
    // tienda quieta, y recien se destraba solo a los diez minutos.
    const primera = await sincronizar();
    const segunda = await sincronizar();

    expect(primera.status).toBe(200);
    expect(segunda.status).toBe(200);
    expect(mockTiendanubeTienda.filas[0].sincronizando_desde).toBeNull();
  });

  it('el arriendo se suelta tambien cuando la corrida termina mal', async () => {
    axios.put.mockRejectedValue(errorHttp(401));

    await sincronizar();

    // Sin el `finally`, un error que ya se le conto al usuario bloquearia la
    // sincronizacion de esa empresa durante diez minutos.
    expect(mockTiendanubeTienda.filas[0].sincronizando_desde).toBeNull();
  });

  it('GET /status dice «sincronizando» con el mismo reloj que toma el arriendo', async () => {
    // El predicado sale del servicio. Hasta este corte habia dos ventanas de diez
    // minutos escritas por separado, que es como se termina diciendo
    // «sincronizando» sobre una tienda quieta.
    mockTiendanubeTienda.filas[0].sincronizando_desde = new Date(Date.now() - 11 * 60 * 1000);

    const vencido = await request(levantarApi(PROPIA)).get('/api/tiendanube/status');
    expect(vencido.body.tienda.sincronizando).toBe(false);

    mockTiendanubeTienda.filas[0].sincronizando_desde = new Date();

    const vivo = await request(levantarApi(PROPIA)).get('/api/tiendanube/status');
    expect(vivo.body.tienda.sincronizando).toBe(true);
  });
});

describe('GET /corridas/ultima · el resultado que sobrevive un reinicio', () => {
  beforeEach(() => {
    sembrarParaSincronizar();
  });

  it('la ultima corrida sigue estando despues de reiniciar: es una fila, no memoria', async () => {
    await sincronizar();

    // «Reiniciar el servidor» aca es tirar el registro de modulos y volver a
    // cargar el router: lo unico que sobrevive es lo que este en la base. Una
    // variable de modulo con el resultado de la ultima corrida —que es como
    // estaba tentador escribirlo— vuelve vacia y este caso se pone en rojo.
    jest.resetModules();
    const recargado = require('../routes/tiendanube');

    const api = express();
    api.use(express.json());
    api.use((req, _res, siguiente) => {
      req.empresaId = PROPIA;
      req.id = 'req-despues-del-reinicio';
      siguiente();
    });
    api.use('/api/tiendanube', recargado.privado);

    const res = await request(api).get('/api/tiendanube/corridas/ultima');

    expect(res.status).toBe(200);
    expect(res.body.corrida.mandadas).toBe(2);
    expect(res.body.corrida.disparador).toBe('manual');
    expect(res.body.corrida.usuario_id).toBe('auth0|quien-mapea');
  }, 30000);

  it('corrida null se distingue de una corrida que mando cero', async () => {
    const sinNinguna = await ultimaCorrida();

    // `null` y no `{}` ni `undefined`: la pantalla tiene que poder decir «nunca
    // se sincronizo» en vez de «se sincronizo y no mando nada», que quiere decir
    // otra cosa —por ejemplo, que no hay stock en la sucursal designada—.
    expect(sinNinguna.status).toBe(200);
    expect(sinNinguna.body.corrida).toBeNull();

    // Ahora una corrida real que no manda ninguna: los tres mapeos sin fila de
    // stock en la designada.
    mockStock.filas = [];
    await sincronizar();

    const conCero = await ultimaCorrida();

    expect(conCero.body.corrida).not.toBeNull();
    expect(conCero.body.corrida.mandadas).toBe(0);
    expect(conCero.body.corrida.terminada_en).not.toBeNull();
  });

  it('fallas trae solo las que fallaron', async () => {
    axios.put
      .mockRejectedValueOnce(errorHttp(503))
      .mockResolvedValue({ data: {} });

    await sincronizar();

    const res = await ultimaCorrida();

    // [PENDIENTE N2]: con un catalogo grande, las que salieron bien son cientos
    // de entradas que nadie lee.
    expect(res.body.corrida.fallas).toHaveLength(1);
    expect(res.body.corrida.fallas[0].variante).toBe(998877);
    expect(JSON.stringify(res.body.corrida.fallas)).not.toContain('111222');
    expect(res.body.corrida.mandadas).toBe(1);
  });

  it('cola dice cuantas estan pendientes y cual es la mas vieja', async () => {
    // ⚠ La mas vieja NO es la primera del array, a proposito: sin el `order` en
    // la consulta, la respuesta saldria bien por el orden en que se sembraron las
    // filas y el caso pasaria con y sin el arreglo.
    const filas = mockTiendanubeVariante.filas.filter((v) => v.empresa_id === PROPIA);

    filas[0].pendiente_desde = new Date('2026-08-12T10:00:00.000Z');
    filas[1].pendiente_desde = new Date('2026-08-12T09:00:00.000Z');
    filas[1].ultimo_error = 'TiendaNube tuvo un problema. No es de AdminApp.';

    const res = await ultimaCorrida();

    expect(res.body.cola.pendientes).toBe(2);
    expect(res.body.cola.con_error).toBe(1);
    expect(res.body.cola.mas_vieja).toBe('2026-08-12T09:00:00.000Z');
  });

  it('la cola y la corrida son de la empresa de la sesion', async () => {
    mockTiendanubeCorrida.filas = [{
      id: 77,
      empresa_id: AJENA,
      empezada_en: new Date('2026-08-13T10:00:00.000Z'),
      terminada_en: new Date('2026-08-13T10:01:00.000Z'),
      disparador: 'manual',
      usuario_id: null,
      mandadas: 99,
      fallidas: 0,
      fallas: null,
    }];

    mockTiendanubeVariante.filas.find((v) => v.empresa_id === AJENA).pendiente_desde = new Date();

    const res = await ultimaCorrida();

    // La de AJENA es mas reciente: sin el `empresa_id`, «la ultima» seria esa.
    expect(res.body.corrida).toBeNull();
    expect(res.body.cola.pendientes).toBe(0);
  });
});
