import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
  },
  resolve: {
    alias: [
      // `server-only` throws when imported outside a Server Component; under
      // Vitest that guard has nothing to protect, so it is stubbed out.
      {
        find: /^server-only$/,
        replacement: fileURLToPath(new URL('./__tests__/stubs/server-only.ts', import.meta.url)),
      },
      { find: '@', replacement: fileURLToPath(new URL('.', import.meta.url)) },
    ],
  },
});
