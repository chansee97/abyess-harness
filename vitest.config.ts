import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Host-side specs only: the browser packages (client/*) have no tests and
    // no DOM here. Node environment, single file pool keeps per-file Cordis
    // contexts isolated while staying fast at this size.
    environment: 'node',
    include: ['packages/**/tests/*.spec.ts'],
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
})
