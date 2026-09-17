import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@once/domain': resolve(__dirname, 'packages/domain/src/index.ts'),
      '@once/crypto': resolve(__dirname, 'packages/crypto/src/index.ts'),
      '@once/chain': resolve(__dirname, 'packages/chain/src/index.ts'),
      '@once/witness': resolve(__dirname, 'packages/witness/src/index.ts'),
      '@once/contract': resolve(__dirname, 'contracts/managed/once/contract/index.js'),
    },
  },
  test: {
    include: ['packages/**/test/**/*.spec.ts', 'test/**/*.spec.ts', 'apps/api/test/**/*.spec.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
