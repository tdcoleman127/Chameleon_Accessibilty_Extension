# Architecture

## Pipeline

```
axe-core run  ─┐
                ├─▶ result mapper ─▶ rule catalog ─▶ issue model ─▶ UI / report / exports
custom checks ─┘        │                 │                │
                         │                 │                ├─▶ Issues tab (cards, filters)
                 (normalizeAxeViolation,   │                ├─▶ Fixes tab (deterministic diffs)
                  checks.runScoredChecks,  │                ├─▶ Executive tab (trend, risks)
                  checks.runPossibleChecks)│                ├─▶ PDF / JSON / CSV / SARIF exports
                                           │                └─▶ "Copy for developer" tickets
                                    lookup.js (who's
                                    affected / POUR /
                                    component per rule
                                    id — the de facto
                                    rule catalog today,
                                    see note below)
```

1. **Scan trigger**: toolbar icon click → `background.js`'s `activateOnTab()` →
   `chrome.scripting.executeScript` injects `lookup.js`, `scoring.js`,
   `checks.js`, `fixes.js`, `style-manager.js`, `executive.js`, `roadmap.js`,
   `content.js` (in that order, same isolated world) into the active tab.
2. **axe-core run**: `content.js` messages `background.js` to inject
   `lib/axe.min.js` (also on-demand, not bundled into every page load), then
   calls `window.axe.run()` with styling suspended via
   `style-manager.js`'s `withSuspended()` so scores describe the real,
   unmodified page.
3. **Result mapper**: `normalizeAxeViolation()` in `content.js` turns each axe
   violation into Chameleon's internal issue shape. `checks.js` produces the
   same shape for custom Confirmed checks (captions, autoplay, etc.) and
   separately for Possible/heuristic findings (vague links, sound-only text,
   reading level, key-flow detection).
4. **Rule catalog**: `lookup.js` maps each rule id → POUR principle, component
   group, and a plain-language "who's affected" sentence. This is the de
   facto rule catalog today. **Not yet consolidated** into a single
   `rules-catalog.json`/`user-groups.json` pair the way the spec describes —
   see the note in `README.md`'s Known Limitations for why that refactor was
   deliberately deferred.
5. **Issue model**: `scoring.js` computes severity weight, domain
   (Design/Code), and the 0–100 scores; `content.js` layers on
   Open/Ignored/Fixed/Regressed state (persisted in `chrome.storage.local`,
   keyed per URL) and confidence (Confirmed/Possible).
6. **UI / report / exports**: all four tabs plus the PDF/JSON/CSV/SARIF
   exporters and "Copy for developer" read from this one issue model —
   nothing re-derives its own copy of the data.

## Module map

| File | Owns |
|---|---|
| `background.js` | Service worker; the only context allowed to call `chrome.scripting` |
| `content.js` | Orchestrator: Shadow DOM widget, all tabs, scan pipeline, issue state |
| `style-manager.js` | The single managed style layer for every page-altering feature |
| `scoring.js` | Severity weights, Design/Code domain split, score formula |
| `lookup.js` | Rule id → POUR/component/"who's affected" (today's rule catalog) |
| `checks.js` | Custom Confirmed checks + Possible heuristics + static human-review items |
| `fixes.js` | Deterministic fix generators (contrast math, labels, alt text, etc.) |
| `executive.js` | Trend sparkline, top risks, legal note, HTML report |
| `roadmap.js` | Static roadmap tab content |
