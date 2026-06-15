module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/src/tests/setup.js'],
  testMatch: ['**/__tests__/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/'],
};
