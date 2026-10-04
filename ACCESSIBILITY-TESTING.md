# Accessibility testing checklist (for Chameleon's own panel)

Run `node scripts/self-check.js` first — it runs axe-core against the panel
automatically and should report zero Critical/Serious issues. These two
checklists cover what that script can't: real assistive-tech behavior.

## Keyboard-only checklist

- [ ] Tab to the launcher from a blank new tab; Enter/Space opens the panel.
- [ ] Focus lands on the panel title when it opens.
- [ ] Tab order moves through: close button → Re-scan → Dyslexia-friendly
      font → Reset page → Sound alternatives → Read aloud → Position →
      tabs → tab panel content, with no trap and no skipped controls.
- [ ] Arrow Left/Right/Home/End move between tabs when a tab has focus
      (roving tabindex — only the active tab is in the regular Tab order).
- [ ] Escape closes the panel from anywhere inside it, and focus returns to
      the launcher button.
- [ ] With the panel docked "Floating," focus the "Position" control and
      confirm arrow keys nudge the panel (Shift = bigger step) and it never
      moves off-screen.
- [ ] Every button in Issues/Fixes/Color Lab/Screen Reader/Executive/Roadmap
      is reachable by keyboard alone and shows a visible focus ring.
- [ ] Filter chips, severity filters, and the Fix-first stepper are all
      operable with Enter/Space, not just click.

## Screen reader checklist (NVDA / JAWS / VoiceOver)

- [ ] The launcher announces as **"Open Chameleon, button"** — never "A11y."
- [ ] The decorative logo image next to the panel title is **not**
      announced separately (it's `aria-hidden`; the visible "Chameleon" text
      already names it).
- [ ] Opening the panel announces the title and that it's a dialog.
- [ ] After a scan completes, the live region announces the scores and
      issue count without the user needing to navigate to find it.
- [ ] Each severity badge is announced with its icon *and* word (e.g. "Critical"),
      never color alone.
- [ ] Tab panels announce their selected/unselected state when switching.
- [ ] Toggle buttons (Dyslexia font, Sound alternatives, Read aloud, Focus
      booster, etc.) announce pressed/not-pressed state.
- [ ] The Color Lab color-blindness simulation and the page-wide filter it
      applies are announced as a preview, not as a fix.
- [ ] "Needs manual review" items are announced as a distinct, unscored
      section — not mixed in with real findings.

## Known gap

Visible-focus-indicator detection (confirming every control actually shows
*some* focus style, not just that it's reachable) is intentionally not
automated anywhere in this extension — see `README.md`'s Known Limitations.
Checking it is part of this manual checklist instead.
