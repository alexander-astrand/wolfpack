// First: the tests' project and its kit.json (the fixture's values).
import './fixtures/kit-project.mjs'
import { describe, expect, it } from 'vitest'
import { DEV_REF, decide } from './guard-production.mjs'

// Burrow V0.9 (15 Oct 2026): the guard asked a person about five scratch and
// memory writes that touch nothing in the frozen set. Under away mode nobody
// answered, and part 3 sat on one of them from 02:12 to 13:04. Each row below
// is the call as it was sent (paths shortened); the frozen twin of each still
// asks, so the fix can't open what the ask was for.
const at = (command, cwd = '/repo') => decide(
  { tool_name: 'Bash', tool_input: { command }, cwd, permission_mode: 'auto' },
  { linkedRef: () => DEV_REF, marker: () => null, chainMarker: () => null, releasePr: () => null, log: () => {}, chainLog: () => {}, readLog: () => '' },
)?.decision ?? 'pass'

const P = '/private/tmp/claude-501/x/scratchpad/probes'

describe('V0.9 stalls: plain writes outside the frozen set pass', () => {
  it("sed -i '' with a script holding .* is a script, not a path", () => {
    expect(at(`cd ~/.claude/projects/x/memory && sed -i '' '3s/.*/description: "V0.9 (\\/captain-call 0.9)"/' project_roadmap.md && sed -n 3p project_roadmap.md`)).toBe('pass')
    expect(at(`cd /repo/lanes/s2 && sed -i '' "1s/.*/import type { ReactNode } from 'react'/" 'app/(home)/dev/ui/shapes.tsx'`)).toBe('pass')
    expect(at(`sed -i '' -e 's/^- \\[ \\] A1 .*/- [x] A1/' -e 's/^- \\[ \\] A2 .*/- [x] A2/' /tmp/pr-body.md`)).toBe('pass')
    expect(at(`sed -i 's/.*/x/' notes.md`)).toBe('pass')
  })

  it('a write after `mkdir -p X && cd X`, on a later line, is judged in X and where the call started', () => {
    expect(at(`mkdir -p ${P} && cd ${P} && cat > aside.js <<'EOF'\nconst a = 1;\nEOF\ncat > recipes.js <<'EOF'\nconst b = 2;\nEOF\ncd /repo && node scripts/qa/shot.mjs /list --js ${P}/aside.js --out -`)).toBe('pass')
  })

  it('a loop writing $f.txt after `&& cd /abs` is judged in that folder', () => {
    expect(at(`cd /tmp/r0 && printf "x" > main.js && cd /repo/lane3 && node scripts/qa/shot.mjs /mine/notes --out - > /tmp/r0/a.json && cd /tmp/r0 && for f in a b; do sed 's/></>\\n</g' $f.json > $f.txt; done; diff a.txt b.txt`)).toBe('pass')
  })
})

describe('V0.9 stalls: the same shapes aimed at the frozen set still ask', () => {
  it('sed -i on a frozen file asks, with or without a backup suffix or -e', () => {
    expect(at(`sed -i '' 's/.*/x/' .claude/settings.json`)).toBe('ask')
    expect(at(`sed -i '' -e 's/deny/allow/' scripts/prod-db.sh`)).toBe('ask')
    expect(at(`sed -i 's/deny/allow/' .claude/hooks/guard-production.mjs`)).toBe('ask')
    expect(at(`sed -i.bak 's/a/b/' .github/workflows/ci.yml`)).toBe('ask')
    expect(at(`sed -i '' s/deny/allow/ guard-production.mjs`, '/repo/.claude/hooks')).toBe('ask')
  })

  it('a later-line write after `a && cd X` asks when either folder holds a frozen name', () => {
    expect(at(`mkdir -p /tmp/x && cd /tmp/x && echo a > a.txt\necho x > settings.json`, '/repo/.claude')).toBe('ask')
    expect(at(`mkdir -p /repo/.claude && cd /repo/.claude && echo a > a.txt\necho x > settings.json`)).toBe('ask')
    expect(at(`true && cd $D\necho x > y`)).toBe('ask')
  })
})
