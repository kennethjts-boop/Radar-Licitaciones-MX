/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  setupFiles: ['<rootDir>/src/__tests__/setup.ts'],
  moduleNameMapper: {
    '^@core/(.*)$': '<rootDir>/src/core/$1',
    '^@matchers/(.*)$': '<rootDir>/src/matchers/$1',
    '^@normalizers/(.*)$': '<rootDir>/src/normalizers/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@types/(.*)$': '<rootDir>/src/types/$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@alerts/(.*)$': '<rootDir>/src/alerts/$1',
    '^@storage/(.*)$': '<rootDir>/src/storage/$1',
    '^@radars/(.*)$': '<rootDir>/src/radars/$1',
    '^@enrichers/(.*)$': '<rootDir>/src/enrichers/$1',
    '^@jobs/(.*)$': '<rootDir>/src/jobs/$1',
    '^@collectors/(.*)$': '<rootDir>/src/collectors/$1',
    '^@commands/(.*)$': '<rootDir>/src/commands/$1',
    '^@agent/(.*)$': '<rootDir>/src/agent/$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { strict: true } }],
  },
};
