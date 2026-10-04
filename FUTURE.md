# Future (planned, not built)

## CLI + CI integration

A command-line tool and a GitHub Action that run the **same rule catalog** this
extension uses — currently that's `lookup.js` (who's-affected text) +
`scoring.js` (severity/domain classification) + `checks.js` (custom checks) —
against a page or a set of URLs in a CI pipeline, and emit the same SARIF/JSON
output the extension's Executive tab already produces (see `content.js`'s
`buildExportData()` / `exportSARIF()`).

The point is consistency: a PR shouldn't get a different verdict from CI than
what a developer sees locally in the browser. This is explicitly **planned,
not built** — nothing described here exists yet.

### Sketch of the shape it would take

- `chameleon-cli scan <url-or-file>` — runs axe-core + the same custom checks
  headlessly (e.g. via Playwright), using the identical scoring formula in
  `scoring.js`, and exits non-zero above a configurable severity threshold.
- A GitHub Action wrapping the CLI, uploading its SARIF output via
  `github/codeql-action/upload-sarif` so results show up natively in the PR's
  "Files changed" view and the repo's Security tab.
- Shared rule logic would need `lookup.js`/`scoring.js`/`checks.js` to be
  genuinely environment-agnostic (no `chrome.*` calls, no `document` assumed
  to be the live extension's shadow-excluded page) — they're close already
  since the scoring/lookup logic doesn't touch `chrome.*` APIs at all, but
  this hasn't been verified by actually running them outside a content
  script.
