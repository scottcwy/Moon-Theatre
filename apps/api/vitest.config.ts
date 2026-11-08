import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    // Test sources live under `src/` only. Scoping the include is what keeps a previous
    // `build:api` from making vitest collect the compiled `.next/standalone/**/src/**/*.test.ts`
    // copies, whose rewired tsconfig does not resolve from the build output.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@juben-sha/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
});
