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

  const withHeader = (status, footer) => {
    const r = rows();
    r['meta/page'] = { status_html: status, lede_html: '', footer_html: footer };
    r['cards/v3-3-3'].status = 'in-progress';
    r['cards/v3-3-1'] = { ver: '3.3.1', title: 'Guard', status: 'planned', badge: 'Planned', track: 'to-come', order: 3000 };
    r['cards/v3-2'] = { ver: '3.2', title: 'Table', status: 'planned', badge: 'Planned', track: 'to-come', order: 4000 };
    r['cards/v3-0'] = { ver: '3.0', title: 'Locks', status: 'shipped', badge: 'Shipped', track: 'to-come', order: 500 };
    return r;
  };

  it('accepts a sentence mixing shipped, in progress and queued releases', () => {
    const r = withHeader([], '3.0 to 3.3.2 shipped 6&ndash;11 Oct, 3.3.2 live on 11 Oct, with 3.3.3 in progress, then 3.3.1 Guard and 3.2 onward.');
    expect(check(r, page)).toEqual([]);
  });

  it('accepts queue sentences', () => {
    const r = withHeader(
      ['<strong>Next:</strong> after 3.3.3, 3.3.1 Guard, then 3.2 Live', '<strong>In progress</strong> is 3.3.3 (draft), then 3.3.1 Guard, 3.2 onward'],
      '',
    );
    expect(check(r, page)).toEqual([]);
  });

  it('fails a version called shipped while its card is in progress', () => {
    const r = withHeader([], '3.3.3 shipped on 11 Oct.');
    expect(check(r, page).some((p) => p.includes('3.3.3 is shipped or live'))).toBe(true);
  });

  it('decodes entities in the quick list', () => {
    const r = rows();
    r['cards/v3-3-3'].title = 'Don&rsquo;t &middot; stop';
    expect(glance(r).join('\n')).toContain('Don’t · stop');
  });

  it('fails a card whose status is next', () => {
    const r = rows();
    r['cards/v3-3-3'].status = 'next';
    const problems = check(r, page);
    expect(problems.some((p) => p.includes('cards/v3-3-3: status "next"'))).toBe(true);
  });
});
