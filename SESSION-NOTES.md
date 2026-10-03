# Session notes — Accessibility Intelligence extension build

**Date:** 2026-10-03
**Source spec:** `../new-proj-10-3-hack.txt` (hackathon prompt, read in full before building)
**Result:** a working, locally-tested Manifest V3 Chrome extension at this folder.

## What was asked for

Build a Chrome extension, "Accessibility Intelligence for Product Teams," that adds a
floating widget to any site, scans it with axe-core, scores it (separate Design and
Code scores, 0-100), and explains who's affected and how to fix it — for designers,
PMs, and CEOs, not end users. Full spec covered: scoring formula weighted by severity
× people-blocked × critical-path, POUR/component-grouped issue cards with click-to-
highlight, deterministic (non-LLM) fix suggestions with preview/undo, an executive
summary tab with trend + legal note + exportable report, and a display-only roadmap
tab. Everything local, no backend, no remote code, minimal permissions.

## What got built

Full folder structure, all four tabs implemented and working:

- `manifest.json` — MV3, permissions limited to `activeTab`, `scripting`, `storage`;
  `web_accessible_resources` for `widget.css` (needed so the Shadow DOM can fetch it
  — see bugs below).
- `background.js` — service worker; the only place allowed to call
  `chrome.scripting.executeScript`. Handles toolbar-icon clicks (injects the content
  script bundle into the active tab), on-demand axe-core injection, and
  `chrome.storage.local` read/write for scan history. Flashes a red badge on the
  toolbar icon with a message when a page can't be scanned (restricted page or
  injection blocked).
- `content.js` — the orchestrator. Builds the floating button + panel in an **open
  Shadow DOM** (isolated from host page styles), runs the scan pipeline, renders all
  four tabs, handles keyboard nav (roving-tabindex tablist, Escape-to-close, focus
  return), and owns the highlight-on-click / apply-fix-preview / undo / reset-all /
  copy-patch logic.
- `scoring.js` — `weight = severity × reach × occurrence × critical-path multiplier`,
  summed separately per Design/Code domain, `score = 100 − 0.5×total weight`. Critical
  path is detected from URL/title keywords and nearby form fields/button text
  (checkout, sign-up, login, etc.).
- `lookup.js` — hand-authored axe-rule-ID → "who's affected" table (~45 rules) with a
  generic fallback by axe's `cat.*` tags for the rest.
- `checks.js` — custom scored checks axe doesn't cover (captions/transcript, autoplay,
  reduced-motion, long line length, color/icon-only alerts) plus the 5 always-listed,
  never-scored human-review items.
- `fixes.js` — deterministic color-contrast math (hue/saturation-preserving lightness
  binary search to hit 4.5:1 / 3:1), plus target-size/label/name/alt-text fix
  generators and the shared style/attr patch+undo tracker used for Copy patch.
- `executive.js` / `roadmap.js` — trend sparkline SVGs, top-3-risks, legal note,
  self-contained downloadable HTML report; and the display-only roadmap content
  (dev snippet, Figma/persona/competitor/haptics mentions, working
  `navigator.vibrate()` demo, competitor table).
- `demo.html` — a deliberately broken "checkout" page covering nearly every check
  category, for one-click end-to-end testing.
- `README.md` — folder structure, load-unpacked steps, scoring formula summary, and
  known limitations.

## Testing performed (not just written — actually run)

Used the `run` skill to drive this for real, since a Chrome extension can't be
smoke-tested by importing a function and checking output. No project-level run skill
existed yet, so the generic browser-driven fallback was adapted: launched a real Edge
instance (`msedge.exe`, found via `chrome.google.com`'s sibling — the Chrome binary
wasn't installed on this machine) via `playwright-core`'s `launchPersistentContext`
with `--load-extension` pointed at a scratch copy of this folder. A copy was used (not
the real folder) so a test-only `host_permissions: ["file:///*"]` could be added to
the manifest, bypassing the need to simulate a literal trusted click on the native
toolbar icon — the same `activateOnTab()` function the real click handler calls was
invoked directly from the service worker, which is otherwise untestable from browser
automation.

**Two real bugs were found this way and fixed in the actual shipped source:**

1. **Widget rendered completely unstyled.** `widget.css` was fetched by `content.js`
   via `fetch(chrome.runtime.getURL("widget.css"))` to inject into the Shadow DOM, but
   it wasn't listed in `manifest.json`'s `web_accessible_resources`, so the fetch
   silently failed. Fixed by adding it there.
2. **Contrast message read "needs 4.5:1:1".** axe-core already returns
   `expectedContrastRatio` as the string `"4.5:1"`; the plain-language template
   appended its own `:1` on top. Fixed to `parseFloat()` it first.

Also found (not a bug, a weak test fixture): `demo.html`'s checkout inputs had
`placeholder` text, which axe's accessible-name computation counts as a (weak) name,
so axe's `label` rule never actually fired. Removed the placeholders so the demo
genuinely reproduces "edit text, blank," matching the spec's own example text.

After both fixes, a full run confirmed: widget opens styled and correct, scan
completes (Design 16 / Code 0 on the intentionally-broken demo), 18 issue cards
grouped by POUR, 4 fix cards generated (contrast/label/alt-text/button-name), Apply
preview + Undo works live on the page, Executive tab renders scores/trend/risks,
Roadmap tab renders the competitor table — zero JS console errors throughout.

## Left as roadmap (per spec, intentionally not built)

Figma plugin, simulated-persona/real-tester validation, the live developer SRI
snippet + PR-based delivery pipeline, "Open PR" button. All shown as display-only
content in the Roadmap tab.

## How to load and run it

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this folder
3. Check the card for a red **Errors** button (should be none)
4. Click **Details** → toggle **Allow access to file URLs** on (needed only for
   testing `demo.html`, which is a local file — Chrome blocks extensions from
   touching `file://` pages by default, independent of `activeTab`)
5. Pin the icon via the puzzle-piece menu (optional, keeps it visible)
6. Open `demo.html` (or any real site)
7. Click the toolbar icon → the floating **A11y** button + panel should appear
   bottom-right, with a scan already running

**Key mental model clarified mid-session:** this is not a website — there's no
server, no hosted page. It's a folder Chrome loads directly. Opening `demo.html` by
itself does nothing; the extension has to be separately loaded into Chrome *and*
activated (toolbar-icon click) against whichever tab is open. If the widget doesn't
appear after a click, check for the red `!` badge the extension flashes on its own
icon — that specifically means the current page blocked injection (most commonly the
`file://` permission above, or a page with a strict CSP).
