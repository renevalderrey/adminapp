const express = require('express');
const router = express.Router();
const forge = require('node-forge');
const { Op } = require('sequelize');
const afipService = require('../services/afipService');
const afipAuth = require('../services/afipAuth');
const afipVerificacion = require('../services/afipVerificacion');
const { Setting, Empresa, sequelize } = require('../models');
const checkPermission = require('../middleware/checkPermission');
const { fallo } = require('../utils/errores');
const logger = require('../utils/logger');

// Toda la configuracion de AFIP es POR EMPRESA: cada empresa cliente factura
// con su propio CUIT, su certificado y su clave privada.
//
// Antes las lecturas y escrituras de Setting no pasaban empresa_id, y la tabla
// settings tenia `key` como unica clave primaria: existia una sola fila por
// clave en toda la base. La segunda empresa que guardaba su certificado pisaba
// el de la primera, y las facturas de esta ultima salian emitidas con la
// identidad fiscal de la otra.

// tax_condition faltaba en esta lista. El formulario de Ajustes la manda, el
// backend respondia "guardada correctamente" y la descartaba. Del otro lado,
// createVoucher lee esa clave y caia siempre al default 'Monotributo': la rama
// que discrimina IVA para Responsable Inscripto era codigo muerto, y todo RI
// emitia Factura A sin discriminar. AFIP rechaza eso, y si lo autorizara el
// comprador se quedaria sin credito fiscal.
const CLAVES_AFIP = ['afip_cuit', 'afip_cert', 'afip_key', 'afip_environment', 'afip_pv', 'tax_condition'];

const CONDICIONES_FISCALES = ['Monotributo', 'RI', 'Exento'];

/**
 * Un valor que `guardarConfiguracionAfip` NO va a escribir: la fila queda como está.
 *
 * Es la guarda de la cadena vacía de FR-075, sacada a una función porque ahora la
 * usan dos: el bucle que escribe y `loQueVaAQuedar`, que le contesta al gate del
 * pase a producción qué configuración va a quedar. Escrita dos veces, un día
 * dirían cosas distintas y el gate volvería a comparar contra otra cosa.
 */
function noSeEscribe(valor) {
  return valor === undefined || valor === null || valor === '';
}

/**
 * La configuración de AFIP que **va a quedar** después de guardar estos cambios.
 *
 * Solo las tres claves que el gate compara. Una clave ausente significa «esta
 * petición no la toca», y `estadoDelCircuito` usa entonces la fila guardada.
 */
function loQueVaAQuedar(cambios) {
  const efectiva = {};

  if (!noSeEscribe(cambios.afip_cuit)) efectiva.cuit = cambios.afip_cuit;
  if (!noSeEscribe(cambios.afip_pv)) efectiva.pv = cambios.afip_pv;
  if (!noSeEscribe(cambios.afip_cert)) efectiva.cert = cambios.afip_cert;

  return efectiva;
}

/**
 * El ÚNICO lugar que escribe la configuración de AFIP de una empresa.
 *
 * ── Por qué es una función y no el cuerpo del handler ──
 *
 * Guardar el ambiente o las credenciales y **no invalidar el ticket WSAA
 * cacheado** deja a la empresa firmando con el ticket viejo hasta que vence, con
 * la pantalla diciendo que se guardó. Es una falla que no aparece en el momento:
 * aparece cuando hay que emitir.
 *
 * Hasta este corte la llamada a `invalidarCache` vivía suelta en `POST /setup`,
 * o sea que la garantía valía para **ese** handler y para ninguno más. El
 * segundo camino que escribiera `afip_environment` —y ya había uno,
 * `PUT /api/settings/:key`, que ahora lo rechaza— nacía sin ella. Con la
 * escritura y la invalidación en la misma función no hay forma de hacer una sin
 * la otra.
 *
 * ── La cadena vacía se saltea, y eso NO se toca ──
 *
 * El formulario de Ajustes arranca con `cert:''` y `key:''` y postea el objeto
 * entero. Antes esto solo salteaba `undefined`: con solo cambiar el desplegable
 * de ambiente y guardar, el bucle de abajo guardaba `value: ''` sobre
 * `afip_cert` y `afip_key`, y el certificado y la clave quedaban destruidos. Y
 * como la clave privada del CSR nunca se guarda del lado del servidor, no había
 * copia: había que rehacer el trámite entero en ARCA.
 *
 * @param {number} empresaId
 * @param {object} cambios Claves de `CLAVES_AFIP`. Lo que no venga, no se toca.
 * @param {object} [opciones]
 * @param {import('sequelize').Transaction} [opciones.transaction]
 */
async function guardarConfiguracionAfip(empresaId, cambios, { transaction } = {}) {
  for (const clave of CLAVES_AFIP) {
    const valor = cambios[clave];

    if (noSeEscribe(valor)) continue;

    await Setting.upsert(
      { key: clave, empresa_id: empresaId, value: valor },
      { transaction }
    );
  }

  // El ticket cacheado se emitió con el certificado y contra el ambiente
  // anteriores. Se invalida acá adentro y no después del commit a propósito: si
  // la transacción se revierte, lo que cuesta es pedir un ticket de más —una
  // llamada a WSAA—, mientras que invalidar de menos cuesta comprobantes
  // firmados con material que ya no es el de la empresa.
  afipAuth.invalidarCache(empresaId);
}

/**
 * El CUIT que ARCA escribe en el subject del certificado, solo dígitos.
 *
 * Viene como `serialNumber` y con la forma `CUIT 20111111112`, así que se saca
 * todo lo que no sea dígito antes de comparar. Es el mismo dato que
 * `GET /afip/cert-info` ya devuelve y que la pantalla ya muestra: lo que no había
 * era **alguien que los comparara**.
 */
function cuitDelCertificado(pem) {
  const cert = forge.pki.certificateFromPem(pem);
  const serie = cert.subject.attributes.find((a) => a.name === 'serialNumber');

  return String((serie && serie.value) || '').replace(/\D/g, '');
}

/**
 * Si esta clave privada es la del certificado.
 *
 * Se firma un blob de prueba con la clave y se verifica la firma con la clave
 * **pública** del certificado. Es la única forma de saberlo sin llamar a AFIP.
 *
 * ── Por qué hace falta ──
 *
 * Hasta este corte los dos PEM se validaban **por separado**: que cada uno fuera
 * un PEM legible. Subir el certificado de ARCA junto con la clave privada de un
 * CSR viejo —que es lo que pasa cuando alguien rehace el trámite y le quedan dos
 * archivos `.key` en Descargas— pasaba las dos validaciones, se guardaba, la
 * pantalla decía «guardada correctamente», y el error aparecía recién al
 * facturar, como «Error al firmar el ticket de acceso» (`afipAuth.js:154`) — con
 * alguien esperando su factura del otro lado del mostrador.
 */
function sonPareja(certPem, keyPem) {
  try {
    const cert = forge.pki.certificateFromPem(certPem);
    const clave = forge.pki.privateKeyFromPem(keyPem);

    const md = forge.md.sha256.create();
    md.update('favalio: verificación de la pareja certificado-clave', 'utf8');

    return cert.publicKey.verify(md.digest().bytes(), clave.sign(md));
  } catch {
    // Una clave que no corresponde puede hacer explotar la verificación en vez
    // de devolver `false`, y las dos cosas significan lo mismo acá.
    return false;
  }
}

/** Solo los dígitos: un CUIT se compara así venga con guiones o sin ellos. */
function soloDigitos(valor) {
  return String(valor === null || valor === undefined ? '' : valor).replace(/\D/g, '');
}

/** El valor guardado de una clave de configuración de esta empresa, o `null`. */
async function valorGuardado(clave, empresaId) {
  const fila = await Setting.findOne({ where: { key: clave, empresa_id: empresaId } });
  return fila && fila.value !== undefined ? fila.value : null;
}

// ════════════════════════════════════════════
//  GET /api/afip/status — DOS cosas distintas, y por eso no es un booleano
//
//  Hasta este corte esto era «Probar conexión» y devolvía lo que contestara
//  `FEDummy`. **`FEDummy` no lleva `Auth`** (`afipService.js:114-122`): no firma
//  con el certificado de nadie, así que contesta OK con el certificado vencido,
//  con la clave equivocada, con el punto de venta inexistente y sin ningún
//  certificado cargado. La pantalla dibujaba «Conectado: API operativa» sobre
//  eso, que es una afirmación sobre la facturación de ESTA empresa hecha con un
//  dato que no la mira.
//
//  Ahora se devuelven las dos cosas por separado, porque son dos:
//
//   · `servidores_afip` — lo que dice `FEDummy`: si los servidores de ARCA están
//     arriba. Sirve para distinguir «AFIP está caído» de «tu configuración está
//     mal», que es la pregunta real cuando algo falla.
//   · `verificacion` — la evidencia de `POST /afip/verificar`: si el circuito de
//     esta empresa, con SU certificado y SU punto de venta, se ejercitó alguna
//     vez y cómo salió.
//   · `circuito` — **el veredicto del servidor**: si el paso 4 está cumplido, por
//     cuál de las dos vías, y si la evidencia es de otro certificado.
//
//  El banner verde de la pantalla sale de la segunda y **nunca** de la primera
//  (FR-080). Y `ambiente` va acá porque el aviso de «los comprobantes no tienen
//  validez fiscal» depende de él (FR-081).
//
//  ── Por qué `circuito` y no que la pantalla lo deduzca ──
//
//  Lo deducía, y las dos deducciones estaban mal. `estadoDelCircuito` ya calcula
//  esto —es lo mismo que decide el bloqueo del pase a producción— y no salía por
//  ningún lado, así que la pantalla afirmaba «hasta que se verifique no se puede
//  pasar a producción» a una empresa que ya facturó y a la que el servidor le
//  contesta 200; y adivinaba «se verificó con otro certificado» comparando
//  fechas, que falla con un certificado cuyo `validFrom` es anterior a la
//  verificación pero que se cargó después. La huella SHA-256 de la evidencia
//  contesta eso exacto, y el certificado no sale por la API para poder calcularla
//  del lado del navegador.
//
//  ⚠ Que `FEDummy` no conteste **no** es un 502 de este endpoint: la evidencia y
//  el ambiente salen igual, y son justamente lo que la pantalla necesita para
//  dibujarse cuando AFIP está caído.
// ════════════════════════════════════════════
router.get('/status', checkPermission('config.ver'), async (req, res) => {
  try {
    const [enProduccion, circuito] = await Promise.all([
      afipAuth.isProduction(req.empresaId),
      afipVerificacion.estadoDelCircuito(req.empresaId),
    ]);

    let servidoresAfip = null;
    let errorDeServidores = null;

    try {
      servidoresAfip = await afipService.getStatus(req.empresaId);
    } catch (err) {
      logger.warn({ err: err.message, empresaId: req.empresaId }, 'afip:status — FEDummy no contestó');
      errorDeServidores = 'No se pudo consultar el estado de los servidores de ARCA.';
    }

    res.json({
      ok: true,
      data: {
        servidores_afip: servidoresAfip,
        error_servidores: errorDeServidores,
        verificacion: circuito.evidencia,
        circuito: {
          cumplido: circuito.cumplido,
          via: circuito.via,
          otro_certificado: circuito.otroCertificado,
        },
        ambiente: enProduccion ? 'production' : 'homologation',
      },
    });
  } catch (err) {
    fallo(req, res, err, 'No se pudo leer el estado de la facturación electrónica');
  }
});

// GET /api/afip/cert-info — Info del certificado cargado por esta empresa
router.get('/cert-info', checkPermission('config.ver'), async (req, res) => {
  try {
    const certSetting = await Setting.findOne({
      where: { key: 'afip_cert', empresa_id: req.empresaId },
    });

    if (!certSetting || !certSetting.value) {
      return res.json({ ok: false, error: 'No hay certificado cargado' });
    }

    const cert = forge.pki.certificateFromPem(certSetting.value);
    const issuer = cert.issuer.attributes.find((a) => a.name === 'commonName')?.value || 'Desconocido';
    const isProduction = issuer === 'Computadores' || issuer === 'AFIP';

    res.json({
      ok: true,
      data: {
        issuer,
        isProduction,
        subject: cert.subject.attributes.find((a) => a.name === 'commonName')?.value || 'Desconocido',
        cuit: cert.subject.attributes.find((a) => a.name === 'serialNumber')?.value || 'Desconocido',
        validFrom: cert.validity.notBefore,
        validTo: cert.validity.notAfter,
      },
    });
  } catch (err) {
    logger.error({ err, empresaId: req.empresaId }, 'afip:cert-info');
    res.status(400).json({ ok: false, error: 'El certificado cargado no es válido' });
  }
});

// POST /api/afip/setup — Guardar la configuración de AFIP de ESTA empresa
router.post('/setup', checkPermission('config.editar'), async (req, res) => {
  try {
    const { cuit, cert, key, environment, pv, tax_condition } = req.body;

    if (environment && !['homologation', 'production'].includes(environment)) {
      return res.status(400).json({
        ok: false,
        error: 'El entorno debe ser "homologation" o "production"',
      });
    }

    // El certificado y la clave se validan antes de guardarlos: un PEM
    // corrupto guardado sin chequear recien fallaba al momento de facturar.
    if (cert) {
      try {
        forge.pki.certificateFromPem(cert);
      } catch {
        return res.status(400).json({ ok: false, error: 'El certificado no es un PEM válido' });
      }
    }

    if (key) {
      try {
        forge.pki.privateKeyFromPem(key);
      } catch {
        return res.status(400).json({ ok: false, error: 'La clave privada no es un PEM válido' });
      }
    }

    if (tax_condition && !CONDICIONES_FISCALES.includes(tax_condition)) {
      return res.status(400).json({
        ok: false,
        error: `La condición fiscal debe ser una de: ${CONDICIONES_FISCALES.join(', ')}`,
      });
    }

    const valores = {
      afip_cuit: cuit,
      afip_cert: cert,
      afip_key: key,
      afip_environment: environment,
      afip_pv: pv,
      tax_condition,
    };

    // El certificado y la clave se guardan juntos o no se guardan: subir uno
    // solo deja una configuracion que no puede firmar.
    if ((cert && !key) || (key && !cert)) {
      return res.status(400).json({
        ok: false,
        error: 'El certificado y la clave privada se cargan juntos.',
      });
    }

    // ── La pareja cert-clave (FR-087) ──
    if (cert && key && !sonPareja(cert, key)) {
      return res.status(400).json({
        ok: false,
        error:
          'El certificado y la clave privada no son pareja: esa clave no firma ese ' +
          'certificado. Subí el .key que generaste junto con el pedido (.csr) del que ' +
          'salió este .crt.',
      });
    }

    // ── El CUIT del certificado contra el configurado (FR-088) ──
    //
    // Es el defecto que hace que una empresa cargue el certificado de su
    // contador —o el de la otra sociedad— y no se entere hasta que AFIP rechaza
    // el ticket con un mensaje que no nombra ningún CUIT.
    const cuitEfectivo = soloDigitos(cuit || (await valorGuardado('afip_cuit', req.empresaId)));

    if (cert && cuitEfectivo) {
      const delCertificado = cuitDelCertificado(cert);

      if (delCertificado && delCertificado !== cuitEfectivo) {
        return res.status(400).json({
          ok: false,
          error:
            `El certificado está emitido para el CUIT ${delCertificado} y acá está ` +
            `configurado el ${cuitEfectivo}. Corregí el CUIT o subí el certificado de ` +
            'esta empresa: AFIP firma con el del certificado.',
        });
      }
    }

    // ════════════════════════════════════════════
    //  El bloqueo del pase a producción (decisión 2 del usuario)
    //
    //  El circuito de facturación **nunca se probó**. Sin este bloqueo, el primer
    //  comprobante fiscal real de un cliente sería también la primera prueba del
    //  circuito — y un comprobante emitido consume numeración correlativa y para
    //  darlo de baja hace falta una nota de crédito, que este sistema no emite.
    //
    //  ⚠⚠ **El bloqueo va SOLO sobre la transición a producción, no sobre
    //  emitir.** `POST /api/sales/:id/facturar` no consulta nada de esto: una
    //  empresa que ya está en producción sigue facturando. Quien ya factura hoy
    //  no puede quedarse sin facturar por un requisito nuevo, y esa es la línea
    //  que no se cruza.
    //
    //  Por eso mismo el paso se cumple también con un CAE previo: un comprobante
    //  autorizado es la prueba más fuerte que existe de que el circuito funciona.
    //
    //  ⚠⚠ **Se pregunta por la configuración que va a quedar, no por la
    //  guardada.** El gate corre ANTES de la escritura de más abajo, así que
    //  leyendo la base miraba las filas viejas: un cuerpo con
    //  `{ environment: 'production', pv: '99', cert, key }` respondía 200, dejaba
    //  la empresa en producción con el punto de venta 99 y no llamaba a AFIP ni
    //  una vez —las credenciales nuevas saltean también la consulta de más
    //  abajo—, amparado en una evidencia del punto de venta anterior.
    // ════════════════════════════════════════════
    if (environment === 'production') {
      const yaEstabaEnProduccion = await afipAuth.isProduction(req.empresaId);

      if (!yaEstabaEnProduccion) {
        const circuito = await afipVerificacion.estadoDelCircuito(
          req.empresaId,
          loQueVaAQuedar(valores)
        );

        if (!circuito.cumplido) {
          return res.status(400).json({
            ok: false,
            error: 'CIRCUITO_NO_VERIFICADO',
            message:
              'Antes de pasar a producción hay que verificar el circuito contra AFIP. ' +
              'Guardá esta configuración en homologación, tocá «Verificar circuito» y, ' +
              'cuando dé bien, volvé a pasar a producción. Es una consulta: no emite ' +
              'ningún comprobante ni consume numeración.',
          });
        }
      }
    }

    // ════════════════════════════════════════════
    //  El punto de venta, contra AFIP y ANTES de guardar (FR-091)
    //
    //  Un punto de venta que ARCA no tiene declarado como «Factura Electrónica -
    //  Web Services» no falla al guardarlo: falla al emitir, y ahí ya hay alguien
    //  esperando su comprobante. `FECompUltimoAutorizado` lo contesta sin emitir
    //  nada y sin consumir numeración.
    //
    //  ⚠ **Solo se puede consultar con las credenciales que YA están guardadas**,
    //  y eso acota cuándo corre. `afipService` lee el certificado y la clave de
    //  `settings`: si vinieran en este mismo request todavía no están escritas, y
    //  escribirlas antes para poder consultar sería guardar justo lo que se está
    //  por validar. Peor: la consulta se haría con el certificado **viejo** —o
    //  sin ninguno—, así que fallaría y bloquearía una carga legítima de material
    //  nuevo, que es exactamente el caso del primer setup de un cliente.
    //
    //  Entonces: se valida cuando cambia el punto de venta y las credenciales en
    //  vigor son las que ya están.
    //
    //  ⚠ **Lo que queda afuera queda afuera de verdad**, y el comentario anterior
    //  decía que «lo cubre el bloqueo del pase a producción» cuando no lo cubría:
    //  el bloqueo leía las filas viejas, así que el punto de venta nuevo que venía
    //  con credenciales nuevas se colaba a producción sin que nadie lo consultara.
    //  Ahora el bloqueo compara contra el punto de venta que va a quedar, y ahí sí
    //  lo cubre — **pero solo cuando se pasa a producción**. Cambiar el punto de
    //  venta con credenciales nuevas quedándose en homologación no consulta nada:
    //  no hay comprobante fiscal en juego, el paso 4 del checklist pasa a
    //  «pendiente» solo —la evidencia es de otro punto de venta— y «Verificar
    //  circuito» ejecuta los dos pasos con la configuración ya guardada.
    // ════════════════════════════════════════════
    const pvPedido = String(pv === undefined || pv === null ? '' : pv).trim();
    const pvActual = String(await valorGuardado('afip_pv', req.empresaId) || '').trim();
    const credencialesNuevas = Boolean(cert && key);

    if (pvPedido && pvPedido !== pvActual && !credencialesNuevas) {
      const certGuardado = await valorGuardado('afip_cert', req.empresaId);

      if (certGuardado) {
        try {
          await afipService.getLastVoucher(
            Number(pvPedido),
            afipVerificacion.TIPO_PARA_CONSULTAR,
            req.empresaId
          );
        } catch (err) {
          logger.warn(
            { empresaId: req.empresaId, pv: pvPedido, err: err.message },
            'afip: AFIP rechazó el punto de venta al guardarlo'
          );

          return res.status(400).json({
            ok: false,
            error:
              `AFIP no reconoce el punto de venta ${pvPedido} para este CUIT. Declaralo en ` +
              'ARCA como «Factura Electrónica - Web Services» y volvé a guardarlo. ' +
              `Respuesta de AFIP: ${err.message}`,
          });
        }
      }
    }

    await sequelize.transaction(async (transaction) => {
      await guardarConfiguracionAfip(req.empresaId, valores, { transaction });
    });

    logger.info({ empresaId: req.empresaId, environment }, 'afip: configuración actualizada');
    res.json({ ok: true, message: 'Configuración de AFIP guardada correctamente' });
  } catch (err) {
    fallo(req, res, err, 'Error al guardar la configuración de AFIP');
  }
});

// POST /api/afip/generate-csr — Generar CSR y clave para el trámite en ARCA
//
// ARCA exige el CUIT dentro del subject del pedido. Antes no se enviaba, y el
// archivo resultante era rechazado en la ventanilla: el primer paso del setup
// no funcionaba.
router.post('/generate-csr', checkPermission('config.editar'), async (req, res) => {
  try {
    const { alias } = req.body;

    // El CUIT y la razón social salen de la empresa, no del body: son datos
    // que ya están cargados y no tiene sentido pedirlos de nuevo.
    const empresa = await Empresa.findByPk(req.empresaId, {
      attributes: ['name', 'cuit'],
    });

    const cuit = (req.body.cuit || (empresa && empresa.cuit) || '').replace(/\D/g, '');

    if (cuit.length !== 11) {
      return res.status(400).json({
        ok: false,
        error: 'Cargá el CUIT de la empresa antes de generar el pedido de certificado.',
      });
    }

    const result = await afipService.createCSR(
      alias || (empresa && empresa.name) || 'Favalio',
      cuit,
      (empresa && empresa.name) || alias
    );

    res.json({ ok: true, data: result });
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    fallo(req, res, err, 'Error al generar el pedido de certificado');
  }
});

// ════════════════════════════════════════════
//  POST /api/afip/verificar — probar el circuito SIN emitir nada
//
//  Es lo que reemplaza al botón «Emitir Factura de Prueba» y a `POST
//  /afip/invoice`: ejercita el circuito entero —ticket WSAA y punto de venta—
//  sin generar un hecho fiscal irreversible.
//
//  Pide `config.editar` y no `config.ver` porque **escribe**: deja la evidencia
//  que cumple el paso 4 del checklist y que habilita el pase a producción.
// ════════════════════════════════════════════
router.post('/verificar', checkPermission('config.editar'), async (req, res) => {
  try {
    const evidencia = await afipVerificacion.verificarCircuito(
      req.empresaId,
      (req.usuario && req.usuario.id) || null
    );

    res.json({ ok: true, data: evidencia });
  } catch (err) {
    // Un `ErrorDeNegocio` sale con su propio texto y su 400: el mensaje dice
    // cuál de los dos pasos falló y qué hacer, y eso es lo que el usuario
    // necesita leer. `fallo` ya lo distingue de un error de servidor.
    fallo(req, res, err, 'No se pudo verificar el circuito de facturación');
  }
});

/**
 * Lo que se borra al desvincular AFIP.
 *
 * ⚠ **`afip_cuit` NO está**, y no es un olvido: el CUIT es un dato de la empresa
 * —el mismo que va en los remitos y en la cuenta corriente—, no una credencial.
 * Borrarlo obligaría a volver a tipearlo para reconectar y dejaría a la pantalla
 * sin poder mostrar de quién era la vinculación que se acaba de cortar.
 *
 * `tax_condition` tampoco: es la condición fiscal de la empresa y decide qué
 * tipo de comprobante emite. Sobrevive a la desvinculación igual que el CUIT.
 */
const CLAVES_DE_LA_VINCULACION = [
  'afip_cert',
  'afip_key',
  'afip_pv',
  'afip_environment',
  'afip_verificacion',
];

// ════════════════════════════════════════════
//  DELETE /api/afip/vinculacion — «Desvincular AFIP»
//
//  ⚠ **No toca ninguna venta ya facturada.** Los CAE emitidos son hechos
//  fiscales: existen en AFIP, están impresos en comprobantes que alguien tiene, y
//  borrarlos de acá no los deshace — solo deja al sistema sin poder mostrar el
//  comprobante que su cliente le muestra en el mostrador.
//
//  ⚠⚠ **La clave privada no se puede recuperar de acá.** No sale por la API
//  (`utils/settingsSecretos.js`) y la del CSR nunca se guardó del lado del
//  servidor. Después de esto hay que volver a subir el par, o rehacer el trámite
//  en ARCA. La confirmación de la pantalla lo dice con esas palabras.
// ════════════════════════════════════════════
router.delete('/vinculacion', checkPermission('config.editar'), async (req, res) => {
  try {
    await sequelize.transaction(async (transaction) => {
      await Setting.destroy({
        where: { key: { [Op.in]: CLAVES_DE_LA_VINCULACION }, empresa_id: req.empresaId },
        transaction,
      });

      // Sin cambios que escribir —el objeto vacío no toca ninguna fila— pero SÍ
      // hay que invalidar el ticket WSAA: sigue en memoria, emitido con el
      // certificado que se acaba de borrar, y valdría hasta doce horas más. La
      // invalidación vive adentro de `guardarConfiguracionAfip` justamente para
      // que ningún camino que cambie el material fiscal pueda saltearla.
      await guardarConfiguracionAfip(req.empresaId, {}, { transaction });
    });

    logger.info({ empresaId: req.empresaId }, 'afip: vinculación eliminada');

    res.json({
      ok: true,
      message:
        'Se desvinculó AFIP. Las ventas ya facturadas conservan su CAE; para volver a ' +
        'facturar hay que subir de nuevo el certificado y la clave.',
    });
  } catch (err) {
    fallo(req, res, err, 'No se pudo desvincular AFIP');
  }
});

// ════════════════════════════════════════════
//  Acá vivía `POST /api/afip/invoice`, y se borró
//
//  Emitía un comprobante fiscal REAL con `type`, `amount` y `pv` sacados del
//  cuerpo, **sin crear ninguna `Sale`**. El permiso que pedía era `ventas.crear`,
//  que tiene el rol `vendedor`: un cajero, a un request de distancia, generaba un
//  CAE que no cuelga de ninguna venta.
//
//  Lo que eso cuesta no se deshace con un `DELETE`: un comprobante emitido
//  consume numeración correlativa, y darlo de baja exige una nota de crédito —que
//  este sistema no emite—. Es exactamente el «CAE huérfano» que
//  `POST /api/sales/:id/facturar` existe para que no pueda pasar: ese sí tiene la
//  venta persistida, es idempotente y toma lock.
//
//  Es la misma familia que el botón «Emitir Factura de Prueba (1 ARS)» que el
//  hito 5 sacó del punto de venta: una acción a un clic de un hecho fiscal
//  irreversible.
//
//  **No lo llamaba nadie**: se buscó en `apps/web` y en los tests antes de
//  borrarlo, y el único uso de `/afip/invoice` que queda es el `GET
//  /invoice/:type/:pv/:number/data` de acá abajo —que solo lee un comprobante ya
//  emitido— desde `pages/InvoicesList.jsx`.
//
//  Lo que ese endpoint servía para comprobar —«¿mi configuración de AFIP
//  funciona?»— lo va a contestar `POST /api/afip/verificar` (corte 9), que pide
//  el ticket WSAA y consulta el último comprobante autorizado: no emite nada y no
//  consume numeración.
//
//  Que no vuelva lo sostiene una guardia estática en
//  `tests/afipConfiguracion.test.js` —no en `observabilidad.test.js`, que es
//  adonde este comentario mandaba y donde nunca estuvo—: ningún archivo de
//  `routes/`, `services/`, `utils/` ni `middleware/` fuera de `routes/sales.js`
//  puede nombrar `createVoucher(`, y la única excepción declarada es
//  `services/afipService.js`, que es donde el método se define.
// ════════════════════════════════════════════

// GET /api/afip/invoice/:type/:pv/:number/data — Datos para imprimir
router.get('/invoice/:type/:pv/:number/data', checkPermission('ventas.ver'), async (req, res) => {
  try {
    const { type, pv, number } = req.params;

    const voucherInfo = await afipService.getVoucherInfo(pv, type, number, req.empresaId);

    res.json({
      ok: true,
      data: {
        PtoVta: pv,
        CbteTipo: type,
        CbteDesde: number,
        CbteHasta: number,
        ...voucherInfo,
      },
    });
  } catch (err) {
    logger.error({ err, empresaId: req.empresaId }, 'afip:voucher-data');
    res.status(502).json({ ok: false, error: 'No se pudo obtener el comprobante de AFIP' });
  }
});

module.exports = router;
