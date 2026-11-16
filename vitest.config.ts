import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'scripts/test/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // CI runs on a 4-core runner; an uncapped pool on a many-core machine
    // oversubscribes the disk and the git-backed suites miss the 20 s timeout.
    maxWorkers: 4,
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],
    outputFile: process.env.CI ? { junit: '.tmp/junit.xml' } : undefined,
  },
})
