// First: the tests' project and its kit.json (the fixture's values).
import './fixtures/kit-project.mjs'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { decide } from './guard-production.mjs'
import { NO_PRODUCTION, loadKitConfig } from './production-steps.mjs'

// job-hunt V0.1 (15 Oct 2026): a project with no production had no ranjit,
// so `gh pr ready` and `gh pr merge` were refused to everyone and Alexander
// merged PR #3 by hand; and code read as a command line (`x[k]`, a Python
// `'gh' in s`) was refused as a hidden gh merge. Each misfire row is the call
// as it was sent (paths shortened); the twins below keep what the refusal
// was for.
const KIT = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/kit.json', import.meta.url)), 'utf8'))
const NONE = { ci: KIT.ci, production: 'none', refs: { dev: '', prod: '' }, urls: { prod: '' }, deployer: '' }
const green = { state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', baseRefName: 'main',
  statusCheckRollup: KIT.ci.jobs.map((name) => ({ __typename: 'CheckRun', name, workflowName: 'CI', status: 'COMPLETED', conclusion: 'SUCCESS' })) }
const at = (command, { pr = green, mode = 'auto', agent } = {}) => decide(
  { tool_name: 'Bash', tool_input: { command }, cwd: '/repo', permission_mode: mode, ...(agent ? { agent_type: agent } : {}) },
  // Linked to the fixture's dev ref, which counts as dev only while kit.json names it.
  { linkedRef: () => KIT.refs.dev, openPr: () => pr, marker: () => null, chainMarker: () => null, releasePr: () => null, log: () => {}, chainLog: () => {}, readLog: () => '' },
) ?? { decision: 'pass' }

// Calls that only looked like a gh merge to the guard.
const SHELL_FN_NODE = `j(){ node -e 'eval(process.argv[1])' "$1"; }\ncurl -s 'https://boards-api.greenhouse.io/v1/boards/vercel/jobs/1' > /tmp/x/gh.json; j 'for(const k in x)console.log(k,JSON.stringify(x[k]).slice(0,120))' < /tmp/x/gh.json`
const PY_TRIPLE = `python3 -I - <<'EOF'
import os
p='/tmp/x/lorenzo/lib.py'
open(p,'w').write('''
import json,glob,datetime,os
EXP=os.path.expanduser("~/Downloads/export")
def load():
    seen=set(); out=[]
    for f in sorted(glob.glob(EXP+"/conversations-*.json")):
        for c in json.load(open(f,encoding="utf8")):
            if c["id"] in seen: continue
            seen.add(c["id"])
            msgs=[]
            for k,n in (c.get("mapping") or {}).items():
                m=n.get("message")
                if not m: continue
                s=" ".join(p for p in (m["content"].get("parts") or []) if isinstance(p,str))
                msgs.append(dict(key=k,role=m["author"]["role"],text=s,t=m.get("create_time") or 0))
            msgs.sort(key=lambda x:x["t"])
            out.append((f.split("/")[-1],c["title"],c["id"],msgs))
    return out
def day(t): return datetime.datetime.fromtimestamp(t).strftime("%Y-%m-%d")
''')
EOF`
const PY_GH_IN = `cd ~/.claude/projects/x && python3 - <<'EOF'
import json,glob
for f in glob.glob('*.jsonl')+glob.glob('*/subagents/*.jsonl'):
  uses={}
  for line in open(f):
    try:d=json.loads(line)
    except:continue
    c=d.get('message',{}).get('content')
    if not isinstance(c,list):continue
    for b in c:
      if b.get('type')=='tool_use': uses[b['id']]=b
      if b.get('type')=='tool_result':
        s=json.dumps(b.get('content'))
        if ('gh' in s and ('ships a release' in s or 'hook' in s.lower() or 'denied' in s.lower())) :
          u=uses.get(b['tool_use_id'],{})
          print(f[:8], u.get('name'), json.dumps(u.get('input'))[:400]); print('  =>', s[:300]); print('---')
EOF`

describe('job-hunt V0.1: a glob only stands for a name it can match, in every project', () => {
  it('code read as a command line no longer counts as a hidden gh', () => {
    expect(at(SHELL_FN_NODE).decision).toBe('pass')
    expect(at(PY_TRIPLE).decision).toBe('pass')
    expect(at('x[k] pr merge 3').decision).toBe('pass')
  })

  it('a glob that could become gh, a shell or an interpreter still counts as built', () => {
    for (const cmd of ['g? pr merge 3', '/usr/local/bin/g[h] pr merge 3', '* pr merge 3', '[g]h pr ready 3', 'b?sh -c "gh pr merge 3"', 'n*e -e "require(\'child_process\').execSync(\'gh pr merge 3\')"']) {
      expect(at(cmd).decision, cmd).toBe('deny')
    }
    expect(at('scripts/full-auto.s? arm 2.1.0').decision).toBe('deny')
    expect(at('$G pr merge 3').decision).toBe('deny')
  })
})

describe('job-hunt V0.1: a project with no production merges on a person\'s go', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kit-none-'))
  const file = join(dir, 'kit.json')
  const load = (kit) => { writeFileSync(file, JSON.stringify(kit)); loadKitConfig(file) }
  beforeAll(() => load(NONE))
  afterAll(() => { loadKitConfig(); rmSync(dir, { recursive: true, force: true }) })

  it('reads "production": "none" only with no prod ref, prod url or deployer beside it', () => {
    expect(NO_PRODUCTION).toBe(true)
    for (const kit of [{ ...NONE, refs: KIT.refs }, { ...NONE, urls: KIT.urls }, { ...NONE, deployer: 'ranjit' }, { ...NONE, production: 'None' }, { ...NONE, production: undefined }]) {
      load(kit)
      expect(NO_PRODUCTION, JSON.stringify(kit)).toBe(false)
      expect(at('gh pr merge 3 --merge').decision).toBe('deny')
    }
    load(NONE)
  })

  it('a green, open, out-of-draft PR asks, naming it; gh pr ready is left to the permission rules', () => {
    const out = at('gh pr merge 3 --merge --delete-branch')
    expect(out.decision).toBe('ask')
    expect(out.reason).toContain('PR #3 into main')
    expect(at('gh pr merge --subject "x 4" 3 --squash').decision).toBe('ask')
    expect(at('gh pr ready 3').decision).toBe('pass')
  })

  it('refuses a draft, red, conflicting or closed PR, a merge with no number, --admin and --auto', () => {
    expect(at('gh pr merge 3', { pr: { ...green, isDraft: true } }).reason).toContain('draft')
    expect(at('gh pr merge 3', { pr: { ...green, mergeable: 'CONFLICTING' } }).reason).toContain('CONFLICTING')
    expect(at('gh pr merge 3', { pr: { ...green, statusCheckRollup: [{ ...green.statusCheckRollup[0], conclusion: 'FAILURE' }] } }).reason).toContain('green')
    expect(at('gh pr merge 3', { pr: { ...green, state: 'MERGED' } }).reason).toContain('MERGED')
    expect(at('gh pr merge 3', { pr: null }).reason).toContain("couldn't be read")
    for (const cmd of ['gh pr merge', 'gh pr merge --merge', 'gh pr merge 3 --admin', 'gh pr merge 3 --auto', 'gh api -X PUT repos/o/r/pulls/3/merge']) {
      expect(at(cmd).decision, cmd).toBe('deny')
    }
  })

  it("can't ask in bypass mode, so it refuses there and says why", () => {
    const out = at('gh pr merge 3 --merge', { mode: 'bypassPermissions' })
    expect(out.decision).toBe('deny')
    expect(out.reason).toContain('Auto mode')
  })

  it('a guess at a hidden gh passes, and a spelled-out merge in code is still checked', () => {
    expect(at(PY_GH_IN).decision).toBe('pass')
    expect(at(`python3 - <<'EOF'\nimport os\nos.system("gh pr merge 3")\nEOF`, { pr: { ...green, isDraft: true } }).decision).toBe('deny')
    // A name built at run time is also read as supabase, which a project with no refs never reaches.
    expect(at('G=gh; $G pr merge 3').decision).toBe('deny')
  })

  it('production stays closed: with no refs every database call is still refused', () => {
    expect(at('supabase db push --linked').decision).toBe('deny')
  })
})

describe('job-hunt V0.1: a project with production is unchanged', () => {
  it('only ranjit merges, and a guess at a hidden gh is still refused', () => {
    expect(NO_PRODUCTION).toBe(false)
    expect(at('gh pr merge 3 --merge').decision).toBe('deny')
    expect(at('gh pr ready 3').decision).toBe('deny')
    expect(at(PY_GH_IN).decision).toBe('deny')
  })
})
