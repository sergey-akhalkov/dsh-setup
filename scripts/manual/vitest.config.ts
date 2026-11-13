import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Manual acceptance suite: not part of `pnpm test` and not run by CI
 * (the main config includes only `*.test.ts`).
 * Run with: `pnpm exec vitest run --config scripts/manual/vitest.config.ts`
 */
export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: {
    include: ['packages/plugin-codex-subagent/test/live-acceptance.manual.ts'],
    environment: 'node',
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
})
