import { defineConfig } from 'vitest/config'

// The kit's hook tests came from Hutzup's .claude/hooks, which run on Vitest;
// the root config skips kit/** so the app's checks don't run them, and this
// one runs only them (`npm run kit:test`). kit/scripts tests stay node:test.
export default defineConfig({
  test: {
    root: new URL('.', import.meta.url).pathname,
    passWithNoTests: true,
    include: ['plugins/*/hooks/**/*.test.mjs', 'plugins/*/scripts/**/*.test.mjs'],
  },
})
