// ════════════════════════════════════════════
//  ADMINAPP · Que le va a pasar a cada fila de stock cuando la sucursal pase
//            a ser una identidad y no un texto
//
//  Esta es la funcion de la que dependen las otras dos cosas del cambio: el
//  informe que se mira ANTES de migrar y la migracion que escribe. Las dos
//  corren este mismo codigo (decision 4 del plan), asi que el informe es una
//  vista previa de verdad y no una segunda implementacion que dice otra cosa.
//  Si esta funcion esta mal, el informe dice que esta todo bien y la
//  migracion rompe el inventario.
//
//  **No toca la base.** Recibe las filas ya leidas y devuelve que habria que
//  hacer con ellas.
//
//  ── Lo dificil, que es una sola cosa ──
//
//  Dos filas del mismo producto que despues del backfill caen en la misma
//  sucursal pueden ser dos cosas distintas:
//
//   - **Dos pilas.** Una en el deposito y otra en el mostrador, anotadas con
//     `location` distinto porque no habia sucursales de verdad. Sumar es
//     correcto: 40 atras y 12 adelante son 52.
//   - **Una pila anotada dos veces.** El operador cargo 100 unidades por la
//     pantalla y despues importo la lista del proveedor, que traia las mismas
//     100. Sumar da 200 sobre una estanteria que tiene 100.
//
//  En la fila de `stock` **no queda registrado quien la escribio**, asi que
//  no hay forma de distinguirlas con certeza. Lo unico que hay son senales, y
//  ninguna prueba nada por si sola. Por eso la fusion se hace igual —sumar es
//  lo correcto en el caso general— pero **se marca `revisar`** cuando alguna
//  senal aparece, y la fila original se archiva entera antes de desaparecer.
//  Quien opera resuelve esas contando la mercaderia; no hay atajo.
// ════════════════════════════════════════════

const { elegirPorDefecto, LARGO_LOCATION, CODE_PRINCIPAL } = require('./sucursalDeStock');

/** Lo que la migracion le crea a una empresa que tiene stock y ninguna sucursal. */
const SUCURSAL_A_CREAR = { name: 'Sucursal Principal', code: CODE_PRINCIPAL, is_active: true };

const VEINTICUATRO_HORAS = 24 * 60 * 60 * 1000;

/**
 * Las cinco senales de doble registro, con el texto que va al informe y a la
 * nota del archivo. Ninguna prueba nada; todas juntas son lo unico que hay
 * para distinguir "dos pilas" de "una pila anotada dos veces".
 */
const SENALES = {
  MISMA_CANTIDAD: 'dos filas tienen exactamente la misma cantidad',
  SIN_LOTE_QUE_LAS_SEPARE: 'no hay dos lotes distintos que las separen',
  MISMA_SESION: 'se escribieron con menos de 24 horas de diferencia',
  CANTIDAD_NEGATIVA: 'alguna fila tiene cantidad negativa',
  DISPONIBLE_MAYOR: 'alguna fila tiene disponible mayor que la cantidad',
};

/** Convierte una fecha (Date, string ISO o DATEONLY) a milisegundos. */
function enMilisegundos(valor) {
  if (valor === null || valor === undefined || valor === '') return null;

  const t = valor instanceof Date ? valor.getTime() : new Date(valor).getTime();

  return Number.isFinite(t) ? t : null;
}

/** Numero, con 0 para lo que no se pueda leer. */
function numero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

/** El espejo `location` que le corresponde a un punto de venta (FR-041). */
function espejoDe(pv) {
  return String((pv && (pv.code || pv.name)) || '').slice(0, LARGO_LOCATION);
}

/**
 * De los valores no nulos, el de fecha mas chica.
 *
 * Se usa para `expiration_date` y para `purchase_date`, y en los dos casos el
 * criterio es el conservador:
 *
 *  - Vencimiento: **el mas proximo**. La spec pedia el de la fila con mas
 *    cantidad, que es el criterio contrario al que ella misma usa para
 *    `min_stock` ("avisa antes de mas, no de menos"). Si la fila de 100
 *    unidades vence en enero y la de 5 vence el mes que viene, quedarse con
 *    enero saca esas 5 unidades de la alerta de vencimientos de los proximos
 *    30 dias (general.js:360-366). Lo peor que puede pasar con el criterio de
 *    aca es una alerta de mas.
 *  - Fecha de compra: la mas antigua, por simetria. No alimenta ninguna
 *    alerta.
 */
function masTemprana(valores) {
  let elegido = null;
  let mejor = null;

  for (const valor of valores) {
    const t = enMilisegundos(valor);
    if (t === null) continue;

    if (mejor === null || t < mejor) {
      mejor = t;
      elegido = valor;
    }
  }

  return elegido;
}

/**
 * Las senales de doble registro de un grupo de filas que se van a fusionar.
 *
 * @returns {string[]} Los textos de las senales que se cumplen.
 */
function senalesDeDobleRegistro(filas) {
  const encontradas = [];

  // Por fila: dos anomalias que la suma conserva o tapa.
  if (filas.some((f) => numero(f.quantity) < 0)) {
    // Sumar un negativo tapa una sobreventa: la fila resultante puede quedar
    // en un numero razonable y la sobreventa desaparece de la vista.
    encontradas.push(SENALES.CANTIDAD_NEGATIVA);
  }

  if (filas.some((f) => numero(f.available) > numero(f.quantity))) {
    // Ya estaban desincronizadas antes de fusionar; la suma conserva la
    // anomalia y ademas la esconde adentro de una fila nueva.
    encontradas.push(SENALES.DISPONIBLE_MAYOR);
  }

  // Por pares: alcanza con que un par cualquiera del grupo la cumpla.
  let mismaCantidad = false;
  let sinLote = false;
  let mismaSesion = false;

  for (let i = 0; i < filas.length; i++) {
    for (let j = i + 1; j < filas.length; j++) {
      const a = filas[i];
      const b = filas[j];

      // Dos caminos que escribieron el mismo numero absoluto sobre la misma
      // estanteria. Con 0 y 0 no dice nada: dos filas vacias son dos filas
      // vacias.
      if (numero(a.quantity) === numero(b.quantity) && numero(a.quantity) > 0) mismaCantidad = true;

      // Dos lotes distintos y no nulos son dos entradas de mercaderia
      // distintas, y esa es la unica evidencia fuerte de que son dos pilas.
      // Cualquier otra combinacion —los dos nulos, el mismo lote, o uno con
      // lote y otro sin— no aporta ninguna evidencia, asi que cuenta como
      // senal.
      //
      // Que la fusion ahora **conserve** el lote de la unica fila que lo
      // tiene no apaga esta senal, y es a proposito: la senal contesta "¿hay
      // evidencia de que sean dos pilas?" —y un lote solo no separa nada—,
      // mientras que la eleccion del lote contesta "¿cual queda?". Apagarla
      // porque el lote ya no se pierde seria confundir las dos preguntas y
      // sacar del recuento justo el caso mas dudoso.
      const dosLotesDistintos = a.current_batch && b.current_batch
        && a.current_batch !== b.current_batch;
      if (!dosLotesDistintos) sinLote = true;

      // Se escribieron en la misma sesion de trabajo. Sin `updated_at` en
      // alguna de las dos no hay evidencia, y una senal sin evidencia
      // marcaria todo.
      const ta = enMilisegundos(a.updated_at);
      const tb = enMilisegundos(b.updated_at);
      if (ta !== null && tb !== null && Math.abs(ta - tb) < VEINTICUATRO_HORAS) mismaSesion = true;
    }
  }

  if (mismaCantidad) encontradas.push(SENALES.MISMA_CANTIDAD);
  if (sinLote) encontradas.push(SENALES.SIN_LOTE_QUE_LAS_SEPARE);
  if (mismaSesion) encontradas.push(SENALES.MISMA_SESION);

  return encontradas;
}

/**
 * Fusiona un grupo de filas que caen en el mismo producto y la misma sucursal.
 *
 * Sobrevive la de **mayor cantidad**; a igualdad, la de **menor id**, para que
 * el resultado sea el mismo en las dos corridas —la del informe y la de la
 * migracion— y para que no dependa del orden en que Postgres devolvio las
 * filas.
 */
function fusionar(filas) {
  const ordenadas = [...filas].sort(
    (a, b) => numero(b.quantity) - numero(a.quantity) || numero(a.id) - numero(b.id)
  );

  const sobreviviente = ordenadas[0];
  const absorbidas = ordenadas.slice(1);

  const resultado = {
    quantity: filas.reduce((acc, f) => acc + numero(f.quantity), 0),
    available: filas.reduce((acc, f) => acc + numero(f.available), 0),
    // El maximo, que es el criterio conservador de la spec: avisa antes de
    // mas, no de menos.
    min_stock: filas.reduce((acc, f) => Math.max(acc, numero(f.min_stock)), 0),
    expiration_date: masTemprana(filas.map((f) => f.expiration_date)),
    purchase_date: masTemprana(filas.map((f) => f.purchase_date)),
    // Un lote es identidad, no magnitud.
    //
    // Antes quedaba el lote de la fila que sobrevive, que es la de mayor
    // cantidad. Eso hacia que un lote se perdiera **sin que hubiera ninguna
    // razon**: si la fila de 100 unidades tenia el lote en null y la de 5
    // tenia uno real, la fusion quedaba sin lote y el unico dato que habia
    // desaparecia. Perder el lote rompe un retiro de producto —no queda con
    // que saber que mercaderia hay que sacar de la gondola— y suplementos es
    // un rubro donde eso pasa.
    //
    // La regla ahora es: gana el lote de la fila con mas cantidad **entre las
    // que tienen lote**. Si solo una lo tiene, gana ese sin importar la
    // cantidad; si hay dos distintos, gana el de la fila mayor y el otro va a
    // descartados; si ninguna tiene, queda null. `ordenadas` ya viene por
    // cantidad descendente y, a igualdad, por id ascendente, asi que el
    // desempate sigue siendo determinístico.
    current_batch: (ordenadas.find((f) => f.current_batch) || {}).current_batch || null,
  };

  const lotesDescartados = [...new Set(
    filas
      .map((f) => f.current_batch)
      .filter((lote) => lote && lote !== resultado.current_batch)
  )];

  const senales = senalesDeDobleRegistro(filas);

  const partes = [];
  if (senales.length) partes.push(`Revisar: ${senales.join('; ')}.`);
  if (lotesDescartados.length) partes.push(`Lotes descartados: ${lotesDescartados.join(', ')}.`);

  return {
    sobreviviente_id: sobreviviente.id,
    resultado,
    lotes_descartados: lotesDescartados,
    revisar: senales.length > 0,
    senales,
    nota: partes.join(' ') || null,
  };
}

/**
 * Que habria que hacerle a las filas de stock para que la sucursal sea una
 * identidad.
 *
 * Reproduce los pasos 1 a 5 de la migracion (data-model.md) **sin escribir
 * nada**: a que sucursal va cada fila, cuales se fusionan con cuales y con que
 * valores, y que puntos de venta habria que crear antes.
 *
 * @param {object} entrada
 * @param {object[]} entrada.filas Filas de `stock` de todas las empresas.
 * @param {object[]} entrada.puntosDeVenta Puntos de venta de todas las empresas.
 * @returns {{asignaciones: object[], fusiones: object[], avisos: object[]}}
 */
function planificar({ filas = [], puntosDeVenta = [] } = {}) {
  const asignaciones = [];
  const fusiones = [];
  const avisos = [];

  // Los puntos de venta, agrupados por empresa y por id.
  const porEmpresa = new Map();
  const porId = new Map();

  for (const pv of puntosDeVenta) {
    if (!porEmpresa.has(pv.empresa_id)) porEmpresa.set(pv.empresa_id, []);
    porEmpresa.get(pv.empresa_id).push(pv);
    porId.set(pv.id, pv);
  }

  // Paso 1: toda empresa con stock tiene que tener al menos un punto de venta.
  // Sin esto no hay a donde mandar las filas y el NOT NULL no se puede aplicar.
  const empresasConStock = [...new Set(filas.map((f) => f.empresa_id))].sort((a, b) => a - b);
  const sucursalNueva = new Map();

  for (const empresaId of empresasConStock) {
    if ((porEmpresa.get(empresaId) || []).length > 0) continue;

    const aCrear = { ...SUCURSAL_A_CREAR, id: null, empresa_id: empresaId, a_crear: true };
    sucursalNueva.set(empresaId, aCrear);

    avisos.push({
      tipo: 'pv_a_crear',
      empresa_id: empresaId,
      sucursal: SUCURSAL_A_CREAR,
      mensaje:
        `La empresa ${empresaId} tiene stock y ninguna sucursal: hay que crearle ` +
        `"${SUCURSAL_A_CREAR.name}" (code ${SUCURSAL_A_CREAR.code}) antes de migrar.`,
    });
  }

  // Pasos 2 y 3: a que sucursal va cada fila.
  const grupos = new Map();

  for (const fila of filas) {
    const puntos = porEmpresa.get(fila.empresa_id) || [];
    let destino = null;
    let motivo = null;

    if (fila.punto_de_venta_id !== null && fila.punto_de_venta_id !== undefined) {
      destino = puntos.find((pv) => pv.id === fila.punto_de_venta_id) || null;
      motivo = 'ya_tenia';

      if (!destino) {
        // La FK garantiza que el punto de venta existe, pero no que sea de
        // esta empresa. Si aparece, es una fuga anterior y hay que verla antes
        // de migrar, no despues.
        const ajeno = porId.get(fila.punto_de_venta_id);

        avisos.push({
          tipo: 'sucursal_de_otra_empresa',
          empresa_id: fila.empresa_id,
          stock_id: fila.id,
          punto_de_venta_id: fila.punto_de_venta_id,
          mensaje:
            `La fila de stock ${fila.id} (empresa ${fila.empresa_id}) apunta a la sucursal ` +
            `${fila.punto_de_venta_id}, que ${ajeno ? `es de la empresa ${ajeno.empresa_id}` : 'no existe'}. ` +
            'La migracion la deja como esta.',
        });

        destino = ajeno || null;
      }
    } else if (puntos.length === 0) {
      // La sucursal que crea el paso 1. Todavia no tiene id, pero todas las
      // filas de la empresa van ahi, asi que los duplicados se detectan igual.
      destino = sucursalNueva.get(fila.empresa_id) || null;
      motivo = 'pv_a_crear';
    } else {
      // Paso 2: coincidencia exacta y sensible a mayusculas entre el
      // `location` que escribio el operador y el `code` de una sucursal de su
      // misma empresa. Es la misma comparacion que hacen seedPuntosDeVenta.js
      // y stock.js: aflojarla aca haria que la migracion mapee distinto de
      // como mapean las rutas.
      destino = puntos.find((pv) => pv.code && pv.code === fila.location) || null;
      motivo = 'code';

      if (!destino) {
        // Paso 3: el por defecto de la empresa, con los tres escalones.
        destino = elegirPorDefecto(puntos);
        motivo = 'por_defecto';
      }
    }

    const asignacion = {
      stock_id: fila.id,
      empresa_id: fila.empresa_id,
      product_id: fila.product_id,
      punto_de_venta_id_anterior:
        fila.punto_de_venta_id === undefined ? null : fila.punto_de_venta_id,
      punto_de_venta_id_nuevo: destino ? destino.id : null,
      location_anterior: fila.location === undefined ? null : fila.location,
      // Paso 5: el espejo se reescribe con el code (o el name) del destino.
      location_nueva: destino ? espejoDe(destino) : null,
      motivo,
      destino_a_crear: Boolean(destino && destino.a_crear),
    };

    asignaciones.push(asignacion);

    if (!destino) {
      avisos.push({
        tipo: 'sin_sucursal',
        empresa_id: fila.empresa_id,
        stock_id: fila.id,
        mensaje:
          `La fila de stock ${fila.id} (empresa ${fila.empresa_id}) se quedo sin sucursal ` +
          'destino. Hasta que se resuelva, el NOT NULL no se puede aplicar.',
      });
      continue;
    }

    // Paso 4: se agrupa por (empresa, producto, sucursal destino). La sucursal
    // que todavia no existe se agrupa por empresa, que es lo mismo: va a ser
    // una sola.
    const clave = destino.id === null
      ? `${fila.empresa_id}|${fila.product_id}|nueva`
      : `${fila.empresa_id}|${fila.product_id}|${destino.id}`;

    if (!grupos.has(clave)) grupos.set(clave, { destino, filas: [] });
    grupos.get(clave).filas.push(fila);
  }

  // Paso 4: solo los grupos de mas de una fila. Una segunda corrida sobre
  // filas ya consolidadas no encuentra ninguno (FR-048).
  for (const { destino, filas: delGrupo } of grupos.values()) {
    if (delGrupo.length < 2) continue;

    const fusion = fusionar(delGrupo);
    const primera = delGrupo[0];

    fusiones.push({
      empresa_id: primera.empresa_id,
      product_id: primera.product_id,
      punto_de_venta_id: destino.id,
      destino: {
        id: destino.id,
        name: destino.name,
        code: destino.code || null,
        a_crear: Boolean(destino.a_crear),
      },
      sobreviviente_id: fusion.sobreviviente_id,
      filas: [...delGrupo]
        .sort((a, b) => numero(a.id) - numero(b.id))
        .map((f) => ({
          id: f.id,
          location: f.location === undefined ? null : f.location,
          punto_de_venta_id: f.punto_de_venta_id === undefined ? null : f.punto_de_venta_id,
          quantity: numero(f.quantity),
          available: numero(f.available),
          min_stock: numero(f.min_stock),
          current_batch: f.current_batch || null,
          expiration_date: f.expiration_date || null,
          purchase_date: f.purchase_date || null,
          updated_at: f.updated_at || null,
          sobrevive: f.id === fusion.sobreviviente_id,
        })),
      resultado: fusion.resultado,
      lotes_descartados: fusion.lotes_descartados,
      revisar: fusion.revisar,
      senales: fusion.senales,
      nota: fusion.nota,
    });
  }

  // Orden estable para que dos corridas impriman lo mismo y se puedan
  // comparar con un diff.
  fusiones.sort((a, b) =>
    a.empresa_id - b.empresa_id
    || a.product_id - b.product_id
    || numero(a.punto_de_venta_id) - numero(b.punto_de_venta_id));

  return { asignaciones, fusiones, avisos };
}

module.exports = { planificar, SENALES, SUCURSAL_A_CREAR };
