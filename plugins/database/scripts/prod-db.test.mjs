// prod-db.sh's setup checks against a fixture project: kit.json's refs, and
// which Keychain item may point where. `security` and `supabase` are fakes on
// PATH, so nothing reaches a Keychain or a database.
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROD_DB = join(HERE, 'prod-db.sh')
const PROD = 'prodprodprodprodprod'
const DEV = 'devdevdevdevdevdevde'
const url = (ref) => `postgresql://postgres.${ref}:pw-not-real@aws-0-eu-north-1.pooler.supabase.com:5432/postgres`

let root
let bin
const put = (path, text, mode) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
  if (mode) chmodSync(path, mode)
}
const kit = (values) => put(join(root, '.claude', 'kit.json'), JSON.stringify(values))
const keychain = (item, value) => put(join(bin, 'items', item), value)
const run = (args, env = {}) => {
  const r = spawnSync('bash', [PROD_DB, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, PATH: `${bin}:${process.env.PATH}`, ...env },
  })
  return { status: r.status, out: r.stdout + r.stderr }
}
const base = (refs) => ({ refs, keychain: { prod: 'x-prod-db-url', dev: 'x-dev-db-url' }, backupRoot: join(root, 'backups') })

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'prod-db-')))
  bin = join(root, 'fake-bin')
  // `security find-generic-password -s <item> -w` prints the item's file.
  put(join(bin, 'security'), `#!/usr/bin/env bash
while [ $# -gt 0 ]; do [ "$1" = -s ] && item=$2; shift; done
cat "${bin}/items/$item" 2>/dev/null || exit 44
`, 0o755)
  put(join(bin, 'supabase'), '#!/usr/bin/env bash\necho "supabase $1 $2 ran"\n', 0o755)
  keychain('x-prod-db-url', url(PROD))
  keychain('x-dev-db-url', url(DEV))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('refs.dev is optional (a local-only dev)', () => {
  it.each([
    ['missing', { prod: PROD }],
    ['empty', { dev: '', prod: PROD }],
  ])('runs a production command when refs.dev is %s', (_, refs) => {
    kit(base(refs))
    const r = run(['migrations'])
    expect(r.out).toContain(`Target: production (${PROD})`)
    expect(r.out).toContain('supabase migration list ran')
    expect(r.out).not.toContain('pw-not-real')
    expect(r.status).toBe(0)
  })

  it('stops a test run on dev with a setup message', () => {
    kit(base({ prod: PROD }))
    const r = run(['migrations'], { PROD_DB_KEYCHAIN_ITEM: 'x-dev-db-url' })
    expect(r.status).toBe(2)
    expect(r.out).toMatch(/has no refs\.dev\. A test run on dev needs/)
    expect(r.out).not.toContain('ran')
  })

  it('still needs refs.prod', () => {
    kit(base({ dev: DEV }))
    const r = run(['migrations'])
    expect(r.status).toBe(2)
    expect(r.out).toMatch(/has no refs\.prod/)
  })
})

describe('refs.dev, when set, is checked as before', () => {
  it('refuses a malformed refs.dev', () => {
    kit(base({ dev: 'not-a-ref', prod: PROD }))
    const r = run(['migrations'])
    expect(r.status).toBe(2)
    expect(r.out).toMatch(/20 lowercase letters, got 'not-a-ref'/)
  })

  it('refuses refs.dev equal to refs.prod', () => {
    kit(base({ dev: PROD, prod: PROD }))
    const r = run(['migrations'])
    expect(r.status).toBe(2)
    expect(r.out).toMatch(/refs\.dev and refs\.prod are the same project/)
  })

  it('refuses a production item that points at dev', () => {
    kit(base({ dev: DEV, prod: PROD }))
    keychain('x-prod-db-url', url(DEV))
    const r = run(['migrations'])
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/points at dev, not production/)
  })

  it('runs a test run on dev against dev', () => {
    kit(base({ dev: DEV, prod: PROD }))
    const r = run(['migrations'], { PROD_DB_KEYCHAIN_ITEM: 'x-dev-db-url' })
    expect(r.out).toContain(`Target: dev (${DEV})`)
    expect(r.status).toBe(0)
  })
})
