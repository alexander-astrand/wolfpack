import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isReleaseTitle, mainCheckout, projectFolders, releaseSessionIds, sessionIds, titleNamesVersion, titleOfText } from './release-sessions.mjs'

const A = 'aaaa0000-1111-4222-8333-944455556666'
const B = 'bbbb0000-1111-4222-8333-944455556666'
const title = (t) => JSON.stringify({ type: 'custom-title', customTitle: t })

describe('release-sessions', () => {
  it('reads a uuid only where its line calls it a session or transcript, or it is a local_ id', () => {
    expect(sessionIds(`connector ${A}`, `transcript ${B}`, `local_${A}`)).toEqual([B, `local_${A}`])
  })

  it('matches "<project> · <kind> · <version>" titles for that version only, a delphi suffix too', () => {
    expect(titleNamesVersion('wolfpack · release · kit-1.9', '1.9')).toBe(true)
    expect(titleNamesVersion('burrow · follow-up · 1.11 looks · delphi', 'V1.11')).toBe(true)
    expect(titleNamesVersion('wolfpack · release · kit-1.9.1', 'kit-1.9')).toBe(false)
    expect(titleNamesVersion('Future-ted kit 1.9', '1.9')).toBe(false)
    expect(isReleaseTitle('wolfpack · release · kit-1.9 · delphi')).toBe(true)
    expect(isReleaseTitle('wolfpack · wrap · kit-1.9')).toBe(false)
  })

  it('takes the last title a transcript set', () => {
    expect(titleOfText(`${title('first')}\n{"type":"assistant"}\n${title('wolfpack · release · kit-1.9')}\n`)).toBe('wolfpack · release · kit-1.9')
  })

  it("names the main checkout from git's common dir, and null outside a repo", () => {
    expect(mainCheckout('/x/lanes/a', () => '/x/wolfpack/.git\n')).toBe('/x/wolfpack')
    expect(mainCheckout('/x', () => { throw new Error('not a repo') })).toBeNull()
  })

  it("finds a release's titled transcripts in the main checkout's folder when run from a lane", () => {
    const projects = mkdtempSync(join(tmpdir(), 'release-sessions-'))
    const main = join(projects, '-x-wolfpack')
    const other = join(projects, '-x-burrow')
    mkdirSync(main)
    mkdirSync(other)
    writeFileSync(join(main, `${A}.jsonl`), `${title('wolfpack · release · kit-1.9')}\n`)
    writeFileSync(join(other, `${B}.jsonl`), `${title('burrow · release · 1.9')}\n`)
    const git = () => '/x/wolfpack/.git\n'
    expect(projectFolders('/y/wolfpack-lanes/a', { projectsDir: projects, git })).toEqual([main])
    const out = releaseSessionIds('/y/wolfpack-lanes/a', 'kit-1.9', { texts: [`session ${B}`], projectsDir: projects, git })
    expect(out.ids).toEqual([B, A])
    expect(out.titled).toEqual([{ id: A, dir: main, title: 'wolfpack · release · kit-1.9' }])
  })
})
