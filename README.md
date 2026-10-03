# Accessibility Intelligence for Product Teams

A Chrome extension (Manifest V3) that scans the current page, scores it, and tells
designers, PMs, and CEOs who is affected and how to fix it. Built for the people who
build products, not for end users of the sites it scans.

Everything runs locally in your browser. No backend, no network calls, no remote code.

## Folder structure

```
a11y-intel-extension/
├── manifest.json        MV3 manifest — permissions: activeTab, scripting, storage
├── background.js        Service worker: the only context allowed to call chrome.scripting
├── content.js            Builds the Shadow DOM widget, runs the scan pipeline, all 4 tabs
├── widget.css            Styles injected into the widget's own Shadow DOM
├── lookup.js              Fixed axe-rule-ID → "who is affected" table (not LLM-guessed)
├── scoring.js            Design/Code 0-100 scoring formula + critical-path detection
├── checks.js              Custom deaf/HoH + neurodivergent checks + human-review list
├── fixes.js               Deterministic color-contrast math + other fix generators
├── executive.js          Trend sparkline, top risks, legal note, HTML report export
├── roadmap.js             Static roadmap content + competitor table + vibrate demo
├── demo.html              Broken "checkout" page to test every check category on
├── lib/axe.min.js         Vendored axe-core (bundled locally; MV3 forbids remote scripts)
├── icons/                 Placeholder toolbar icons (swap with real art any time)
└── scripts/make-icons.js  One-off generator used to create the placeholder icons
```

## Load it (unpacked)

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select this `a11y-intel-extension` folder
5. Open `demo.html` in a tab (drag it into Chrome, or `file://` it), **or** navigate to any
   real site
6. Click the extension's toolbar icon — this is the "A11y" floating button's cue to
   appear in the current tab
7. Click the floating **A11y** button in the bottom-right corner, then **Re-scan**

> The extension only requests `activeTab`, so it only ever sees the page you explicitly
> click the toolbar icon on — no broad host permissions, no background page tracking.
> That also means after you navigate to a new page, click the toolbar icon again to
> reactivate the widget there.

## What each tab does

- **Issues** — Automated Design score + Automated Code score (0-100 each), an
  expandable "How is this calculated?" formula, a POUR/component grouping toggle, and
  issue cards sorted by weighted impact. Clicking an issue scrolls to and highlights the
  live element on the page.
- **Fixes** — Side-by-side original/suggested code for contrast, target size, labels,
  accessible names, and alt text. "Apply preview" mutates the page in memory only
  (never saved to the site) with per-fix Undo and a global Reset all. "Copy patch"
  copies every currently-applied change as one CSS/HTML blob. "Open PR" is a disabled
  "coming soon" button by design.
- **Executive** — Both scores, a trend sparkline from scans saved per-URL in
  `chrome.storage.local`, the top 3 risks in plain language, which tasks are currently
  blocked, a legal-exposure note (ADA / EU Accessibility Act both reference WCAG), and
  an **Export report** button that downloads a self-contained HTML page.
- **Roadmap** — Display-only: a secure read-only/SRI developer snippet concept, the
  Figma plugin / persona-validation / competitor-benchmark / haptics ideas, a working
  `navigator.vibrate()` demo button, an explicit statement of what's excluded by design
  (overlays, auto-routing), and a competitor snapshot table.

## Scoring, in one sentence

`weight = severity × reach × occurrence × critical-path multiplier`, summed separately
for Design-rules and Code-rules, then `score = 100 − 0.5 × total weight` — see the
in-app "How is this calculated?" section for the exact breakdown. This is tuned so a
single broken checkout/sign-up/login button clearly outweighs a pile of minor issues
elsewhere on the page (`scoring.js`).

## Known limitations (by design, for this build)

- "Missing focus style" is offered in the Fixes tab as a manual one-click preview
  (adds a `:focus-visible` outline to every control), not as an auto-detected scored
  issue — reliably detecting "no visible focus style" requires programmatically
  focusing every interactive element, which risks side effects on the host page.
- The POUR/component classification and the Design-vs-Code domain split are driven by
  a hand-authored table per axe rule ID, with a generic fallback by axe's `cat.*` tags
  for any of axe-core's ~90 rules not explicitly listed.
- "Alerts that use only color or only sound" and "long line length" are heuristic
  custom checks (documented in `checks.js`), not WCAG success criteria axe-core itself
  covers — they're a best effort at automating something inherently fuzzy.
- Everything under **Needs human review** (plain-language wording, layout consistency,
  caption accuracy, flashing content, cognitive load) is intentionally never scored —
  each item explains why it can't be reliably automated.

## Testing it

`demo.html` deliberately contains one issue from nearly every category this tool
checks: a low-contrast, 20px-tall checkout button; unlabeled form fields; a 16×16px
quantity button; `outline: none` with no focus replacement; a duplicated `id`; a
skipped heading level; a missing `lang` attribute; a `meta refresh`; an autoplaying,
caption-less video; an `!important` inline style that breaks text-spacing overrides; a
very long unbroken paragraph; and two color-only status dots with no text. Scan it, and
you should see the checkout button's contrast failure rise to the top of the list
because it sits on the critical path.
