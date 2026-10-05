// The node --test side of test-project.mjs, loaded with --import: node runs each
// test file in its own process, so the temp project is entered at load and the
// markers are compared at exit (a change sets a failing exit code).
import { enterTempProject, failure } from './test-project.mjs'

const run = enterTempProject()
process.on('exit', () => {
  const paths = run.leave()
  if (paths.length) {
    console.error(failure(paths))
    process.exitCode = 1
  }
})
