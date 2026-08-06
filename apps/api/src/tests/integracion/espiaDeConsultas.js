// ════════════════════════════════════════════
//  Qué consultas hizo la aplicación mientras corría un request
//
//  Existe para dos afirmaciones que no se pueden hacer de otra manera:
//
//   1. **Sobre qué SQL se pide un `EXPLAIN`.** Un plan medido sobre una consulta
//      escrita a mano en el test dice que *esa* consulta usa el índice, no que lo
//      use la que corre la aplicación. Las dos se separan en cuanto alguien
//      agrega un `where` o cambia un `group`, y el test seguiría en verde
//      hablando de una consulta que ya no existe.
//   2. **Cuántas consultas cuesta una operación.** El paso manual P11 medía
//      tiempo, y el tiempo no puede ponerse en rojo: depende de la máquina. Lo
//      que sí crece cuando alguien mete una consulta adentro de un bucle es la
//      **cantidad**, y esa es la misma en cualquier máquina.
//
//  ── Cómo ──
//
//  `config/database.js` construye la instancia con `logging: false` fuera de
//  desarrollo. Sequelize resuelve el logger por consulta desde
//  `sequelize.options.logging` cuando la llamada no trae el suyo, así que
//  reemplazarlo mientras dura la función alcanza y no hace falta tocar ni un
//  archivo de producción.
//
//  ⚠ **Se restaura en un `finally`.** Si una aserción falla en el medio, dejar
//  el logger puesto llenaría de SQL la salida de los tests siguientes, y una
//  suite que imprime ruido es una que nadie lee cuando se pone en rojo.
// ════════════════════════════════════════════

/**
 * Corre `accion` espiando el SQL que emite Sequelize.
 *
 * @param {import('sequelize').Sequelize} sequelize
 * @param {() => Promise<any>} accion
 * @returns {Promise<{resultado: any, consultas: string[]}>} `consultas` sin el
 *   prefijo «Executing (default): » que Sequelize le pone a cada línea.
 */
async function capturarConsultas(sequelize, accion) {
  const consultas = [];
  const anterior = sequelize.options.logging;

  sequelize.options.logging = (mensaje) => {
    consultas.push(String(mensaje).replace(/^Executing \([^)]*\): /, ''));
  };

  try {
    const resultado = await accion();
    return { resultado, consultas };
  } finally {
    sequelize.options.logging = anterior;
  }
}

/** Las consultas capturadas que tocan una tabla, como texto SQL. */
function contra(consultas, tabla) {
  return consultas.filter((sql) => sql.includes(`"${tabla}"`));
}

/**
 * La consulta que hace el `SELECT` sobre una tabla, si hay exactamente una.
 *
 * Falla con las candidatas a la vista si hay más de una: elegir «la primera»
 * convertiría un cambio de orden en un test que mide otra cosa sin avisar.
 */
function unicoSelect(consultas, tabla) {
  const candidatas = contra(consultas, tabla).filter((sql) => /^SELECT/i.test(sql.trim()));

  if (candidatas.length !== 1) {
    throw new Error(
      `Se esperaba UN solo SELECT sobre "${tabla}" y hubo ${candidatas.length}:\n` +
      candidatas.map((s) => `  - ${s}`).join('\n')
    );
  }

  return candidatas[0];
}

module.exports = { capturarConsultas, contra, unicoSelect };
