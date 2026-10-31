import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  CLOSE_ASK,
  CLOSE_ASK_PLAYBOOK,
  agentsIn,
  budgetFor,
  compose,
  dbNames,
  designRoute,
  factsFor,
  filesIn,
  findStep,
  laneCommands,
  parseArgs,
  parseSteps,
  render,
  testsReading,
  walk,
} from './compose-order.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const budgets = JSON.parse(readFileSync(join(HERE, '..', 'budgets.json'), 'utf8'))

// The shape of Burrow V1.4's table (Step | What | Agent · model | Lane | Ceiling | Found | Checked by | Intent).
const PLAN = `# V9.9

| Step | What | Agent · model | Lane | Ceiling | Found | Checked by | Intent |
|---|---|---|---|---|---|---|---|
| N0 | Branch from main | navigator | – | 3M | – | diff | I5 |
| B4 | From the bank to spend through the import's checks | ahmed-och-ahmed · Opus | B | 12M | \`lib/money-import.ts:47,92\`; \`components/money/spend-import.tsx:7\` | unit tests | I1 |
| M1 | **0144_money_fixes**: \`shared_card_cycle()\` reads \`spend.split_pct\` | the-playbook · Opus | M | 14M | \`0012_money_accounts.sql\` (\`shared_card_cycle\`, latest) | \`npm run test:db\` | I7 |
| O1 | One Ahead route | saul-goodman · Opus | O | 20M | \`lib/places.ts:67\` | shots | I3 |
| X1 | A fix with no cap | jesse-pinkman · Sonnet | X | – | \`lib/places.ts\` | check | I3 |
| D1 | Trips box option A, the layout | mosbius-designs · Fable | D | lifted | \`components/trips/box.tsx\` | gallery | I2 |
| D2 | The 404 hand, drawn: three directions at 48px | mosbius-designs · Fable | D | 12M | – | gallery | I2 |
| D3 | Three warm palettes | mosbius-designs · Fable | D | 12M | – | gallery | I2 |
| R1 | The wall review | kissochbajslowski · Opus | R | 15M | – | – | – |
| Q1 | The pair, shot as one | staffan-olsson (375) + magnus-wislander (1024) | W | 10M | – | shots | I5 |
`

let root
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'compose-order-'))
  const w = (p, s) => {
    mkdirSync(dirname(join(root, p)), { recursive: true })
    writeFileSync(join(root, p), s)
  }
  w('lib/money-import.ts', 'export const x = 1\n')
  w('lib/money-import.test.ts', "import { x } from './money-import'\n")
  w('lib/places.ts', 'export const p = 1\n')
  w('components/money/spend-import.tsx', 'export default 1\n')
  w('components/money/other.test.tsx', "import S from '@/components/money/spend-import'\n")
  w('components/money/unrelated.test.tsx', "import S from './spend-import-old'\n")
  w('components/trips/box.tsx', 'export default 1\n')
  w('app/globals.css', ':root { --bg: #fff }\n')
  w('supabase/migrations/0012_money_accounts.sql', 'create function shared_card_cycle() returns int as $$ select 1 $$;\n')
  w('supabase/tests/money_test.sql', '-- reads 0012_money_accounts.sql\nselect shared_card_cycle();\n')
  w('docs/money.md', 'How shared_card_cycle splits a bill.\n')
  w('node_modules/x/lib/places.test.ts', "import './places'\n")
  w('package.json', JSON.stringify({ scripts: { 'test:db': 'node t.mjs', types: 'supabase gen types' } }))
  w('.claude/kit.json', JSON.stringify({ refs: { dev: 'localstacknotahosted' }, budgets: { 'jesse-pinkman': '6M' } }))
  w(
    '.claude/standing-facts.md',
    [
      '# Standing facts',
      '## Every order',
      '- Use `Section defaultOpen={false}` for folds.',
      '## Data',
      '- The money loader is `lib/money-load.ts`; never a second spend query.',
      '- The bank import maps rows through `lib/money-import.ts`.',
      '- Example: <a placeholder line>',
      '## Traps',
      '- Trips pages read the calendar cache first.',
    ].join('\n'),
  )
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('the plan table', () => {
  it('finds columns by their header words', () => {
    const rows = parseSteps(PLAN)
    expect(rows.map((r) => r.step)).toContain('B4')
    const b4 = findStep(PLAN, 'b4')
    expect(b4.agent).toMatch(/ahmed/)
    expect(b4.budget).toBe('12M')
    expect(b4.files).toMatch(/money-import/)
    expect(b4.check).toBe('unit tests')
  })
  it('reads other header spellings', () => {
    const t = '| Step | What | Who | Files | Check | Budget |\n|---|---|---|---|---|---|\n| 3 | A page | chris-de-kok | `app/x.tsx` | lint | 9M |\n'
    const r = findStep(t, '3')
    expect(r).toMatchObject({ agent: 'chris-de-kok', files: '`app/x.tsx`', check: 'lint', budget: '9M' })
  })
  it('skips tables that are not step tables', () => {
    expect(parseSteps('| Release | Planned |\n|---|---|\n| V1.0 | 470M |\n')).toEqual([])
  })
  it('returns null for a missing step', () => {
    expect(findStep(PLAN, 'Z9')).toBeNull()
  })
})

describe('reading a row', () => {
  it('names agents in order, the pool for "builder"', () => {
    expect(agentsIn('staffan-olsson (375) + magnus-wislander (1024)')).toEqual(['staffan-olsson', 'magnus-wislander'])
    expect(agentsIn('a builder · Opus')).toEqual(['chris-de-kok'])
    expect(agentsIn('navigator')).toEqual(['navigator'])
  })
  it('takes file:line paths from backticks or plain words', () => {
    expect(filesIn('`lib/a.ts:47,92`; `b.sql` (`spend`, latest)')).toEqual(['lib/a.ts:47,92', 'b.sql'])
    expect(filesIn('app/(home)/layout.tsx; P0 table')).toEqual(['app/(home)/layout.tsx'])
  })
  it('names tables and functions, never migrations or files', () => {
    expect(dbNames('**0144_money_fixes**: `shared_card_cycle()` reads `spend.split_pct` in `0012_x.sql` and `app/globals.css`')).toEqual(['shared_card_cycle', 'spend'])
  })
})

describe('the designer route (H7)', () => {
  it('sends drawn things to Fable at 12M', () => {
    expect(designRoute('The 404 hand, drawn: three directions', { budgets })).toMatchObject({ model: 'fable', mode: 'drawn-things', budget: '12M' })
    expect(designRoute('New nav icons', { budgets }).model).toBe('fable')
  })
  it('does not read "drawn" alone as a drawn thing', () => {
    expect(designRoute('Card titles drawn outside h1', { budgets, tokenCss: 'a.css' }).model).not.toBe('fable')
  })
  it('sends important design to Fable', () => {
    expect(designRoute('Home page, important design', { budgets })).toMatchObject({ model: 'fable', mode: 'layout' })
  })
  it('keeps palettes, type pairs and a first look on Opus at 5M', () => {
    for (const t of ['Three warm palettes', 'Three warm font pairs', 'A first look for the new project']) {
      expect(designRoute(t, { budgets, tokenCss: 'a.css' })).toMatchObject({ model: 'opus', budget: '5M' })
    }
  })
  it('scripts a plain one-page layout on Sonnet when a token CSS is known', () => {
    expect(designRoute('Trips box option A, the layout', { budgets, tokenCss: 'app/globals.css' })).toMatchObject({ model: 'sonnet', mode: 'scripted', tokenCss: 'app/globals.css' })
  })
  it('keeps Opus layout mode for several pages, an app route, or no token CSS', () => {
    expect(designRoute('Start a club, club page, meeting pages', { budgets, tokenCss: 'a.css' }).mode).toBe('layout')
    expect(designRoute('The box as a route in the app', { budgets, tokenCss: 'a.css' }).mode).toBe('layout')
    expect(designRoute('The box layout', { budgets })).toMatchObject({ model: 'opus', mode: 'layout' })
  })
})

describe('the budget tag, never absent', () => {
  it('takes the plan cell', () => {
    expect(budgetFor('ahmed-och-ahmed', '12M', { budgets }).tag).toBe('[budget 12M]')
  })
  it('falls back to kit.json, then budgets.json', () => {
    expect(budgetFor('jesse-pinkman', '–', { budgets, kitBudgets: { 'jesse-pinkman': '6M' } }).tag).toBe('[budget 6M]')
    expect(budgetFor('jesse-pinkman', '', { budgets }).tag).toBe('[budget 8M]')
    expect(budgetFor('nobody-new', '', { budgets }).tag).toBe('[budget 15M]')
  })
  it('holds a build order at the ceiling', () => {
    const b = budgetFor('saul-goodman', '20M', { budgets })
    expect(b.tag).toBe('[budget 15M]')
    expect(b.notes.join()).toMatch(/ceiling/)
  })
  it('lets an above-ceiling role keep its number', () => {
    expect(budgetFor('dom-cobb', '20M', { budgets }).tag).toBe('[budget 20M]')
  })
  it('turns a lifted, unlimited or missing designer budget into the 12M stop', () => {
    const fable = { budget: '12M', model: 'fable', mode: 'layout' }
    for (const cell of ['lifted', 'unlimited', '', '–']) {
      expect(budgetFor('mosbius-designs', cell, { budgets, design: fable }).tag).toBe('[budget 12M]')
    }
  })
  it('caps a designer at its route', () => {
    expect(budgetFor('mosbius-designs', '12M', { budgets, design: { budget: '5M', model: 'opus', mode: 'layout' } }).tag).toBe('[budget 5M]')
  })
})

describe('the project reads', () => {
  it('finds the tests that read a file, skipping node_modules and near names', () => {
    const t = testsReading(root, ['lib/money-import.ts', 'components/money/spend-import.tsx'], walk(root))
    expect(t).toEqual(['components/money/other.test.tsx', 'lib/money-import.test.ts'])
    expect(testsReading(root, ['supabase/migrations/0012_money_accounts.sql'])).toEqual(['supabase/tests/money_test.sql'])
  })
  it('picks the standing facts that touch the step, and every Every order line', () => {
    const facts = factsFor(readFileSync(join(root, '.claude/standing-facts.md'), 'utf8'), 'the bank import', ['lib/money-import.ts'])
    expect(facts).toEqual(['Use `Section defaultOpen={false}` for folds.', 'The bank import maps rows through `lib/money-import.ts`.'])
  })
  it('reads the lane commands from package.json and the stack, kit.json winning', () => {
    expect(laneCommands(root, { refs: { dev: 'localstacknotahosted' } })).toMatchObject({ stack: 'local', test: 'npm run test:db', apply: 'supabase migration up --local', types: 'npm run types' })
    expect(laneCommands(root, { refs: { dev: 'abcd' } }).schema).toMatch(/--linked/)
    expect(laneCommands(root, { database: { test: 'make dbtest' } }).test).toBe('make dbtest')
  })
})

describe('compose', () => {
  const run = (step) => compose({ planText: PLAN, stepId: step, root, budgets })

  it('builds a builder order with files, tests, facts, shell and the last-line ask', () => {
    const o = run('B4')
    expect(o).toMatchObject({ agent: 'ahmed-och-ahmed', model: 'opus', effort: 'medium', budget: '[budget 12M]', mode: 'build', close: CLOSE_ASK })
    expect(o.description).toMatch(/^ahmed-och-ahmed: step B4 .*\[budget 12M\]$/)
    expect(o.files).toEqual(['lib/money-import.ts', 'components/money/spend-import.tsx'])
    expect(o.tests).toContain('lib/money-import.test.ts')
    expect(o.facts.join()).toMatch(/money-import/)
    const text = render(o)
    expect(text.trim().split('\n').at(-1)).not.toBe('')
    expect(text).toMatch(/Shell: zsh/)
    expect(text).toContain(CLOSE_ASK)
  })
  it('adds the lane brief to a the-playbook order, and the first-field ask', () => {
    const o = run('M1')
    expect(o.close).toBe(CLOSE_ASK_PLAYBOOK)
    expect(o.effort).toBe('high')
    expect(o.files).toEqual(['supabase/migrations/0012_money_accounts.sql'])
    expect(o.lane_brief.test).toBe('npm run test:db')
    const scc = o.lane_brief.names.find((n) => n.name === 'shared_card_cycle')
    expect(scc.scope).toMatch(/scope\.mjs shared_card_cycle --root /)
    expect(scc.docs).toEqual(['docs/money.md'])
    expect(render(o)).toMatch(/Lane brief \(local\)/)
  })
  it('routes a Fable layout with a lifted budget to scripted Sonnet', () => {
    const o = run('D1')
    expect(o).toMatchObject({ model: 'sonnet', mode: 'scripted', tokenCss: 'app/globals.css' })
    expect(o.notes.join()).toMatch(/plan said fable/)
    expect(o.budget).toBe('[budget 4M]')
  })
  it('keeps a drawn thing on Fable and a palette on Opus at 5M', () => {
    expect(run('D2')).toMatchObject({ model: 'fable', mode: 'drawn-things', budget: '[budget 12M]' })
    expect(run('D3')).toMatchObject({ model: 'opus', budget: '[budget 5M]' })
  })
  it('keeps the reviewer on Sonnet when the plan names Opus with no reason', () => {
    const o = run('R1')
    expect(o.model).toBe('sonnet')
    expect(o.notes.join()).toMatch(/no reason/)
  })
  it('notes a row with two agents, and kit budgets for a missing cell', () => {
    expect(run('Q1').notes.join()).toMatch(/staffan-olsson \+ magnus-wislander/)
    expect(run('X1').budget).toBe('[budget 6M]')
    expect(run('O1').budget).toBe('[budget 15M]')
  })
  it('says the navigator does its own step, and errors on a missing one', () => {
    expect(render(run('N0'))).toMatch(/navigator does this step itself/)
    expect(run('Z9').error).toMatch(/no row/)
  })
  it('notes a project with no standing facts yet', () => {
    const bare = mkdtempSync(join(tmpdir(), 'compose-bare-'))
    try {
      const o = compose({ planText: PLAN, stepId: 'B4', root: bare, budgets })
      expect(o.facts).toBeNull()
      expect(o.notes.join()).toMatch(/standing-facts/)
      expect(o.files[0]).toMatch(/not found/)
    } finally {
      rmSync(bare, { recursive: true, force: true })
    }
  })
})

describe('arguments', () => {
  it('needs --plan and --step', () => {
    expect(parseArgs(['--plan', 'p.md']).error).toMatch(/usage/)
    expect(parseArgs(['--plan', 'p.md', '--step', 'B4', '--json'])).toMatchObject({ plan: 'p.md', step: 'B4', json: true })
    expect(parseArgs(['--nope']).error).toMatch(/unknown/)
  })
})
