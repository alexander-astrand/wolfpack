// Runs before each kit test file (setupFiles): the file runs in a temp project and
// fails if this checkout's drive markers changed. See scripts/test-project.mjs.
import { afterAll, beforeAll } from 'vitest'
import { enterTempProject, failure } from './scripts/test-project.mjs'

let run
beforeAll(() => {
  run = enterTempProject()
})
afterAll(() => {
  const paths = run.leave()
  if (paths.length) throw new Error(failure(paths))
})
