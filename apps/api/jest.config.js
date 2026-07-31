module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/src/tests/setup.js'],
  // Antes era solo '**/__tests__/**/*.test.js', un directorio que no existe en
  // el repo: jest no encontraba nada y --passWithNoTests hacia que la suite
  // pasara en verde. Ahora tambien toma los tests de src/tests.
  testMatch: [
    '**/__tests__/**/*.test.js',
    '**/src/tests/**/*.test.js',
  ],
  testPathIgnorePatterns: ['/node_modules/'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/tests/**',
    '!src/migrations/**',
    '!scripts/**',
  ],
};
