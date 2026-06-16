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
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #6d28d9;">Bienvenido a Admin App</h1>
      <p>Hola ${usuarioNombre},</p>
      <p>Tu empresa <strong>${empresaNombre}</strong> ha sido creada exitosamente.</p>
      <p>Ya podés empezar a gestionar tus ventas, inventario y más.</p>
      <p style="margin-top: 24px;">
        <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}"
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
  const acceptUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/accept-invite/${token}`;
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

module.exports = { sendEmail, welcomeEmail, invitationEmail };
