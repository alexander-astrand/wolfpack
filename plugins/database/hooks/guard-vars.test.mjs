// First: the tests' project and its kit.json (the fixture's values).
import './fixtures/kit-project.mjs'
import { homedir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { DEV_REF, decide, resolveLiteralVars } from './guard-production.mjs'

// Kit 1.10 (H4, the kit 1.9 council; the fourth council on the guard's asks):
// a literal `VAR=/path` is put in before the rules read the call, and a plain
// `sed -i` outside scripts/ is judged as an Edit. Each row below asked or was
// refused before this change (the shapes from Burrow's guard log, 1 to 5 Nov,
// and the admiral's sweep); each frozen twin still asks or is refused.
const STUBS = { linkedRef: () => DEV_REF, marker: () => null, chainMarker: () => null, releasePr: () => null, log: () => {}, chainLog: () => {}, readLog: () => '' }
const LANE = '/Users/x/wolfpack-lanes/a'
const at = (command, cwd = '/repo', env = STUBS) =>
  decide({ tool_name: 'Bash', tool_input: { command }, cwd, permission_mode: 'auto' }, env)?.decision ?? 'pass'
const edit = (file_path, cwd = LANE) =>
  decide({ tool_name: 'Edit', tool_input: { file_path, old_string: 'a', new_string: 'b' }, cwd, permission_mode: 'auto' }, STUBS)?.decision ?? 'pass'

const SD = '/Users/alexanderastrand/wolfpack-live/plugins/release/scripts/step-done.mjs'
const PLAN = '/Users/alexanderastrand/.claude/plans/burrow/V1.12.md'

describe('H4: step-done.mjs run through a literal variable passes', () => {
  // Each asked as `frozen-file` before: `node $SD` hid the script's path, so
  // every word was read as code and the --cheaper line's check.sh asked.
  it.each([
    `S=local_a4f2; D=${SD}; node $D chris-de-kok --step "A1 usage ceiling" --budget 8M --session $S --plan ${PLAN} --pr 91 --cheaper "check.sh answers before sending a builder to it" --tag order`,
    `S=local_a4f2 && SD=~/wolfpack-live/plugins/release/scripts/step-done.mjs && node "$SD" jesse-pinkman --step "S1 sweep" --session "$S" --plan ~/.claude/plans/burrow/V1.12.md --pr 91 --cheaper "builders skip check.sh's build"`,
    `export SD=${SD} S=local_a4f2; node \${SD} saul-goodman --step B2 --session \${S} --plan ${PLAN} --pr 91 --tick "B2 run scripts/check.sh"`,
    `SD=~/wolfpack-live/plugins/release/scripts/step-done.mjs; S=local_a4f2\nnode $SD troy-and-abed --step B3 --session $S --plan ~/.claude/plans/burrow/V1.12.md --pr 91 --cheaper "name check.sh in the order" --tick "B3 money split"`,
    `S=local_a4f2; P=${PLAN}; SD=${SD}; node $SD chris-de-kok --step C1 --session $S --plan $P --pr 91 --cheaper "check.sh could skip the crawl"`,
    `S=local_a4f2; SD=${SD}; node $SD ahmed-och-ahmed --step C2 --session $S --plan ${PLAN} --pr 91 --cheaper "skip check.sh's build" 2>&1 | tail -3`,
    `S=local_a4f2; SD=${SD}; T=/private/tmp/claude-501/x/scratchpad; node $SD jeff-winger --step D1 --session $S --dir $T --hank-log $T/hank.tsv --pr 91 --cheaper "check.sh once"`,
    `S=local_a4f2; R=/Users/alexanderastrand/wolfpack-live/plugins/release; node $R/scripts/step-done.mjs chris-de-kok --step D2 --session $S --plan ${PLAN} --pr 91 --cheaper "say check.sh, not npm test"`,
    `S=local_a4f2 && SD=${SD} && node $SD saul-goodman --step D3 --session $S --plan ~/.claude/plans/burrow/V1.12.md --pr 91 --cheaper "run check.sh once, not per lane" && echo done`,
  ])('%s', (cmd) => {
    expect(at(cmd)).toBe('pass')
  })

  it('a path flag through a variable that names a frozen file still asks', () => {
    expect(at(`SD=${SD}; node $SD x --plan .claude/settings.json --pr 1`)).toBe('ask')
    expect(at(`P=/repo/.claude/settings.json; SD=${SD}; node $SD x --plan $P --pr 1`)).toBe('ask')
  })
})

describe("H4: the admiral's K= reads pass", () => {
  it('a cd to a literal folder is that folder, not one built at run time', () => {
    // Refused as `arm-script` before: after `cd $K` a bare `*` could have been scripts/.
    expect(at('K=/Users/alexanderastrand/wolfpack/plugins; cd $K; for f in *; do grep -c Next: $f/skills/*/SKILL.md; done')).toBe('pass')
    expect(at('K=/Users/alexanderastrand/.claude/plans/audits-kit-1.9; cd $K; grep -n H4 jedi-council.md')).toBe('pass')
    expect(at('R=/Users/alexanderastrand/Desktop/Burrow/.claude/worktrees/v1-4; cd $R; sed -i \'s/^export type AddSpec/type AddSpec/\' components/ui/section.tsx; grep -n AddSpec components/ui/section.tsx')).toBe('pass')
  })

  it('a cd to a literal folder that holds a frozen file still asks for a write there', () => {
    expect(at("K=/repo/.claude; cd $K; sed -i '' 's/a/b/' settings.json")).toBe('ask')
    expect(at('K=/repo/.claude; cd $K && echo x > settings.json')).toBe('ask')
  })

  it("a glob that may be scripts/ whatever K holds stays refused", () => {
    expect(at("K=/Users/alexanderastrand/wolfpack/plugins; cd $K; sed -n '/^Next:/p' */skills/*/*")).toBe('deny')
  })
})

describe('H4: a variable that is not a literal is judged as today', () => {
  it.each([
    [`S=$(ls -t ~/.claude/projects | head -1); SD=${SD}; node $SD x --session $S --plan /p/V1.md --pr 1 --cheaper "check.sh"`, 'ask'],
    ["K=$(pwd); cd $K; sed -i '' 's/a/b/' .claude/settings.json", 'ask'],
    ["K=$(pwd); cd $K; sed -i '' 's/a/b/' src/a.ts", 'ask'],
    ["K=`pwd`; cd $K; sed -i '' 's/a/b/' src/a.ts", 'ask'],
    ["K=\"$HOME/x\"; cd $K; sed -i '' 's/a/b/' src/a.ts", 'ask'],
    ["K=\"~/x\"; cd $K; sed -i '' 's/a/b/' settings.json", 'ask'],
    ['S=/tmp; read S; cd $S; echo x > settings.json', 'ask'],
  ])('%s', (cmd, verdict) => {
    expect(at(cmd)).toBe(verdict)
  })

  it('a variable that hid a frozen path is now seen (these passed before)', () => {
    expect(at("F=.claude/settings.json; sed -i '' 's/a/b/' $F")).toBe('ask')
    expect(at('D=/repo/scripts; cp x.sh $D/prod-db.sh')).toBe('ask')
    expect(at("F=/repo/.claude/kit.json; sed -i '' 's/a/b/' $F")).toBe('ask')
  })
})

describe('H4: resolveLiteralVars resolves only what the shell surely expands', () => {
  it('puts each literal in, in and out of double quotes and braces', () => {
    expect(resolveLiteralVars('S=a1; K=/x/y; cd $K && node t.mjs --session "$S" ${S}')).toBe('S=a1; K=/x/y; cd /x/y && node t.mjs --session "a1" a1')
    expect(resolveLiteralVars('export K=/x; ls $K')).toBe('export K=/x; ls /x')
    expect(resolveLiteralVars('K=~/w; ls $K')).toBe(`K=~/w; ls ${homedir()}/w`)
  })

  it('keeps the whole-assignment segments before a prefix one, and judges the rest as typed (R1 must 2)', () => {
    expect(resolveLiteralVars('SRC=/x/y; K=/z true; ls $SRC $K')).toBe('SRC=/x/y; K=/z true; ls /x/y $K')
    expect(at('K=/tmp/n true; cd $K; rm -rf wolfpack')).toBe('ask')
    expect(at('K=/tmp/n true; cd $K; git checkout -- .')).toBe('ask')
  })

  it('leaves single quotes, escapes, comments and zsh modifiers alone', () => {
    expect(resolveLiteralVars("K=/x; echo '$K' \\$K $K # $K")).toBe("K=/x; echo '$K' \\$K /x # $K")
    expect(resolveLiteralVars('K=/x; echo $K:h $K[1] $KK')).toBeNull()
  })

  it.each([
    ['S=x cmd $S', 'a prefix assignment: $S expands before it'],
    ['S=x true; cmd $S', 'a prefix assignment, set only for true (R1 must 2)'],
    ['K=/tmp/n true; cd $K; rm -rf wolfpack', 'a prefix assignment before a cd'],
    ['K=/tmp/n true; cd $K; git checkout -- .', 'a prefix assignment before a cd'],
    ["K=/tmp/n true; cd $K; sed -i '' 's/a/b/' prod-db.sh", 'a prefix assignment before a cd'],
    ['export K=/x true; cd $K', 'export with a word that is no assignment'],
    ['true && S=x; cmd $S', 'not at the start: it may not have run'],
    ['S=x | cmd $S', 'in a pipeline: a subshell'],
    ['(S=x); cmd $S', 'in a subshell'],
    ['S=x; S=y; cmd $S', 'set twice'],
    ['S=x; for S in a b; do cmd $S; done', 'set by for'],
    ['S=x; cmd ${S:-/y}', 'a modifier names it bare'],
    ['S=x; cmd $s', 'another case'],
    ["S='a b'; cmd $S", 'a space would split'],
    ['S=a*; cmd $S', 'a glob would expand'],
    ['IFS=/; S=a/b; cmd $S', 'IFS is set'],
    ['PWD=/x; cd /y; cmd $PWD', 'the shell sets PWD'],
    ['HOME=/x; K=~/y; cmd $K', 'HOME is set, so ~ is not the guard\'s'],
    ['K=\\~/y; cmd $K', 'an escaped ~ is not expanded'],
    ['K=/x; cmd `echo $K`', 'a backtick'],
    ["K=/x; cat <<EOF\n$K\nEOF", 'a heredoc'],
    ['K=/x; echo "$(ls $K)"', 'a substitution in double quotes'],
    ["K=/x; echo $'$K'", "ANSI-C quotes"],
  ])('%s: null (%s)', (src) => {
    expect(resolveLiteralVars(src)).toBeNull()
  })
})

describe('H4: sed -i outside scripts/ is judged as an Edit', () => {
  it('passes in a lane, a CSS comment in the script included', () => {
    expect(at("sed -i '' 's/a/b/' plugins/x/SKILL.md", LANE)).toBe('pass')
    // Refused as `arm-script` before: ` /* ` read as a glob of the arm script in /.
    expect(at("sed -i '' 's|^ .topbar { border-bottom: 1px solid var(--line); }$| /* No bar, so no line under it (5 Nov). */|' app/globals.css", LANE)).toBe('pass')
    expect(edit(`${LANE}/plugins/x/SKILL.md`)).toBe('pass')
  })

  it('a frozen name asks as its Edit does, or is refused as today', () => {
    expect(at("sed -i '' 's/a/b/' .github/workflows/ci.yml")).toBe('ask')
    expect(edit('/repo/.github/workflows/ci.yml')).toBe('ask')
    expect(at("sed -i '' 's/a/b/' .claude/kit.json")).toBe('ask')
    expect(edit('/repo/.claude/kit.json')).toBe('ask')
    expect(at("sed -i '' 's/a/b/' .claude/hooks/guard-production.mjs")).toBe('ask')
    // Inside scripts/: as today.
    expect(at("sed -i '' 's/a/b/' plugins/database/scripts/chain-cover.mjs")).toBe('ask')
    expect(at("sed -i '' 's/a/b/' scripts/prod-db.sh")).toBe('ask')
    expect(at("sed -i '' 's/a/b/' scripts/full-auto.sh")).toBe('deny')
    expect(at("sed -i '' 's| /* x */||' scripts/qa/notes.css")).toBe('deny')
  })

  it('is refused on a frozen file while full auto is armed, as an Edit is', () => {
    const armed = { ...STUBS, marker: () => ({}) }
    expect(at("sed -i '' 's/a/b/' .github/workflows/ci.yml", '/repo', armed)).toBe('deny')
    expect(at("sed -i '' 's/a/b/' app/globals.css", '/repo', armed)).toBe('pass')
  })

  it("a sed that runs, writes elsewhere or feeds a shell is refused as today", () => {
    expect(at("sed -i '' 's/a/b/w scripts/full-auto.sh' notes.md")).toBe('deny')
    expect(at("sed -i '' '1e gh pr merge 12' notes.md")).toBe('deny')
    expect(at("sed -i '' 's| /* x */|gh pr merge 1|' notes.md && cat notes.md | sh")).toBe('deny')
  })
})

describe("H4: a lane's own plugins/database/hooks/ is not the installed guard", () => {
  // The /inception check: `--explain` showed a lane path there passes.
  it('passes by Edit and by sed -i, while the frozen names stay refused', () => {
    expect(edit(`${LANE}/plugins/database/hooks/guard-vars.test.mjs`)).toBe('pass')
    expect(at(`sed -i '' 's/a/b/' ${LANE}/plugins/database/hooks/guard-vars.test.mjs`)).toBe('pass')
    expect(edit('/repo/.claude/hooks/guard-production.mjs')).toBe('ask')
    expect(edit('/repo/.claude/settings.json')).toBe('ask')
    expect(edit('/repo/scripts/chain-cover.mjs')).toBe('ask')
    expect(edit('/repo/scripts/full-auto.sh')).toBe('ask')
  })
})
