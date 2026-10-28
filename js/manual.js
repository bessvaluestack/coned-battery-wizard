// The manual reader (manual.html): a GitBook-style book from manual/*.md.
// SUMMARY.md gives the contents; each page renders through js/markdown.js.
// Routes live in the fragment, #/<page>/<heading>, so any static host
// serves the book: README.md is the opening page (#/). The pages are this
// edition's: the hosted build's store keeps projects on a server.
import { renderMarkdown, parseSummary, plainText, forEdition } from './markdown.js';
import { STORE } from './store.js';

const EDITION = STORE.kind === 'server' ? 'hosted' : 'pages';

const ROOT = 'manual/';
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let parts = [], pages = [];
const sources = new Map();
let current = null;

const slugOf = (path) => (path === 'README.md' ? '' : path.replace(/\.md$/, ''));
const route = (slug, id = '') => `#/${slug}${id ? `${slug ? '/' : ''}${id}` : ''}`;
function parseRoute() {
  const [slug = '', id = ''] = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/');
  if (!pages.some((p) => p.slug === slug) && !id) return { slug: '', id: slug }; // #/heading on the opening page
  return { slug, id };
}

async function source(path) {
  if (!sources.has(path)) {
    sources.set(path, fetch(ROOT + path).then((r) => {
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.text().then((t) => forEdition(t, EDITION));
    }));
  }
  return sources.get(path);
}

// Links between pages ("battery.md#capacity-curve") become routes; others stay.
function linker(slug) {
  return (href) => {
    if (/^[a-z]+:|^\/\//i.test(href)) return href;
    if (href.startsWith('#')) return route(slug, href.slice(1));
    const m = href.match(/^([\w-]+)\.md(?:#(.*))?$/);
    return m ? route(slugOf(`${m[1]}.md`), m[2] || '') : href;
  };
}

function renderNav(query = '') {
  const nav = $('#bookNav');
  if (query) return renderResults(nav, query);
  nav.innerHTML = parts.map((part) => `
    <div class="nav-part">${part.title ? `<p class="nav-title">${esc(part.title)}</p>` : ''}
      <ul>${part.items.map((it) => `<li class="d${it.depth}"><a href="${route(slugOf(it.path))}" class="${current && current.path === it.path ? 'active' : ''}">${esc(it.title)}</a></li>`).join('')}</ul>
    </div>`).join('');
}

async function renderPage() {
  const { slug, id } = parseRoute();
  const page = pages.find((p) => p.slug === slug) || pages[0];
  const main = $('#bookPage');
  if (!current || current.path !== page.path) {
    current = page;
    try {
      const doc = renderMarkdown(await source(page.path), { link: linker(page.slug), asset: (a) => (/^[a-z]+:|^\//i.test(a) ? a : ROOT + a) });
      const at = pages.indexOf(page), prev = pages[at - 1], next = pages[at + 1];
      main.innerHTML = `<article class="book-article">${doc.html}</article>
        <nav class="pager" aria-label="Previous and next pages">
          ${prev ? `<a class="prev" href="${route(prev.slug)}"><span>Previous</span><b>${esc(prev.title)}</b></a>` : '<span></span>'}
          ${next ? `<a class="next" href="${route(next.slug)}"><span>Next</span><b>${esc(next.title)}</b></a>` : '<span></span>'}
        </nav>`;
      document.title = `${doc.title || page.title} · Battery Wizard manual`;
      const toc = doc.headings.filter((h) => h.level === 2 || h.level === 3);
      $('#bookToc').innerHTML = toc.length ? `<p class="nav-title">On this page</p><ul>${toc.map((h) => `<li class="l${h.level}"><a href="${route(page.slug, h.id)}" data-id="${h.id}">${esc(h.text)}</a></li>`).join('')}</ul>` : '';
      watchHeadings();
    } catch (e) {
      main.innerHTML = `<p class="bad">This page could not be loaded (${esc(e.message)}). Reload to try again.</p>`;
    }
    renderNav($('#bookSearch').value.trim());
  }
  const target = id && document.getElementById(id);
  if (target) target.scrollIntoView({ block: 'start' }); else window.scrollTo({ top: 0 });
  document.body.classList.remove('nav-open');
  $('#navToggle').setAttribute('aria-expanded', 'false');
}

// "On this page" follows the heading in view.
let observer = null;
function watchHeadings() {
  if (observer) observer.disconnect();
  const links = new Map([...document.querySelectorAll('#bookToc a')].map((a) => [a.dataset.id, a]));
  if (!links.size || !('IntersectionObserver' in window)) return;
  observer = new IntersectionObserver((entries) => {
    const seen = entries.filter((e) => e.isIntersecting).map((e) => e.target.id);
    if (!seen.length) return;
    links.forEach((a, id) => a.classList.toggle('active', id === seen[0]));
  }, { rootMargin: '-80px 0px -70% 0px' });
  document.querySelectorAll('.book-article h2, .book-article h3').forEach((h) => observer.observe(h));
}

// Search: every page, section by section; a section matches when it holds
// every word of the query.
let index = null;
async function searchIndex() {
  if (!index) {
    index = (async () => {
      const out = [];
      for (const p of pages) {
        let src = '';
        try { src = await source(p.path); } catch (e) { continue; }
        let section = { page: p, id: '', heading: p.title, text: [] };
        out.push(section);
        let fenced = false;
        for (const line of src.split('\n')) {
          if (/^```/.test(line)) fenced = !fenced;
          const h = !fenced && line.match(/^(#{1,4})\s+(.*?)\s*#*\s*$/);
          if (h) {
            if (h[1].length === 1) { section.heading = plainText(h[2]); continue; }
            section = { page: p, heading: plainText(h[2]), text: [] };
            out.push(section);
            continue;
          }
          section.text.push(plainText(line.replace(/^\s*(>\s*)?(\[![A-Z]+\]|[-*+]|\d+[.)]|\|)?\s*/, '').replace(/\|/g, ' ')));
        }
      }
      // Heading ids as the renderer makes them.
      for (const p of pages) {
        const doc = renderMarkdown(await source(p.path).catch(() => ''));
        const mine = out.filter((s) => s.page === p);
        let k = 0;
        for (const h of doc.headings) if (h.level > 1) { k++; if (mine[k]) mine[k].id = h.id; }
      }
      return out.map((s) => ({ ...s, text: s.text.join(' ').replace(/\s+/g, ' ').trim() }));
    })();
  }
  return index;
}

async function renderResults(nav, query) {
  nav.innerHTML = '<p class="note">Searching...</p>';
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = (await searchIndex()).filter((s) => words.every((w) => `${s.heading} ${s.text}`.toLowerCase().includes(w))).slice(0, 30);
  if ($('#bookSearch').value.trim() !== query) return; // a newer query is running
  const mark = (t) => words.reduce((acc, w) => acc.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>'), esc(t));
  const snippet = (t) => { const at = Math.max(0, t.toLowerCase().indexOf(words[0]) - 60); return (at ? '...' : '') + t.slice(at, at + 160) + (t.length > at + 160 ? '...' : ''); };
  nav.innerHTML = `<p class="nav-title">${hits.length ? `${hits.length}${hits.length === 30 ? '+' : ''} result${hits.length === 1 ? '' : 's'}` : 'No results'}</p>
    <ul class="results">${hits.map((s) => `<li><a href="${route(s.page.slug, s.id)}"><b>${mark(s.heading)}</b><span class="where">${esc(s.page.title)}</span><span class="snip">${mark(snippet(s.text))}</span></a></li>`).join('')}</ul>`;
}

async function boot() {
  try {
    parts = parseSummary(await source('SUMMARY.md'));
    pages = parts.flatMap((p) => p.items).map((it) => ({ ...it, slug: slugOf(it.path) }));
  } catch (e) {
    $('#bookPage').innerHTML = '<p class="bad">The manual could not be loaded. Reload to try again.</p>';
    return;
  }
  renderNav();
  await renderPage();
  window.addEventListener('hashchange', renderPage);
  const box = $('#bookSearch');
  let timer = null;
  box.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => renderNav(box.value.trim()), 150); });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { box.value = ''; renderNav(); box.blur(); }
    if (e.key === 'Enter') { const first = $('#bookNav .results a'); if (first) location.hash = first.getAttribute('href'); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== box && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); box.focus(); }
  });
  $('#navToggle').addEventListener('click', () => {
    const open = document.body.classList.toggle('nav-open');
    $('#navToggle').setAttribute('aria-expanded', String(open));
  });
}

boot();
