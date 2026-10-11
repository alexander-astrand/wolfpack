#!/usr/bin/env node
// Checks the shared roadmap page's rows after a write (the-trail), so one fact can't sit wrong in many places.
// Usage: node roadmap-check.mjs <rows.json> <page.html>
// rows.json is a dump of the page's db keyed by doc path: {"meta/page": {...}, "meta/archive": {...}, "cards/v3-3": {...}, ...}
// (a script can't call the artifact's database; the caller dumps the rows first).
// Prints the "At a glance" quick list as drawGlance() builds it, then one line per problem; exit 1 if any.
import { readFileSync } from 'node:fs';

export function parseStatus(pageHtml) {
  const m = pageHtml.match(/var STATUS = \[([\s\S]*?)\];/);
  if (!m) return null;
  return [...m[1].matchAll(/\['([^']+)'\s*,/g)].map((x) => x[1]);
}

// The glance rules below copy page.html's groupOf(), GROUPS and drawGlance(). If those lines change, this fails
// loudly instead of printing a quick list that differs from the page.
const MIRRORED = [
  "function groupOf(c) { return isShipped(c) && c.track !== 'beyond' ? 'shipped' : (c.track || 'beyond'); }",
  "var GROUPS = [['shipped', 'Shipped'], ['to-come', 'Still to come'], ['beyond', 'Beyond V2']];",
  'if (c.glance_hide || groupOf(c) !== g[0]) return;',
  'shortBadge(c.badge)',
  "str(badge).replace(/\\s*·\\s*PR #\\d+$/, '')",
];
const GROUPS = [['shipped', 'Shipped'], ['to-come', 'Still to come'], ['beyond', 'Beyond V2']];

const text = (h) =>
  String(h ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
const shortBadge = (b) => String(b ?? '').replace(/\s*·\s*PR #\d+$/, '');
const isShipped = (c) => c.status === 'shipped';
const groupOf = (c) => (isShipped(c) && c.track !== 'beyond' ? 'shipped' : c.track || 'beyond');
const verOf = (s) => (String(s ?? '').match(/\d+(?:\.\d+)+/) || [null])[0];

export function loadCards(rows) {
  return Object.entries(rows)
    .filter(([k]) => k.startsWith('cards/'))
    .map(([k, v]) => ({ ...v, id: k.slice('cards/'.length) }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function glance(rows) {
  const cards = loadCards(rows);
  const archive = Array.isArray(rows['meta/archive']?.rows) ? rows['meta/archive'].rows : [];
  const out = [];
  for (const [key, label] of GROUPS) {
    const lines = [];
    if (key === 'shipped') {
      for (const r of archive) {
        if (!r || typeof r.href !== 'string' || !/^https:\/\//.test(r.href)) continue;
        lines.push(`${r.ver} | ${text(r.theme_html)} [Shipped] | ${r.pips ?? 0}/4 ${text(r.size_html)} | ${text(r.what_html)}`);
      }
    }
    for (const c of cards) {
      if (c.glance_hide || groupOf(c) !== key) continue;
      const badge = shortBadge(c.badge);
      const pips = c.glance_pips != null ? c.glance_pips : c.size_pips;
      const size = c.glance_size != null ? c.glance_size : c.size_text;
      lines.push(
        `${c.glance_ver || c.ver} | ${text(c.glance_theme || c.title)}${badge ? ` [${badge}]` : ''} | ${pips ?? 0}/4 ${text(size)} | ${text(c.glance_what)}`,
      );
    }
    if (lines.length) out.push(label, ...lines.map((l) => '  ' + l));
  }
  return out;
}

// A clause is a stretch of header text between sentence breaks; a version in a "next" or "in progress" clause
// must be a card in that state, a version in a "shipped" clause must be shipped.
function headerClauses(rows) {
  const meta = rows['meta/page'] || {};
  const parts = [];
  for (const h of Array.isArray(meta.status_html) ? meta.status_html : [meta.status_html]) parts.push(['status', text(h)]);
  parts.push(['lede', text(meta.lede_html)], ['footer', text(meta.footer_html)]);
  const clauses = [];
  for (const [where, t] of parts) for (const c of t.split(/[.;·|]\s+|[.;·|]$/)) if (c.trim()) clauses.push([where, c.trim()]);
  return clauses;
}

export function check(rows, pageHtml) {
  const problems = [];
  const cards = loadCards(rows);
  const statuses = parseStatus(pageHtml);
  if (!statuses) problems.push("page.html: could not find the STATUS list (var STATUS = [...])");
  for (const s of MIRRORED) if (!pageHtml.includes(s)) problems.push(`page.html no longer contains "${s}": update the glance rules in roadmap-check.mjs to match drawGlance()`);

  // 1. every card's status is one the page knows
  if (statuses) for (const c of cards) if (!statuses.includes(c.status)) problems.push(`cards/${c.id}: status "${c.status}" is not one of ${statuses.join(' | ')}`);

  // 2. at most one next
  const next = cards.filter((c) => c.status === 'next' || /\bnext\b/i.test(c.badge || ''));
  if (next.length > 1) problems.push(`more than one card says next: ${next.map((c) => 'cards/' + c.id).join(', ')}`);

  const byVer = new Map();
  for (const c of cards) {
    const v = verOf(c.ver) || verOf(c.id.replace(/^[rv]/i, '').replace(/-/g, '.'));
    if (v) byVer.set(v, c);
  }

  // 3. "Folded into <v>" while that release shipped and this card didn't
  for (const c of cards) {
    for (const m of text(c.pre_html).matchAll(/folded into\s+v?(\d+(?:\.\d+)+)/gi)) {
      const t = byVer.get(m[1]);
      if (t && isShipped(t) && !isShipped(c)) problems.push(`cards/${c.id}: says "Folded into ${m[1]}", which has shipped, but this card is ${c.status}`);
    }
  }

  // 4. header text against the cards
  for (const [where, clause] of headerClauses(rows)) {
    const vers = [...clause.matchAll(/\d+(?:\.\d+)+/g)].map((m) => m[0]);
    for (const v of vers) {
      const c = byVer.get(v);
      if (!c) continue;
      const tag = `${where}: "${clause}"`;
      if (/\bnext\b/i.test(clause) && isShipped(c)) problems.push(`${tag} names ${v} as next, but it has shipped`);
      if (/in progress|in-progress|building|being built|under way|underway/i.test(clause) && !/not in progress/i.test(clause) && isShipped(c))
        problems.push(`${tag} names ${v} as in progress, but it has shipped`);
      if (/\b(shipped|live)\b/i.test(clause) && !/not (yet )?(shipped|live)|until|when/i.test(clause) && !isShipped(c))
        problems.push(`${tag} says ${v} is shipped or live, but its card is ${c.status}`);
    }
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [rowsPath, pagePath] = process.argv.slice(2);
  if (!rowsPath || !pagePath) {
    console.error('usage: node roadmap-check.mjs <rows.json> <page.html>');
    process.exit(2);
  }
  const rows = JSON.parse(readFileSync(rowsPath, 'utf8'));
  const html = readFileSync(pagePath, 'utf8');
  console.log('At a glance');
  console.log(glance(rows).join('\n'));
  const problems = check(rows, html);
  for (const p of problems) console.log('PROBLEM: ' + p);
  if (problems.length) process.exit(1);
  console.log('roadmap-check: ok');
}
