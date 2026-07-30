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
