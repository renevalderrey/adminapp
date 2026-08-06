// ════════════════════════════════════════════
//  Modelos falsos para testear la logica de calculo sin base de datos
//
//  Los services de calculo (costos, impuestos, cuenta corriente) son donde
//  vive la logica que produce numeros que el usuario cree. Testearlos contra
//  Postgres real seria mas fiel, pero exige fixtures y una base de test, y
//  ninguna de las dos cosas existe todavia.
//
//  Estos dobles implementan el subconjunto de la API de Sequelize que esos
//  services usan realmente, sobre arrays en memoria. Alcanza para ejercitar
//  las formulas, que es lo que se quiere cubrir.
//
//  Limitacion consciente: no valida SQL ni tipos de columna. Un bug que solo
//  aparece contra Postgres real (por ejemplo, DECIMAL devuelto como string)
//  NO lo atrapan estos tests. Para eso hace falta el test de integracion.
// ════════════════════════════════════════════

/**
 * Reproduce el rechazo de Sequelize ante un valor undefined en el where.
 *
 * Sequelize real lanza: WHERE parameter "x" has invalid "undefined" value.
 * Sin esto, el doble seria mas permisivo que la base y dejaria pasar
 * justamente el bug mas comun despues de un refactor de firmas: una llamada
 * que se olvido de pasar empresaId.
 */
function validarWhere(where = {}) {
  for (const [campo, valor] of Object.entries(where)) {
    if (valor === undefined) {
      throw new Error(`WHERE parameter "${campo}" has invalid "undefined" value`);
    }
  }
}

const { Op } = require('sequelize');

/**
 * Evalua un where simple contra una fila.
 *
 * Soporta igualdad, arrays (IN abreviado) y `{ [Op.in]: [...] }`.
 *
 * ── Por que `Op.in` necesita una rama propia ──
 *
 * `Op.in` es un **Symbol**, y `Object.entries` NO devuelve claves de tipo
 * Symbol. Sin esta rama, un `where: { id: { [Op.in]: [1, 2] } }` entraba por el
 * `fila[campo] === valor` de abajo, que compara un numero contra un objeto: da
 * `false` **siempre**, para toda fila.
 *
 * O sea que el doble no respondia «no encontre nada» por los datos, sino porque
 * no entendia la consulta — y el codigo de produccion que usa `Op.in` se
 * comportaba en los tests como si la tabla estuviera vacia. Es el mismo modo de
 * falla que el encabezado de este archivo advierte: un doble que es mas
 * permisivo o mas restrictivo que la base convierte cualquier test que lo use
 * en una afirmacion sobre el doble.
 *
 * Aparecio validando los productos de una carga masiva de stock: la consulta
 * legitima devolvia cero filas y la ruta respondia 404 sobre productos propios.
 */
function coincide(fila, where = {}) {
  return Object.entries(where).every(([campo, valor]) => {
    if (Array.isArray(valor)) return valor.includes(fila[campo]);

    if (valor && typeof valor === 'object' && Array.isArray(valor[Op.in])) {
      return valor[Op.in].includes(fila[campo]);
    }

    return fila[campo] === valor;
  });
}

/**
 * Crea un modelo falso sobre un array de filas.
 *
 * @param {object[]} filas Datos iniciales. Se mutan, para que las escrituras
 *   sean observables desde el test.
 * @param {object} [relaciones] Mapa de alias -> funcion(fila) que devuelve los
 *   registros asociados. Simula los include de Sequelize.
 */
function crearModelo(filas = [], relaciones = {}) {
  const modelo = {
    filas,
    // Registro de llamadas, para poder afirmar sobre el scoping.
    llamadas: [],

    _hidratar(fila, opciones = {}) {
      if (!fila) return null;

      const instancia = {
        ...fila,
        async update(cambios) {
          Object.assign(fila, cambios);
          Object.assign(this, cambios);
          return this;
        },
        async destroy() {
          const i = modelo.filas.indexOf(fila);
          if (i >= 0) modelo.filas.splice(i, 1);
        },
        toJSON() {
          const { update, destroy, toJSON, ...datos } = this;
          return datos;
        },
      };

      for (const inc of opciones.include || []) {
        const alias = inc.as;
        if (alias && relaciones[alias]) {
          instancia[alias] = relaciones[alias](fila, inc);
        }
      }

      return instancia;
    },

    async findOne(opciones = {}) {
      modelo.llamadas.push({ metodo: 'findOne', ...opciones });
      validarWhere(opciones.where);
      const fila = modelo.filas.find((f) => coincide(f, opciones.where));
      return modelo._hidratar(fila, opciones);
    },

    async findByPk(id, opciones = {}) {
      modelo.llamadas.push({ metodo: 'findByPk', id, ...opciones });
      const fila = modelo.filas.find((f) => f.id === id);
      return modelo._hidratar(fila, opciones);
    },

    async findAll(opciones = {}) {
      modelo.llamadas.push({ metodo: 'findAll', ...opciones });
      validarWhere(opciones.where);
      return modelo.filas
        .filter((f) => coincide(f, opciones.where))
        .map((f) => modelo._hidratar(f, opciones));
    },

    async count(opciones = {}) {
      modelo.llamadas.push({ metodo: 'count', ...opciones });
      validarWhere(opciones.where);
      return modelo.filas.filter((f) => coincide(f, opciones.where)).length;
    },

    /**
     * Devuelve la suma como STRING, igual que Sequelize con columnas DECIMAL
     * en Postgres. Que devuelva string y no number es justamente lo que hace
     * que un parseFloat faltante se convierta en una concatenacion silenciosa.
     */
    async sum(campo, opciones = {}) {
      modelo.llamadas.push({ metodo: 'sum', campo, ...opciones });
      validarWhere(opciones.where);
      const filtradas = modelo.filas.filter((f) => coincide(f, opciones.where));
      if (filtradas.length === 0) return null; // Sequelize devuelve null, no 0
      const total = filtradas.reduce((acc, f) => acc + parseFloat(f[campo] || 0), 0);
      return String(total);
    },

    async create(datos, opciones = {}) {
      modelo.llamadas.push({ metodo: 'create', datos, ...opciones });
      const fila = { id: modelo.filas.length + 1, ...datos };
      modelo.filas.push(fila);
      return modelo._hidratar(fila);
    },
  };

  return modelo;
}

module.exports = { crearModelo, coincide, validarWhere };
