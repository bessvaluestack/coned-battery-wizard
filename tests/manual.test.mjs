// node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { renderMarkdown, parseSummary, forEdition, EDITIONS } from '../js/markdown.js';

const book = (p) => new URL(`../manual/${p}`, import.meta.url);
const read = (p) => readFileSync(book(p), 'utf8');

test('markdown: headings with ids, lists, tables, code, hints and links; raw HTML stays text', () => {
  const src = [
    '# Title', '', 'A **bold**, *em* and `code <b>` line with a [link](rate.md#taxes) and Wizard_Import.', '<script>alert(1)</script>', '',
    '## Section', '', '- one', '  - nested', '- two', '', '1. first', '2. second', '',
    '> [!WARNING]', '> Careful.', '', '| A | B |', '|---|--:|', '| x \\| y | 2 |', '', '```sh', 'a < b', '```', '', '## Section', '',
  ].join('\n');
  const r = renderMarkdown(src, { link: (h) => h.replace(/^(\w+)\.md#(.*)$/, '#/$1/$2') });
  assert.equal(r.title, 'Title');
  assert.deepEqual(r.headings.map((h) => h.id), ['title', 'section', 'section-2']);
  assert.match(r.html, /<strong>bold<\/strong>, <em>em<\/em> and <code>code &lt;b&gt;<\/code>/);
  assert.match(r.html, /<a href="#\/rate\/taxes">link<\/a> and Wizard_Import/);
  assert.doesNotMatch(r.html, /<script>/);
  assert.match(r.html, /<ul><li>one\n<ul><li>nested<\/li><\/ul><\/li><li>two<\/li><\/ul>/);
  assert.match(r.html, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
  assert.match(r.html, /<div class="hint hint-warning"><p class="hint-title">Warning<\/p><p>Careful.<\/p><\/div>/);
  assert.match(r.html, /<td>x \| y<\/td><td class="num">2<\/td>/);
  assert.match(r.html, /<pre><code class="lang-sh">a &lt; b<\/code><\/pre>/);
  assert.equal(renderMarkdown('[x](javascript:alert(1))').html.includes('javascript:'), false);
});

test('manual: in each edition, every page in SUMMARY.md exists and renders, and every link inside it lands', () => {
  for (const edition of EDITIONS) checkBook(edition, (p) => forEdition(read(p), edition));
});

function checkBook(edition, read) {
  const parts = parseSummary(read('SUMMARY.md'));
  const pages = parts.flatMap((p) => p.items.map((i) => i.path));
  assert.equal(pages[0], 'README.md');
  assert.ok(pages.length >= 15, `${pages.length} pages`);
  const files = readdirSync(new URL('../manual/', import.meta.url)).filter((f) => f.endsWith('.md') && f !== 'SUMMARY.md');
  assert.deepEqual([...files].sort(), [...pages].sort(), 'every page is in the contents, and only those');
  const anchors = new Map(), links = [];
  for (const p of pages) {
    const doc = renderMarkdown(read(p), { link: (h) => { links.push([p, h]); return h; } });
    assert.ok(doc.title, `${edition}: ${p} has a title`);
    anchors.set(p, new Set(doc.headings.map((h) => h.id)));
  }
  for (const [from, href] of links) {
    if (/^https?:/.test(href)) continue;
    const [file, id] = href.startsWith('#') ? [from, href.slice(1)] : href.split('#');
    assert.ok(pages.includes(file), `${edition}: ${from}: link to ${href}`);
    if (id) assert.ok(anchors.get(file).has(id), `${edition}: ${from}: no heading #${id} in ${file}`);
  }
}

test('manual: the GitHub Pages edition says nothing about the hosted site; edition blocks are closed', () => {
  const files = readdirSync(new URL('../manual/', import.meta.url)).filter((f) => f.endsWith('.md'));
  for (const f of files) {
    const src = read(f);
    let open = null;
    for (const [n, line] of src.split('\n').entries()) {
      const m = line.match(/^:::\s*(\w*)\s*$/);
      if (!m) continue;
      if (m[1]) { assert.equal(open, null, `${f}:${n + 1}: a block inside a block`); assert.ok(EDITIONS.includes(m[1]), `${f}:${n + 1}: ${m[1]}`); open = m[1]; } else { assert.ok(open, `${f}:${n + 1}: ::: without a block`); open = null; }
    }
    assert.equal(open, null, `${f}: a block is never closed`);
    const pages = forEdition(src, 'pages');
    for (const re of [/hosted/i, /on the server/i, /Copy link/, /\bVersions\b/, /Save version/]) assert.doesNotMatch(pages, re, `${f} (GitHub Pages edition)`);
  }
});

test('manual: each wizard step links to an existing page', () => {
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const map = Object.fromEntries([...app.match(/const MANUAL_PAGE = \{([^}]*)\}/)[1].matchAll(/(\w+): '([\w-]+)'/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual(Object.keys(map).sort(), ['battery', 'load', 'modality', 'rate', 'results', 'riders', 'supply', 'valuestack']);
  for (const [step, page] of Object.entries(map)) assert.ok(existsSync(book(`${page}.md`)), `${step}: manual/${page}.md`);
  assert.ok(renderMarkdown(read('rate.md')).headings.some((h) => h.id === 'site-and-charging-account-stand-alone'), 'the stand-alone anchor');
});
