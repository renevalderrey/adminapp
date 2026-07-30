const { Empresa, PuntoDeVenta, Usuario, UsuarioEmpresa, Suscripcion, Setting } = require('./models');
const logger = require('./utils/logger');

async function setupDefaultData() {
  try {
    const existing = await Empresa.findOne({ where: { is_active: true } });
    if (existing) {
      // En BYPASS_AUTH, asegurar que el dev user tenga acceso a la empresa existente
      if (process.env.BYPASS_AUTH === 'true') {
        await ensureDevUserAccess(existing.id);
      }
      return;
    }

    logger.info('Creating default empresa');

    const empresa = await Empresa.create({
      name: 'Mi Empresa',
      cuit: '',
      rubro: 'suplementos',
      onboarding_completed: true,
      settings: {
        margin_efectivo: 50,
        recargo_tarjeta: 20,
        descuento_alianza: 10,
        fixed_expenses_total: 0,
        afip_cuit: '',
        afip_pv: '',
        afip_environment: 'homologation',
        tax_condition: 'Monotributo',
      },
    });

    const pvs = await PuntoDeVenta.bulkCreate([
      { empresa_id: empresa.id, name: 'General (Jesús)', code: 'general', address: 'Jesús' },
      { empresa_id: empresa.id, name: 'Ortiz', code: 'ortiz', address: 'Ortiz' },
      { empresa_id: empresa.id, name: 'Mayo', code: 'mayo', address: 'Mayo' },
    ]);

    const settings = await Setting.findAll();
    if (settings.length) {
      const flat = {};
      settings.forEach(s => { flat[s.key] = s.value; });
      await empresa.update({ settings: { ...empresa.settings, ...flat } });
    }

    // Crear suscripción trial para la empresa default
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 15);
    await Suscripcion.create({
      empresa_id: empresa.id,
      plan: 'free',
      status: 'trialing',
      trial_starts_at: new Date(),
      trial_ends_at: trialEnd,
    });

    // Vincular dev user si BYPASS_AUTH está activo
    if (process.env.BYPASS_AUTH === 'true') {
      await ensureDevUserAccess(empresa.id);
    }

    logger.info({ empresa: empresa.name, pvs: pvs.length }, 'Default empresa created');
  } catch (err) {
    logger.error({ err }, 'Setup error');
  }
}

async function ensureDevUserAccess(empresaId) {
  try {
    const [usuario] = await Usuario.findOrCreate({
      where: { auth0_sub: 'test-user-id' },
      defaults: { email: 'dev@adminapp.app', nombre: 'Dev User' },
    });

    await UsuarioEmpresa.findOrCreate({
      where: { usuario_id: usuario.id, empresa_id: empresaId },
      defaults: { role: 'admin', is_default: true },
    });

    logger.info({ empresaId }, 'Dev user linked to empresa');
  } catch (err) {
    logger.error({ err }, 'Error linking dev user');
  }
}

module.exports = setupDefaultData;
