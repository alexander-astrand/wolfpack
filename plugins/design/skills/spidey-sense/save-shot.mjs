#!/usr/bin/env node
// Save the newest screenshot from this project's Claude Code transcripts to
// a file. The browser pane's screenshot tool returns an image to the model
// and writes nothing to disk, but every image is kept in the session (or
// subagent) transcript as base64, so the file can be recovered from there.
//
//   node ${CLAUDE_PLUGIN_ROOT}/skills/spidey-sense/save-shot.mjs <out.jpg> [--minutes 5] [--repo <main checkout>]
//
// Looks at every transcript under ~/.claude/projects/<this project>/ (the
// session files and their subagents/) modified in the last N minutes and
// writes the image with the latest timestamp. Run it right after the
// screenshot: another agent screenshotting in the same seconds could win.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'

const out = process.argv[2]
if (!out) {
  console.error('usage: save-shot.mjs <out.jpg> [--minutes 5]')
  process.exit(2)
}
const minutesFlag = process.argv.indexOf('--minutes')
const minutes = minutesFlag > 0 ? Number(process.argv[minutesFlag + 1]) : 5

// ~/.claude/projects/-Users-name-path-to-repo. From a worktree, pass the
// main checkout with --repo <path>.
const repoFlag = process.argv.indexOf('--repo')
let repo = repoFlag > 0 ? process.argv[repoFlag + 1] : process.cwd()
let projectDir = join(homedir(), '.claude', 'projects', resolve(repo).replace(/[/.]/g, '-'))

// process.cwd() is a worktree (e.g. .claude/worktrees/<x>), which has its own
// transcript folder that doesn't exist. Fall back to the main repo's own
// folder: `git rev-parse --git-common-dir` always points at the main
// checkout's .git, even run from inside a worktree.
if (repoFlag < 0 && !existsSync(projectDir)) {
  try {
    const gitCommonDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim()
    const mainRepo = dirname(gitCommonDir)
    const mainProjectDir = join(homedir(), '.claude', 'projects', resolve(mainRepo).replace(/[/.]/g, '-'))
    if (existsSync(mainProjectDir)) {
      repo = mainRepo
      projectDir = mainProjectDir
    }
  } catch {
    // Not a git repo, or git isn't on PATH -- keep the original projectDir
    // and let the "no screenshot" check below report it.
  }
}
const since = Date.now() - minutes * 60_000

function transcripts(dir) {
  const files = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (name === 'subagents' || /^[0-9a-f-]{36}$/.test(name)) files.push(...transcripts(p))
    } else if (name.endsWith('.jsonl') && st.mtimeMs >= since) {
      files.push(p)
    }
  }
  return files
}

let best = null
for (const file of transcripts(projectDir)) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.includes('"image"')) continue
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    const content = entry?.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block.type !== 'tool_result' || !Array.isArray(block.content)) continue
      for (const part of block.content) {
        if (part.type !== 'image' || !part.source?.data) continue
        const at = Date.parse(entry.timestamp ?? 0)
        if (!best || at > best.at) best = { at, data: part.source.data, type: part.source.media_type, file }
      }
    }
  }
}

if (!best) {
  console.error(`no screenshot in the last ${minutes} minutes under ${projectDir}`)
  process.exit(1)
}
writeFileSync(out, Buffer.from(best.data, 'base64'))
console.log(`${out} (${best.type}, taken ${new Date(best.at).toISOString()})`)
