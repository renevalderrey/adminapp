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
// BYPASS_AUTH hace que el servidor no use checkJwt, pero middleware/auth.js
// igual construye auth({...}) al importarse, y esa llamada tira
// "An 'audience' is required to validate the 'aud' claim" si falta la variable.
//
// En la maquina de quien desarrolla no se notaba porque dotenv levanta el .env
// local. En CI no hay .env: server.test.js fallaba solo alla, que es
// exactamente donde el test tiene que servir.
process.env.AUTH0_DOMAIN = process.env.AUTH0_DOMAIN || 'tests.auth0.local';
process.env.AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE || 'https://tests.adminapp.local/api';
