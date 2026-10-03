// Main orchestrator: builds the Shadow DOM widget, runs the scan pipeline, and
// wires up all four tabs. Loaded last by background.js, after lookup/scoring/
// checks/fixes/executive/roadmap have attached themselves to window.__a11yIntel.
(function () {
  if (window.__a11yIntelInjected) {
    window.__a11yIntelToggle && window.__a11yIntelToggle();
    return;
  }
  window.__a11yIntelInjected = true;

  const ns = window.__a11yIntel;
  const { lookup, scoring, checks, fixes, executive, roadmap } = ns;
  const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"];
  const LARGE_DOM_THRESHOLD = 3000;
  const SCAN_TIMEOUT_MS = 15000;

  let shadowRoot, panelEl, toggleBtn, liveRegion, host;
  let activeTabId = "issues";
  let groupMode = "pour";
  let currentScan = null; // { design, code, issues, humanReview, pageCritical }
  let scanHistory = [];
  let highlightedEl = null;
  let highlightTimer = null;
  let focusFixStyleEl = null;
  let lastToggleFocus = null;

  function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  async function fetchCss() {
    try {
      const res = await fetch(chrome.runtime.getURL("widget.css"));
      return await res.text();
    } catch {
      return "";
    }
  }

  async function init() {
    host = document.createElement("div");
    host.id = "a11y-intel-host";
    document.documentElement.appendChild(host);
    shadowRoot = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = await fetchCss();
    shadowRoot.appendChild(style);

    buildDom();
    window.__a11yIntelToggle = () => openPanel();
    openPanel();
    runScan();
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v === null || v === undefined) return;
      if (k === "text") node.textContent = v;
      else if (k === "html") node.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    (children || []).forEach((c) => c && node.appendChild(c));
    return node;
  }

  function buildDom() {
    toggleBtn = el("button", {
      id: "a11y-toggle",
      "aria-label": "Open Accessibility Intelligence panel",
      "aria-expanded": "false",
      text: "A11y",
      onclick: () => (panelEl.hidden ? openPanel() : closePanel()),
    });
    shadowRoot.appendChild(toggleBtn);

    liveRegion = el("div", { class: "a11y-live-region", "aria-live": "polite", role: "status" });
    shadowRoot.appendChild(liveRegion);

    panelEl = el("div", {
      id: "a11y-panel",
      role: "dialog",
      "aria-label": "Accessibility Intelligence for Product Teams",
      hidden: "true",
      onkeydown: (e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          closePanel();
        }
      },
    });

    const header = el("div", { class: "a11y-header" }, [
      el("div", { class: "a11y-header-row" }, [
        el("div", {}, [
          el("p", { class: "a11y-title", text: "Accessibility Intelligence" }),
          el("p", { class: "a11y-page-meta", id: "a11y-page-meta" }),
        ]),
        el("button", { class: "a11y-icon-btn", "aria-label": "Close panel", text: "✕", onclick: closePanel }),
      ]),
      el("div", { class: "a11y-actions" }, [
        el("button", { class: "a11y-btn primary", id: "a11y-rescan-btn", text: "Re-scan", onclick: () => runScan() }),
        el("span", { style: "font-size:10.5px;color:#5b6572;align-self:center;", text: "Runs locally. Nothing leaves your browser." }),
      ]),
    ]);
    panelEl.appendChild(header);

    const tabOrder = ["issues", "fixes", "executive", "roadmap"];
    const tabs = [
      ["issues", "Issues"],
      ["fixes", "Fixes"],
      ["executive", "Executive"],
      ["roadmap", "Roadmap"],
    ];
    const tablist = el(
      "div",
      {
        class: "a11y-tablist", role: "tablist", "aria-label": "Accessibility Intelligence sections",
        onkeydown: (e) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
          e.preventDefault();
          const i = tabOrder.indexOf(activeTabId);
          let next = i;
          if (e.key === "ArrowLeft") next = (i - 1 + tabOrder.length) % tabOrder.length;
          if (e.key === "ArrowRight") next = (i + 1) % tabOrder.length;
          if (e.key === "Home") next = 0;
          if (e.key === "End") next = tabOrder.length - 1;
          switchTab(tabOrder[next]);
          shadowRoot.getElementById(`a11y-tab-${tabOrder[next]}`).focus();
        },
      },
      tabs.map(([id, label]) =>
        el("button", {
          class: "a11y-tab",
          role: "tab",
          id: `a11y-tab-${id}`,
          "aria-controls": `a11y-panel-${id}`,
          "aria-selected": id === activeTabId ? "true" : "false",
          tabindex: id === activeTabId ? "0" : "-1",
          text: label,
          onclick: () => switchTab(id),
        })
      )
    );
    panelEl.appendChild(tablist);

    tabs.forEach(([id]) => {
      const panel = el("div", {
        class: "a11y-tabpanel",
        role: "tabpanel",
        id: `a11y-panel-${id}`,
        "aria-labelledby": `a11y-tab-${id}`,
        hidden: id === activeTabId ? null : "true",
      });
      panelEl.appendChild(panel);
    });

    shadowRoot.appendChild(panelEl);
    updatePageMeta();
    renderRoadmapTab();
  }

  function updatePageMeta() {
    shadowRoot.getElementById("a11y-page-meta").textContent = `${document.title} — ${location.href}`;
  }

  function panelFor(id) { return shadowRoot.getElementById(`a11y-panel-${id}`); }

  function switchTab(id) {
    activeTabId = id;
    ["issues", "fixes", "executive", "roadmap"].forEach((t) => {
      const tabBtn = shadowRoot.getElementById(`a11y-tab-${t}`);
      tabBtn.setAttribute("aria-selected", t === id ? "true" : "false");
      tabBtn.tabIndex = t === id ? 0 : -1;
      panelFor(t).hidden = t === id ? false : true;
    });
    if (id === "executive") renderExecutiveTab();
  }

  function openPanel() {
    lastToggleFocus = document.activeElement;
    panelEl.hidden = false;
    toggleBtn.setAttribute("aria-expanded", "true");
    const heading = shadowRoot.querySelector(".a11y-title");
    heading && heading.setAttribute("tabindex", "-1");
    heading && heading.focus();
  }

  function closePanel() {
    panelEl.hidden = true;
    toggleBtn.setAttribute("aria-expanded", "false");
    toggleBtn.focus();
  }

  function announce(msg) {
    liveRegion.textContent = "";
    requestAnimationFrame(() => (liveRegion.textContent = msg));
  }

  // ---------- Scan pipeline ----------
  function withTimeout(promise, ms, message) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
    ]);
  }

  function sendMessage(msg) {
    return new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
  }

  function showError(message) {
    const panel = panelFor("issues");
    panel.innerHTML = "";
    panel.appendChild(el("div", { class: "a11y-error-banner", text: message }));
  }

  function wcagRef(tags) {
    const t = (tags || []).find((x) => /^wcag\d{3,4}$/.test(x));
    if (!t) return null;
    const d = t.replace("wcag", "");
    return d.length === 3 ? `${d[0]}.${d[1]}.${d[2]}` : `${d[0]}.${d[1]}.${d.slice(2)}`;
  }

  function elementWord(node) {
    const html = (node && node.html || "").toLowerCase();
    if (html.startsWith("<button")) return "button";
    if (html.startsWith("<a")) return "link";
    if (html.startsWith("<input")) return "field";
    return "element";
  }

  function generatePlainFlag(violation) {
    const ref = wcagRef(violation.tags);
    if (violation.id === "color-contrast" || violation.id === "color-contrast-enhanced") {
      const node = violation.nodes[0];
      const check = node && node.any && node.any.find((a) => a.data && a.data.contrastRatio);
      if (check) {
        const d = check.data;
        const expected = parseFloat(d.expectedContrastRatio) || 4.5;
        return `This ${elementWord(node)} fails WCAG ${ref || "1.4.3"}: contrast is ${parseFloat(d.contrastRatio).toFixed(1)}:1, needs ${expected}:1. These colors are not fully compliant.`;
      }
    }
    return ref ? `This fails WCAG ${ref}: ${violation.help}.` : `${violation.help}.`;
  }

  function resolveTargets(nodes) {
    const resolved = [];
    nodes.forEach((n) => {
      const selector = Array.isArray(n.target) ? n.target[n.target.length - 1] : n.target;
      if (typeof selector !== "string") return;
      try {
        const node = document.querySelector(selector);
        if (node) resolved.push(node);
      } catch { /* invalid/unsupported selector, skip */ }
    });
    return resolved;
  }

  function normalizeAxeViolation(v) {
    const { pour, component, affected } = lookup.lookupRule(v.id, v.tags);
    const targets = resolveTargets(v.nodes);
    return {
      id: v.id,
      source: "axe",
      impact: v.impact || "minor",
      help: generatePlainFlag(v),
      rawHelp: v.help,
      description: v.description,
      tags: v.tags,
      wcag: wcagRef(v.tags),
      nodeCount: v.nodes.length,
      targets,
      nodes: v.nodes,
      pour, component, affected,
    };
  }

  function inferTaskLabel(issue) {
    const target = issue.targets[0];
    const text = [
      target && target.textContent,
      target && target.closest && target.closest("form") && target.closest("form").textContent,
      document.title,
      location.href,
    ].filter(Boolean).join(" ").toLowerCase();
    if (/checkout|cart|payment|billing|order/.test(text)) return "Checkout";
    if (/signup|sign-up|register/.test(text)) return "Sign-up";
    if (/login|log-in|signin|sign-in|account/.test(text)) return "Log in";
    return "Checkout / sign-up / login flow";
  }

  async function runScan() {
    const rescanBtn = shadowRoot.getElementById("a11y-rescan-btn");
    rescanBtn.disabled = true;
    rescanBtn.textContent = "Scanning…";
    announce("Scanning page for accessibility issues.");
    updatePageMeta();

    try {
      const elementCount = document.querySelectorAll("*").length;
      const largeDomWarning = elementCount > LARGE_DOM_THRESHOLD;

      const injectResult = await sendMessage({ type: "A11Y_INJECT_AXE" });
      if (!injectResult || !injectResult.ok) {
        throw new Error("This page blocks script injection, so it can't be scanned.");
      }
      if (typeof window.axe === "undefined") {
        throw new Error("axe-core failed to load on this page.");
      }

      const results = await withTimeout(
        window.axe.run(document, { runOnly: { type: "tag", values: WCAG_TAGS } }),
        SCAN_TIMEOUT_MS,
        "Scan timed out — this page may be unusually large or complex."
      );

      const axeIssues = results.violations.map(normalizeAxeViolation);
      const { issues: customIssues, reviewIframes } = checks.runScoredChecks(document);
      const allIssues = [...axeIssues, ...customIssues];
      const humanReview = checks.runHumanReview(document, reviewIframes);

      const scored = scoring.computeScores(allIssues, document, location.href);
      scored.issues.forEach((issue) => {
        issue.taskLabel = (issue.elementCritical || issue.pageCritical) ? inferTaskLabel(issue) : null;
      });

      currentScan = {
        design: scored.design,
        code: scored.code,
        issues: scored.issues,
        humanReview,
        pageCritical: scored.pageCritical,
        largeDomWarning,
        elementCount,
      };

      const saveResult = await sendMessage({
        type: "A11Y_SAVE_SCAN",
        url: location.href,
        entry: { ts: Date.now(), design: scored.design, code: scored.code },
      });
      const historyResult = await sendMessage({ type: "A11Y_GET_SCAN_HISTORY", url: location.href });
      scanHistory = (historyResult && historyResult.scans) || [];

      renderIssuesTab();
      renderFixesTab();
      if (activeTabId === "executive") renderExecutiveTab();

      announce(
        `Scan complete. Design score ${scored.design}. Code score ${scored.code}. ${allIssues.reduce((a, i) => a + (i.nodeCount || 0), 0)} issue instances found.`
      );
    } catch (err) {
      showError(err && err.message ? err.message : "Could not complete the scan.");
      announce("Scan failed.");
    } finally {
      rescanBtn.disabled = false;
      rescanBtn.textContent = "Re-scan";
    }
  }

  // ---------- Highlight on click ----------
  function highlightElement(targetEl) {
    if (!targetEl) return;
    if (highlightedEl) {
      highlightedEl.style.outline = "";
      highlightedEl.style.outlineOffset = "";
    }
    clearTimeout(highlightTimer);
    targetEl.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
    targetEl.style.outline = "3px solid #ff5f3a";
    targetEl.style.outlineOffset = "2px";
    highlightedEl = targetEl;
    highlightTimer = setTimeout(() => {
      targetEl.style.outline = "";
      targetEl.style.outlineOffset = "";
      highlightedEl = null;
    }, 3000);
  }

  // ---------- Issues tab ----------
  const POUR_ORDER = ["Perceivable", "Operable", "Understandable", "Robust"];
  const COMPONENT_ORDER = ["buttons", "forms", "navigation", "media", "content", "structure"];

  function groupIssues(issues, mode) {
    const order = mode === "pour" ? POUR_ORDER : COMPONENT_ORDER;
    const groups = new Map(order.map((k) => [k, []]));
    issues.forEach((issue) => {
      const key = mode === "pour" ? issue.pour : issue.component;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(issue);
    });
    return Array.from(groups.entries()).filter(([, list]) => list.length);
  }

  function renderIssuesTab() {
    const panel = panelFor("issues");
    panel.innerHTML = "";

    if (currentScan.largeDomWarning) {
      panel.appendChild(
        el("div", {
          class: "a11y-error-banner",
          text: `This page has ${currentScan.elementCount.toLocaleString()} elements — scan results may take a moment and could miss edge cases on very deep DOM trees.`,
        })
      );
    }

    const scores = el("div", { class: "a11y-scores" }, [
      el("div", { class: "a11y-score-card" }, [
        el("div", { class: "a11y-score-num", text: String(currentScan.design) }),
        el("div", { class: "a11y-score-label", text: "Automated design score" }),
      ]),
      el("div", { class: "a11y-score-card" }, [
        el("div", { class: "a11y-score-num", text: String(currentScan.code) }),
        el("div", { class: "a11y-score-label", text: "Automated code score" }),
      ]),
    ]);
    panel.appendChild(scores);
    panel.appendChild(
      el("p", {
        class: "a11y-disclaimer",
        text: "Automated checks catch only a portion of real barriers. This is a starting point, not a certification.",
      })
    );

    const details = el("details", { class: "a11y-formula" });
    details.appendChild(el("summary", { text: "How is this calculated?" }));
    details.appendChild(el("p", { text: scoring.FORMULA_EXPLANATION }));
    panel.appendChild(details);

    const toggleRow = el("div", { class: "a11y-group-toggle", role: "group", "aria-label": "Group issues by" }, [
      el("button", {
        "aria-pressed": groupMode === "pour" ? "true" : "false",
        text: "By POUR principle",
        onclick: () => { groupMode = "pour"; renderIssuesTab(); },
      }),
      el("button", {
        "aria-pressed": groupMode === "component" ? "true" : "false",
        text: "By component",
        onclick: () => { groupMode = "component"; renderIssuesTab(); },
      }),
    ]);
    panel.appendChild(toggleRow);

    const scoredIssues = currentScan.issues.filter((i) => i.nodeCount > 0);
    if (!scoredIssues.length) {
      panel.appendChild(el("p", { class: "a11y-empty-state", text: "No automated issues found. Nice — but remember this only covers what's measurable." }));
    } else {
      groupIssues(scoredIssues, groupMode).forEach(([groupName, list]) => {
        panel.appendChild(el("div", { class: "a11y-group-heading", text: `${groupName} (${list.length})` }));
        list.forEach((issue) => panel.appendChild(renderIssueCard(issue)));
      });
    }

    if (currentScan.humanReview.length) {
      panel.appendChild(el("div", { class: "a11y-group-heading", text: "Needs human review (not scored)" }));
      currentScan.humanReview.forEach((item) => {
        panel.appendChild(
          el("div", { class: "a11y-issue-card" }, [
            el("p", { class: "a11y-issue-flag", text: item.title }),
            el("p", { class: "a11y-issue-affected", text: item.why }),
          ])
        );
      });
    }
  }

  function renderIssueCard(issue) {
    const card = el("div", { class: `a11y-issue-card impact-${issue.impact}` });
    const flagBtn = el("button", {
      class: "a11y-issue-flag",
      text: issue.help,
      onclick: () => highlightElement(issue.targets[0]),
    });
    card.appendChild(flagBtn);
    card.appendChild(el("p", { class: "a11y-issue-affected", text: issue.affected }));

    const meta = el("div", { class: "a11y-issue-meta" }, [
      el("span", { class: "a11y-badge", text: issue.impact }),
      el("span", { class: "a11y-badge", text: `${issue.nodeCount} on page` }),
    ]);
    if (issue.taskLabel) {
      meta.appendChild(el("span", { class: "a11y-badge blocks", text: `Blocks task: ${issue.taskLabel}` }));
    } else {
      meta.appendChild(el("span", { class: "a11y-badge", text: "Blocks a task: no" }));
    }
    card.appendChild(meta);

    const actions = el("div", { class: "a11y-card-actions" }, [
      el("button", { text: "Highlight on page", onclick: () => highlightElement(issue.targets[0]) }),
      el("button", { text: "See suggested fix →", onclick: () => { switchTab("fixes"); scrollToFix(issue.id); } }),
    ]);
    card.appendChild(actions);
    return card;
  }

  // ---------- Fixes tab ----------
  const appliedCustomUndos = new Map(); // cardId -> undo function (every fix type, incl. those also tracked in fixes.js)
  const customPatchTexts = new Map(); // cardId -> patch text, only for fixes fixes.js's own patch map can't see (label insertion)
  let fixCounter = 0;

  function buildFixDescriptors(issue) {
    const fixesOut = [];
    const el0 = issue.targets[0];
    if (!el0) return fixesOut;

    if (issue.id === "color-contrast" || issue.id === "color-contrast-enhanced") {
      issue.nodes.slice(0, 3).forEach((node) => {
        const selector = Array.isArray(node.target) ? node.target[node.target.length - 1] : node.target;
        let targetEl;
        try { targetEl = typeof selector === "string" ? document.querySelector(selector) : null; } catch { targetEl = null; }
        if (!targetEl) return;
        const check = node.any && node.any.find((a) => a.data && a.data.fgColor);
        if (!check) return;
        const target = parseFloat(check.data.expectedContrastRatio) || 4.5;
        const result = fixes.suggestContrastFix(check.data.fgColor, check.data.bgColor, target);
        if (!result) return;
        fixesOut.push({
          issue, element: targetEl, kind: "design",
          title: "Adjust text color for contrast",
          originalText: `color: ${result.originalHex}; /* on background ${check.data.bgColor} */`,
          suggestedText: `color: ${result.suggestedHex};`,
          why: `Ratio goes from ${result.originalRatio}:1 to ${result.newRatio}:1 (target ${result.targetRatio}:1).`,
          swatches: { from: result.originalHex, to: result.suggestedHex },
          apply: () => {
            fixes.applyStylePatch(targetEl, `color: ${result.suggestedHex} !important;`);
            return () => fixes.undo(targetEl);
          },
        });
      });
    }

    if (issue.id === "target-size") {
      issue.targets.slice(0, 3).forEach((targetEl) => {
        const suggestion = fixes.suggestTargetSizeFix(targetEl);
        if (!suggestion) return;
        fixesOut.push({
          issue, element: targetEl, kind: "design",
          title: "Increase tap target size",
          originalText: suggestion.original,
          suggestedText: suggestion.suggested,
          why: suggestion.why,
          apply: () => {
            fixes.applyStylePatch(targetEl, suggestion.suggested);
            return () => fixes.undo(targetEl);
          },
        });
      });
    }

    if (["label", "aria-input-field-name", "select-name", "form-field-multiple-labels"].includes(issue.id)) {
      const suggestion = fixes.suggestLabelFix(el0);
      fixesOut.push({
        issue, element: el0, kind: "code",
        title: "Add an associated label",
        originalText: suggestion.original,
        suggestedText: suggestion.suggested,
        why: suggestion.why,
        needsHumanConfirmation: suggestion.needsHumanConfirmation,
        patchText: () => suggestion.suggested,
        apply: () => {
          const label = document.createElement("label");
          label.textContent = suggestion.suggested.match(/>([^<]*)<\/label>/)?.[1] || "Field label";
          let idWasSet = false;
          if (!el0.id) { el0.id = suggestion.id; idWasSet = true; }
          label.htmlFor = el0.id;
          el0.parentNode.insertBefore(label, el0);
          return () => { label.remove(); if (idWasSet) el0.removeAttribute("id"); };
        },
      });
    }

    if (["button-name", "input-button-name", "link-name", "aria-command-name"].includes(issue.id)) {
      const suggestion = fixes.suggestNameFix(el0);
      fixesOut.push({
        issue, element: el0, kind: "code",
        title: "Add an accessible name",
        originalText: suggestion.original,
        suggestedText: suggestion.suggested,
        why: suggestion.why,
        needsHumanConfirmation: suggestion.needsHumanConfirmation,
        apply: () => {
          const label = suggestion.suggested.match(/aria-label="([^"]*)"/)?.[1] || "Describe this control";
          fixes.applyAttrPatch(el0, "aria-label", label);
          return () => fixes.undo(el0);
        },
      });
    }

    if (["image-alt", "input-image-alt", "role-img-alt", "svg-img-alt", "image-redundant-alt"].includes(issue.id)) {
      const suggestion = fixes.suggestAltFix(el0);
      fixesOut.push({
        issue, element: el0, kind: "code",
        title: "Add placeholder alt text",
        originalText: suggestion.original,
        suggestedText: suggestion.suggested,
        why: suggestion.why,
        needsHumanConfirmation: true,
        apply: () => {
          const alt = suggestion.suggested.match(/alt="([^"]*)"/)?.[1] || "[describe image]";
          fixes.applyAttrPatch(el0, "alt", alt);
          return () => fixes.undo(el0);
        },
      });
    }

    return fixesOut;
  }

  function applyGlobalFocusFix() {
    if (focusFixStyleEl) return;
    focusFixStyleEl = document.createElement("style");
    focusFixStyleEl.setAttribute("data-a11y-intel", "focus-fix");
    focusFixStyleEl.textContent =
      "a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, [tabindex]:focus-visible { outline: 3px solid #005fcc !important; outline-offset: 2px !important; }";
    document.head.appendChild(focusFixStyleEl);
  }
  function removeGlobalFocusFix() {
    if (focusFixStyleEl) { focusFixStyleEl.remove(); focusFixStyleEl = null; }
  }

  function scrollToFix(issueId) {
    const target = shadowRoot.querySelector(`[data-fix-issue="${issueId}"]`);
    if (target) target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  }

  function renderFixesTab() {
    const panel = panelFor("fixes");
    panel.innerHTML = "";

    const globalActions = el("div", { class: "a11y-actions", style: "margin-bottom:10px;flex-wrap:wrap;" }, [
      el("button", { class: "a11y-btn", text: "Add visible focus styles (all controls)", onclick: () => { applyGlobalFocusFix(); announce("Preview applied: visible focus styles added."); } }),
      el("button", { class: "a11y-btn", text: "Reset all previews", onclick: resetAllFixes }),
      el("button", { class: "a11y-btn", text: "Copy patch", onclick: copyPatch }),
      el("button", { class: "a11y-btn", text: "Open PR", disabled: "true", title: "Coming soon" }),
    ]);
    panel.appendChild(globalActions);

    const fixableIssues = (currentScan.issues || []).filter((i) => i.nodeCount > 0 && i.targets[0]);
    let any = false;
    fixableIssues.forEach((issue) => {
      const descriptors = buildFixDescriptors(issue);
      descriptors.forEach((fd) => {
        any = true;
        panel.appendChild(renderFixCard(fd, issue.id));
      });
    });
    if (!any) {
      panel.appendChild(el("p", { class: "a11y-empty-state", text: "Run a scan to see fix suggestions here, or no auto-fixable issues were found this scan." }));
    }
  }

  function renderFixCard(fd, issueId) {
    const cardId = `fix-${fixCounter++}`;
    const card = el("div", { class: "a11y-fix-card", "data-fix-issue": issueId });
    card.appendChild(el("p", { style: "font-weight:700;font-size:12.5px;margin:0 0 4px;", text: fd.title }));

    if (fd.swatches) {
      card.appendChild(
        el("div", { class: "a11y-swatch-row" }, [
          el("span", { class: "a11y-swatch", style: `background:${fd.swatches.from}` }),
          el("span", { text: fd.swatches.from }),
          el("span", { text: "→" }),
          el("span", { class: "a11y-swatch", style: `background:${fd.swatches.to}` }),
          el("span", { text: fd.swatches.to }),
        ])
      );
    }

    const diff = el("div", { class: "a11y-fix-diff" }, [
      el("div", {}, [el("div", { class: "label", text: "Original" }), el("pre", { text: fd.originalText })]),
      el("div", {}, [el("div", { class: "label", text: "Suggested" }), el("pre", { text: fd.suggestedText })]),
    ]);
    card.appendChild(diff);
    card.appendChild(el("p", { style: "font-size:11.5px;color:#333;margin:4px 0;", text: fd.why }));
    if (fd.needsHumanConfirmation) {
      card.appendChild(el("span", { class: "a11y-needs-human", text: "Needs human confirmation" }));
    }

    const applyBtn = el("button", { text: "Apply preview" });
    const undoBtn = el("button", { text: "Undo", disabled: "true" });
    applyBtn.addEventListener("click", () => {
      const undoFn = fd.apply();
      appliedCustomUndos.set(cardId, undoFn);
      if (fd.patchText) customPatchTexts.set(cardId, fd.patchText());
      applyBtn.disabled = true;
      undoBtn.disabled = false;
      announce(`Preview applied: ${fd.title}.`);
    });
    undoBtn.addEventListener("click", () => {
      const undoFn = appliedCustomUndos.get(cardId);
      if (undoFn) undoFn();
      appliedCustomUndos.delete(cardId);
      customPatchTexts.delete(cardId);
      applyBtn.disabled = false;
      undoBtn.disabled = true;
      announce("Preview undone.");
    });
    card.appendChild(el("div", { class: "a11y-card-actions" }, [
      el("button", { text: "Highlight on page", onclick: () => highlightElement(fd.element) }),
      applyBtn,
      undoBtn,
    ]));
    return card;
  }

  function resetAllFixes() {
    appliedCustomUndos.forEach((undoFn) => undoFn());
    appliedCustomUndos.clear();
    customPatchTexts.clear();
    removeGlobalFocusFix();
    renderFixesTab();
    announce("All previews reset.");
  }

  function copyPatch() {
    const styleAttrPatches = fixes.buildCopyPatch(); // contrast / target-size / aria-label / alt fixes
    const labelInsertions = Array.from(customPatchTexts.values()).join("\n\n"); // new <label> elements
    const focusFix = focusFixStyleEl ? focusFixStyleEl.textContent : "";
    const combined = [styleAttrPatches, labelInsertions, focusFix].filter(Boolean).join("\n\n");
    navigator.clipboard.writeText(combined || "/* No previews applied yet */").then(
      () => announce("Patch copied to clipboard."),
      () => announce("Could not copy to clipboard.")
    );
  }

  // ---------- Executive tab ----------
  function renderExecutiveTab() {
    const panel = panelFor("executive");
    panel.innerHTML = "";
    if (!currentScan) {
      panel.appendChild(el("p", { class: "a11y-empty-state", text: "Run a scan first." }));
      return;
    }
    const summary = executive.buildSummary(currentScan, scanHistory);

    panel.appendChild(
      el("div", { class: "a11y-scores" }, [
        el("div", { class: "a11y-score-card" }, [el("div", { class: "a11y-score-num", text: String(currentScan.design) }), el("div", { class: "a11y-score-label", text: "Design" })]),
        el("div", { class: "a11y-score-card" }, [el("div", { class: "a11y-score-num", text: String(currentScan.code) }), el("div", { class: "a11y-score-label", text: "Code" })]),
      ])
    );

    const sparkRow = el("div", { class: "a11y-sparkline-row" }, [
      el("div", { class: "a11y-sparkline-block", html: `${executive.renderSparklineSvg(scanHistory, "design", "#1457c9")}<div>Design trend (${scanHistory.length} scans)</div>` }),
      el("div", { class: "a11y-sparkline-block", html: `${executive.renderSparklineSvg(scanHistory, "code", "#a34d00")}<div>Code trend (${scanHistory.length} scans)</div>` }),
    ]);
    panel.appendChild(sparkRow);

    panel.appendChild(el("div", { class: "a11y-group-heading", text: "Top 3 risks" }));
    const risksList = el("ul", { style: "margin:4px 0 10px;padding-left:18px;font-size:12px;" });
    (summary.risks.length ? summary.risks : ["No automated issues found this scan."]).forEach((r) =>
      risksList.appendChild(el("li", { text: r }))
    );
    panel.appendChild(risksList);

    panel.appendChild(el("div", { class: "a11y-group-heading", text: "Blocked tasks" }));
    const blockedList = el("ul", { style: "margin:4px 0 10px;padding-left:18px;font-size:12px;" });
    (summary.blocked.length ? summary.blocked : ["No blocked critical-path tasks detected."]).forEach((b) =>
      blockedList.appendChild(el("li", { text: b }))
    );
    panel.appendChild(blockedList);

    panel.appendChild(el("div", { class: "a11y-legal-note", text: summary.legalNote }));

    panel.appendChild(
      el("button", {
        class: "a11y-btn primary",
        text: "Export report (HTML)",
        onclick: () => {
          const html = executive.buildReportHtml({
            url: location.href, title: document.title,
            design: currentScan.design, code: currentScan.code,
            issues: currentScan.issues, history: scanHistory,
          });
          executive.downloadText(`accessibility-report-${Date.now()}.html`, html, "text/html");
          announce("Report downloaded.");
        },
      })
    );
  }

  // ---------- Roadmap tab ----------
  function renderRoadmapTab() {
    const panel = panelFor("roadmap");
    panel.innerHTML = "";

    panel.appendChild(el("div", { class: "a11y-group-heading", text: "Secure developer snippet (not built)" }));
    panel.appendChild(el("pre", { class: "a11y-code-snippet", text: roadmap.DEV_SNIPPET }));
    panel.appendChild(el("p", { style: "font-size:11.5px;color:#333;", text: roadmap.SNIPPET_NOTE }));

    panel.appendChild(el("div", { class: "a11y-group-heading", text: "Also on the roadmap" }));
    roadmap.ROADMAP_ITEMS.forEach((item) => {
      const block = el("div", { class: "a11y-roadmap-item" }, [
        el("h4", { text: item.title }),
        el("p", { text: item.body }),
      ]);
      panel.appendChild(block);
    });

    panel.appendChild(
      el("button", {
        class: "a11y-btn",
        text: "Try the vibration alert demo",
        onclick: () => {
          const ok = roadmap.vibrateDemo();
          announce(ok ? "Vibration triggered (if supported by this device)." : "This device/browser doesn't support navigator.vibrate.");
        },
      })
    );

    panel.appendChild(el("div", { class: "a11y-legal-note", text: roadmap.EXCLUSIONS_NOTE }));

    panel.appendChild(el("div", { class: "a11y-group-heading", text: "Competitor snapshot" }));
    const table = el("table", { class: "a11y-competitor-table" }, [
      el("thead", {}, [el("tr", {}, [el("th", { text: "Tool" }), el("th", { text: "What it does" })])]),
      el("tbody", {}, roadmap.COMPETITOR_TABLE.map((row) => el("tr", {}, [el("td", { text: row.name }), el("td", { text: row.note })]))),
    ]);
    panel.appendChild(table);
  }

  init();
})();
