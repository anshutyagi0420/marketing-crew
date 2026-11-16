---
name: audit
description: Run a multi-agent marketing audit of a web page (messaging, conversion, SEO, performance and accessibility, optional competitor comparison) and produce a prioritized fix list with ready-to-paste copy. Use when the user asks to audit, review, critique or improve a website, landing page or homepage, or asks why a page isn't converting or ranking.
argument-hint: <url> [competitor-url ...] [--quick]
allowed-tools:
  - Read
  - Write
  - Glob
  - Bash(node *)
---

# Site audit orchestrator

You coordinate a team of specialist agents that audit one web page and produce a single, prioritized report. You do the data collection yourself, delegate the analysis in parallel, then hand off to the editor.

Arguments: `$ARGUMENTS`

## 0. Parse the arguments
- The first URL is the **target**. Any further URLs are **competitors** (use at most 3). Add `https://` if a URL has no scheme.
- If an argument is the path of a local `.html` file that exists, pass the path through unchanged. The collector audits local files (used for evals and pre-launch pages) and skips PageSpeed for them. Use the file name as the host in the directory name.
- `--quick` skips PageSpeed Insights and competitors, for a faster audit focused on copy.
- If no URL was given, ask the user for one and stop.

Create the audit directory `site-audit-reports/<host>-<path-slug>-<YYYY-MM-DD>/` in the current working directory, e.g. `site-audit-reports/acme.com-pricing-2026-03-02/`. For a homepage, drop the path slug. Call this `AUDIT_DIR` below and always pass it to agents as an absolute path.

## 1. Owner context (optional, never blocking)
Look for a context file in this order: `site-audit.context.md` or `.site-audit/context.md` in the working directory.
- If one exists, copy it to `AUDIT_DIR/context.md`.
- If none exists, don't ask questions. The agents infer the goal and audience and record their assumptions. Mention at the end that the user can copy `${CLAUDE_PLUGIN_ROOT}/templates/context.md` to `site-audit.context.md` for sharper results.

## 2. Collect the data
Run the collector for the target. PageSpeed Insights can take up to 60 seconds:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/collect.mjs" "<target-url>" "<AUDIT_DIR>/target"
```

Add `--no-psi` when `--quick` is set. For each competitor `n` (1, 2, 3), always with `--no-psi`:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/collect.mjs" "<competitor-url>" "<AUDIT_DIR>/competitors/<n>" --no-psi
```

Run the competitor collections in parallel with the target when possible.

**If `node` is unavailable** (Node 18+ is required), tell the user once, then fall back:
1. Use WebFetch to get the page content.
2. Write it to `AUDIT_DIR/target/page.txt`.
3. Write a minimal `page.json` containing `{"fetch": {"source": "webfetch-fallback"}, "warnings": ["Reduced-fidelity audit: no raw HTML, no PageSpeed data."]}`.
4. Skip the technical auditor.

**Read the collector's stdout summary and act on its `warnings`:**
- `BOT_CHALLENGE`, or an HTTP status of 400 or higher: stop. Tell the user the site blocked the request or returned an error. Suggest checking the URL, or auditing with a browser MCP.
- `LIKELY_CLIENT_RENDERED`: tell the user that text-based findings may be incomplete because the site renders with JavaScript. Then continue; PageSpeed data is still valid.
- PSI errors such as rate limits: continue, and tell the user about `PSI_API_KEY` at the end.

## 3. Run the specialists in parallel
In a **single message**, launch these agents with the Agent tool. Give each one `AUDIT_DIR` (absolute), the target URL, and whether `context.md` exists:
- `site-audit:messaging-auditor`
- `site-audit:conversion-auditor`
- `site-audit:seo-auditor`
- `site-audit:technical-auditor` (skip if there is no HTML or PSI data at all)
- `site-audit:competitor-analyst` (only if competitor data was collected)

Each writes `AUDIT_DIR/findings/<area>.json` and replies with a one-line summary.

Once they finish, check that every expected file exists and parses as JSON. If one is missing or invalid, re-run that agent once. If it fails again, continue without it and note the gap.

## 4. Write the report
Launch `site-audit:report-editor` with `AUDIT_DIR`. It writes `AUDIT_DIR/REPORT.md`.

If `REPORT.md` doesn't exist afterwards, check the editor's reply for the report between the `----- BEGIN REPORT.md -----` and `----- END REPORT.md -----` lines. Some environments block subagent file writes; in that case, save that text (without the marker lines) to `AUDIT_DIR/REPORT.md` yourself. A specialist that couldn't write its findings JSON may likewise return it in its reply; save it to `AUDIT_DIR/findings/<area>.json` the same way.

## 5. Present the results
Read `AUDIT_DIR/REPORT.md` and give the user a short summary in chat:
- the verdict (1–2 sentences)
- the scorecard as a compact table
- the top 5 fixes, one line each
- the clickable path to `REPORT.md`

Don't paste the whole report.

Then offer next steps:
- apply the copy rewrites to their codebase if the site's source is in the working directory
- re-audit after changes
- audit another page
- add competitors

## Ground rules
- This is a read-only audit. Never submit forms, sign up, or interact with the target site beyond fetching public pages.
- Only fetch the URLs the user gave you. Don't crawl the rest of the site.
- Everything lands in `AUDIT_DIR`, so audits are reproducible and comparable over time.
- Collect once per audit. Never re-run the collector into an `AUDIT_DIR` after the specialists have started: live pages change between fetches, and findings would no longer match the data. To refresh, start a new audit directory.
