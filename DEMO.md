# Chameleon — 2-minute demo script

Load the extension unpacked first (see README.md), open `demo.html`, and have
`chrome://extensions` in a second tab in case you need to show the Errors button.

## Script (~2:00)

**0:00–0:15 — Open it**
Click the Chameleon toolbar icon on `demo.html`. The launcher appears bottom-right
and the panel opens with a scan already running automatically — no second click
needed. Say: *"Chameleon scans the page it's pointed at, entirely locally."*

**0:15–0:40 — Issues tab (the 10-second view)**
Point at the two score cards — Design and Code, each with a verdict
("Significant barriers," "Needs urgent attention," etc.) and, after the first
scan, a trend delta. Read the disclaimer line out loud: *"triage aid, not a
certification."* Point at **Task blockers** at the top — the checkout flow is
flagged. Click **Fix first →**.

**0:40–1:05 — Fixes tab**
Fix-first jumps straight to the highest-priority fix card (the checkout
button's contrast failure). Show the before/after swatches and ratio. Click
**Apply preview** — the button visibly changes color on the live page behind
the panel. Click **Undo** to show it's reversible and nothing was saved to the
page.

**1:05–1:25 — Executive tab**
Click **Re-scan** once, then switch to Executive. Point at the score delta
("+N since last scan" or similar) and the top-3-risks list in plain language —
no WCAG jargon. Mention the legal-exposure note (ADA / EU Accessibility Act).

**1:25–1:45 — Roadmap tab**
Scroll the competitor table — "this is the gap between us and axe/Lighthouse,
overlays, and manual audits." Click the vibration demo button if presenting on
a device with a vibration motor; skip it otherwise, no need to narrate the
skip.

**1:45–2:00 — Close**
*"Everything you just saw ran in the browser — no server, no data leaves the
machine. This is triage, not a pass/fail stamp."*

## Recovery plan — if something breaks live

- **Scan throws an error mid-demo:** this is handled automatically — Chameleon
  falls back to the last successful scan and labels it "Cached result from
  [time]" rather than showing a raw error or a fake result. Just keep talking;
  point at the cached-result banner as *"and here's the fallback behavior we
  built in for exactly this."* It turns a bug into a feature beat.
- **Toolbar icon click does nothing / no widget appears:** check
  `chrome://extensions` for a red **Errors** button first. If the page is
  `file://` and you haven't enabled **Allow access to file URLs** on the
  extension's Details page, that's almost certainly it — toggle it and retry.
- **Extension won't load at all / Chrome is misbehaving:** stop troubleshooting
  live. Switch straight to the backup recording below and narrate over it.
- **Any multi-minute stall:** same rule — switch to the backup video rather
  than let dead air run.

## Backup recording

Place a pre-recorded run-through at: `docs/demo-backup.mp4` *(not yet
recorded — record one before presenting; this file doesn't exist yet)*.
