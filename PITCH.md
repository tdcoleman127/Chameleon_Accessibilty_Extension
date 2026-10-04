# Pitch notes

**Who pays:** agencies, nonprofits, and dev teams that need to find and
prioritize accessibility fixes — not just get a list of violations, but know
which one to fix first and why.

**Why Chameleon beats running axe or Lighthouse alone:** those tools are
developer-only output — a flat list of rule violations with no sense of who's
affected or what matters most. Chameleon adds plain-language fixes,
user-impact prioritization (one broken checkout button can outweigh dozens of
minor issues elsewhere), live simulation and fix preview, honest
manual-review disclosure instead of false confidence, and built-in
adjustments (Color Lab, Dyslexia mode, Read Aloud) that let a reviewer
actually experience a barrier, not just read about it.

**Compliance and risk:** automated accessibility failures are commonly cited
evidence in ADA Title III lawsuits, and public-sector sites face explicit
WCAG-based requirements. Chameleon doesn't make anyone compliant — nothing
automated can — but catching and triaging high-impact barriers earlier, as
part of normal development rather than a once-a-year audit, measurably
reduces that exposure.

**Built next vs. cut:**

| Built this pass | Cut / deferred |
|---|---|
| Rebrand, new scoring formula, Task blockers + Fix-first | Real mouse drag/resize/minimize for the panel |
| Confidence labels, Needs-manual-review, Ignored/Fixed/Regressed states | Full `rules-catalog.json`/`user-groups.json` consolidation |
| Color Lab, Dyslexia mode, "What a screen reader hears" | Per-rule "Learn more" examples (shipped generic POUR-level ones instead) |
| Sound alternatives, Read Aloud | Live on-device captions (would need a remote speech API — breaks "nothing leaves your browser") |
| PDF/JSON/CSV/SARIF export, Copy for developer | CLI / GitHub Action (see `FUTURE.md`) |
| Keyboard tab-order overlay, Position menu, panel themes, first-run tour | Real chameleon logo artwork (placeholder SVG until the source file is provided) |

**Accuracy statement:** scores are triage, not certification. Automated
checks (even very good ones) catch roughly a third of real WCAG failures by
most published estimates — the rest requires human judgment. Every score,
report, and export in Chameleon says this explicitly, on purpose, because a
false sense of "done" is worse than an honest "here's where to look first."

**Inclusive design note:** disabled people are also designers and developers
who would use this tool directly, not just the population it describes in
the third person. Low-vision developers triaging contrast issues, deaf
developers checking caption coverage, and keyboard-only developers auditing
tab order are all first-class users of Chameleon itself, not just
beneficiaries of what it finds. *(Placeholder: real user feedback from
disabled testers goes here once available — none has been collected yet.)*
