#!/usr/bin/env node
// The project's checks in one place: runs the npm scripts that exist (lint, test,
// build), prints only what failed, exits 1 if anything did. Grows with the project:
// add a script to package.json and it is picked up, no edit here.
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const scripts = existsSync('package.json')
  ? JSON.parse(readFileSync('package.json', 'utf8')).scripts ?? {}
  : {}

let failed = 0
for (const name of ['lint', 'test', 'build']) {
  if (!scripts[name]) continue
  // CI=1 keeps test runners out of watch mode.
  const r = spawnSync('npm', ['run', name], { encoding: 'utf8', env: { ...process.env, CI: '1' } })
  if (r.status !== 0) {
    failed++
    console.log('FAIL: npm run ' + name)
    console.log((r.stdout || '') + (r.stderr || ''))
  }
}

process.exit(failed ? 1 : 0)
