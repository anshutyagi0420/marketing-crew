#!/usr/bin/env node
// site-audit collector
// Fetches one page and extracts the facts the audit agents need.
// Zero dependencies. Requires Node 18+ (built-in fetch).
//
// Usage:
//   node collect.mjs <url | path/to/file.html> <outDir> [--no-psi]
//
// Writes to <outDir>:
//   page.html  raw HTML as served
//   page.json  structured facts (meta, headings, links, images, CTAs, forms, scripts, signals...)
//   page.txt   visible text in reading order, with # headings and [BUTTON]/[CTA LINK]/[FIELD]/[IMG] markers
//   psi.json   Google PageSpeed Insights (mobile) summary, unless --no-psi or input is a local file
// Prints a short JSON summary to stdout.

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const VERSION = '0.1.0';
const UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 site-audit/${VERSION}`;

if (typeof fetch !== 'function') {
  console.error('site-audit: Node 18 or newer is required (built-in fetch is missing).');
  process.exit(2);
}

// ---------- args ----------
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const positional = argv.filter((a) => !a.startsWith('--'));
if (positional.length < 2) {
  console.error('Usage: node collect.mjs <url | file.html> <outDir> [--no-psi]');
  process.exit(2);
}
const [input, outDirArg] = positional;
const outDir = path.resolve(outDirArg);
const runPsiFlag = !flags.has('--no-psi');

// ---------- small helpers ----------
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', reg: '®', trade: '™', bull: '•', middot: '·',
};
function decode(s = '') {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
const clean = (s = '') => decode(s.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const truncate = (s = '', n = 160) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function parseAttrs(s = '') {
  const out = {};
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(s))) out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}
function tags(html, name) {
  const re = new RegExp(`<${name}\\b([^>]*)>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(html))) out.push(parseAttrs(m[1]));
  return out;
}
function pairs(html, name) {
  const re = new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)</${name}\\s*>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(html))) out.push({ attrs: parseAttrs(m[1]), inner: m[2] });
  return out;
}
function resolveUrl(href, base) {
  try { return new URL(href, base).href; } catch { return null; }
}
const bareHost = (h = '') => h.toLowerCase().replace(/^www\./, '');
function siteKey(host = '') {
  // Rough registrable domain: last two labels (three for common 2-level TLDs like co.uk).
  const parts = bareHost(host).split('.');
  const twoLevel = /^(co|com|org|net|gov|ac|edu)$/.test(parts[parts.length - 2] || '') && parts.length > 2;
  return parts.slice(twoLevel ? -3 : -2).join('.');
}
function countMatches(text, re) {
  const m = text.match(re);
  return m ? m.length : 0;
}
function snippetAround(text, re, width = 90) {
  const m = re.exec(text);
  if (!m) return null;
  const start = Math.max(0, m.index - width / 2);
  return truncate(text.slice(start, start + width).replace(/\s+/g, ' ').trim(), width + 2);
}

// ---------- fetching ----------
async function fetchWithChain(url, { timeoutMs = 30000, maxRedirects = 10 } = {}) {
  const chain = [];
  let current = url;
  const t0 = Date.now();
  for (let i = 0; i <= maxRedirects; i++) {
    const res = await fetch(current, {
      redirect: 'manual',
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'accept-language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      chain.push({ url: current, status: res.status });
      current = new URL(loc, current).href;
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, finalUrl: current, chain, headers: res.headers, text: buf.toString('utf8'), bytes: buf.length, ms: Date.now() - t0 };
  }
  throw new Error(`Too many redirects starting at ${url}`);
}

async function fetchSmall(url, timeoutMs = 15000) {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    return { status: res.status, finalUrl: res.url, text };
  } catch (e) {
    return { status: null, error: String(e.message || e) };
  }
}

async function checkRobotsAndSitemap(pageUrl) {
  const u = new URL(pageUrl);
  const robotsUrl = `${u.origin}/robots.txt`;
  const robots = await fetchSmall(robotsUrl);
  const out = { robots_url: robotsUrl, robots_status: robots.status, sitemaps_declared: [], blocks_everything_for_all_agents: false, rules_matching_this_path: [] };
  if (robots.status === 200 && robots.text && !/<html/i.test(robots.text.slice(0, 500))) {
    let agents = [];
    let lastWasAgent = false;
    for (const raw of robots.text.split(/\r?\n/)) {
      const line = raw.replace(/#.*/, '').trim();
      const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
      if (!m) continue;
      const key = m[1].toLowerCase();
      const val = m[2].trim();
      if (key === 'sitemap') { out.sitemaps_declared.push(val); continue; }
      if (key === 'user-agent') {
        agents = lastWasAgent ? [...agents, val] : [val];
        lastWasAgent = true;
        continue;
      }
      lastWasAgent = false;
      if (!agents.includes('*')) continue;
      if (key === 'disallow' && val === '/') out.blocks_everything_for_all_agents = true;
      if ((key === 'disallow' || key === 'allow') && val) {
        const prefix = val.replace(/\*.*$/, '').replace(/\$$/, '');
        if (u.pathname.startsWith(prefix)) out.rules_matching_this_path.push(`${key}: ${val}`);
      }
    }
  }
  const sitemapUrl = out.sitemaps_declared[0] || `${u.origin}/sitemap.xml`;
  const sm = await fetchSmall(sitemapUrl);
  out.sitemap_url_checked = sitemapUrl;
  out.sitemap_status = sm.status;
  if (sm.status === 200 && sm.text) {
    const isIndex = /<sitemapindex/i.test(sm.text);
    out.sitemap_is_index = isIndex;
    const target = pageUrl.replace(/\/$/, '');
    out.page_listed_in_sitemap = isIndex ? 'unknown (sitemap index; child sitemaps not checked)' : sm.text.includes(target);
  }
  return out;
}

async function checkHttpsRedirect(pageUrl) {
  const u = new URL(pageUrl);
  if (u.protocol !== 'https:') return { checked: false, note: 'page is not served over https' };
  try {
    const res = await fetch(`http://${u.host}/`, { redirect: 'manual', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(10000) });
    const loc = res.headers.get('location') || '';
    return { checked: true, status: res.status, redirects_to_https: res.status >= 300 && res.status < 400 && loc.startsWith('https://') };
  } catch (e) {
    return { checked: false, error: String(e.message || e) };
  }
}

// ---------- PageSpeed Insights ----------
function sampleItem(it) {
  const s = it?.node?.snippet || it?.node?.selector || it?.url || it?.source?.url || it?.label || it?.entity || null;
  return truncate(typeof s === 'string' ? s : JSON.stringify(it ?? {}), 160);
}
async function runPsi(url) {
  const key = process.env.PSI_API_KEY || process.env.PAGESPEED_API_KEY;
  const q = new URLSearchParams({ url, strategy: 'mobile' });
  for (const c of ['PERFORMANCE', 'ACCESSIBILITY', 'BEST_PRACTICES', 'SEO']) q.append('category', c);
  if (key) q.set('key', key);
  let res;
  try {
    res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`, { signal: AbortSignal.timeout(150000) });
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: truncate(await res.text(), 300),
      hint: res.status === 429
        ? (key ? 'Your PSI_API_KEY quota is exhausted. Retry later.' : 'Google\'s shared keyless quota is exhausted (common). Set PSI_API_KEY to a free key: https://developers.google.com/speed/docs/insights/v5/get-started')
        : undefined,
    };
  }
  const j = await res.json();
  const lh = j.lighthouseResult || {};
  const scores = {};
  for (const [k, c] of Object.entries(lh.categories || {})) scores[k] = c.score == null ? null : Math.round(c.score * 100);
  const lab = {};
  for (const id of ['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift', 'speed-index']) {
    const a = lh.audits?.[id];
    if (a) lab[id] = { value: a.displayValue, score: a.score };
  }
  const exp = j.loadingExperience?.metrics ? j.loadingExperience : j.originLoadingExperience;
  let field = null;
  if (exp?.metrics) {
    field = { scope: exp === j.loadingExperience && !exp.origin_fallback ? 'this URL' : 'whole origin', overall: exp.overall_category, metrics: {} };
    for (const [k, v] of Object.entries(exp.metrics)) field.metrics[k] = { p75: v.percentile, category: v.category };
  }
  const failing = [];
  for (const [catId, cat] of Object.entries(lh.categories || {})) {
    for (const ref of cat.auditRefs || []) {
      if (ref.group === 'metrics') continue;
      const a = lh.audits?.[ref.id];
      if (!a || ['notApplicable', 'manual', 'informative', 'error'].includes(a.scoreDisplayMode)) continue;
      if (a.score === null || a.score >= 0.9) continue;
      const items = a.details?.items || [];
      failing.push({
        category: catId,
        id: a.id,
        title: a.title,
        score: a.score,
        weight: ref.weight,
        display_value: a.displayValue,
        savings_ms: a.details?.overallSavingsMs ?? a.metricSavings?.LCP ?? undefined,
        items_count: items.length,
        examples: items.slice(0, 3).map(sampleItem),
      });
    }
  }
  failing.sort((a, b) => a.category.localeCompare(b.category) || (b.weight || 0) - (a.weight || 0) || a.score - b.score);
  return {
    ok: true,
    strategy: 'mobile',
    tested_url: lh.finalDisplayedUrl || lh.finalUrl || url,
    lighthouse_version: lh.lighthouseVersion,
    fetched_at: lh.fetchTime,
    scores,
    lab_metrics: lab,
    field_data: field,
    failing_audits: failing.slice(0, 45),
  };
}

// ---------- extraction ----------
const GENERIC_ANCHORS = /^(click here|here|read more|learn more|more|link|this|go|details|continue)$/i;
const CTA_CLASS = /\b(btn|button|cta)\b/i;
// Link/button wording that signals a call to action even when CSS classes are hashed.
const ACTION_TEXT = /^(get|start|try|book|request|schedule|sign ?up|sign in to start|join|buy|shop|order|download|install|contact|talk to|chat with|subscribe|register|claim|apply|see (pricing|plans|a demo)|view (pricing|plans)|learn more|watch( the)? demo|create|upgrade|reserve|call)\b/i;
const isActionText = (t = '') => t.length <= 45 && ACTION_TEXT.test(t.trim());
// Interface controls that are not marketing calls to action.
const UI_CONTROL = /^(open|close|toggle|show|hide|expand|collapse)?\s*(the\s)?(main\s)?(menu|nav(igation)?|search|play( video)?|pause( video)?|mute|unmute|next( slide)?|prev(ious)?( slide)?|close|dismiss|back|skip|submenu|dropdown|×|✕|x)$/i;
const VAGUE_WORDS = [
  'solution', 'solutions', 'seamless', 'seamlessly', 'innovative', 'leverage', 'next-generation', 'next-gen', 'world-class',
  'cutting-edge', 'best-in-class', 'empower', 'empowering', 'synergy', 'robust', 'revolutionary', 'game-changing', 'game-changer',
  'holistic', 'state-of-the-art', 'unlock', 'transform', 'streamline', 'end-to-end', 'one-stop', 'disruptive', 'scalable',
];
const SIGNALS = {
  testimonials: /\b(testimonials?|what (our )?(customers|clients|users) say|loved by)\b/i,
  reviews_ratings: /\b(reviews?|rated|ratings?|stars?|★|g2|capterra|trustpilot)\b/i,
  social_proof_logos: /\b(trusted by|used by|as seen (in|on)|featured (in|on)|customers include|clients include|join(ed)? [\d,.]+\+? )\b/i,
  case_studies: /\b(case stud(y|ies)|success stor(y|ies))\b/i,
  guarantee_risk_reversal: /\b(guarantee[d]?|money[- ]back|refund|risk[- ]free|cancel anytime|no credit card)\b/i,
  free_trial_or_demo: /\b(free trial|try (it )?(for )?free|start free|book a demo|request a demo|get a demo|free consultation)\b/i,
  pricing_mentioned: /(\bpricing\b|\bprice[sd]?\b|[$€£₹]\s?\d)/i,
  security_compliance: /\b(secure|ssl|encrypt(ed|ion)|gdpr|soc ?2|hipaa|iso ?27001|pci)\b/i,
  awards_certifications: /\b(award|certified|accredited|winner|#1)\b/i,
  faq: /\b(faq|frequently asked|questions\?)\b/i,
  urgency_scarcity: /\b(limited time|only \d+ left|ends (soon|today)|hurry|today only|spots left)\b/i,
  phone_number: /(\+?\d[\d\s().-]{8,}\d)/,
  email_address: /\b[\w.+-]+@[\w-]+\.[\w.]+\b/,
  physical_address: /\b\d{1,5}\s+\w+(\s\w+)*\s(street|st\.|avenue|ave\.|road|rd\.|boulevard|blvd|lane|suite)\b/i,
};

function extract(html, baseUrl, fetchMeta) {
  const site = new URL(baseUrl);
  const src = html.replace(/<!--[\s\S]*?-->/g, '');
  const headMatch = src.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i);
  const head = headMatch ? headMatch[1] : src;

  // scripts (before stripping)
  const scriptPairs = pairs(src, 'script');
  const jsonLd = [];
  for (const s of scriptPairs.filter((s) => /ld\+json/i.test(s.attrs.type || ''))) {
    try {
      const parsed = JSON.parse(s.inner.trim());
      const nodes = Array.isArray(parsed) ? parsed : parsed['@graph'] ? parsed['@graph'] : [parsed];
      for (const n of nodes) jsonLd.push({ type: n?.['@type'] ?? null, name: n?.name ?? n?.headline ?? null });
    } catch (e) {
      jsonLd.push({ type: null, error: 'invalid JSON-LD: ' + truncate(String(e.message), 80) });
    }
  }
  const headScriptPairs = pairs(head, 'script');
  const externalScripts = scriptPairs.filter((s) => s.attrs.src).map((s) => ({ ...s.attrs, src: resolveUrl(s.attrs.src, baseUrl) }));
  const renderBlocking = headScriptPairs
    .filter((s) => s.attrs.src && !('async' in s.attrs) && !('defer' in s.attrs) && (s.attrs.type || '').toLowerCase() !== 'module')
    .map((s) => resolveUrl(s.attrs.src, baseUrl));
  const inlineScripts = scriptPairs.filter((s) => !s.attrs.src && !/ld\+json/i.test(s.attrs.type || ''));
  const thirdPartyHosts = [...new Set(
    externalScripts.map((s) => { try { return new URL(s.src).hostname; } catch { return null; } })
      .filter((h) => h && siteKey(h) !== siteKey(site.hostname)),
  )];

  // strip non-visible blocks
  const stripped = src
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<template\b[^>]*>[\s\S]*?<\/template\s*>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg\s*>/gi, ' ');
  const bodyMatch = stripped.match(/<body\b[^>]*>([\s\S]*)(<\/body\s*>|$)/i);
  const body = bodyMatch ? bodyMatch[1] : stripped;

  // head meta
  const metas = tags(head, 'meta');
  const metaBy = (k, v) => metas.find((m) => (m[k] || '').toLowerCase() === v)?.content ?? null;
  const og = {};
  const twitter = {};
  for (const m of metas) {
    const p = (m.property || m.name || '').toLowerCase();
    if (p.startsWith('og:')) og[p] = m.content ?? '';
    if (p.startsWith('twitter:')) twitter[p] = m.content ?? '';
  }
  const linkTags = tags(head, 'link');
  const relHas = (l, r) => (l.rel || '').toLowerCase().split(/\s+/).includes(r);
  const titleTag = pairs(head, 'title')[0];
  const title = titleTag ? clean(titleTag.inner) : null;
  const htmlTag = tags(src, 'html')[0] || {};

  // headings
  const headings = [];
  const hre = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi;
  let hm;
  while ((hm = hre.exec(body))) headings.push({ level: +hm[1], text: truncate(clean(hm[2]), 200) });
  const skips = [];
  for (let i = 1; i < headings.length; i++) {
    if (headings[i].level > headings[i - 1].level + 1) skips.push(`h${headings[i - 1].level} → h${headings[i].level} before "${truncate(headings[i].text, 60)}"`);
  }

  // anchors
  const anchors = pairs(body, 'a').map(({ attrs, inner }) => {
    const imgAlt = tags(inner, 'img').map((i) => i.alt).filter(Boolean).join(' ');
    const text = clean(inner) || imgAlt || attrs['aria-label'] || attrs.title || '';
    const raw = attrs.href ?? null;
    let kind = 'internal';
    let abs = null;
    if (raw == null) kind = 'no-href';
    else if (/^mailto:/i.test(raw)) kind = 'mailto';
    else if (/^tel:/i.test(raw)) kind = 'tel';
    else if (/^javascript:/i.test(raw)) kind = 'javascript';
    else if (/^#/.test(raw)) kind = 'same-page';
    else {
      abs = resolveUrl(raw, baseUrl);
      try { kind = abs && siteKey(new URL(abs).hostname) === siteKey(site.hostname) ? 'internal' : 'external'; } catch { kind = 'invalid'; }
    }
    const isCta = CTA_CLASS.test(attrs.class || '') || (attrs.role || '') === 'button' || (isActionText(text) && kind !== 'same-page' && kind !== 'no-href');
    return { text: truncate(text, 120), href: abs || raw, kind, rel: attrs.rel || null, target: attrs.target || null, is_cta_styled: isCta };
  });
  const socialHosts = /(facebook|twitter|x|linkedin|instagram|youtube|tiktok|pinterest|github|threads)\.com$/i;
  const social = [...new Set(anchors.filter((a) => a.kind === 'external').map((a) => { try { return new URL(a.href).hostname.replace(/^www\./, ''); } catch { return null; } }).filter((h) => h && socialHosts.test(h)))];

  // images
  const images = tags(body, 'img').map((a) => ({
    src: truncate(resolveUrl(a.src || a['data-src'] || '', baseUrl) || '', 200),
    alt: 'alt' in a ? a.alt : null,
    has_dimensions: !!(a.width && a.height),
    loading: a.loading || null,
    has_srcset: !!(a.srcset || a['data-srcset']),
  }));

  // CTAs
  const ctas = [];
  let uiControls = 0;
  for (const b of pairs(body, 'button')) {
    const t = clean(b.inner) || b.attrs['aria-label'] || '';
    if (!t) continue;
    const isDisclosure = 'aria-expanded' in b.attrs || 'aria-haspopup' in b.attrs || 'aria-controls' in b.attrs;
    if (!isActionText(t) && (isDisclosure || UI_CONTROL.test(t) || /cookie/i.test(t))) { uiControls++; continue; }
    ctas.push({ text: truncate(t, 80), element: 'button' });
  }
  for (const i of tags(body, 'input')) {
    const ty = (i.type || '').toLowerCase();
    if ((ty === 'submit' || ty === 'button') && i.value) ctas.push({ text: truncate(i.value, 80), element: `input[${ty}]` });
  }
  for (const a of anchors) if (a.is_cta_styled && a.text) ctas.push({ text: a.text, element: 'a.button', href: a.href });
  const ctaCounts = {};
  for (const c of ctas) ctaCounts[c.text.toLowerCase()] = (ctaCounts[c.text.toLowerCase()] || 0) + 1;

  // forms
  const labelFors = new Set(tags(body, 'label').map((l) => l.for).filter(Boolean));
  const wrappedNames = new Set();
  for (const l of pairs(body, 'label')) for (const i of [...tags(l.inner, 'input'), ...tags(l.inner, 'select'), ...tags(l.inner, 'textarea')]) wrappedNames.add(i.name || i.id || '__wrapped__');
  const fieldInfo = (a, tag) => {
    const type = tag === 'input' ? (a.type || 'text').toLowerCase() : tag;
    return {
      type,
      name: a.name || a.id || null,
      required: 'required' in a || a['aria-required'] === 'true',
      placeholder: a.placeholder || null,
      has_label: !!(a['aria-label'] || a['aria-labelledby'] || (a.id && labelFors.has(a.id)) || wrappedNames.has(a.name || a.id || '__none__')),
    };
  };
  const collectFields = (html) => [
    ...tags(html, 'input').filter((a) => !['hidden', 'submit', 'button', 'image', 'reset'].includes((a.type || '').toLowerCase())).map((a) => fieldInfo(a, 'input')),
    ...tags(html, 'select').map((a) => fieldInfo(a, 'select')),
    ...tags(html, 'textarea').map((a) => fieldInfo(a, 'textarea')),
  ];
  const forms = pairs(body, 'form').map(({ attrs, inner }) => {
    const fields = collectFields(inner);
    const submit = [...pairs(inner, 'button').map((b) => clean(b.inner)), ...tags(inner, 'input').filter((i) => (i.type || '').toLowerCase() === 'submit').map((i) => i.value || 'Submit')].filter(Boolean);
    return {
      action: attrs.action || null,
      method: (attrs.method || 'get').toLowerCase(),
      field_count: fields.length,
      required_count: fields.filter((f) => f.required).length,
      unlabeled_count: fields.filter((f) => !f.has_label).length,
      fields,
      submit_text: submit[0] || null,
    };
  });
  const allFields = collectFields(body);

  // visible text with markers
  const toText = (html) => {
    let t = html
      .replace(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, (m, h, inner) => `\n\n${'#'.repeat(+h[1])} ${clean(inner)}\n\n`)
      .replace(/<button\b[^>]*>([\s\S]*?)<\/button\s*>/gi, (m, inner) => { const x = clean(inner); return x ? ` [BUTTON: ${x}] ` : ' '; })
      .replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (m, a, inner) => {
        const at = parseAttrs(a);
        const x = clean(inner);
        if (!x) return ' ';
        return CTA_CLASS.test(at.class || '') || at.role === 'button' || isActionText(x) ? ` [CTA LINK: ${x}] ` : ` ${x} `;
      })
      .replace(/<input\b([^>]*)>/gi, (m, a) => {
        const at = parseAttrs(a);
        const ty = (at.type || 'text').toLowerCase();
        if (ty === 'hidden') return ' ';
        if (ty === 'submit' || ty === 'button') return at.value ? ` [BUTTON: ${at.value}] ` : ' ';
        return ` [FIELD ${ty}: ${at.placeholder || at['aria-label'] || at.name || ''}] `;
      })
      .replace(/<select\b([^>]*)>[\s\S]*?<\/select\s*>/gi, (m, a) => { const at = parseAttrs(a); return ` [FIELD select: ${at['aria-label'] || at.name || ''}] `; })
      .replace(/<textarea\b([^>]*)>[\s\S]*?<\/textarea\s*>/gi, (m, a) => { const at = parseAttrs(a); return ` [FIELD textarea: ${at.placeholder || at['aria-label'] || at.name || ''}] `; })
      .replace(/<img\b([^>]*)>/gi, (m, a) => { const at = parseAttrs(a); return at.alt ? ` [IMG: ${at.alt}] ` : ' '; })
      .replace(/<(br|hr)\b[^>]*>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n- ')
      .replace(/<\/(p|div|section|article|header|footer|nav|main|aside|li|ul|ol|tr|table|form|blockquote|figure|figcaption|dd|dt)\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');
    return decode(t).replace(/[ \t\f\v ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  };
  const fullText = toText(body);
  const withoutNav = toText(body.replace(/<nav\b[^>]*>[\s\S]*?<\/nav\s*>/gi, ' '));
  const firstScreenWords = withoutNav.split(/\s+/).slice(0, 130).join(' ');
  const plain = fullText.replace(/\[(BUTTON|CTA LINK|FIELD[^\]:]*|IMG):[^\]]*\]/g, ' ').replace(/^#+ /gm, '');
  const words = plain.split(/\s+/).filter((w) => /\w/.test(w));
  const lower = plain.toLowerCase();

  const youCount = countMatches(lower, /\b(you|your|you're|yours|yourself)\b/g);
  const weCount = countMatches(lower, /\b(we|our|us|we're|ours|ourselves)\b/g);
  const vague = {};
  for (const w of VAGUE_WORDS) {
    const n = countMatches(lower, new RegExp(`\\b${w.replace(/-/g, '[- ]')}\\b`, 'g'));
    if (n) vague[w] = n;
  }
  const signals = {};
  for (const [k, re] of Object.entries(SIGNALS)) {
    const n = countMatches(plain, new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'));
    if (n) signals[k] = { count: n, sample: snippetAround(plain, new RegExp(re.source, re.flags.replace('g', ''))) };
  }
  const stats = [...new Set((plain.match(/\b\d[\d,.]*\s?(%|\+|x\b|k\b|m\b|million|billion|customers|users|companies|teams|businesses|reviews|countries|hours|minutes|days)/gi) || []).map((s) => s.trim()))].slice(0, 15);

  // warnings
  const warnings = [];
  if (fetchMeta.status && fetchMeta.status >= 400) warnings.push(`HTTP ${fetchMeta.status}: the page did not load normally. Findings may describe an error page.`);
  if (words.length < 120 && (externalScripts.length >= 3 || /id=["'](root|app|__next|__nuxt|svelte)["']/i.test(src))) {
    warnings.push('LIKELY_CLIENT_RENDERED: very little text in the served HTML. This site probably renders content with JavaScript, so text-based findings are unreliable. Rerun with a browser MCP (e.g. Playwright) or audit a server-rendered page.');
  }
  if (/(cf-chl|captcha|just a moment\.\.\.|attention required|access denied|are you a robot)/i.test(src) && words.length < 250) {
    warnings.push('BOT_CHALLENGE: the server returned a bot check or block page instead of the real content.');
  }
  const robotsMeta = metaBy('name', 'robots');
  const xRobots = fetchMeta.headers?.['x-robots-tag'] || null;
  if (/noindex/i.test(robotsMeta || '') || /noindex/i.test(xRobots || '')) warnings.push('NOINDEX: this page tells search engines not to index it.');

  return {
    page: {
      url: baseUrl,
      title,
      title_length: title ? title.length : 0,
      meta_description: metaBy('name', 'description'),
      meta_description_length: (metaBy('name', 'description') || '').length,
      meta_robots: robotsMeta,
      canonical: linkTags.find((l) => relHas(l, 'canonical'))?.href ?? null,
      lang: htmlTag.lang || null,
      viewport: metaBy('name', 'viewport'),
      charset: metas.find((m) => m.charset)?.charset ?? null,
      has_doctype: /^\s*<!doctype html/i.test(html),
      favicon: !!linkTags.find((l) => relHas(l, 'icon')),
      hreflang: linkTags.filter((l) => relHas(l, 'alternate') && l.hreflang).map((l) => ({ hreflang: l.hreflang, href: l.href })),
      open_graph: og,
      twitter_card: twitter,
      structured_data: jsonLd,
    },
    content: {
      word_count: words.length,
      headings,
      h1_count: headings.filter((h) => h.level === 1).length,
      heading_level_skips: skips,
      first_screen_text: firstScreenWords,
      first_screen_note: 'Approximation: the first ~130 words of visible text with <nav> removed. True above-the-fold depends on layout and screen size.',
      you_vs_we: { you: youCount, we: weCount },
      vague_words: vague,
      stats_and_numbers: stats,
      signals,
    },
    ctas: { all: ctas.slice(0, 60), distinct_count: Object.keys(ctaCounts).length, counts: ctaCounts, ui_controls_excluded: uiControls },
    links: {
      total: anchors.length,
      internal: anchors.filter((a) => a.kind === 'internal').length,
      external: anchors.filter((a) => a.kind === 'external').length,
      generic_anchor_text: anchors.filter((a) => GENERIC_ANCHORS.test(a.text)).map((a) => ({ text: a.text, href: a.href })).slice(0, 20),
      empty_anchor_text: anchors.filter((a) => !a.text && a.kind !== 'no-href').length,
      nofollow: anchors.filter((a) => /nofollow/i.test(a.rel || '')).length,
      social_profiles: social,
      has_privacy_link: anchors.some((a) => /privacy/i.test(`${a.text} ${a.href}`)),
      has_terms_link: anchors.some((a) => /\bterms\b/i.test(`${a.text} ${a.href}`)),
      contact_links: anchors.filter((a) => a.kind === 'mailto' || a.kind === 'tel' || /contact/i.test(`${a.text} ${a.href}`)).map((a) => a.href).slice(0, 10),
      sample: anchors.slice(0, 120),
    },
    images: {
      total: images.length,
      missing_alt: images.filter((i) => i.alt === null).length,
      empty_alt: images.filter((i) => i.alt === '').length,
      missing_dimensions: images.filter((i) => !i.has_dimensions).length,
      lazy_loaded: images.filter((i) => i.loading === 'lazy').length,
      with_srcset: images.filter((i) => i.has_srcset).length,
      missing_alt_examples: images.filter((i) => i.alt === null).slice(0, 8).map((i) => i.src),
      list: images.slice(0, 60),
    },
    forms: { count: forms.length, forms, fields_on_page: allFields.length, unlabeled_fields_on_page: allFields.filter((f) => !f.has_label).length },
    resources: {
      html_bytes: fetchMeta.bytes,
      external_scripts: externalScripts.length,
      inline_scripts: inlineScripts.length,
      inline_script_bytes: inlineScripts.reduce((n, s) => n + s.inner.length, 0),
      render_blocking_scripts: renderBlocking,
      third_party_script_hosts: thirdPartyHosts,
      stylesheets: linkTags.filter((l) => relHas(l, 'stylesheet')).length,
      preloads: linkTags.filter((l) => relHas(l, 'preload') || relHas(l, 'preconnect')).length,
      iframes: tags(body, 'iframe').map((f) => { try { return new URL(f.src, baseUrl).hostname; } catch { return f.src || null; } }),
      videos: tags(body, 'video').length,
    },
    warnings,
    _text: fullText,
  };
}

// ---------- main ----------
async function main() {
  await mkdir(outDir, { recursive: true });
  const isFile = !/^https?:\/\//i.test(input) && existsSync(input);
  let html;
  let baseUrl;
  let fetchMeta;

  if (isFile) {
    html = await readFile(input, 'utf8');
    baseUrl = 'https://fixture.local/';
    fetchMeta = { source: 'local file', file: path.resolve(input), status: 200, bytes: Buffer.byteLength(html), headers: {} };
  } else {
    const url = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    let r;
    try {
      r = await fetchWithChain(url);
    } catch (e) {
      const err = { ok: false, input: url, error: String(e.message || e), hint: 'Check the URL, or the site may block automated requests.' };
      await writeFile(path.join(outDir, 'page.json'), JSON.stringify(err, null, 2));
      console.log(JSON.stringify(err, null, 2));
      process.exit(1);
    }
    html = r.text;
    baseUrl = r.finalUrl;
    const keep = ['content-type', 'content-encoding', 'cache-control', 'server', 'x-robots-tag', 'strict-transport-security', 'content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy'];
    const headers = {};
    for (const k of keep) { const v = r.headers.get(k); if (v) headers[k] = truncate(v, 200); }
    fetchMeta = { source: 'http', requested_url: url, final_url: r.finalUrl, status: r.status, redirect_chain: r.chain, response_ms: r.ms, bytes: r.bytes, headers };
  }

  const facts = extract(html, baseUrl, fetchMeta);
  const text = facts._text;
  delete facts._text;

  const [site, https] = isFile ? [null, null] : await Promise.all([checkRobotsAndSitemap(baseUrl), checkHttpsRedirect(baseUrl)]);
  if (site?.blocks_everything_for_all_agents) facts.warnings.push('ROBOTS_BLOCKS_ALL: robots.txt disallows the whole site for all crawlers.');

  const result = { collector_version: VERSION, collected_at: new Date().toISOString(), fetch: fetchMeta, site: site ? { ...site, http_to_https: https } : null, ...facts };
  await writeFile(path.join(outDir, 'page.html'), html);
  await writeFile(path.join(outDir, 'page.json'), JSON.stringify(result, null, 2));
  await writeFile(path.join(outDir, 'page.txt'), text.length > 60000 ? text.slice(0, 60000) + '\n\n[truncated]' : text);

  let psi = null;
  if (runPsiFlag && !isFile) {
    psi = await runPsi(baseUrl);
    await writeFile(path.join(outDir, 'psi.json'), JSON.stringify(psi, null, 2));
  }

  console.log(JSON.stringify({
    ok: true,
    out_dir: outDir,
    url: baseUrl,
    status: fetchMeta.status,
    title: facts.page.title,
    word_count: facts.content.word_count,
    headings: facts.content.headings.length,
    ctas: facts.ctas.distinct_count,
    forms: facts.forms.count,
    images: facts.images.total,
    psi: psi ? (psi.ok ? psi.scores : { error: psi.status || psi.error, hint: psi.hint }) : 'skipped',
    warnings: facts.warnings,
  }, null, 2));
}

main().catch((e) => {
  console.error('site-audit collector failed:', e?.stack || e);
  process.exit(1);
});
