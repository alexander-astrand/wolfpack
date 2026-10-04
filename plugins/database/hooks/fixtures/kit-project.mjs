// The tests' project: a temp folder whose .claude/kit.json is the fixture,
// so the guard reads placeholder values (the kit is public) and a hook run as
// a process finds the same file through CLAUDE_PROJECT_DIR. Imported first by
// each test file that needs the project's values.
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEV_REF, loadKitConfig } from '../production-steps.mjs'

export const KIT_PROJECT = realpathSync(mkdtempSync(join(tmpdir(), 'kit-project-')))
process.once('exit', () => rmSync(KIT_PROJECT, { recursive: true, force: true }))
mkdirSync(join(KIT_PROJECT, '.claude'), { recursive: true })
copyFileSync(fileURLToPath(new URL('./kit.json', import.meta.url)), join(KIT_PROJECT, '.claude', 'kit.json'))
// The CLI linked to dev, as in a project that follows the rules; the guard
// reads the link under CLAUDE_PROJECT_DIR.
mkdirSync(join(KIT_PROJECT, 'supabase', '.temp'), { recursive: true })
process.env.CLAUDE_PROJECT_DIR = KIT_PROJECT
loadKitConfig()
writeFileSync(join(KIT_PROJECT, 'supabase', '.temp', 'project-ref'), DEV_REF + '\n')
