import { describe, expect, it } from 'vitest'
import { ancestors, assertCanStop, parseArgs, select, sessionPidOf } from './stop-own.mjs'

// A fake process table: nothing here touches a real process.
const procs = [
  { pid: 1, ppid: 0, cmd: '/sbin/launchd' },
  { pid: 10, ppid: 1, cmd: '/usr/local/bin/claude --resume' }, // this session
  { pid: 11, ppid: 10, cmd: 'node /x/plugins/core/scripts/stop-own.mjs' }, // the script itself
  { pid: 12, ppid: 10, cmd: 'sleep 1200' },
  { pid: 13, ppid: 10, cmd: 'node node_modules/.bin/vite --port 5174' },
  { pid: 14, ppid: 13, cmd: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless --user-data-dir=/tmp/kit-shots-a' },
  { pid: 20, ppid: 1, cmd: '/usr/local/bin/claude' }, // another session
  { pid: 21, ppid: 20, cmd: 'sleep 600' },
  { pid: 22, ppid: 20, cmd: 'node next dev' },
  { pid: 30, ppid: 1, cmd: 'sleep 5' }, // a stray outside any session
]

describe('parseArgs', () => {
  it('collects ports, names and --dry', () => {
    expect(parseArgs(['--port', '5174', '--name', 'sleep', '--dry'])).toEqual({ ports: [5174], names: ['sleep'], dry: true })
  })
  it('refuses a bad port or name', () => {
    expect(() => parseArgs(['--port', 'x'])).toThrow()
    expect(() => parseArgs(['--name', 'bash'])).toThrow()
    expect(() => parseArgs(['--kill'])).toThrow()
  })
})

describe('session lookup', () => {
  it('walks to the claude ancestor', () => {
    expect(ancestors(procs, 11)).toEqual([11, 10, 1, 0].filter((p) => p !== 0))
    expect(sessionPidOf(procs, 11)).toBe(10)
  })
  it('returns null with no claude above', () => {
    expect(sessionPidOf(procs, 30)).toBe(null)
  })
})

describe('select', () => {
  const base = { procs, selfPid: 11, sessionPid: 10 }
  it('stops this session\'s sleep only, not another session\'s or a stray', () => {
    expect(select({ ...base, names: ['sleep'] }).map((p) => p.pid)).toEqual([12])
  })
  it('matches headless chrome below the session', () => {
    expect(select({ ...base, names: ['chrome'] }).map((p) => p.pid)).toEqual([14])
  })
  it('matches vite by name and by port, but a port owned by another session is left alone', () => {
    expect(select({ ...base, names: ['vite'] }).map((p) => p.pid)).toEqual([13])
    expect(select({ ...base, ports: [5174], portPids: { 5174: [13] } }).map((p) => p.pid)).toEqual([13])
    expect(select({ ...base, ports: [3000], portPids: { 3000: [22] } })).toEqual([])
  })
  it('never selects itself', () => {
    expect(select({ ...base, names: ['vite', 'sleep', 'chrome', 'next'] }).map((p) => p.pid)).not.toContain(11)
  })
  it('without a session, takes only processes working inside the folder tree', () => {
    const cwds = { 12: '/lane/a', 13: '/lane/a/web', 21: '/lane/ab', 30: '/elsewhere' }
    const got = select({ procs, selfPid: 11, sessionPid: null, cwds, root: '/lane/a', names: ['sleep', 'vite'] })
    expect(got.map((p) => p.pid)).toEqual([12, 13])
  })
  it('without a session and no readable cwd, selects nothing', () => {
    expect(select({ procs, selfPid: 11, sessionPid: null, cwds: {}, root: '/lane/a', names: ['sleep'] })).toEqual([])
  })
})

describe('assertCanStop (R1 S2)', () => {
  it('without a session, --dry lists but a real stop is refused with the reason', () => {
    expect(() => assertCanStop({ sessionPid: null, dry: true, root: '/repo' })).not.toThrow()
    expect(() => assertCanStop({ sessionPid: null, dry: false, root: '/repo' })).toThrow(/no claude ancestor found, so nothing is stopped.*other sessions' processes/)
  })
  it('with a session, a real stop goes ahead', () => {
    expect(() => assertCanStop({ sessionPid: 10, dry: false, root: '/repo' })).not.toThrow()
  })
})
