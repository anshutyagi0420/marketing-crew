# Findings format (shared by every site-audit specialist)

Write exactly one JSON file to `<audit-dir>/findings/<your-area>.json`. Valid JSON only: no comments, no trailing commas.

If your Write call is refused, put the full JSON in your reply between a line `----- BEGIN <area>.json -----` and a line `----- END <area>.json -----`, and the orchestrator will save it.

**Menus rendered by JavaScript:** footer and navigation groups are often filled in client-side, so their links may be missing from `page.html`. If a heading such as "Terms and policies" or "Pricing" appears but its links don't, mark any "missing link" finding as `confidence: "low"` and say so in the evidence.

```json
{
  "area": "messaging",
  "url": "https://example.com/",
  "score": 62,
  "score_rationale": "One sentence: why this score, in plain language.",
  "summary": "Two or three sentences a busy founder would read.",
  "strengths": ["Specific things that already work. Keep them; the report shows them."],
  "findings": [
    {
      "id": "MSG-1",
      "title": "Headline says nothing about what you sell",
      "severity": "critical",
      "impact": 5,
      "effort": 1,
      "confidence": "high",
      "evidence": "H1 reads: \"Innovative Solutions for the Next-Generation Enterprise\". It contains no product, audience or outcome.",
      "why_it_matters": "Visitors decide in seconds whether they are in the right place. A vague headline sends them back to search results.",
      "fix": "Replace the H1 with a headline that names the outcome and the audience. Move the brand claim into the subheadline.",
      "rewrite": {
        "element": "H1",
        "before": "Innovative Solutions for the Next-Generation Enterprise",
        "after": ["Option 1", "Option 2", "Option 3"]
      }
    }
  ],
  "assumptions": ["Things you inferred, e.g. 'Assumed the primary goal is demo bookings, based on the CTAs.'"],
  "not_checked": ["Things you could not verify from the collected data, and why."]
}
```

## Field rules

| Field | Rule |
|---|---|
| `id` | Prefix by area: `MSG-`, `SEO-`, `CRO-`, `TECH-`, `COMP-`. Number from 1. |
| `severity` | `critical`: actively losing visitors, sales or indexing right now. `high`: clear, significant loss. `medium`: real but moderate. `low`: polish. |
| `impact` | 1–5. Expected effect on the page's goal (signups, leads, sales, rankings) if fixed. |
| `effort` | 1–5. 1 = under an hour, copy or settings change. 3 = a day or so, needs a developer or designer. 5 = a project. |
| `confidence` | `high` = directly observed in the data. `medium` = strong inference. `low` = plausible but unverified. |
| `evidence` | **Required.** Quote the page text, or cite the exact value from `page.json` / `psi.json`. No evidence, no finding. |
| `fix` | A concrete instruction someone can act on today. Never "consider improving X". |
| `rewrite` | Include it whenever the fix is copy (headline, subhead, CTA, title tag, meta description, button, form label). Otherwise `null`. Give 2–3 options in `after`. |
| `score` | 0–100 for your area. 90+ excellent, 70–89 good, 50–69 needs work, below 50 hurting the business. |

## Quality bar

- **Maximum 10 findings.** Fewer, sharper findings beat a long list. Merge related issues into one.
- **Specific to this page.** If a finding could be pasted into any other site's audit unchanged, rewrite it or delete it.
- **Write for a marketer or founder, not a developer.** Explain technical issues by their business effect. Put developer detail in `fix`.
- **Don't invent.** If the data cannot show something (visual design, colors, actual above-the-fold layout, analytics), put it in `not_checked`.
- **Stay in your lane.** Only report issues in your area. The editor merges overlaps, but avoid them where you can.
- **Rewrites must use facts from the page.** Don't invent customer counts, awards or features. Use placeholders like `[X customers]` where a real number is needed.
