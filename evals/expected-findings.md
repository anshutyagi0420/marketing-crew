# Eval: planted-issues.html

`fixtures/planted-issues.html` is a fake B2B homepage with deliberately planted problems. A good audit catches all of the **must-catch** items and invents none of the **must-not-claim** ones.

## How to run

**Collector only (deterministic):**

```bash
node plugins/site-audit/scripts/collect.mjs evals/fixtures/planted-issues.html ./tmp-eval
```

Then check the values in `tmp-eval/page.json` against the "Collector" column below.

**Full audit** (needs Claude Code with the plugin installed):

```
/site-audit:audit evals/fixtures/planted-issues.html
```

The collector accepts local file paths, and PageSpeed is skipped automatically for files.

## Must catch

| # | Planted issue | Area | Collector evidence |
|---|---|---|---|
| 1 | Vague H1 ("Innovative Solutions for the Next-Generation Enterprise") fails the 5-second test | Messaging | `content.headings[0]` |
| 2 | Jargon-heavy copy (14+ vague words) | Messaging | `content.vague_words` |
| 3 | Company-centric copy: 0 "you" vs 13 "we" | Messaging | `content.you_vs_we` |
| 4 | Headings read like a site map ("About Us", "Contact Us") | Messaging | `content.headings` |
| 5 | Four competing CTAs in the first screen (Learn More, Book a Demo, See Pricing, Get Started), plus Sign up in the nav | Conversion | `ctas.counts` |
| 6 | 9-field form, 7 required, including phone, job title and company size | Conversion | `forms.forms[0]` |
| 7 | Generic "Submit" button | Conversion | `forms.forms[0].submit_text` |
| 8 | No testimonials, logos, numbers or guarantee | Conversion | `content.signals` is `{}` |
| 9 | No privacy link near a form that collects personal data | Conversion | `links.has_privacy_link: false` |
| 10 | Title is just "Home" | SEO | `page.title` |
| 11 | No meta description | SEO | `page.meta_description: null` |
| 12 | Two H1s, and an h1 → h4 skip | SEO | `content.h1_count: 2`, `heading_level_skips` |
| 13 | Generic anchors ("click here", "read more", "Learn More") | SEO | `links.generic_anchor_text` |
| 14 | No canonical, no Open Graph tags, no structured data | SEO | `page.canonical`, `page.open_graph`, `page.structured_data` |
| 15 | No `lang` attribute | SEO / Technical | `page.lang: null` |
| 16 | No viewport meta tag, so the page isn't mobile-ready | Technical | `page.viewport: null` |
| 17 | 3 images without alt text, none with width/height | Technical | `images.missing_alt: 3`, `images.missing_dimensions: 4` |
| 18 | 9 form fields with placeholder-only labels | Technical | `forms.forms[0].unlabeled_count: 9` |
| 19 | 2 render-blocking scripts in the head, one of them third-party | Technical | `resources.render_blocking_scripts` |

## Must not claim

- Anything about colors, contrast or visual layout (there's no PSI for a local file, and the agents can't see the page)
- Page speed numbers (there's no PSI for a local file)
- Fabricated proof, e.g. "add your 10,000 customers" (rewrites must use placeholders)
- That the site is blocked from indexing (it isn't)
