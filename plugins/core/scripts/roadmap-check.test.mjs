import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { check, glance } from './roadmap-check.mjs';

const page = readFileSync(new URL('../skills/the-trail/page.html', import.meta.url), 'utf8');

const rows = () => ({
  'meta/page': { status_html: ['<span>Next: 3.3.3</span>'], lede_html: '<p>3.3.2 is live.</p>', footer_html: '' },
  'meta/archive': { rows: [] },
  'cards/v3-3-2': { ver: '3.3.2', title: 'Pages', status: 'shipped', badge: 'Shipped · PR #103', track: 'to-come', order: 1000, size_pips: 2, size_text: 'M' },
  'cards/v3-3-3': { ver: '3.3.3', title: 'Clean-up', status: 'planned', badge: 'Planned', track: 'to-come', order: 2000, size_pips: 1, size_text: 'S' },
});

describe('roadmap-check', () => {
  it('passes a consistent page and lists the quick list', () => {
    expect(check(rows(), page)).toEqual([]);
    expect(glance(rows())).toEqual([
      'Shipped',
      '  3.3.2 | Pages [Shipped] | 2/4 M | ',
      'Still to come',
      '  3.3.3 | Clean-up [Planned] | 1/4 S | ',
    ]);
  });

  it('fails a card whose status is next', () => {
    const r = rows();
    r['cards/v3-3-3'].status = 'next';
    const problems = check(r, page);
    expect(problems.some((p) => p.includes('cards/v3-3-3: status "next"'))).toBe(true);
  });
});
