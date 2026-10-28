// A small Markdown renderer for the manual (manual/*.md): the subset a
// GitBook-style book uses. Headings (with ids for anchors), paragraphs,
// lists (nested, ordered or not), fenced code, pipe tables, rules, block
// quotes and GitHub-style hints ("> [!NOTE]", TIP, IMPORTANT, WARNING,
// CAUTION); inline code, bold, italics, links and images. Raw HTML is
// escaped, never passed through.
//
//   renderMarkdown(src, { link(href), asset(src) }) -> { html, title, headings: [{ level, text, id }] }
//   parseSummary(src) -> [{ title, items: [{ title, path, depth }] }]    (GitBook's SUMMARY.md)
//   forEdition(src, 'pages' | 'hosted') -> src with the other edition's blocks removed

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const safeUrl = (u) => (/^\s*(javascript|data|vbscript):/i.test(u) ? '#' : u);

const LIST = /^(\s*)([-*+]|\d{1,3}[.)])\s+/;
const FENCE = /^```\s*([\w-]*)\s*$/;
const HEADING = /^(#{1,4})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const TABLE_SEP = /^(?=[^|]*\|)\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const HINTS = { NOTE: 'Note', TIP: 'Tip', IMPORTANT: 'Important', WARNING: 'Warning', CAUTION: 'Caution' };

const indentOf = (line) => line.match(/^\s*/)[0].replace(/\t/g, '    ').length;
const blank = (line) => /^\s*$/.test(line);

// Text for one edition of the wizard. A block that only one edition shows
// sits between a line "::: pages" (or "::: hosted") and a line ":::"; the
// other edition drops it, and both drop the fence lines. It works on lines,
// before any parsing, so a block can hold table rows, list items or pages
// in SUMMARY.md. The build applies it, so an edition's files never carry the
// other's text; the reader applies it again for the source tree.
export const EDITIONS = ['pages', 'hosted'];
export function forEdition(src, edition) {
  const out = [];
  let inside = null;
  for (const line of String(src).split('\n')) {
    const open = line.match(/^:::\s*(\w+)\s*$/);
    if (!inside && open && EDITIONS.includes(open[1])) { inside = open[1]; continue; }
    if (inside && /^:::\s*$/.test(line)) { inside = null; continue; }
    if (!inside || inside === edition) out.push(line);
  }
  return out.join('\n');
}

// Text with its inline markup removed: for ids, titles and search.
export const plainText = (s) => s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/(\*\*|__|\*|_)(?=\S)([^*_]*?\S)\1/g, '$2');

function inline(src, o) {
  const slots = [];
  const keep = (html) => `\u0000${slots.push(html) - 1}\u0000`;
  let s = src.replace(/`([^`]+)`/g, (m, c) => keep(`<code>${esc(c)}</code>`));
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => keep(`<img src="${esc(safeUrl(o.asset(url)))}" alt="${esc(alt)}" loading="lazy">`));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
    const href = safeUrl(o.link(url));
    const away = /^https?:\/\//i.test(href);
    return keep(`<a href="${esc(href)}"${away ? ' target="_blank" rel="noopener"' : ''}>${inline(text, o)}</a>`);
  });
  s = esc(s)
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?![\w*])/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/ {2,}\n|\\\n/g, '<br>');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => slots[+i]);
}

function tableCells(row) {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

export function renderMarkdown(src, opts = {}) {
  const o = { link: (h) => h, asset: (a) => a, ...opts };
  const headings = [], used = new Map();
  const idFor = (text) => {
    const base = plainText(text).toLowerCase().replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
    const n = (used.get(base) || 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };
  const startsBlock = (lines, i) => {
    const l = lines[i];
    return FENCE.test(l) || HEADING.test(l) || RULE.test(l) || /^\s*>/.test(l) || LIST.test(l)
      || (l.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]));
  };

  function list(lines, i) {
    const first = lines[i].match(LIST), indent = indentOf(first[1]), ordered = /\d/.test(first[2]);
    const items = [];
    while (i < lines.length) {
      const m = lines[i].match(LIST);
      if (!m || indentOf(m[1]) !== indent || /\d/.test(m[2]) !== ordered) break;
      const offset = m[0].length;
      const body = [lines[i].slice(offset)];
      let loose = false;
      i++;
      while (i < lines.length) {
        const l = lines[i];
        if (blank(l)) {
          let j = i + 1; while (j < lines.length && blank(lines[j])) j++;
          if (j < lines.length && indentOf(lines[j]) > indent) { body.push(''); loose = true; i++; continue; }
          break;
        }
        const lm = l.match(LIST);
        if (lm && indentOf(lm[1]) <= indent) break;
        if (indentOf(l) > indent) { body.push(l.slice(Math.min(indentOf(l), offset))); i++; continue; }
        if (!startsBlock(lines, i)) { body.push(l); i++; continue; }
        break;
      }
      let h = blocks(body);
      if (!loose) h = h.replace(/^<p>([\s\S]*?)<\/p>/, '$1');
      items.push(`<li>${h}</li>`);
    }
    const start = ordered && +first[2].replace(/\D/g, '') !== 1 ? ` start="${+first[2].replace(/\D/g, '')}"` : '';
    return { html: ordered ? `<ol${start}>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`, next: i };
  }

  function blocks(lines) {
    const out = [];
    let i = 0, m;
    while (i < lines.length) {
      const line = lines[i];
      if (blank(line)) { i++; continue; }
      if ((m = line.match(FENCE))) {
        const buf = []; i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) buf.push(lines[i++]);
        i++;
        out.push(`<pre><code${m[1] ? ` class="lang-${esc(m[1])}"` : ''}>${esc(buf.join('\n'))}</code></pre>`);
        continue;
      }
      if ((m = line.match(HEADING))) {
        const level = m[1].length, id = idFor(m[2]);
        headings.push({ level, text: plainText(m[2]), id });
        out.push(`<h${level} id="${id}">${inline(m[2], o)}<a class="anchor" href="${esc(o.link('#' + id))}" aria-label="Link to this section">#</a></h${level}>`);
        i++; continue;
      }
      if (RULE.test(line)) { out.push('<hr>'); i++; continue; }
      if (/^\s*>/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*> ?/, ''));
        const hint = buf[0] && buf[0].match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i);
        if (hint) {
          const kind = hint[1].toUpperCase();
          out.push(`<div class="hint hint-${kind.toLowerCase()}"><p class="hint-title">${HINTS[kind]}</p>${blocks(buf.slice(1))}</div>`);
        } else out.push(`<blockquote>${blocks(buf)}</blockquote>`);
        continue;
      }
      if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
        const head = tableCells(line);
        const align = tableCells(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : ''));
        const cell = (tag, c, k) => `<${tag}${align[k] ? ` class="${align[k] === 'right' ? 'num' : 'mid'}"` : ''}>${inline(c, o)}</${tag}>`;
        i += 2;
        const rows = [];
        while (i < lines.length && !blank(lines[i]) && lines[i].includes('|')) rows.push(tableCells(lines[i++]));
        out.push(`<div class="tablewrap"><table><thead><tr>${head.map((c, k) => cell('th', c, k)).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${head.map((_, k) => cell('td', r[k] || '', k)).join('')}</tr>`).join('')}</tbody></table></div>`);
        continue;
      }
      if (LIST.test(line)) { const l = list(lines, i); out.push(l.html); i = l.next; continue; }
      const buf = [line.trim()]; i++;
      while (i < lines.length && !blank(lines[i]) && !startsBlock(lines, i)) buf.push(lines[i++].replace(/^\s+/, ''));
      out.push(`<p>${inline(buf.join('\n'), o).replace(/\n/g, ' ')}</p>`);
    }
    return out.join('\n');
  }

  const html = blocks(src.replace(/\r\n?/g, '\n').split('\n'));
  const h1 = headings.find((h) => h.level === 1);
  return { html, title: h1 ? h1.text : '', headings };
}

// GitBook's SUMMARY.md: "## Part" headings and "* [Title](page.md)" items,
// indented for sub-pages.
export function parseSummary(src) {
  const parts = [{ title: null, items: [] }];
  for (const line of src.replace(/\r\n?/g, '\n').split('\n')) {
    let m;
    if ((m = line.match(/^#{2,}\s+(.*?)\s*$/))) { parts.push({ title: plainText(m[1]), items: [] }); continue; }
    if ((m = line.match(/^(\s*)[-*+]\s+\[([^\]]+)\]\(([^)\s]+)\)/))) parts[parts.length - 1].items.push({ title: m[2], path: m[3], depth: Math.floor(indentOf(m[1]) / 2) });
  }
  return parts.filter((p) => p.items.length);
}
