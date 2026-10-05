#!/usr/bin/env node
// Sets one plugin's version in both places Claude Code reads it, in one go:
//
//   node kit/scripts/bump.mjs <plugin> <version> [--kit <dir>]
//
// `plugins/<plugin>/.claude-plugin/plugin.json` and the plugin's entry in
// `.claude-plugin/marketplace.json` each carry a version, and a bump by hand
// moved one and forgot the other. Both files are checked before either is
// written, so a refusal leaves both as they were. --kit points at another kit
// root (the test's temp copy); the default is the kit this script sits in.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

// semver.org's grammar: MAJOR.MINOR.PATCH, no leading zeros, optional
// -prerelease and +build.
const NUM = '(0|[1-9]\\d*)'
const ID = '(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)'
const SEMVER = new RegExp(
  `^${NUM}\\.${NUM}\\.${NUM}(?:-${ID}(?:\\.${ID})*)?(?:\\+[0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*)?$`,
)

export const isSemver = (v) => typeof v === 'string' && SEMVER.test(v)

// The version is swapped in the text, not re-serialised: the files keep short
// objects on one line (marketplace's `owner`), which JSON.stringify would
// spread out, so a bump's diff stays the version line and nothing else.
const VERSION = /("version"\s*:\s*")[^"]*(")/
function setVersion(text, from, version) {
  const m = VERSION.exec(text.slice(from))
  if (!m) return null
  const at = from + m.index
  return text.slice(0, at) + m[1] + version + m[2] + text.slice(at + m[0].length)
}

export function bump(plugin, version, kit = resolve(HERE, '..')) {
  const errors = []
  if (!isSemver(version)) errors.push(`"${version}" isn't a semver version (like 1.2.3)`)

  const marketFile = join(kit, '.claude-plugin', 'marketplace.json')
  const market = JSON.parse(readFileSync(marketFile, 'utf8'))
  const names = (market.plugins ?? []).map((p) => p.name)
  const entry = (market.plugins ?? []).find((p) => p.name === plugin)
  const pluginFile = join(kit, 'plugins', plugin, '.claude-plugin', 'plugin.json')
  if (!entry || !existsSync(pluginFile)) {
    errors.push(`unknown plugin "${plugin}" (the marketplace lists ${names.join(', ')})`)
  }
  if (errors.length) return { errors }

  const pluginText = readFileSync(pluginFile, 'utf8')
  const marketText = readFileSync(marketFile, 'utf8')
  const before = { plugin: JSON.parse(pluginText).version, marketplace: entry.version }
  // plugin.json: its one top-level version. marketplace.json: the first version
  // after this plugin's name (entries list name before version), searched from
  // `"plugins"` on, since the marketplace itself is also named "wolfpack".
  const listAt = marketText.indexOf('"plugins"')
  const nameRe = new RegExp(`"name"\\s*:\\s*"${plugin.replace(/[^\w-]/g, '')}"`)
  const found = listAt >= 0 ? marketText.slice(listAt).search(nameRe) : -1
  const nameAt = found >= 0 ? listAt + found : -1
  const newPlugin = setVersion(pluginText, 0, version)
  const newMarket = nameAt >= 0 ? setVersion(marketText, nameAt, version) : null
  // Read both back before writing either: the swap must land on exactly these keys.
  const ok =
    newPlugin &&
    newMarket &&
    JSON.parse(newPlugin).version === version &&
    JSON.parse(newMarket).plugins.every((p) => p.version === (p.name === plugin ? version : market.plugins.find((q) => q.name === p.name).version))
  if (!ok) return { errors: [`couldn't place the version in ${plugin}'s manifests; edit them by hand`] }
  writeFileSync(pluginFile, newPlugin)
  writeFileSync(marketFile, newMarket)
  return { errors: [], before, files: [pluginFile, marketFile] }
}

function main(argv) {
  const ki = argv.indexOf('--kit')
  const kit = ki >= 0 ? resolve(argv[ki + 1] ?? '') : undefined
  const rest = argv.filter((_, i) => ki < 0 || (i !== ki && i !== ki + 1))
  if (rest.length !== 2 || (ki >= 0 && !argv[ki + 1])) {
    console.error('usage: node kit/scripts/bump.mjs <plugin> <version> [--kit <dir>]')
    return 2
  }
  const [plugin, version] = rest
  const r = bump(plugin, version, kit)
  if (r.errors.length) {
    for (const e of r.errors) console.error('bump: ' + e)
    return 1
  }
  console.log(`${plugin}: ${r.before.plugin} -> ${version} (plugin.json), ${r.before.marketplace} -> ${version} (marketplace.json)`)
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
