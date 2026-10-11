#!/usr/bin/env node
// Checks the shared roadmap page's rows after a write (the-trail), so one fact can't sit wrong in many places.
// Usage: node roadmap-check.mjs <rows.json> <page.html>
// rows.json is a dump of the page's db keyed by doc path: {"meta/page": {...}, "meta/archive": {...}, "cards/v3-3": {...}, ...}
// (a script can't call the artifact's database; the caller dumps the rows first).
// Prints the "At a glance" quick list as drawGlance() builds it, then one line per problem; exit 1 if any.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

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

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", middot: '·', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', asymp: '≈', rarr: '→', larr: '←', ndash: '–', mdash: '—', hellip: '…', times: '×', bull: '•' };
const decode = (s) =>
  s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (m, d, x, n) =>
    d ? String.fromCodePoint(+d) : x ? String.fromCodePoint(parseInt(x, 16)) : (ENTITIES[n.toLowerCase()] ?? m));
const text = (h) =>
  decode(String(h ?? '').replace(/<[^>]*>/g, ' '))
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

// Header text is cut into clauses at commas, semicolons, full stops, brackets and the words then/with/after/on to
// ("3.3.2 live on 11 Oct, with 3.3.3 in progress, then 3.3.1 Guard"). A status word belongs to the nearest version
// in its own clause (the one before it, else the one after). A clause that opens with then/after/on to is a queue
// and makes no claim.
function headerParts(rows) {
  const meta = rows['meta/page'] || {};
  const parts = [];
  for (const h of Array.isArray(meta.status_html) ? meta.status_html : [meta.status_html]) parts.push(['status', text(h)]);
  parts.push(['lede', text(meta.lede_html)], ['footer', text(meta.footer_html)]);
  return parts;
}
const VER = /\d+(?:\.\d+)+/g;
const STATUS_WORDS = [
  ['next', /\bnext\b/gi],
  ['progress', /in[ -]progress|\bbuilding\b|being built|under ?way/gi],
  // "live" is lower case only: a title such as "3.2 Live at the table" is a name, not a claim.
  ['live', /\b[Ss]hipped\b|\blive\b/g],
];
export function claims(t) {
  const out = [];
  for (const clause of t.split(/\.(?=\s|$)|[;,()]\s*|\s+(?:then|with|after)\s+|\s+on to\s+/i)) {
    const c = (clause || '').trim();
    if (!c || /^(?:then|after|on to)\b/i.test(c)) continue;
    const vers = [...c.matchAll(VER)].map((m) => ({ v: m[0], at: m.index }));
    if (!vers.length) continue;
    for (const [kind, re] of STATUS_WORDS) {
      for (const w of c.matchAll(re)) {
        if (kind === 'live' && /not (?:yet )?$/i.test(c.slice(0, w.index))) continue;
        const before = vers.filter((x) => x.at < w.index).pop();
        const hit = before || vers.find((x) => x.at > w.index);
        out.push({ kind, v: hit.v, clause: c });
      }
    }
  }
  return out;
}

// A rows file, or a directory of one JSON file per doc (ArtifactData's out_dir): the doc path is the file's path
// without .json, with "__" or "%2F" standing for "/"; an {id, data} wrapper is unwrapped.
export function loadRows(path) {
  if (!statSync(path).isDirectory()) return JSON.parse(readFileSync(path, 'utf8'));
  const rows = {};
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const full = join(d, f);
      if (statSync(full).isDirectory()) walk(full);
      else if (f.endsWith('.json')) {
        let v = JSON.parse(readFileSync(full, 'utf8'));
        const key = decodeURIComponent(relative(path, full).replace(/\.json$/, '')).replace(/__/g, '/');
        if (v && typeof v.data === 'object' && Object.keys(v).every((k) => ['id', 'path', 'data'].includes(k))) v = v.data;
        rows[key] = v;
      }
    }
  };
  walk(path);
  return rows;
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
  for (const [where, t] of headerParts(rows)) {
    for (const { kind, v, clause } of claims(t)) {
      const c = byVer.get(v);
      if (!c) continue;
      const tag = `${where}: "${clause}"`;
      if (kind === 'next' && isShipped(c)) problems.push(`${tag} names ${v} as next, but it has shipped`);
      if (kind === 'progress' && isShipped(c)) problems.push(`${tag} names ${v} as in progress, but it has shipped`);
      if (kind === 'live' && !isShipped(c)) problems.push(`${tag} says ${v} is shipped or live, but its card is ${c.status}`);
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
  const rows = loadRows(rowsPath);
  const html = readFileSync(pagePath, 'utf8');
  console.log('At a glance');
  console.log(glance(rows).join('\n'));
  const problems = check(rows, html);
  for (const p of problems) console.log('PROBLEM: ' + p);
  if (problems.length) process.exit(1);
  console.log('roadmap-check: ok');
}
