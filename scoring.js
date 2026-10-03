// Turns a flat list of normalized issues into two 0-100 "Automated score" numbers.
// Everything here is arithmetic on data axe/checks.js already produced — no guessing.
//
// Formula per the Chameleon spec (2026-10-03 update):
//   penalty per rule = weight x min(instances, 3)
//   weight: Critical=10, Serious=5, Moderate=2, Moderate(minor)=1
//   score = 100 - sum(penalties in that domain), clamped to [0, 100]
// Critical-path detection (checkout/login/etc.) is kept as a separate signal for the
// "Blocks task" badge / Task-blockers summary — it no longer multiplies into the score,
// per spec section 0.3 (only severity x instances feeds the score now).
(function () {
  const ns = (window.__a11yIntel = window.__a11yIntel || {});
  const { POUR } = ns.lookup;

  // axe critical/serious/moderate/minor -> {label shown (3 visible levels only),
  // isMinor tag, score weight}. Minor collapses into the "Moderate" visible level
  // with its own lower weight and a small "minor" tag, per spec 0.2.
  const SEVERITY = {
    critical: { label: "Critical", weight: 10, minor: false },
    serious: { label: "Serious", weight: 5, minor: false },
    moderate: { label: "Moderate", weight: 2, minor: false },
    minor: { label: "Moderate", weight: 1, minor: true },
  };

  function severityInfo(impact) {
    return SEVERITY[impact] || SEVERITY.moderate;
  }

  // Which "Automated score" a rule counts against: Design (contrast, text spacing,
  // target size, reflow, color use, motion) or Code (names, labels, roles, ARIA,
  // landmarks, headings, language, duplicate IDs). A rule in both lists would only
  // ever be read from this one place, so picking one bucket here *is* the record.
  const DESIGN_RULES = new Set([
    "color-contrast",
    "color-contrast-enhanced",
    "link-in-text-block",
    "target-size",
    "css-orientation-lock",
    "meta-viewport",
    "avoid-inline-spacing",
    "custom-long-line-length",
    "custom-color-or-sound-only-alert",
    "custom-reduced-motion",
  ]);
  const DESIGN_CATS = new Set(["cat.color", "cat.sensory-and-visual-cues"]);

  function domainFor(issue) {
    if (DESIGN_RULES.has(issue.id)) return "design";
    if (issue.tags && issue.tags.some((t) => DESIGN_CATS.has(t))) return "design";
    return "code";
  }

  const CRITICAL_PATH_KEYWORDS = [
    "checkout", "cart", "payment", "pay", "billing", "order",
    "signup", "sign-up", "register", "registration",
    "login", "log-in", "signin", "sign-in", "account",
  ];

  function textHasCriticalKeyword(text) {
    if (!text) return false;
    const t = text.toLowerCase();
    return CRITICAL_PATH_KEYWORDS.some((k) => t.includes(k));
  }

  // Page-level signal: URL, document title, and the presence of password/email
  // fields or submit buttons whose text matches checkout/signup/login language.
  // Informational only (Task blockers / "Blocks task" badge) — does not affect score.
  function detectPageContext(doc, url) {
    const urlCritical = textHasCriticalKeyword(url) || textHasCriticalKeyword(doc.title);
    let formCritical = false;
    const buttonsAndInputs = doc.querySelectorAll(
      'button, input[type="submit"], input[type="button"], a[role="button"]'
    );
    buttonsAndInputs.forEach((el) => {
      const label = (el.textContent || el.value || el.getAttribute("aria-label") || "").trim();
      if (textHasCriticalKeyword(label)) formCritical = true;
    });
    const sensitiveFields = doc.querySelectorAll(
      'input[type="password"], input[type="email"], input[autocomplete*="cc-"], input[name*="card"], input[name*="checkout"]'
    );
    if (sensitiveFields.length) formCritical = true;
    return { pageCritical: urlCritical || formCritical };
  }

  // Element-level signal: does this specific node (or its closest form/button
  // ancestor) look like it's part of a checkout/signup/login flow? Informational
  // only, same as above.
  function isElementCritical(target) {
    if (!target || !target.closest) return false;
    const container = target.closest("form, button, a, [role=button], fieldset") || target;
    const text = [
      container.textContent,
      container.getAttribute && container.getAttribute("aria-label"),
      container.id,
      container.className && String(container.className),
      container.name,
    ]
      .filter(Boolean)
      .join(" ");
    return textHasCriticalKeyword(text);
  }

  function computeScores(issues, doc, url) {
    const { pageCritical } = detectPageContext(doc, url);
    let designPenalty = 0;
    let codePenalty = 0;
    const scored = issues.map((issue) => {
      const domain = domainFor(issue);
      const elementCritical = (issue.targets || []).some((t) => isElementCritical(t));
      const { label, weight, minor } = severityInfo(issue.impact);
      const instances = Math.min(issue.nodeCount || 0, 3);
      const penalty = weight * instances;
      if (domain === "design") designPenalty += penalty;
      else codePenalty += penalty;
      return {
        ...issue,
        domain, elementCritical, pageCritical,
        severityLabel: label, severityWeight: weight, isMinor: minor, penalty,
      };
    });

    const design = Math.min(100, Math.max(0, 100 - designPenalty));
    const code = Math.min(100, Math.max(0, 100 - codePenalty));
    scored.sort((a, b) => b.penalty - a.penalty);

    return { design, code, issues: scored, pageCritical, designPenalty, codePenalty };
  }

  function verdictFor(score) {
    if (score >= 90) return { label: "Few automated issues found", tone: "good" };
    if (score >= 70) return { label: "Some barriers remain", tone: "ok" };
    if (score >= 40) return { label: "Significant barriers", tone: "warn" };
    return { label: "Needs urgent attention", tone: "bad" };
  }

  function scoreDelta(current, previous) {
    if (previous === null || previous === undefined) return null;
    const diff = current - previous;
    if (diff === 0) return "No change since last scan";
    return `${diff > 0 ? "+" : ""}${diff} since last scan`;
  }

  const FORMULA_EXPLANATION =
    "Each score starts at 100 and can't go below 0 or above 100. " +
    "Penalty per rule = weight × min(instances on the page, 3), so one repeated " +
    "mistake can't zero the score on its own. Weights: Critical 10, Serious 5, " +
    "Moderate 2, Moderate (minor) 1. Design rules (contrast, text spacing, target " +
    "size, reflow, color use, motion) and Code rules (names, labels, roles, ARIA, " +
    "landmarks, headings, language, duplicate IDs) are scored separately — each rule " +
    "counts in exactly one bucket. Ignored issues, Fixed issues, Needs-manual-review " +
    "items, and Possible (heuristic) findings never affect either score.";

  ns.scoring = {
    computeScores, domainFor, verdictFor, scoreDelta, FORMULA_EXPLANATION,
    CRITICAL_PATH_KEYWORDS, SEVERITY,
  };
})();
