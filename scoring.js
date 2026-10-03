// Turns a flat list of normalized issues into two 0-100 "Automated score" numbers.
// Everything here is arithmetic on data axe/checks.js already produced — no guessing.
(function () {
  const ns = (window.__a11yIntel = window.__a11yIntel || {});
  const { POUR } = ns.lookup;

  const SEVERITY_SCORE = { critical: 4, serious: 3, moderate: 2, minor: 1 };

  const REACH_SCORE = {
    [POUR.P]: 4, // perceivable barriers (contrast, captions, alt text) tend to hit the broadest population
    [POUR.O]: 3, // operability barriers hit keyboard/motor/switch users hard
    [POUR.U]: 3, // understandability barriers hit cognitive, ESL, and screen-reader users
    [POUR.R]: 2, // robustness barriers are usually assistive-tech-only, still real but narrower
  };

  // Which "Automated score" a rule counts against: Design (color, spacing, target
  // size, layout) or Code (labels, roles, structure, semantics, markup).
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
  // ancestor) look like it's part of a checkout/signup/login flow?
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

  function occurrenceFactor(count) {
    return 1 + Math.log2(1 + Math.max(0, count));
  }

  const SCALE_K = 0.5; // tuned so one critical-path checkout failure outweighs dozens of minor ones

  function computeWeight(issue, pageCritical) {
    const severity = SEVERITY_SCORE[issue.impact] || 1;
    const reach = REACH_SCORE[issue.pour] || 2;
    const occurrence = occurrenceFactor(issue.nodeCount);
    let criticalMultiplier = 1;
    if (issue.elementCritical) criticalMultiplier = 3;
    else if (pageCritical) criticalMultiplier = 1.5;
    const weight = severity * reach * occurrence * criticalMultiplier;
    return { weight, severity, reach, occurrence, criticalMultiplier };
  }

  function computeScores(issues, doc, url) {
    const { pageCritical } = detectPageContext(doc, url);
    let designPenalty = 0;
    let codePenalty = 0;
    const scored = issues.map((issue) => {
      const domain = domainFor(issue);
      const elementCritical = (issue.targets || []).some((t) => isElementCritical(t));
      const { weight, severity, reach, occurrence, criticalMultiplier } = computeWeight(
        { ...issue, elementCritical },
        pageCritical
      );
      if (domain === "design") designPenalty += weight;
      else codePenalty += weight;
      return { ...issue, domain, weight, severity, reach, occurrence, criticalMultiplier, elementCritical, pageCritical };
    });

    const design = Math.max(0, Math.round(100 - designPenalty * SCALE_K));
    const code = Math.max(0, Math.round(100 - codePenalty * SCALE_K));
    scored.sort((a, b) => b.weight - a.weight);

    return { design, code, issues: scored, pageCritical, designPenalty, codePenalty };
  }

  const FORMULA_EXPLANATION =
    "Each issue gets a weight = severity (1-4, minor→critical) " +
    "× reach (2-4, how broad a population that WCAG principle tends to affect) " +
    "× occurrence (1 + log2(1 + number of matching elements), so repeats matter but don't dominate) " +
    "× critical-path multiplier (×3 if the specific element is inside a checkout/sign-up/login flow, " +
    "×1.5 if the page itself is one of those flows, ×1 otherwise). " +
    "All Design-rule weights are summed and all Code-rule weights are summed separately; " +
    "each score = 100 − (0.5 × that domain's total weight), floored at 0. " +
    "This is why one broken checkout button can outweigh dozens of minor issues elsewhere.";

  ns.scoring = { computeScores, domainFor, FORMULA_EXPLANATION, CRITICAL_PATH_KEYWORDS, SEVERITY_SCORE, REACH_SCORE };
})();
