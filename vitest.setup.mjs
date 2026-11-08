// Runs before each kit test file (setupFiles): the file runs in a temp project and
// fails if this checkout's drive markers changed. See scripts/test-project.mjs.
import { afterAll, beforeAll } from 'vitest'
import { enterTempProject, failure } from './scripts/test-project.mjs'

// The meter tier file is Alexander's own (~/.claude/global/meter.json); the
// tests run on usage.mjs's defaults, never on whatever tier this machine is on.
process.env.KIT_METER_FILE = '/nonexistent/kit-test-meter.json'

let run
beforeAll(() => {
  run = enterTempProject()
})
afterAll(() => {
  const paths = run.leave()
  if (paths.length) throw new Error(failure(paths))
})
