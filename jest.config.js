/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        // Transpile-only: type checking is handled by tsc/lint, not jest.
        // This also avoids strict tsconfig flags (noUnusedLocals etc.) in test files.
        isolatedModules: true,
        tsconfig: {
          // Tests do not produce declaration files.
          declaration: false,
          // Allow importing default exports from modules without them (cdktf providers).
          esModuleInterop: true,
        },
      },
    ],
  },
};
