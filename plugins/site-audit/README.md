# site-audit

A team of AI agents that audits any web page and returns a prioritized fix list with ready-to-paste copy.

```
/site-audit:audit https://yoursite.com [competitor-url ...] [--quick]
```

Five specialists review the page in parallel, and an editor merges their findings into one report ranked by impact ÷ effort. The specialists cover:
- messaging (the 5-second test, value proposition, copy rewrites)
- conversion (CTAs, forms, trust, risk reversal)
- SEO (indexability, title and meta, headings, structured data)
- technical (Core Web Vitals via PageSpeed Insights, accessibility, mobile)
- competitors (optional)

Every finding must quote the page or cite a measured value.

The output is `site-audit-reports/<site>-<date>/REPORT.md`, containing:
- a verdict
- a scorecard
- the top 10 fixes
- quick wins
- copy you can paste
- a competitor comparison

All the raw data sits next to it so you can verify any claim.

**Requirements:** Node.js 18+. Optionally, a free `PSI_API_KEY` for page-speed data.

The audit is read-only: it fetches only the public URLs you give it and never submits forms.

Full documentation: https://github.com/anshutyagi0420/marketing-crew
