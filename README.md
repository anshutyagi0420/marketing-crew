# marketing-crew

**Open-source AI marketing agents for [Claude Code](https://code.claude.com).** Practical tools that do real marketing work, not demos.

The first tool is **site-audit**.

---

## site-audit

**Give it a URL. Get back the report a good marketing consultant would charge you for.**

```
/site-audit:audit https://yoursite.com
```

A team of AI specialists reviews the page in parallel, and an editor merges their work into one prioritized report:

| Agent | What it checks |
|---|---|
| **Messaging** | The 5-second test, value proposition, vague claims, "we" vs "you" language, headline rewrites |
| **Conversion** | CTAs, form friction, trust and social proof, risk reversal, distractions |
| **SEO** | Indexability, title and meta tags, headings, structured data, internal links, social previews |
| **Technical** | Core Web Vitals (via Google PageSpeed Insights), accessibility, mobile, HTTPS basics |
| **Competitors** (optional) | Table-stakes claims, real differentiators, gaps, an ownable positioning angle |
| **Editor** | Deduplicates, ranks by impact ÷ effort, writes the final report |

### What you get

`site-audit-reports/<site>-<date>/REPORT.md` contains:

- **A verdict:** three sentences on what works, what's broken and what fixing it is worth
- **A scorecard** across messaging, conversion, SEO, technical and competitive
- **The top 10 fixes, ranked.** Each one has evidence quoted from your page, why it matters, and exactly what to do.
- **Quick wins:** a checklist of fixes that each take under an hour
- **Copy you can paste:** new headline, subheadline, CTA, title tag and meta description options
- **All raw data** (`page.json`, `psi.json`, `findings/*.json`), so you can check every claim

> 📸 _Add a screenshot or GIF of a real report here. See [examples/](examples/)._

### Why it's different

- **Evidence-based.** Every finding must quote your page or cite a measured value. No generic "consider improving your SEO" filler.
- **Near-zero setup.** No accounts or paid SEO tools. You need Claude Code and Node 18+. A free Google key (optional) unlocks the speed data.
- **Read-only and safe.** It fetches the public pages you name and nothing else. It never submits forms or crawls your site.
- **Copy, not just criticism.** Every copy problem comes with rewrites you can ship today.

---

## Install

In Claude Code:

```
/plugin marketplace add anshutyagi0420/marketing-crew
/plugin install site-audit@marketing-crew
```

Or from your terminal:

```bash
claude plugin marketplace add anshutyagi0420/marketing-crew
```

```bash
claude plugin install site-audit@marketing-crew
```

**Requirements:** Claude Code and [Node.js 18+](https://nodejs.org) (used by the zero-dependency page collector). Check with `node --version`.

## Usage

```
/site-audit:audit https://yoursite.com
/site-audit:audit https://yoursite.com/pricing https://competitor-a.com/pricing https://competitor-b.com/pricing
/site-audit:audit https://yoursite.com --quick
```

You can also just ask: *"audit the landing page at example.com and compare it to competitor.com"*.

| Option | Effect |
|---|---|
| Extra URLs | Treated as competitors (up to 3) |
| `--quick` | Skips PageSpeed Insights and competitors, for a faster audit focused on copy |

### Sharper results: tell it about your business (optional)

Copy [`plugins/site-audit/templates/context.md`](plugins/site-audit/templates/context.md) to `site-audit.context.md` in the folder where you run Claude Code, then fill in your goal, audience, offer and proof. Without it, the agents infer these and list their assumptions in the report.

### Performance data: add a free Google key

Core Web Vitals and Lighthouse scores come from Google's free PageSpeed Insights API. Requests without a key share a global daily quota that is almost always exhausted (in testing, keyless calls failed on every attempt), so in practice you need a key for speed data. Without one, the audit continues on HTML-based checks only and tells you so. For reliable results, [get a free API key](https://developers.google.com/speed/docs/insights/v5/get-started) (about 2 minutes) and set it:

```bash
export PSI_API_KEY=your-key
```

On Windows PowerShell, use `$env:PSI_API_KEY="your-key"` instead.

Note that PageSpeed Insights sends the page URL to Google so Google can test it.

## How it works

```
/site-audit:audit <url>
        │
        ▼
 collect.mjs ── fetches HTML, robots.txt, sitemap, PageSpeed Insights
        │        → page.json (facts) · page.txt (readable text) · psi.json
        ▼
 ┌──────────┬────────────┬─────────┬───────────┬─────────────┐
 │messaging │ conversion │   seo   │ technical │ competitor  │   (in parallel)
 └────┬─────┴─────┬──────┴────┬────┴─────┬─────┴──────┬──────┘
      └───────────┴── findings/*.json ───┴────────────┘
                          │
                          ▼
                    report-editor ── dedupe · rank by impact/effort · write
                          │
                          ▼
                      REPORT.md
```

- The **collector** (`scripts/collect.mjs`) is deterministic. It does the fetching and parsing so the agents spend their effort on judgement, not on scraping.
- All agents write to one **shared findings format** (`references/findings-format.md`). Each finding carries evidence, severity, impact, effort and confidence, and that is what makes the final ranking meaningful.

### Repository layout

```
.claude-plugin/marketplace.json     # makes this repo installable as a marketplace
plugins/site-audit/
  .claude-plugin/plugin.json
  skills/audit/SKILL.md             # the orchestrator (/site-audit:audit)
  agents/                           # messaging, conversion, seo, technical, competitor, editor
  scripts/collect.mjs               # zero-dependency page collector
  references/findings-format.md     # the contract between agents
  templates/                        # report template, owner context template
evals/                              # test page with planted issues and the expected findings
```

## Limitations

- **One page per run.** It audits the URLs you give it, not the whole site.
- **No JavaScript rendering.** Sites that render content client-side (some React/Vue single-page apps) return little text. The report warns you when this happens.
- **No visual analysis.** It reads the page's content and structure, not its colors or layout. Contrast issues come from Lighthouse.
- **No private data.** It has no access to your analytics, Search Console, backlinks or rankings.

## Roadmap

- [ ] Optional browser rendering (Playwright MCP) for JavaScript-heavy sites
- [ ] Multi-page audits (homepage, pricing, signup flow)
- [ ] Before/after comparison between two audit runs
- [ ] `customer-voice`: mine reviews and support tickets for the language your customers use
- [ ] `repurpose`: voice-matched content repurposing

## Contributing

Issues and pull requests are welcome, especially:
- **Eval cases.** Add a page with planted issues to `evals/fixtures/` and list them in `evals/expected-findings.md`.
- **False positives or negatives** you hit on real sites. Include the URL and what went wrong.
- **Sharper checks** in the agent prompts.

Before opening a pull request, run the collector on the fixture:

```bash
node plugins/site-audit/scripts/collect.mjs evals/fixtures/planted-issues.html ./tmp-eval
```

## License

[MIT](LICENSE)
