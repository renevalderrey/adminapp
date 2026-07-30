// ════════════════════════════════════════════
//  Test Setup
//  Configuración global para tests con Jest
// ════════════════════════════════════════════

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.BYPASS_AUTH = 'true';
});

afterAll(async () => {
  // Cleanup connections if needed
});
