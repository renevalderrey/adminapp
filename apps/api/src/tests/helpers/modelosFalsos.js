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

/** Evalua un where simple contra una fila. Soporta igualdad y arrays (IN). */
function coincide(fila, where = {}) {
  return Object.entries(where).every(([campo, valor]) => {
    if (Array.isArray(valor)) return valor.includes(fila[campo]);
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
      return modelo.filas
        .filter((f) => coincide(f, opciones.where))
        .map((f) => modelo._hidratar(f, opciones));
    },

    async count(opciones = {}) {
      modelo.llamadas.push({ metodo: 'count', ...opciones });
      return modelo.filas.filter((f) => coincide(f, opciones.where)).length;
    },

    /**
     * Devuelve la suma como STRING, igual que Sequelize con columnas DECIMAL
     * en Postgres. Que devuelva string y no number es justamente lo que hace
     * que un parseFloat faltante se convierta en una concatenacion silenciosa.
     */
    async sum(campo, opciones = {}) {
      modelo.llamadas.push({ metodo: 'sum', campo, ...opciones });
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

module.exports = { crearModelo, coincide };
