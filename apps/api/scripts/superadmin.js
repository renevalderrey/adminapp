#!/usr/bin/env node
/**
 * ════════════════════════════════════════════
 *  Operadores de la plataforma
 *
 *  Un superadmin puede entrar a la empresa de cualquier cliente y ve los
 *  modulos que todavia no se liberaron. Es el nivel de quien desarrolla y da
 *  soporte, no un rol dentro de una empresa.
 *
 *  Se hace como script y NO como endpoint a proposito. Un endpoint que otorga
 *  superadmin es una escalada de privilegios esperando a que alguien encuentre
 *  el IDOR: quien lo llame se vuelve operador de toda la plataforma. Un script
 *  que corre con las credenciales de la base no tiene esa superficie.
 *
 *  ── Uso ──
 *
 *    node scripts/superadmin.js listar
 *    node scripts/superadmin.js activar <email>
 *    node scripts/superadmin.js quitar <email>
 * ════════════════════════════════════════════
 */

require('dotenv').config();

const { sequelize, Usuario, UsuarioEmpresa, Empresa } = require('../src/models');

async function listar() {
  const superadmins = await Usuario.findAll({
    where: { es_superadmin: true },
    attributes: ['id', 'email', 'nombre'],
    order: [['id', 'ASC']],
  });

  console.log('');

  if (superadmins.length === 0) {
    console.log('No hay ningun superadmin.');
    console.log('');
    return;
  }

  console.log(`Operadores de la plataforma (${superadmins.length}):`);
  console.log('');

  for (const u of superadmins) {
    console.log(`  #${u.id}  ${u.email || '(sin email)'}  ${u.nombre || ''}`);
  }

  const empresas = await Empresa.count();
  console.log('');
  console.log(`Cada uno puede entrar a las ${empresas} empresas de la plataforma.`);
  console.log('');
}

async function cambiar(email, valor) {
  if (!email) {
    console.error('Falta el email del usuario.');
    process.exitCode = 1;
    return;
  }

  const usuario = await Usuario.findOne({ where: { email } });

  if (!usuario) {
    console.error(`No hay ningun usuario con el email "${email}".`);
    console.error('El usuario tiene que haber entrado al menos una vez para existir en la base.');
    process.exitCode = 1;
    return;
  }

  if (usuario.es_superadmin === valor) {
    console.log('');
    console.log(`${email} ya ${valor ? 'es' : 'no es'} superadmin. No se cambio nada.`);
    console.log('');
    return;
  }

  await usuario.update({ es_superadmin: valor });

  // Las membresias reales no se tocan: el superadmin entra a las otras
  // empresas sin ser miembro, y por eso no aparece en la pantalla de Equipo de
  // ningun cliente.
  const membresias = await UsuarioEmpresa.count({ where: { usuario_id: usuario.id } });

  console.log('');
  console.log(valor
    ? `${email} ahora es operador de la plataforma.`
    : `${email} dejo de ser operador de la plataforma.`);
  console.log(`Membresias propias: ${membresias} (sin cambios).`);
  console.log('');

  if (valor) {
    console.log('Puede entrar a cualquier empresa desde el selector del encabezado.');
    console.log('Cada accion suya sobre una empresa ajena queda registrada en el log.');
    console.log('');
  }
}

async function main() {
  const [accion, argumento] = process.argv.slice(2);

  await sequelize.authenticate();

  switch (accion) {
    case 'listar':
      await listar();
      break;

    case 'activar':
      await cambiar(argumento, true);
      break;

    case 'quitar':
      await cambiar(argumento, false);
      break;

    default:
      console.log('');
      console.log('Uso:');
      console.log('  node scripts/superadmin.js listar');
      console.log('  node scripts/superadmin.js activar <email>');
      console.log('  node scripts/superadmin.js quitar <email>');
      console.log('');
      process.exitCode = 1;
  }

  await sequelize.close();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}
