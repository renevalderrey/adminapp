const { Resend } = require('resend');
const logger = require('../utils/logger');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'noreply@favalio.com';

let resend = null;
if (RESEND_API_KEY) {
  resend = new Resend(RESEND_API_KEY);
}

// Sin RESEND_API_KEY no se manda nada. Avisarlo una sola vez al arrancar, y no
// en cada envio, para que el aviso se vea en vez de perderse repetido.
if (!RESEND_API_KEY) {
  const nivel = process.env.NODE_ENV === 'production' ? 'error' : 'warn';
  logger[nivel](
    'RESEND_API_KEY no esta configurada: NO se va a enviar ningun email ' +
    '(invitaciones, bienvenida, avisos de vencimiento).'
  );
}

/**
 * Envia un email.
 *
 * @returns {Promise<{ok: boolean, enviado: boolean, error?: any, data?: any}>}
 *
 * `ok: false` cuando no se envio. Antes, sin RESEND_API_KEY, devolvia
 * `{ ok: true, mock: true }`: las invitaciones se perdian en silencio y quien
 * invitaba veia "Invitación enviada" en pantalla mientras el destinatario no
 * recibia nada y no habia forma de darse cuenta. Un error silencioso que se
 * manifiesta como "el sistema anda pero el equipo no llega" es de los mas
 * caros de diagnosticar.
 */
async function sendEmail({ to, subject, html }) {
  if (!resend) {
    logger.error(
      { to, subject },
      'Email NO enviado: falta RESEND_API_KEY'
    );
    return { ok: false, enviado: false, error: 'EMAIL_NO_CONFIGURADO' };
  }

  logger.info({ to, subject }, 'Enviando email');

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
    });

    if (error) {
      logger.error({ error, to, subject }, 'Resend rechazo el envio');
      return { ok: false, enviado: false, error };
    }

    return { ok: true, enviado: true, data };
  } catch (err) {
    logger.error({ err, to, subject }, 'Error al enviar el email');
    return { ok: false, enviado: false, error: err.message };
  }
}

function welcomeEmail(usuarioNombre, empresaNombre) {
  const frontendUrl = process.env.FRONTEND_URL;
  if (!frontendUrl) logger.warn('FRONTEND_URL not set — email links will be broken');

  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #6d28d9;">Bienvenido a Favalio</h1>
      <p>Hola ${usuarioNombre},</p>
      <p>Tu empresa <strong>${empresaNombre}</strong> ha sido creada exitosamente.</p>
      <p>Ya podés empezar a gestionar tus ventas, inventario y más.</p>
      <p style="margin-top: 24px;">
        <a href="${frontendUrl || '#'}"
           style="background: #6d28d9; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
          Ir al Dashboard
        </a>
      </p>
      <p style="margin-top: 24px; font-size: 12px; color: #888;">
        Estás en período de prueba de 15 días. Al finalizar, podrás elegir un plan para continuar.
      </p>
    </div>
  `;
}

/**
 * El mail de invitacion.
 *
 * ⚠ El enlace va a `/?invite=<token>` y **no** a `/accept-invite/<token>`, que
 * es adonde apuntaba hasta este hito: esa ruta **no existe en `App.jsx`**. Quien
 * abria el enlace del mail entraba, el `<Routes>` no matcheaba nada y el `<main>`
 * quedaba **en blanco**. Era el segundo de los tres eslabones rotos de la cadena
 * de la invitacion, y el sintoma —una pagina vacia— no dejaba ni un log.
 *
 * ── Por que NO es una `<Route>` nueva ──
 *
 * Porque el `<Routes>` de `App.jsx` vive adentro del shell autenticado: exige
 * contexto de empresa y desloguea con `contextError`, que es exactamente lo que
 * un invitado no tiene todavia. Una ruta nueva ahi lo sacaria de la aplicacion
 * antes de que pudiera aceptar nada. Y sumaria una decimonovena ruta contra
 * FR-004.
 *
 * `?invite=` es el mecanismo que la aplicacion **ya tiene**: `App.jsx` lo lee del
 * query string apenas monta, lo guarda en `localStorage` y lo canjea en cuanto
 * hay usuario. Funciona igual si la persona todavia se tiene que registrar,
 * porque el token sobrevive al ida y vuelta con Auth0.
 */
/**
 * El enlace de invitacion, armado en UN solo lugar.
 *
 * Lo necesitan dos: el mail, y la respuesta de `POST /:empresaId/invitar`, que
 * lo devuelve para que la pantalla lo pueda copiar cuando el mail **no** salio
 * (FR-106). Escrito dos veces, el dia que la forma cambie —como acaba de pasar,
 * de `/accept-invite/<token>` a `/?invite=<token>`— uno de los dos queda
 * apuntando a una ruta que no existe, y el que queda mal es justamente el que se
 * usa cuando el mail fallo: el camino que nadie ejercita hasta que hace falta.
 *
 * @param {string} token El token de la invitacion.
 * @returns {string} La URL absoluta, o una relativa si falta `FRONTEND_URL`.
 */
function enlaceDeInvitacion(token) {
  const frontendUrl = process.env.FRONTEND_URL || '';

  return `${frontendUrl}/?invite=${token}`;
}

function invitationEmail(invitadorNombre, empresaNombre, token) {
  const acceptUrl = enlaceDeInvitacion(token);
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #6d28d9;">Te invitaron a unirte a ${empresaNombre}</h1>
      <p><strong>${invitadorNombre}</strong> te ha invitado a formar parte de <strong>${empresaNombre}</strong> en Favalio.</p>
      <p>Hacé clic en el siguiente enlace para aceptar la invitación:</p>
      <p style="margin-top: 24px;">
        <a href="${acceptUrl}"
           style="background: #6d28d9; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
          Aceptar Invitación
        </a>
      </p>
      <p style="margin-top: 24px; font-size: 12px; color: #888;">
        Este enlace expira en 7 días.
      </p>
    </div>
  `;
}


// ════════════════════════════════════════════
//  Ciclo de vida de la suscripcion
//
//  No existia ninguna: el usuario se enteraba de que se le vencio el trial
//  cuando la aplicacion le empezaba a devolver 402 y dejaba de funcionar.
//  Avisar antes es la diferencia entre un cliente que renueva y uno que se va
//  pensando que el sistema se rompio.
// ════════════════════════════════════════════

/** Envoltorio comun, para no repetir el marcado en cada plantilla. */
function plantillaBase({ titulo, cuerpo, cta, notaPie }) {
  const frontendUrl = process.env.FRONTEND_URL || '#';

  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #6d28d9;">${titulo}</h1>
      ${cuerpo}
      ${cta ? `
        <p style="margin-top: 24px;">
          <a href="${frontendUrl}${cta.ruta || ''}"
             style="background: #6d28d9; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
            ${cta.texto}
          </a>
        </p>
      ` : ''}
      ${notaPie ? `<p style="margin-top: 24px; font-size: 12px; color: #888;">${notaPie}</p>` : ''}
    </div>
  `;
}

/** Aviso previo: al trial le quedan pocos dias. */
function trialPorVencerEmail(empresaNombre, diasRestantes) {
  const plural = diasRestantes === 1 ? 'día' : 'días';

  return plantillaBase({
    titulo: `Tu prueba de Favalio termina en ${diasRestantes} ${plural}`,
    cuerpo: `
      <p>Hola,</p>
      <p>El período de prueba de <strong>${empresaNombre}</strong> termina en
         <strong>${diasRestantes} ${plural}</strong>.</p>
      <p>Para no interrumpir la operación —ventas, facturación, stock— hace falta
         contratar un plan antes de esa fecha.</p>
    `,
    cta: { texto: 'Ver mi suscripción', ruta: '/suscripcion' },
    notaPie: 'Si ya arreglaste el pago, ignorá este mensaje.',
  });
}

/** El trial termino y empieza el periodo de gracia. */
function trialVencidoEmail(empresaNombre, finDeGracia) {
  const fecha = finDeGracia
    ? new Date(finDeGracia).toLocaleDateString('es-AR', { day: 'numeric', month: 'long' })
    : null;

  return plantillaBase({
    titulo: 'Terminó tu período de prueba',
    cuerpo: `
      <p>Hola,</p>
      <p>La prueba gratuita de <strong>${empresaNombre}</strong> llegó a su fin.</p>
      ${fecha
        ? `<p>Tenés acceso hasta el <strong>${fecha}</strong>. Después de esa fecha
             la cuenta queda suspendida hasta que se registre el pago.</p>`
        : '<p>La cuenta queda suspendida hasta que se registre el pago.</p>'}
      <p>Tus datos no se borran: quedan guardados y vuelven a estar disponibles
         apenas se reactive la cuenta.</p>
    `,
    cta: { texto: 'Contratar un plan', ruta: '/suscripcion' },
  });
}

/** Se registro un pago y la cuenta quedo activa. */
function suscripcionActivadaEmail(empresaNombre, plan, hasta) {
  const fecha = hasta
    ? new Date(hasta).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  return plantillaBase({
    titulo: 'Tu suscripción está activa',
    cuerpo: `
      <p>Hola,</p>
      <p>Registramos el pago de <strong>${empresaNombre}</strong>.</p>
      <p>Plan <strong>${plan}</strong>${fecha ? `, activo hasta el <strong>${fecha}</strong>` : ''}.</p>
      <p>Gracias por confiar en Favalio.</p>
    `,
    cta: { texto: 'Ir al panel' },
  });
}

/** La cuenta quedo suspendida por falta de pago. */
function suscripcionVencidaEmail(empresaNombre) {
  return plantillaBase({
    titulo: 'Tu cuenta quedó suspendida',
    cuerpo: `
      <p>Hola,</p>
      <p>La suscripción de <strong>${empresaNombre}</strong> venció y la cuenta
         quedó suspendida.</p>
      <p><strong>Tus datos siguen ahí.</strong> Ventas, comprobantes, stock y
         clientes están guardados y vuelven a estar disponibles apenas se
         registre el pago.</p>
      <p>Si necesitás exportar información para tu contador, escribinos y lo
         resolvemos.</p>
    `,
    cta: { texto: 'Reactivar mi cuenta', ruta: '/suscripcion' },
  });
}


// ════════════════════════════════════════════
//  Los pedidos del catálogo público
//
//  Dos correos por pedido, y ninguno de los dos puede afectar al pedido: cuando
//  se mandan, la transacción ya commiteó y la fila existe. Lo único que viaja de
//  vuelta al handler es **si salieron**, porque es lo que le permite a la
//  pantalla no prometer un correo que no llegó.
//
//  ⚠ Los importes van **congelados**, de las líneas del pedido. Recalcularlos
//  contra el catálogo dejaría un correo que dice un número y una base que dice
//  otro — y el que el comprador guarda es el correo.
// ════════════════════════════════════════════

// El mismo formateador del número que usan la tienda, la bandeja y el WhatsApp:
// `#1042` en las seis superficies (FR-137b). Escrito a mano acá, sería la
// séptima forma de escribir lo mismo.
const { numeroDePedido } = require('@favalio/pedido');

const pesosDelPedido = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-AR')}`;

const ENTREGAS_LEGIBLES = {
  retiro_socio: 'Retiro en el gimnasio',
  retiro_local: 'Retiro en el local',
  envio: 'Envío a domicilio',
  coordinar: 'A coordinar por WhatsApp',
};

const PAGOS_LEGIBLES = {
  transferencia: 'Transferencia bancaria',
  efectivo: 'Efectivo al retirar',
};

/** Las líneas como tabla, con el mismo formato en los dos correos. */
function lineasDelPedidoEnHtml(lineas = [], pedido = {}) {
  const filas = lineas.map((l) => `
    <tr>
      <td style="padding:6px 0;border-bottom:1px solid #eee;">${l.cantidad}× ${l.nombre}</td>
      <td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;">${pesosDelPedido(l.subtotal)}</td>
    </tr>
  `).join('');

  // Un renglón «Envío $0» le hace creer al que lo lee que paga algo.
  const envio = Number(pedido.envio_costo) > 0 ? `
    <tr>
      <td style="padding:6px 0;">Envío</td>
      <td style="padding:6px 0;text-align:right;">${pesosDelPedido(pedido.envio_costo)}</td>
    </tr>
  ` : '';

  return `
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:12px;">
      ${filas}
      ${envio}
      <tr>
        <td style="padding:8px 0;font-weight:bold;">Total</td>
        <td style="padding:8px 0;text-align:right;font-weight:bold;">${pesosDelPedido(pedido.total)}</td>
      </tr>
    </table>
  `;
}

/**
 * El aviso al comercio. Va **a la casilla del catálogo** y a ninguna otra.
 *
 * No a todos los usuarios con `pedidos.ver` —que serían cinco correos por pedido
 * y ninguno con dueño— ni al email de la empresa, que es el administrativo y no
 * el que mira quien prepara los pedidos.
 */
function pedidoNuevoEmail(pedido, lineas, catalogo = {}) {
  const quien = [pedido.comprador_nombre, pedido.comprador_telefono].filter(Boolean).join(' — ');
  const donde = pedido.entrega === 'envio'
    ? [pedido.envio_direccion, pedido.envio_localidad, pedido.envio_cp].filter(Boolean).join(', ')
    : '';

  return plantillaBase({
    titulo: `Pedido ${numeroDePedido(pedido.numero)}`,
    cuerpo: `
      <p>Entró un pedido por <strong>${catalogo.nombre_visible || 'tu catálogo'}</strong>.</p>
      <p>${quien}${pedido.comprador_nro_socio ? ` · Socio ${pedido.comprador_nro_socio}` : ''}</p>
      ${lineasDelPedidoEnHtml(lineas, pedido)}
      <p style="margin-top:16px;">
        <strong>Entrega:</strong> ${ENTREGAS_LEGIBLES[pedido.entrega] || pedido.entrega}
        ${donde ? `<br>${donde}` : ''}<br>
        <strong>Pago:</strong> ${PAGOS_LEGIBLES[pedido.medio_pago] || pedido.medio_pago}
      </p>
      ${pedido.notas ? `<p><strong>Nota:</strong> ${pedido.notas}</p>` : ''}
    `,
    cta: { texto: 'Ver en la bandeja', ruta: '/pedidos' },
    // ⚠ Lo mismo que dice la pantalla, por el mismo motivo: quien lee este
    // correo puede creer que la venta ya está registrada.
    notaPie: 'Marcar el pedido como cobrado cambia su estado. No descuenta stock ni registra la venta.',
  });
}

/** La confirmación al comprador. Sólo si dejó email: es opcional. */
function pedidoConfirmadoEmail(pedido, lineas, catalogo = {}) {
  return plantillaBase({
    titulo: `Tu pedido ${numeroDePedido(pedido.numero)}`,
    cuerpo: `
      <p>Recibimos tu pedido en <strong>${catalogo.nombre_visible || 'la tienda'}</strong>.</p>
      ${lineasDelPedidoEnHtml(lineas, pedido)}
      <p style="margin-top:16px;">
        <strong>Entrega:</strong> ${ENTREGAS_LEGIBLES[pedido.entrega] || pedido.entrega}<br>
        <strong>Pago:</strong> ${PAGOS_LEGIBLES[pedido.medio_pago] || pedido.medio_pago}
      </p>
      <p>Te vamos a escribir por WhatsApp para coordinar.</p>
    `,
    // ⚠ **Sin plazo.** Ningún pedido vence solo: no hay tarea que los expire ni
    // stock reservado, así que prometer «reservado 24 horas» dejaría al
    // comprador creyendo que perdió el lugar.
    notaPie: 'Si algo no coincide, respondé este correo o escribinos por WhatsApp.',
  });
}

module.exports = {
  sendEmail,
  welcomeEmail,
  invitationEmail,
  enlaceDeInvitacion,
  trialPorVencerEmail,
  trialVencidoEmail,
  suscripcionActivadaEmail,
  suscripcionVencidaEmail,
  pedidoNuevoEmail,
  pedidoConfirmadoEmail,
};
