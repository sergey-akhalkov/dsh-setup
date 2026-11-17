import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'scripts/test/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true,
    // The git-backed suites run real git worktrees; under a busy Windows host a
    // 20 s cap is tight, so the cap matches the slower integration budget.
    testTimeout: 40_000,
    hookTimeout: 40_000,
    // The composed and real-timer suites occasionally miss their own window on
    // the 4-core runner while each case passes on a rerun; one retry absorbs
    // that without hiding a deterministic failure.
    retry: 1,
    // CI runs on a 4-core runner; an uncapped pool on a many-core machine
    // oversubscribes the disk and the git-backed suites miss the 20 s timeout.
    maxWorkers: 4,
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],
    outputFile: process.env.CI ? { junit: '.tmp/junit.xml' } : undefined,
  },
})
