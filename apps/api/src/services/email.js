const { Resend } = require('resend');
const logger = require('../utils/logger');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'noreply@adminapp.app';

let resend = null;
if (RESEND_API_KEY) {
  resend = new Resend(RESEND_API_KEY);
}

async function sendEmail({ to, subject, html }) {
  logger.info({ to, subject }, 'Sending email');

  if (!resend) {
    logger.warn('Resend not configured — email logged to console only');
    return { ok: true, mock: true };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
    });

    if (error) {
      logger.error({ error }, 'Resend send failed');
      return { ok: false, error };
    }

    return { ok: true, data };
  } catch (err) {
    logger.error({ err }, 'Email send error');
    return { ok: false, error: err.message };
  }
}

function welcomeEmail(usuarioNombre, empresaNombre) {
  const frontendUrl = process.env.FRONTEND_URL;
  if (!frontendUrl) logger.warn('FRONTEND_URL not set — email links will be broken');

  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #6d28d9;">Bienvenido a Admin App</h1>
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

function invitationEmail(invitadorNombre, empresaNombre, token) {
  const frontendUrl = process.env.FRONTEND_URL || '#';
  const acceptUrl = `${frontendUrl}/accept-invite/${token}`;
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #6d28d9;">Te invitaron a unirte a ${empresaNombre}</h1>
      <p><strong>${invitadorNombre}</strong> te ha invitado a formar parte de <strong>${empresaNombre}</strong> en Admin App.</p>
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
    titulo: `Tu prueba de AdminApp termina en ${diasRestantes} ${plural}`,
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
      <p>Gracias por confiar en AdminApp.</p>
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

module.exports = {
  sendEmail,
  welcomeEmail,
  invitationEmail,
  trialPorVencerEmail,
  trialVencidoEmail,
  suscripcionActivadaEmail,
  suscripcionVencidaEmail,
};
