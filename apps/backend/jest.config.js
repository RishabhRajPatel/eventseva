/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  globalSetup: '<rootDir>/test/global-setup.ts',
  testTimeout: 20000,
  // On GitHub Actions a failing test also becomes an annotation (file, line, message) on the check run,
  // readable without downloading the logs. Elsewhere only the default reporter prints.
  reporters: process.env.GITHUB_ACTIONS ? ['default', ['github-actions', { silent: false }], 'summary'] : ['default'],
};
