// ════════════════════════════════════════════
//  Test Setup
//  Configuración global para tests con Jest
// ════════════════════════════════════════════

// Esto corre via setupFiles, es decir ANTES de que jest instale el framework
// de tests. Los globals beforeAll/afterAll todavia no existen en este punto:
// la version anterior de este archivo los usaba y habria tirado ReferenceError
// apenas corriera el primer test. Como no habia ninguno, nunca se noto.
// Las variables se setean de forma directa.

process.env.NODE_ENV = 'test';
process.env.BYPASS_AUTH = 'true';
process.env.LOG_LEVEL = 'silent';

// Valores ficticios de Auth0.
//
// Ya no hacen falta: desde que `middleware/auth.js` no construye el verificador
// con BYPASS_AUTH activo, importarlo sin estas variables no rompe nada, y
// `autenticacionConBypass.test.js` es el que lo fija.
//
// Se dejan como red. Historia de por que: `auth({...})` se construia al
// importar el archivo y tiraba "An 'audience' is required to validate the 'aud'
// claim" si faltaba la variable. En la maquina de quien desarrolla no se notaba
// porque dotenv levanta el .env local; en CI no hay .env, asi que server.test.js
// fallaba solo alla. Se parcheo aca. El mismo hueco volvio a morder meses
// despues en el job de pruebas de navegador, que levanta la API con
// BYPASS_AUTH y sin .env: noventa segundos de espera y un ERR_ASSERTION que no
// nombra ni a Auth0 ni al bypass. Ahi se arreglo en el medio y no en el borde.
process.env.AUTH0_DOMAIN = process.env.AUTH0_DOMAIN || 'tests.auth0.local';
process.env.AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE || 'https://tests.adminapp.local/api';
