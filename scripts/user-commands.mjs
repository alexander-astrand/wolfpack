#!/usr/bin/env node
// Lists the kit's user-only commands (skills marked disable-model-invocation:
// true) from their frontmatter. Without --write it prints the block; with
// --write it replaces the block between the two marker comments under
// "## Commands only I type" in ~/.claude/CLAUDE.md. future-ted runs it when a
// skill is added or renamed, so that list never drifts from the kit.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const START = '<!-- user-commands:start -->'
export const END = '<!-- user-commands:end -->'

// Frontmatter is flat `key: value` lines; quotes around a value are dropped.
export function parseFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text)
  const out = {}
  if (!m) return out
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':')
    if (i < 1) continue
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, '$2')
  }
  return out
}

export function firstSentence(description = '') {
  const m = /^[\s\S]*?[.!?](?=\s|$)/.exec(description)
  return (m ? m[0] : description).trim()
}

export function collect(kitRoot) {
  const skills = []
  const plugins = join(kitRoot, 'plugins')
  for (const plugin of readdirSync(plugins)) {
    const dir = join(plugins, plugin, 'skills')
    if (!existsSync(dir)) continue
    for (const skill of readdirSync(dir)) {
      const file = join(dir, skill, 'SKILL.md')
      if (!existsSync(file)) continue
      const fm = parseFrontmatter(readFileSync(file, 'utf8'))
      if (fm['disable-model-invocation'] !== 'true') continue
      skills.push({ name: fm.name || skill, hint: fm['argument-hint'] || '', sentence: firstSentence(fm.description) })
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

export function renderBlock(skills) {
  return skills
    .map((s) => `- \`/${s.name}${s.hint ? ` ${s.hint}` : ''}\`: ${s.sentence}`)
    .join('\n')
}

export function replaceBlock(text, block) {
  const a = text.indexOf(START)
  const b = text.indexOf(END)
  if (a < 0 || b < a) throw new Error(`markers ${START} / ${END} not found in order`)
  return `${text.slice(0, a + START.length)}\n${block}\n${text.slice(b)}`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const kitRoot = fileURLToPath(new URL('..', import.meta.url))
  const block = renderBlock(collect(kitRoot))
  if (process.argv.includes('--write')) {
    const target = join(homedir(), '.claude', 'CLAUDE.md')
    writeFileSync(target, replaceBlock(readFileSync(target, 'utf8'), block))
    console.log(`wrote ${block.split('\n').length} commands to ${target}`)
  } else {
    console.log(block)
  }
}
