import { expect, mock, test, type TestBody } from 'claude-code/testing'

async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve()
}

// The kit as the mod finds it: settings name the release plugin and its script
// is there. `exists` decides which paths exist; reads and checks are recorded.
function kit(on: Parameters<TestBody>[1], opts: { dirs?: string, exists?: (p: string) => boolean } = {}) {
  const looked: string[] = []
  const dirs = opts.dirs ?? '~/.claude/mods/the-tower:~/kit/plugins/core:~/kit/plugins/release'
  on('fs.read', (_$, e) => {
    if (e.path !== '/Users/x/.claude/settings.json') return { deny: 'no such file' }
    return { value: JSON.stringify({ env: { CLAUDE_CODE_PLUGIN_DIRS: dirs } }) }
  })
  on('fs.exists', (_$, e) => {
    looked.push(e.path)
    return { value: (opts.exists ?? (() => true))(e.path) }
  })
  return looked
}

test('shows the script line as the status line, refreshed on the timer', async ($, on) => {
  const clock = mock.clock(on)
  const shown: (string | undefined)[] = []
  const stdins: string[] = []
  let line = 'V2.14.9.2.1'

  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/Users/x/Desktop/game-night-planning-app' }))
  on('session.id', () => ({ value: 'abc-123' }))
  kit(on)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [{ kind: 'seven_day', percentUsed: 62 }] } }))
  on('process.run', (_$, e) => {
    if (e.argv[0] === 'printenv') return { value: { exitCode: 0, stdout: '/Users/x\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (e.argv[0] === 'sh') return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    stdins.push(e.init?.stdin ?? '')
    return { value: { exitCode: 0, stdout: `${line}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.status', (_$, e) => {
    shown.push(e.text)
    return { value: undefined }
  })

  await $.session.start({ cwd: '/Users/x/Desktop/game-night-planning-app', surface: 'desktop', isInteractive: true })
  await settle()
  expect({ runs: stdins.length, shown }).toEqual({ runs: 1, shown: ['V2.14.9.2.1'] })

  const input = JSON.parse(stdins[0] ?? '{}')
  expect(input.workspace.current_dir).toBe('/Users/x/Desktop/game-night-planning-app')
  expect(input.rate_limits).toEqual([{ kind: 'seven_day', percentUsed: 62 }])
  expect(input.transcript_path).toBe('/Users/x/.claude/projects/-Users-x-Desktop-game-night-planning-app/abc-123.jsonl')

  // An unchanged line isn't sent again; a new one is.
  await clock.advance(10_000)
  await settle()
  expect(shown).toEqual(['V2.14.9.2.1'])
  line = 'V2.14.9.2.1 · link 1/2'
  await clock.advance(10_000)
  await settle()
  expect(shown).toEqual(['V2.14.9.2.1', 'V2.14.9.2.1 · link 1/2'])
})

test('a failing script clears nothing and throws nothing', async ($, on) => {
  mock.clock(on)
  const shown: (string | undefined)[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/tmp/p' }))
  on('session.id', () => ({ value: 's' }))
  on('process.run', () => {
    return { deny: 'node missing' }
  })
  on('ui.status', (_$, e) => {
    shown.push(e.text)
    return { value: undefined }
  })
  await $.session.start({ cwd: '/tmp/p', surface: 'desktop', isInteractive: true })
  await settle()
  expect(shown).toEqual([])
})

test('logs a start line, then one line per meter move, skipping a move another session logged', async ($, on) => {
  const clock = mock.clock(on)
  const file: string[] = []
  let pct = 3
  const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/tmp/p' }))
  on('session.id', () => ({ value: 's' }))
  kit(on)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [
    { kind: 'seven_day', percentUsed: pct, resetsAt: '2026-10-15T13:00:00Z' },
    { kind: 'five_hour', percentUsed: 10 },
  ] } }))
  on('process.run', (_$, e) => {
    if (e.argv[0] === 'printenv') return ok('/Users/x\n')
    if (e.argv[0] !== 'sh') return ok('line\n')
    if (e.argv[2]?.includes('--tower')) return ok('')
    expect(e.argv[4]).toBe('/Users/x/.claude/meter-ticks.log')
    if (e.argv[2]?.includes('>>')) file.push(...(e.argv[5] ?? '').split('\n'))
    return ok(e.argv[2]?.includes('tail') ? file.join('\n') : '')
  })
  on('ui.status', () => ({ value: undefined }))

  await $.session.start({ cwd: '/tmp/p', surface: 'desktop', isInteractive: true })
  await settle()
  expect(file.map(l => l.split('\t').slice(1))).toEqual([
    ['seven_day', 'start', '3', '2026-10-15T13:00:00Z'],
    ['five_hour', 'start', '10', ''],
  ])

  // Nothing moved: nothing logged.
  await clock.advance(10_000)
  await settle()
  expect(file.length).toBe(2)

  pct = 4
  await clock.advance(10_000)
  await settle()
  expect(file.length).toBe(3)
  expect(file[2]?.split('\t').slice(1)).toEqual(['seven_day', '3', '4', '2026-10-15T13:00:00Z'])

  // Another session logged 4 -> 4.5 just now; this one sees the same move and skips it.
  file.push(`${new Date().toISOString()}\tseven_day\t4\t4.5\t2026-10-15T13:00:00Z`)
  pct = 4.5
  await clock.advance(10_000)
  await settle()
  expect(file.length).toBe(4)
})

test('adds the daily budget day part after the script line', async ($, on) => {
  mock.clock(on)
  const shown: (string | undefined)[] = []
  const toBudget: string[] = []
  const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/tmp/p' }))
  on('session.id', () => ({ value: 's' }))
  kit(on)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [{ kind: 'seven_day', percentUsed: 30, resetsAt: '2026-10-17T10:00:00Z' }] } }))
  on('process.run', (_$, e) => {
    if (e.argv[0] === 'printenv') return ok('/Users/x\n')
    if (e.argv[0] !== 'sh') return ok('V3.1\n')
    if (e.argv[2]?.includes('--tower')) {
      toBudget.push(e.argv[5] ?? '')
      return ok('day 5.2/14% ↓\n')
    }
    return ok('')
  })
  on('ui.status', (_$, e) => {
    shown.push(e.text)
    return { value: undefined }
  })
  await $.session.start({ cwd: '/tmp/p', surface: 'desktop', isInteractive: true })
  await settle()
  expect(shown).toEqual(['V3.1 · day 5.2/14% ↓'])
  expect(JSON.parse(toBudget[0] ?? '{}').rate_limits[0].percentUsed).toBe(30)
})

// The node runs and the status lines of one session start, with the kit as given.
async function startWith($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], opts: Parameters<typeof kit>[1]) {
  mock.clock(on)
  const shown: (string | undefined)[] = []
  const nodes: string[][] = []
  const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/tmp/p' }))
  on('session.id', () => ({ value: 's' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [{ kind: 'seven_day', percentUsed: 30 }] } }))
  const looked = kit(on, opts)
  on('process.run', (_$, e) => {
    if (e.argv[0] === 'printenv') return ok('/Users/x\n')
    if (e.argv[0] === 'node') nodes.push([...e.argv])
    if (e.argv[0] !== 'sh') return ok('V3.1\n')
    return ok(e.argv[2]?.includes('--tower') ? 'day 5.2/14%\n' : '')
  })
  on('ui.status', (_$, e) => {
    shown.push(e.text)
    return { value: undefined }
  })
  await $.session.start({ cwd: '/tmp/p', surface: 'desktop', isInteractive: true })
  await settle()
  return { shown, nodes, looked }
}

test('runs the release plugin that settings name, not a fixed copy', async ($, on) => {
  const script = '/Users/x/kit/plugins/release/scripts/the-tower.mjs'
  const { shown, nodes, looked } = await startWith($, on, { exists: p => p === script })
  expect(nodes).toEqual([['node', script]])
  expect(looked[0]).toBe(script)
  expect(shown).toEqual(['V3.1 · day 5.2/14%'])
})

test('falls back to ~/wolfpack-live when settings name no release plugin', async ($, on) => {
  const script = '/Users/x/wolfpack-live/plugins/release/scripts/the-tower.mjs'
  const { nodes } = await startWith($, on, { dirs: '~/.claude/mods/the-tower', exists: p => p === script })
  expect(nodes).toEqual([['node', script]])
})

test('shows a marker, with the day part, when no copy of the script is found', async ($, on) => {
  const { shown, nodes, looked } = await startWith($, on, { exists: () => false })
  expect(nodes).toEqual([])
  expect(looked).toEqual([
    '/Users/x/kit/plugins/release/scripts/the-tower.mjs',
    '/Users/x/wolfpack-live/plugins/release/scripts/the-tower.mjs',
  ])
  expect(shown).toEqual(['tower: no the-tower.mjs (release plugin?) · day 5.2/14%'])
})
