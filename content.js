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
  const { lookup, scoring, checks, fixes, executive, roadmap, styleManager } = ns;
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
  let priorityIndex = -1; // "Fix first" stepper position into currentScan.issues (already priority-sorted)
  const colorLabDraft = { textColor: "#1b1f23", bgColor: "#ffffff", fontSize: 16, lineHeight: 1.5, letterSpacing: 0, wordSpacing: 0, cbType: "protanopia" };
  let activeFilter = "all"; // all | critical | serious | moderate | review | ignored | fixed
  let panelDock = "floating"; // left | right | bottom | floating
  const NUDGE_STEP = 20;
  let panelTheme = "light"; // light | dark | high-contrast
  let keyboardOverlayEls = [];
  const readAloud = { enabled: false, voices: [], voiceURI: null, rate: 1, queue: [], index: -1, speaking: false };

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

    const saved = await chrome.storage.local.get(["chameleonDyslexia"]);
    if (saved.chameleonDyslexia) {
      styleManager.setState("dyslexia", { enabled: true });
      shadowRoot.getElementById("a11y-dyslexia-btn").setAttribute("aria-pressed", "true");
    }
    await loadDockPreference();
    await loadPanelPosition();
    await loadThemePreference();
    maybeShowFirstRunTour();

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

  // Real logo art: assets/chameleon-logo-source.png, exported to assets/icons/
  // at 16/32/48/64/96/128px (see scripts in the repo history / README). Decorative
  // everywhere it appears — the visible "Chameleon" text or aria-label already
  // names it, so alt="" keeps it from being announced twice.
  const LOGO_SRC = (assetSize) => chrome.runtime.getURL(`assets/icons/icon${assetSize}.png`);
  const LOGO_IMG = (displaySize, assetSize = 64) => `<img src="${LOGO_SRC(assetSize)}" width="${displaySize}" height="${displaySize}" alt="" />`;

  function buildDom() {
    toggleBtn = el("button", {
      id: "a11y-toggle",
      "aria-label": "Open Chameleon",
      "aria-expanded": "false",
      onclick: () => (panelEl.hidden ? openPanel() : closePanel()),
    });
    toggleBtn.innerHTML = LOGO_IMG(32);
    const badge = el("span", { id: "a11y-toggle-badge", "aria-hidden": "true", hidden: "true" });
    toggleBtn.appendChild(badge);
    shadowRoot.appendChild(toggleBtn);

    liveRegion = el("div", { class: "a11y-live-region", "aria-live": "polite", role: "status" });
    shadowRoot.appendChild(liveRegion);

    panelEl = el("div", {
      id: "a11y-panel",
      role: "dialog",
      "aria-label": "Chameleon — accessibility triage",
      hidden: "true",
      onkeydown: (e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          closePanel();
          return;
        }
        const ARROWS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
        if (ARROWS[e.key] && panelDock === "floating" && shadowRoot.activeElement && shadowRoot.activeElement.closest(".a11y-position-menu")) {
          e.preventDefault();
          const step = e.shiftKey ? NUDGE_STEP * 3 : NUDGE_STEP;
          const [dx, dy] = ARROWS[e.key];
          nudgePanel(dx * step, dy * step);
        }
      },
    });

    const header = el("div", { class: "a11y-header" }, [
      el("div", { class: "a11y-header-row a11y-drag-handle", id: "a11y-drag-handle" }, [
        el("div", {}, [
          el("p", { class: "a11y-title" }, [
            el("span", { class: "a11y-title-logo", html: LOGO_IMG(22), "aria-hidden": "true" }),
            el("span", { text: "Chameleon" }),
          ]),
          el("p", { class: "a11y-page-meta", id: "a11y-page-meta" }),
        ]),
        el("button", { class: "a11y-icon-btn", "aria-label": "Close panel", text: "✕", onclick: closePanel }),
      ]),
      el("div", { class: "a11y-actions" }, [
        el("button", { class: "a11y-btn primary", id: "a11y-rescan-btn", text: "Re-scan", onclick: () => runScan() }),
        el("span", { style: "font-size:10.5px;color:#5b6572;align-self:center;", text: "Runs locally. Nothing leaves your browser." }),
      ]),
      el("div", { class: "a11y-actions", style: "margin-top:6px;" }, [
        el("button", {
          class: "a11y-btn", id: "a11y-dyslexia-btn", "aria-pressed": "false",
          text: "Dyslexia-friendly font",
          onclick: toggleDyslexiaMode,
        }),
        el("button", { class: "a11y-btn", text: "Reset page", onclick: resetPage }),
      ]),
      el("div", { class: "a11y-actions", style: "margin-top:6px;" }, [
        el("button", {
          class: "a11y-btn", id: "a11y-sound-alt-btn", "aria-pressed": "false",
          text: "Sound alternatives",
          onclick: toggleSoundAlternatives,
        }),
        el("button", {
          class: "a11y-btn", id: "a11y-readaloud-btn", "aria-pressed": "false",
          text: "🔊 Read aloud",
          onclick: toggleReadAloud,
        }),
      ]),
      el("div", { id: "a11y-readaloud-bar", class: "a11y-readaloud-bar", hidden: "true" }),
      buildPositionMenu(),
    ]);
    panelEl.appendChild(header);

    const tabOrder = ["issues", "fixes", "colorlab", "reader", "executive", "roadmap"];
    const tabs = [
      ["issues", "Issues"],
      ["fixes", "Fixes"],
      ["colorlab", "Color Lab"],
      ["reader", "Screen Reader"],
      ["executive", "Executive"],
      ["roadmap", "Roadmap"],
    ];
    const tablist = el(
      "div",
      {
        class: "a11y-tablist", role: "tablist", "aria-label": "Chameleon sections",
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
    renderColorLabTab();
    renderScreenReaderTab();
    makePanelDraggable();
  }

  // Short display label for a URL — just the site name (e.g. "walmart.com"), never
  // the full path/query string. Used anywhere a URL is shown to a human; storage
  // keys, exports, and SARIF locations still use the real, full location.href.
  function shortSiteLabel(urlStr) {
    try {
      const u = new URL(urlStr);
      if (u.protocol === "file:") {
        return u.pathname.split("/").filter(Boolean).pop() || "local file";
      }
      return u.hostname.replace(/^www\./, "");
    } catch {
      return urlStr;
    }
  }

  function updatePageMeta() {
    shadowRoot.getElementById("a11y-page-meta").textContent = `${document.title} — ${shortSiteLabel(location.href)}`;
  }

  function panelFor(id) { return shadowRoot.getElementById(`a11y-panel-${id}`); }

  function switchTab(id) {
    activeTabId = id;
    ["issues", "fixes", "colorlab", "reader", "executive", "roadmap"].forEach((t) => {
      const tabBtn = shadowRoot.getElementById(`a11y-tab-${t}`);
      tabBtn.setAttribute("aria-selected", t === id ? "true" : "false");
      tabBtn.tabIndex = t === id ? 0 : -1;
      panelFor(t).hidden = t === id ? false : true;
    });
    if (id === "executive") renderExecutiveTab();
  }

  // Launcher pulse (spec section 9): logo color never changes, only a soft ring
  // pulses around it — max 3 pulses, never a hard flash, off under
  // prefers-reduced-motion (static badge only, same as after the pulses finish).
  function updateLauncherBadge(criticalCount, shouldPulse) {
    const badge = shadowRoot.getElementById("a11y-toggle-badge");
    if (!badge) return;
    if (criticalCount > 0) {
      badge.textContent = String(criticalCount);
      badge.hidden = false;
      toggleBtn.setAttribute("aria-label", `Open Chameleon — ${criticalCount} critical issue${criticalCount > 1 ? "s" : ""} found`);
    } else {
      badge.hidden = true;
      toggleBtn.setAttribute("aria-label", "Open Chameleon");
    }
    if (shouldPulse && !prefersReducedMotion()) {
      toggleBtn.classList.remove("pulsing");
      void toggleBtn.offsetWidth; // restart the animation if it's already mid-run
      toggleBtn.classList.add("pulsing");
      setTimeout(() => toggleBtn.classList.remove("pulsing"), 3100); // 3 pulses at ~1s each
    }
  }

  // ---------- Panel positioning (spec section 9) ----------
  // Real mouse-drag-to-reposition, drag-to-resize, and minimize/collapse are NOT
  // built here — this covers the keyboard-operable alternative the spec requires
  // regardless: a Position menu, plus arrow-key nudging while docked floating.
  function buildPositionMenu() {
    const details = el("details", { class: "a11y-position-menu" });
    details.appendChild(el("summary", { text: "Position" }));
    const row = el("div", { class: "a11y-group-toggle", role: "group", "aria-label": "Dock position" });
    [["left", "Left"], ["right", "Right"], ["bottom", "Bottom"], ["floating", "Floating"]].forEach(([key, label]) => {
      row.appendChild(
        el("button", {
          "aria-pressed": String(panelDock === key),
          text: label,
          onclick: () => setDock(key),
        })
      );
    });
    details.appendChild(row);
    details.appendChild(el("p", { class: "a11y-disclaimer", style: "margin:6px 0 0;", text: "While floating: focus this \"Position\" control, then use arrow keys to nudge the panel (Shift = bigger step)." }));

    details.appendChild(el("div", { class: "a11y-group-heading", style: "margin-top:10px;", text: "Theme" }));
    const themeRow = el("div", { class: "a11y-group-toggle", role: "group", "aria-label": "Panel theme" });
    [["light", "Light"], ["dark", "Dark"], ["high-contrast", "High contrast"]].forEach(([key, label]) => {
      themeRow.appendChild(
        el("button", { id: `a11y-theme-${key}`, "aria-pressed": String(panelTheme === key), text: label, onclick: () => setTheme(key) })
      );
    });
    details.appendChild(themeRow);
    return details;
  }

  function applyDockClass() {
    panelEl.classList.remove("dock-left", "dock-right", "dock-bottom", "dock-floating");
    panelEl.classList.add(`dock-${panelDock}`);
    if (panelDock !== "floating") {
      panelEl.style.left = "";
      panelEl.style.top = "";
    }
  }

  function setDock(key) {
    panelDock = key;
    applyDockClass();
    chrome.storage.local.set({ [`chameleonDock:${location.hostname}`]: key });
    shadowRoot.querySelectorAll(".a11y-position-menu button").forEach((b) => b.setAttribute("aria-pressed", String(b.textContent.toLowerCase() === key)));
    announce(`Panel docked ${key}.`);
  }

  async function loadDockPreference() {
    const data = await chrome.storage.local.get([`chameleonDock:${location.hostname}`]);
    const saved = data[`chameleonDock:${location.hostname}`];
    if (saved) { panelDock = saved; applyDockClass(); }
  }

  function setTheme(key) {
    panelTheme = key;
    if (key === "light") host.removeAttribute("data-theme");
    else host.setAttribute("data-theme", key);
    chrome.storage.local.set({ chameleonTheme: key });
    shadowRoot.querySelectorAll('[id^="a11y-theme-"]').forEach((b) => b.setAttribute("aria-pressed", String(b.id === `a11y-theme-${key}`)));
    announce(`${key === "high-contrast" ? "High contrast" : key[0].toUpperCase() + key.slice(1)} theme applied.`);
  }

  async function loadThemePreference() {
    const data = await chrome.storage.local.get(["chameleonTheme"]);
    if (data.chameleonTheme) setTheme(data.chameleonTheme);
  }

  function clampToViewport(left, top, rect) {
    const maxLeft = window.innerWidth - rect.width - 4;
    const maxTop = window.innerHeight - rect.height - 4;
    return [Math.min(Math.max(4, left), maxLeft), Math.min(Math.max(4, top), maxTop)];
  }

  function nudgePanel(dx, dy) {
    const rect = panelEl.getBoundingClientRect();
    if (!panelEl.style.left) { panelEl.style.left = `${rect.left}px`; panelEl.style.top = `${rect.top}px`; panelEl.style.right = "auto"; panelEl.style.bottom = "auto"; }
    const [newLeft, newTop] = clampToViewport(rect.left + dx, rect.top + dy, rect);
    panelEl.style.left = `${newLeft}px`;
    panelEl.style.top = `${newTop}px`;
    savePanelPosition(newLeft, newTop);
  }

  function savePanelPosition(left, top) {
    chrome.storage.local.set({ [`chameleonPanelPos:${location.hostname}`]: { left, top } });
  }

  async function loadPanelPosition() {
    const data = await chrome.storage.local.get([`chameleonPanelPos:${location.hostname}`]);
    const pos = data[`chameleonPanelPos:${location.hostname}`];
    if (pos && panelDock === "floating") {
      panelEl.style.left = `${pos.left}px`;
      panelEl.style.top = `${pos.top}px`;
      panelEl.style.right = "auto";
      panelEl.style.bottom = "auto";
    }
  }

  // Real click-and-drag repositioning (spec section 9) — grab the title bar
  // anywhere that isn't a button and drag freely; it's not constrained to the
  // Position menu's four presets. Uses Pointer Events + setPointerCapture so the
  // drag keeps tracking even if the cursor leaves the title bar or the window
  // mid-drag. Dragging always wins over whatever dock was active — grabbing the
  // title bar undocks the panel into floating mode, same as dragging a maximized
  // OS window's title bar un-maximizes it. The Position menu + arrow-key nudge
  // remain as the fully keyboard-operable equivalent; this doesn't replace them.
  function makePanelDraggable() {
    const handle = shadowRoot.getElementById("a11y-drag-handle");
    let dragging = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;

    handle.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button, a, input, select, textarea")) return; // let real controls work normally
      if (e.button !== undefined && e.button !== 0) return; // left-click / primary touch only
      dragging = true;
      const rect = panelEl.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      if (panelDock !== "floating") {
        panelDock = "floating";
        applyDockClass();
        chrome.storage.local.set({ [`chameleonDock:${location.hostname}`]: "floating" });
        shadowRoot.querySelectorAll(".a11y-position-menu button").forEach((b) => b.setAttribute("aria-pressed", String(b.textContent === "Floating")));
      }
      panelEl.style.left = `${startLeft}px`;
      panelEl.style.top = `${startTop}px`;
      panelEl.style.right = "auto";
      panelEl.style.bottom = "auto";
      handle.setPointerCapture(e.pointerId);
      handle.classList.add("dragging");
      e.preventDefault();
    });

    handle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const rect = panelEl.getBoundingClientRect();
      const [newLeft, newTop] = clampToViewport(startLeft + (e.clientX - startX), startTop + (e.clientY - startY), rect);
      panelEl.style.left = `${newLeft}px`;
      panelEl.style.top = `${newTop}px`;
    });

    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove("dragging");
      try { handle.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      const rect = panelEl.getBoundingClientRect();
      savePanelPosition(rect.left, rect.top);
    };
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);
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

  let toastEl = null;
  let toastTimer = null;
  function announce(msg) {
    liveRegion.textContent = "";
    requestAnimationFrame(() => (liveRegion.textContent = msg));
    // Sound alternatives (spec section 7): Chameleon's own feedback is never
    // sound-only to begin with, but when this mode is on we also surface it as a
    // visible banner so it's unmissable, not just programmatically announced.
    if (styleManager.getState("soundAlternatives").enabled) {
      if (!toastEl) {
        toastEl = el("div", { class: "a11y-toast" });
        shadowRoot.appendChild(toastEl);
      }
      toastEl.textContent = msg;
      toastEl.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toastEl.hidden = true; }, 4000);
    }
  }

  // ---------- Page style manager controls (spec 0.7 / section 4) ----------
  function toggleDyslexiaMode() {
    const next = !styleManager.getState("dyslexia").enabled;
    styleManager.setState("dyslexia", { enabled: next });
    chrome.storage.local.set({ chameleonDyslexia: next });
    const btn = shadowRoot.getElementById("a11y-dyslexia-btn");
    btn.setAttribute("aria-pressed", String(next));
    announce(next ? "Dyslexia-friendly font turned on." : "Dyslexia-friendly font turned off.");
  }

  function toggleSoundAlternatives() {
    const next = !styleManager.getState("soundAlternatives").enabled;
    styleManager.setState("soundAlternatives", { enabled: next });
    const btn = shadowRoot.getElementById("a11y-sound-alt-btn");
    btn.setAttribute("aria-pressed", String(next));
    announce(next ? "Sound alternatives on: media shows caption/transcript badges, and Chameleon's own messages now also appear as visible banners." : "Sound alternatives off.");
  }

  function resetPage() {
    styleManager.resetAll();
    const dyslexiaBtn = shadowRoot.getElementById("a11y-dyslexia-btn");
    if (dyslexiaBtn) dyslexiaBtn.setAttribute("aria-pressed", "false");
    const soundBtn = shadowRoot.getElementById("a11y-sound-alt-btn");
    if (soundBtn) soundBtn.setAttribute("aria-pressed", "false");
    chrome.storage.local.set({ chameleonDyslexia: false });
    announce("Page reset. All Chameleon display changes cleared.");
  }

  // ---------- Read Aloud (spec section 8) ----------
  // Only ever offers localService voices, so speech never leaves the browser —
  // if none exist, stays off and says so, rather than silently using a remote voice.
  function loadLocalVoices() {
    readAloud.voices = speechSynthesis.getVoices().filter((v) => v.localService);
    if (!readAloud.voiceURI && readAloud.voices.length) readAloud.voiceURI = readAloud.voices[0].voiceURI;
  }
  if (typeof speechSynthesis !== "undefined") {
    loadLocalVoices();
    speechSynthesis.addEventListener("voiceschanged", loadLocalVoices);
  }

  function splitSentences(text) {
    return (text || "")
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function stopReadAloud() {
    speechSynthesis.cancel();
    readAloud.speaking = false;
    readAloud.queue = [];
    readAloud.index = -1;
    clearReadingHighlight();
    updateReadAloudNow("");
  }

  function clearReadingHighlight() {
    const prev = shadowRoot.querySelector(".a11y-reading");
    if (prev) prev.classList.remove("a11y-reading");
  }

  function updateReadAloudNow(text) {
    const now = shadowRoot.getElementById("a11y-readaloud-now");
    if (now) now.textContent = text;
  }

  function speakNext() {
    readAloud.index += 1;
    if (readAloud.index >= readAloud.queue.length) {
      readAloud.speaking = false;
      clearReadingHighlight();
      updateReadAloudNow("");
      return;
    }
    const item = readAloud.queue[readAloud.index];
    clearReadingHighlight();
    if (item.cardEl) item.cardEl.classList.add("a11y-reading");
    updateReadAloudNow(item.text);
    const utterance = new SpeechSynthesisUtterance(item.text);
    const voice = readAloud.voices.find((v) => v.voiceURI === readAloud.voiceURI);
    if (voice) utterance.voice = voice;
    utterance.rate = readAloud.rate;
    utterance.onend = () => { if (readAloud.speaking) speakNext(); };
    utterance.onerror = () => { if (readAloud.speaking) speakNext(); };
    speechSynthesis.speak(utterance);
  }

  function speakQueue(items) {
    if (!readAloud.voices.length) {
      announce("No on-device voice is available for Read aloud, so it's staying off — nothing is sent off your device to speak text.");
      return;
    }
    speechSynthesis.cancel();
    readAloud.queue = items.filter((i) => i.text && i.text.trim());
    readAloud.index = -1;
    readAloud.speaking = true;
    speakNext();
  }

  function readThisIssue(issue, cardEl) {
    if (!readAloud.enabled) toggleReadAloud();
    speakQueue([{ text: issue.help, cardEl }, { text: issue.affected || issue.description || "", cardEl }]);
  }

  function readPanelSummary() {
    const items = [{ text: `Design score ${currentScan.design}, ${scoring.verdictFor(currentScan.design).label}.` }, { text: `Code score ${currentScan.code}, ${scoring.verdictFor(currentScan.code).label}.` }];
    const blockers = getTaskBlockers(currentScan.issues.filter((i) => i.nodeCount > 0));
    blockers.forEach(({ taskLabel, issue }) => items.push({ text: `Task blocker: ${taskLabel}. ${issue.help}` }));
    const cards = Array.from(shadowRoot.querySelectorAll('#a11y-panel-issues .a11y-issue-card:not(.possible)'));
    const openIssues = currentScan.issues.filter((i) => i.nodeCount > 0);
    openIssues.slice(0, 8).forEach((issue, i) => items.push({ text: `${issue.help}. ${issue.affected}`, cardEl: cards[i] }));
    speakQueue(items);
  }

  function readPageContent() {
    const main = document.querySelector("main") || document.body;
    const text = (main.innerText || "").slice(0, 3000);
    speakQueue(splitSentences(text).map((s) => ({ text: s })));
  }

  function buildReadAloudBar() {
    const bar = shadowRoot.getElementById("a11y-readaloud-bar");
    bar.innerHTML = "";
    if (!readAloud.voices.length) {
      bar.appendChild(el("p", { class: "a11y-disclaimer", style: "margin:0;", text: "No on-device voice found — Read aloud needs a localService voice so nothing is sent off your device." }));
      return;
    }
    const voiceSelect = el(
      "select", { "aria-label": "Voice", onchange: (e) => { readAloud.voiceURI = e.target.value; } },
      readAloud.voices.map((v) => el("option", { value: v.voiceURI, text: `${v.name} (${v.lang})`, selected: v.voiceURI === readAloud.voiceURI ? "true" : null }))
    );
    const rateSelect = el(
      "select", { "aria-label": "Speed", onchange: (e) => { readAloud.rate = parseFloat(e.target.value); } },
      [0.75, 1, 1.25, 1.5, 2].map((r) => el("option", { value: String(r), text: `${r}x`, selected: r === readAloud.rate ? "true" : null }))
    );
    bar.appendChild(el("button", { class: "a11y-btn", text: "▶ Read panel", onclick: readPanelSummary }));
    bar.appendChild(el("button", { class: "a11y-btn", text: "⏸ Pause", onclick: () => speechSynthesis.pause() }));
    bar.appendChild(el("button", { class: "a11y-btn", text: "▶ Resume", onclick: () => speechSynthesis.resume() }));
    bar.appendChild(el("button", { class: "a11y-btn", text: "⏹ Stop", onclick: stopReadAloud }));
    bar.appendChild(el("button", { class: "a11y-btn", text: "Read page content", onclick: readPageContent }));
    bar.appendChild(voiceSelect);
    bar.appendChild(rateSelect);
    bar.appendChild(el("div", { id: "a11y-readaloud-now", class: "a11y-readaloud-now" }));
  }

  function toggleReadAloud() {
    readAloud.enabled = !readAloud.enabled;
    const btn = shadowRoot.getElementById("a11y-readaloud-btn");
    btn.setAttribute("aria-pressed", String(readAloud.enabled));
    const bar = shadowRoot.getElementById("a11y-readaloud-bar");
    bar.hidden = !readAloud.enabled;
    if (readAloud.enabled) {
      loadLocalVoices();
      buildReadAloudBar();
      if (currentScan) readPanelSummary();
    } else {
      stopReadAloud();
    }
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

  // ---------- Issue state persistence (Open/Ignored/Fixed/Regressed — spec 0.6) ----------
  // One flat map per URL, keyed by rule id (confirmed issues) or possible-check id
  // (possible-*). "storage" permission already covers direct access from a content
  // script — no background relay needed, unlike the scripting-only calls above.
  async function loadIssueStates(url) {
    const data = await chrome.storage.local.get(["chameleonIssueStates"]);
    const all = data.chameleonIssueStates || {};
    return all[url] || {};
  }

  async function saveAllIssueStates(url, statesForUrl) {
    const data = await chrome.storage.local.get(["chameleonIssueStates"]);
    const all = data.chameleonIssueStates || {};
    all[url] = statesForUrl;
    await chrome.storage.local.set({ chameleonIssueStates: all });
  }

  async function setIssueState(id, state, extra) {
    const states = await loadIssueStates(location.href);
    states[id] = { state, ts: Date.now(), ...extra };
    await saveAllIssueStates(location.href, states);
    return states;
  }

  async function clearIssueState(id) {
    const states = await loadIssueStates(location.href);
    delete states[id];
    await saveAllIssueStates(location.href, states);
    return states;
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
      confidence: "confirmed", // an axe rule actually fired — not a guess
      nodeCount: v.nodes.length,
      targets,
      nodes: v.nodes,
      pour, component, affected,
    };
  }

  function normalizeIncomplete(v) {
    const { affected } = lookup.lookupRule(v.id, v.tags);
    return {
      title: v.help,
      why: `Automation flagged this but can't decide on its own — check: ${v.description || "does this meet the relevant WCAG criterion?"} ${affected ? `(${affected})` : ""}`.trim(),
      reviewed: false,
      source: "axe-incomplete",
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

      // Scores must describe the real page, not a Dyslexia/Color-Lab/High-contrast
      // preview of it — suspend every managed style during the scan (spec 0.7).
      const results = await styleManager.withSuspended(() =>
        withTimeout(
          window.axe.run(document, { runOnly: { type: "tag", values: WCAG_TAGS } }),
          SCAN_TIMEOUT_MS,
          "Scan timed out — this page may be unusually large or complex."
        )
      );

      const axeIssues = results.violations.map(normalizeAxeViolation);
      const { issues: customIssues, reviewIframes } = checks.runScoredChecks(document);
      const allIssues = [...axeIssues, ...customIssues];

      const scored = scoring.computeScores(allIssues, document, location.href);
      scored.issues.forEach((issue) => {
        issue.taskLabel = (issue.elementCritical || issue.pageCritical) ? inferTaskLabel(issue) : null;
      });

      const possibleIssuesRaw = checks.runPossibleChecks(document, scored.pageCritical);
      const humanReview = [
        ...checks.runHumanReview(document, reviewIframes).map((i) => ({ ...i, reviewed: false })),
        ...results.incomplete.map(normalizeIncomplete),
      ];

      // ---- Issue states: Open / Ignored / Fixed / Regressed (spec 0.6) ----
      // Fetch the PREVIOUS scan's confirmed-issue snapshot before we overwrite it,
      // so a rule that was failing last scan and isn't failing now can be
      // auto-marked "Fixed since last scan."
      const preSaveHistory = await sendMessage({ type: "A11Y_GET_SCAN_HISTORY", url: location.href });
      const prevScans = (preSaveHistory && preSaveHistory.scans) || [];
      const prevEntry = prevScans.length ? prevScans[prevScans.length - 1] : null;

      const issueStates = await loadIssueStates(location.href);
      const currentIds = new Set(scored.issues.map((i) => i.id));
      let statesChanged = false;

      if (prevEntry && prevEntry.issueIds) {
        prevEntry.issueIds.forEach((prevId) => {
          const already = issueStates[prevId];
          if (currentIds.has(prevId)) return; // still failing, nothing to do
          if (already && already.state === "ignored") return; // ignored issues don't get auto-fixed banners
          if (already && already.state === "fixed") return; // already recorded
          const snap = (prevEntry.issueSnapshots && prevEntry.issueSnapshots[prevId]) || {};
          issueStates[prevId] = { state: "fixed", auto: true, ts: Date.now(), help: snap.help || prevId, severityLabel: snap.severityLabel || "Moderate" };
          statesChanged = true;
        });
      }

      const openIssues = [];
      scored.issues.forEach((issue) => {
        const st = issueStates[issue.id];
        if (st && st.state === "ignored") {
          issue.state = "ignored";
          issue.ignoreReason = st.reason || null;
          // Not pushed to openIssues — lives only in ignoredEntries below, so the
          // main Issues list, Fix-first stepper, and Fixes tab skip it naturally.
        } else if (st && st.state === "fixed") {
          // Was marked fixed before, but it's back — regressed, reopen it.
          issue.state = "open";
          issue.regressed = true;
          delete issueStates[issue.id];
          statesChanged = true;
          openIssues.push(issue);
        } else {
          issue.state = "open";
          openIssues.push(issue);
        }
      });

      const ignoredEntries = [];
      const fixedEntries = [];
      Object.entries(issueStates).forEach(([id, st]) => {
        if (id.startsWith("possible-")) return;
        const live = scored.issues.find((i) => i.id === id);
        if (st.state === "ignored") ignoredEntries.push({ id, ...st, live });
        if (st.state === "fixed") fixedEntries.push({ id, ...st });
      });

      // Apply Confirm/Dismiss to Possible findings (also persisted in issueStates,
      // same map — "possible-*" ids never collide with real axe/custom rule ids).
      const possibleIssues = possibleIssuesRaw
        .filter((issue) => !(issueStates[issue.id] && issueStates[issue.id].state === "dismissed"))
        .map((issue) => ({ ...issue, userConfirmed: !!(issueStates[issue.id] && issueStates[issue.id].state === "confirmed") }));

      if (statesChanged) await saveAllIssueStates(location.href, issueStates);

      // Launcher pulse (spec section 9): did any issue that's Critical NOW was not
      // present (by id) in the previous scan? If so, that's "new Critical issues."
      const currentCriticalIds = new Set(scored.issues.filter((i) => i.severityLabel === "Critical").length ? scored.issues.filter((i) => i.severityLabel === "Critical").map((i) => i.id) : []);
      const prevCriticalIds = new Set(
        prevEntry && prevEntry.issueSnapshots
          ? Object.entries(prevEntry.issueSnapshots).filter(([, snap]) => snap.severityLabel === "Critical").map(([id]) => id)
          : []
      );
      const hasNewCritical = Array.from(currentCriticalIds).some((id) => !prevCriticalIds.has(id));
      updateLauncherBadge(currentCriticalIds.size, hasNewCritical && prevEntry !== null);

      currentScan = {
        design: scored.design,
        code: scored.code,
        issues: openIssues,
        possibleIssues,
        ignoredEntries,
        fixedEntries,
        humanReview,
        pageCritical: scored.pageCritical,
        largeDomWarning,
        elementCount,
        ts: Date.now(),
        stale: false,
      };

      const issueSnapshots = {};
      scored.issues.forEach((i) => { issueSnapshots[i.id] = { help: i.help, severityLabel: i.severityLabel }; });

      const saveResult = await sendMessage({
        type: "A11Y_SAVE_SCAN",
        url: location.href,
        entry: { ts: Date.now(), design: scored.design, code: scored.code, issueIds: Array.from(currentIds), issueSnapshots },
      });
      const historyResult = await sendMessage({ type: "A11Y_GET_SCAN_HISTORY", url: location.href });
      scanHistory = (historyResult && historyResult.scans) || [];
      const prev = scanHistory.length >= 2 ? scanHistory[scanHistory.length - 2] : null;
      currentScan.previousDesign = prev ? prev.design : null;
      currentScan.previousCode = prev ? prev.code : null;

      renderIssuesTab();
      renderFixesTab();
      if (activeTabId === "executive") renderExecutiveTab();

      announce(
        `Scan complete. Design score ${scored.design}. Code score ${scored.code}. ${allIssues.reduce((a, i) => a + (i.nodeCount || 0), 0)} issue instances found.`
      );
    } catch (err) {
      const message = err && err.message ? err.message : "Could not complete the scan.";
      // Demo safety (spec 12.5): never replace a working result with a bare error if
      // we have something to fall back to — show the last good scan, clearly labeled.
      if (currentScan) {
        currentScan.stale = true;
        currentScan.staleError = message;
        renderIssuesTab();
        renderFixesTab();
        if (activeTabId === "executive") renderExecutiveTab();
        announce(`Re-scan failed. Showing cached result from ${new Date(currentScan.ts).toLocaleTimeString()}.`);
      } else {
        showError(message);
        announce("Scan failed.");
      }
    } finally {
      rescanBtn.disabled = false;
      rescanBtn.textContent = "Re-scan";
    }
  }

  // ---------- Highlight on click ----------
  const HIGHLIGHT_COLOR = { Critical: "#d55e00", Serious: "#e69f00", Moderate: "#0072b2" };
  const PULSE_STYLE_ID = "chameleon-highlight-pulse-style";

  function ensurePulseStyle() {
    if (document.getElementById(PULSE_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = PULSE_STYLE_ID;
    // Slow pulse (never a hard flash — box-shadow never drops to zero), capped at 2
    // iterations, fully off under prefers-reduced-motion. Spec 11e / 9.
    style.textContent = `
      @keyframes chameleon-highlight-pulse {
        0%, 100% { box-shadow: 0 0 0 2px var(--chameleon-pulse-color, #0072b2); }
        50% { box-shadow: 0 0 0 7px var(--chameleon-pulse-color, #0072b2); }
      }
      .chameleon-highlight {
        outline: 3px solid var(--chameleon-pulse-color, #0072b2) !important;
        outline-offset: 2px !important;
        animation: chameleon-highlight-pulse 1.4s ease-in-out 2;
      }
      @media (prefers-reduced-motion: reduce) {
        .chameleon-highlight { animation: none; }
      }
    `;
    document.head.appendChild(style);
  }

  function clearHighlight(targetEl) {
    targetEl.classList.remove("chameleon-highlight");
    targetEl.style.removeProperty("--chameleon-pulse-color");
    targetEl.style.outline = "";
    targetEl.style.outlineOffset = "";
  }

  function highlightElement(targetEl, severityLabel) {
    if (!targetEl) return;
    ensurePulseStyle();
    if (highlightedEl) clearHighlight(highlightedEl);
    clearTimeout(highlightTimer);
    targetEl.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
    targetEl.style.setProperty("--chameleon-pulse-color", HIGHLIGHT_COLOR[severityLabel] || "#0072b2");
    targetEl.classList.add("chameleon-highlight");
    highlightedEl = targetEl;
    highlightTimer = setTimeout(() => {
      clearHighlight(targetEl);
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

  const VERDICT_ICON = { good: "✓", ok: "●", warn: "▲", bad: "⛔" };

  function renderScoreCard(label, score, previousScore) {
    const verdict = scoring.verdictFor(score);
    const delta = scoring.scoreDelta(score, previousScore);
    return el("div", { class: `a11y-score-card verdict-${verdict.tone}` }, [
      el("div", { class: "a11y-score-num", text: String(score) }),
      el("div", { class: "a11y-score-label", text: label }),
      el("div", { class: "a11y-verdict", text: `${VERDICT_ICON[verdict.tone]} ${verdict.label}` }),
      delta ? el("div", { class: "a11y-delta", text: delta }) : null,
    ]);
  }

  // Distinct task names blocked this scan, each paired with its single
  // highest-priority blocking issue (currentScan.issues is already sorted by
  // penalty desc, so first match per task name wins). Spec 11d / 12.3.
  function getTaskBlockers(issues) {
    const seen = new Map();
    issues.forEach((issue) => {
      if (!issue.taskLabel) return;
      if (!seen.has(issue.taskLabel)) seen.set(issue.taskLabel, issue);
    });
    return Array.from(seen.entries()).map(([taskLabel, issue]) => ({ taskLabel, issue }));
  }

  function goToPriorityIssue(index) {
    const issues = (currentScan.issues || []).filter((i) => i.nodeCount > 0);
    if (!issues.length) return;
    priorityIndex = Math.min(Math.max(index, 0), issues.length - 1);
    const issue = issues[priorityIndex];
    highlightElement(issue.targets[0], issue.severityLabel);
    switchTab("fixes");
    scrollToFix(issue.id);
    announce(`Issue ${priorityIndex + 1} of ${issues.length}: ${issue.help}`);
    renderIssuesTab();
  }

  function renderTaskBlockers() {
    const issues = (currentScan.issues || []).filter((i) => i.nodeCount > 0);
    const blockers = getTaskBlockers(issues);
    const box = el("div", { class: "a11y-blockers" });

    if (blockers.length) {
      box.appendChild(el("div", { class: "a11y-group-heading", text: `Task blockers (${blockers.length})` }));
      blockers.forEach(({ taskLabel, issue }) => {
        box.appendChild(
          el("div", { class: "a11y-blocker-row" }, [
            el("span", { class: "a11y-badge blocks", text: taskLabel }),
            el("button", {
              class: "a11y-blocker-link",
              text: issue.help,
              onclick: () => highlightElement(issue.targets[0], issue.severityLabel),
            }),
          ])
        );
      });
    }

    const stepperRow = el("div", { class: "a11y-actions", style: "margin-top:8px;" }, [
      el("button", {
        class: "a11y-btn",
        text: "◀ Previous",
        disabled: priorityIndex <= 0 ? "true" : null,
        onclick: () => goToPriorityIssue(priorityIndex - 1),
      }),
      el("button", {
        class: "a11y-btn primary",
        text: priorityIndex === -1 ? "Fix first →" : `Issue ${priorityIndex + 1} of ${issues.length} — Next →`,
        disabled: !issues.length ? "true" : null,
        onclick: () => goToPriorityIssue(priorityIndex === -1 ? 0 : priorityIndex + 1),
      }),
    ]);
    box.appendChild(stepperRow);
    return box;
  }

  function renderIssuesTab() {
    const panel = panelFor("issues");
    panel.innerHTML = "";

    if (currentScan.stale) {
      panel.appendChild(
        el("div", {
          class: "a11y-error-banner",
          text: `Cached result from ${new Date(currentScan.ts).toLocaleTimeString()} — the last re-scan failed (${currentScan.staleError}). Numbers below are not from the current page state.`,
        })
      );
    }

    if (currentScan.largeDomWarning) {
      panel.appendChild(
        el("div", {
          class: "a11y-error-banner",
          text: `This page has ${currentScan.elementCount.toLocaleString()} elements — scan results may take a moment and could miss edge cases on very deep DOM trees.`,
        })
      );
    }

    const scores = el("div", { class: "a11y-scores" }, [
      renderScoreCard("Automated design score", currentScan.design, currentScan.previousDesign),
      renderScoreCard("Automated code score", currentScan.code, currentScan.previousCode),
    ]);
    panel.appendChild(scores);
    panel.appendChild(
      el("p", {
        class: "a11y-disclaimer",
        text: "Chameleon is a triage aid, not a certification. Automated checks catch only part of real barriers.",
      })
    );

    panel.appendChild(renderTaskBlockers());

    const details = el("details", { class: "a11y-formula" });
    details.appendChild(el("summary", { text: "How is this calculated?" }));
    details.appendChild(el("p", { text: scoring.FORMULA_EXPLANATION }));
    panel.appendChild(details);

    panel.appendChild(renderFilterChips());

    if (activeFilter === "review") return renderNeedsReviewSection(panel);
    if (activeFilter === "ignored") return renderIgnoredSection(panel);
    if (activeFilter === "fixed") return renderFixedSection(panel);

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

    let scoredIssues = currentScan.issues.filter((i) => i.nodeCount > 0);
    if (["critical", "serious", "moderate"].includes(activeFilter)) {
      scoredIssues = scoredIssues.filter((i) => i.severityLabel.toLowerCase() === activeFilter);
    }
    if (!scoredIssues.length) {
      panel.appendChild(el("p", { class: "a11y-empty-state", text: "No automated issues found. Nice — but remember this only covers what's measurable." }));
    } else {
      groupIssues(scoredIssues, groupMode).forEach(([groupName, list]) => {
        panel.appendChild(el("div", { class: "a11y-group-heading", text: `${groupName} (${list.length})` }));
        list.forEach((issue) => panel.appendChild(renderIssueCard(issue)));
      });
    }

    if (activeFilter === "all" && currentScan.possibleIssues.length) {
      renderPossibleFindings(panel);
    }

    if (activeFilter === "all" && currentScan.humanReview.length) {
      const unreviewed = currentScan.humanReview.filter((i) => !i.reviewed).length;
      panel.appendChild(el("div", { class: "a11y-group-heading", text: `Needs human review (${unreviewed} of ${currentScan.humanReview.length}) — not scored` }));
      currentScan.humanReview.slice(0, 3).forEach((item) => panel.appendChild(renderReviewCard(item)));
      if (currentScan.humanReview.length > 3) {
        panel.appendChild(
          el("button", { class: "a11y-btn", text: `See all ${currentScan.humanReview.length} →`, onclick: () => { activeFilter = "review"; renderIssuesTab(); } })
        );
      }
    }
  }

  // ---------- Filter chips (spec 0.6) ----------
  function renderFilterChips() {
    const counts = {
      all: currentScan.issues.filter((i) => i.nodeCount > 0).length,
      critical: currentScan.issues.filter((i) => i.severityLabel === "Critical").length,
      serious: currentScan.issues.filter((i) => i.severityLabel === "Serious").length,
      moderate: currentScan.issues.filter((i) => i.severityLabel === "Moderate").length,
      review: currentScan.humanReview.length,
      ignored: currentScan.ignoredEntries.length,
      fixed: currentScan.fixedEntries.length,
    };
    const labels = { all: "All", critical: "Critical", serious: "Serious", moderate: "Moderate", review: "Needs review", ignored: "Ignored", fixed: "Fixed" };
    const chips = el("div", { class: "a11y-filter-chips", role: "group", "aria-label": "Filter issues" });
    Object.entries(labels).forEach(([key, label]) => {
      chips.appendChild(
        el("button", {
          class: "a11y-chip", "aria-pressed": String(activeFilter === key),
          text: `${label} (${counts[key]})`,
          onclick: () => { activeFilter = key; renderIssuesTab(); },
        })
      );
    });
    return chips;
  }

  function renderReviewCard(item) {
    const card = el("div", { class: "a11y-issue-card" }, [
      el("p", { class: "a11y-issue-flag", text: item.title }),
      el("p", { class: "a11y-issue-affected", text: item.why }),
    ]);
    if (item.reviewed) {
      card.appendChild(el("span", { class: "a11y-badge", style: "background:#e3f3ec;color:#0b5a38;", text: "✓ Reviewed" }));
    } else {
      card.appendChild(
        el("div", { class: "a11y-card-actions" }, [
          el("button", {
            text: "Mark reviewed",
            onclick: () => { item.reviewed = true; renderIssuesTab(); },
          }),
        ])
      );
    }
    return card;
  }

  function renderNeedsReviewSection(panel) {
    panel.appendChild(el("div", { class: "a11y-group-heading", text: `Needs human review (${currentScan.humanReview.length})` }));
    if (!currentScan.humanReview.length) {
      panel.appendChild(el("p", { class: "a11y-empty-state", text: "Nothing pending review." }));
    } else {
      currentScan.humanReview.forEach((item) => panel.appendChild(renderReviewCard(item)));
    }
  }

  function renderIgnoredSection(panel) {
    panel.appendChild(el("div", { class: "a11y-group-heading", text: `Ignored (${currentScan.ignoredEntries.length})` }));
    if (!currentScan.ignoredEntries.length) {
      panel.appendChild(el("p", { class: "a11y-empty-state", text: "Nothing ignored." }));
      return;
    }
    currentScan.ignoredEntries.forEach((entry) => {
      const card = el("div", { class: "a11y-issue-card" }, [
        el("p", { class: "a11y-issue-flag", text: entry.help }),
        entry.reason ? el("p", { class: "a11y-issue-affected", text: `Reason: ${entry.reason}` }) : null,
        el("div", { class: "a11y-card-actions" }, [
          entry.live ? el("button", { text: "Highlight on page", onclick: () => highlightElement(entry.live.targets[0], entry.severityLabel) }) : null,
          el("button", { text: "Reopen", onclick: () => reopenIgnored(entry) }),
        ]),
      ]);
      panel.appendChild(card);
    });
  }

  function renderFixedSection(panel) {
    panel.appendChild(el("div", { class: "a11y-group-heading", text: `Fixed (${currentScan.fixedEntries.length})` }));
    if (!currentScan.fixedEntries.length) {
      panel.appendChild(el("p", { class: "a11y-empty-state", text: "Nothing marked fixed yet." }));
      return;
    }
    currentScan.fixedEntries.forEach((entry) => {
      const card = el("div", { class: "a11y-issue-card" }, [
        el("p", { class: "a11y-issue-flag", text: entry.help }),
        el("p", { class: "a11y-issue-affected", text: entry.auto ? "Fixed since last scan (detected automatically)." : `You marked this fixed on ${new Date(entry.ts).toLocaleString()}.` }),
        el("div", { class: "a11y-card-actions" }, [
          el("button", { text: "Reopen", onclick: () => reopenFixed(entry) }),
        ]),
      ]);
      panel.appendChild(card);
    });
  }

  // ---------- Possible findings (spec 0.4) ----------
  function renderPossibleFindings(panel) {
    panel.appendChild(el("div", { class: "a11y-group-heading", text: `Possible findings (${currentScan.possibleIssues.length}) — not scored` }));
    currentScan.possibleIssues.forEach((issue) => {
      const card = el("div", { class: "a11y-issue-card possible" });
      card.appendChild(el("span", { class: "a11y-badge possible", text: "Possible" }));
      card.appendChild(el("button", { class: "a11y-issue-flag", text: issue.help, onclick: () => highlightElement(issue.targets[0]) }));
      card.appendChild(el("p", { class: "a11y-issue-affected", text: issue.description }));
      if (issue.userConfirmed) {
        card.appendChild(el("span", { class: "a11y-badge", style: "background:#e3f3ec;color:#0b5a38;", text: "✓ Confirmed by you" }));
      }
      card.appendChild(
        el("div", { class: "a11y-card-actions" }, [
          el("button", { text: "Highlight on page", onclick: () => highlightElement(issue.targets[0]) }),
          el("button", { text: "🔊 Read", onclick: () => readThisIssue(issue, card) }),
          el("button", {
            text: "Confirm",
            onclick: async () => {
              await setIssueState(issue.id, "confirmed", { help: issue.help, severityLabel: issue.severityLabel });
              issue.userConfirmed = true;
              renderIssuesTab();
              announce(`${issue.help} confirmed. Still not scored — this stays a heuristic finding.`);
            },
          }),
          el("button", {
            text: "Dismiss",
            onclick: async () => {
              await setIssueState(issue.id, "dismissed", { help: issue.help });
              currentScan.possibleIssues = currentScan.possibleIssues.filter((i) => i.id !== issue.id);
              renderIssuesTab();
              announce(`${issue.help} dismissed.`);
            },
          }),
        ])
      );
      panel.appendChild(card);
    });
  }

  const SEVERITY_ICON = { Critical: "⛔", Serious: "▲", Moderate: "●" };

  function renderIssueCard(issue) {
    const card = el("div", { class: `a11y-issue-card impact-${issue.severityLabel.toLowerCase()}` });
    const flagBtn = el("button", {
      class: "a11y-issue-flag",
      text: issue.help,
      onclick: () => highlightElement(issue.targets[0], issue.severityLabel),
    });
    card.appendChild(flagBtn);
    card.appendChild(el("p", { class: "a11y-issue-affected", text: issue.affected }));
    if (LEARN_MORE_EXAMPLES[issue.pour]) {
      card.appendChild(
        el("details", { class: "a11y-learn-more" }, [
          el("summary", { text: "Learn more" }),
          el("p", { text: LEARN_MORE_EXAMPLES[issue.pour] }),
        ])
      );
    }

    const meta = el("div", { class: "a11y-issue-meta" }, [
      el("span", { class: "a11y-badge", text: `${SEVERITY_ICON[issue.severityLabel]} ${issue.severityLabel}` }),
      issue.isMinor ? el("span", { class: "a11y-badge", text: "minor" }) : null,
      el("span", { class: "a11y-badge", text: `${issue.nodeCount} on page` }),
    ]);
    if (issue.taskLabel) {
      meta.appendChild(el("span", { class: "a11y-badge blocks", text: `Blocks task: ${issue.taskLabel}` }));
    } else {
      meta.appendChild(el("span", { class: "a11y-badge", text: "Blocks a task: no" }));
    }
    if (issue.regressed) {
      meta.appendChild(el("span", { class: "a11y-badge", style: "background:#fde2e1;color:#7a1a12;", text: "↩ Regressed — was marked fixed" }));
    }
    card.appendChild(meta);

    const actions = el("div", { class: "a11y-card-actions" }, [
      el("button", { text: "Highlight on page", onclick: () => highlightElement(issue.targets[0], issue.severityLabel) }),
      el("button", { text: "See suggested fix →", onclick: () => { switchTab("fixes"); scrollToFix(issue.id); } }),
      el("button", { text: "🔊 Read", onclick: () => readThisIssue(issue, card) }),
      el("button", { text: "Copy for developer", onclick: () => copyForDeveloper(issue) }),
      el("button", { text: "Mark fixed", onclick: () => markIssueFixed(issue) }),
      el("button", { text: "Ignore", onclick: () => ignoreIssue(issue) }),
    ]);
    card.appendChild(actions);
    return card;
  }

  // ---------- Local issue-state mutations ----------
  // These update storage AND currentScan's in-memory lists directly, without
  // triggering a real axe re-scan — marking something fixed/ignored is bookkeeping,
  // not a change to the live DOM, so re-running axe here would just re-detect the
  // same issue and immediately flip it back to "Regressed." A real re-scan only
  // happens when the user clicks Re-scan, or reopens something we have no live
  // reference for (see reopenFixed below).
  async function markIssueFixed(issue) {
    await setIssueState(issue.id, "fixed", { auto: false, help: issue.help, severityLabel: issue.severityLabel });
    currentScan.issues = currentScan.issues.filter((i) => i.id !== issue.id);
    currentScan.fixedEntries.push({ id: issue.id, state: "fixed", auto: false, ts: Date.now(), help: issue.help, severityLabel: issue.severityLabel });
    renderIssuesTab();
    renderFixesTab();
    announce(`${issue.help} marked fixed.`);
  }

  async function ignoreIssue(issue) {
    const reason = window.prompt("Why ignore this? (optional)", "") || null;
    await setIssueState(issue.id, "ignored", { reason, help: issue.help, severityLabel: issue.severityLabel });
    currentScan.issues = currentScan.issues.filter((i) => i.id !== issue.id);
    currentScan.ignoredEntries.push({ id: issue.id, state: "ignored", reason, ts: Date.now(), help: issue.help, severityLabel: issue.severityLabel, live: issue });
    renderIssuesTab();
    renderFixesTab();
    announce(`${issue.help} ignored.`);
  }

  async function reopenIgnored(entry) {
    await clearIssueState(entry.id);
    currentScan.ignoredEntries = currentScan.ignoredEntries.filter((e) => e.id !== entry.id);
    if (entry.live) {
      entry.live.state = "open";
      currentScan.issues.push(entry.live);
    }
    renderIssuesTab();
    renderFixesTab();
    announce(`${entry.help} reopened.`);
  }

  async function reopenFixed(entry) {
    // No live DOM reference for a "fixed" entry — only a real re-scan can tell us
    // whether it's genuinely still resolved or back.
    await clearIssueState(entry.id);
    runScan();
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
      el("button", { text: "Highlight on page", onclick: () => highlightElement(fd.element, fd.issue && fd.issue.severityLabel) }),
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
        renderScoreCard("Design", currentScan.design, currentScan.previousDesign),
        renderScoreCard("Code", currentScan.code, currentScan.previousCode),
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

    panel.appendChild(
      el("div", { class: "a11y-actions", style: "flex-wrap:wrap;margin-top:8px;" }, [
        el("button", { class: "a11y-btn", text: "Download report (PDF)", onclick: exportPDF }),
        el("button", { class: "a11y-btn", text: "Download JSON", onclick: exportJSON }),
        el("button", { class: "a11y-btn", text: "Download CSV", onclick: exportCSV }),
        el("button", { class: "a11y-btn", text: "Download SARIF", onclick: exportSARIF }),
        el("button", { class: "a11y-btn", text: "Copy summary", onclick: copySummaryToClipboard }),
      ])
    );
  }

  // ---------- Exports (spec 10, 11m, 11n, 12.1) ----------
  function exportCssPath(el0) {
    if (!el0 || !el0.tagName) return null;
    if (el0.id) return `#${CSS.escape(el0.id)}`;
    const parts = [];
    let node = el0;
    while (node && node.nodeType === 1 && parts.length < 6) {
      let part = node.tagName.toLowerCase();
      if (node.classList && node.classList.length) part += "." + Array.from(node.classList).slice(0, 2).map((c) => CSS.escape(c)).join(".");
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  function firstFixFor(issue) {
    try {
      const fixes0 = buildFixDescriptors(issue);
      return fixes0[0] || null;
    } catch {
      return null;
    }
  }

  // Stable, documented schema — the shape external tooling can rely on not
  // changing out from under it. Spec 12.1.
  function buildExportData() {
    const confirmedIssues = currentScan.issues.filter((i) => i.nodeCount > 0).map((issue) => {
      const fix = firstFixFor(issue);
      return {
        ruleId: issue.id,
        severity: issue.severityLabel,
        minor: !!issue.isMinor,
        confidence: "confirmed",
        state: issue.state || "open",
        regressed: !!issue.regressed,
        selector: exportCssPath(issue.targets[0]),
        wcag: issue.wcag || null,
        pour: issue.pour,
        component: issue.component,
        instances: issue.nodeCount,
        blocksTask: issue.taskLabel || null,
        help: issue.help,
        affected: issue.affected,
        fix: fix ? { words: fix.why, before: fix.originalText, after: fix.suggestedText } : null,
      };
    });
    const possibleFindings = currentScan.possibleIssues.map((issue) => ({
      ruleId: issue.id, confidence: "possible", userConfirmed: !!issue.userConfirmed,
      instances: issue.nodeCount, help: issue.help, description: issue.description,
    }));
    return {
      schemaVersion: "1.0",
      tool: "Chameleon",
      generatedAt: new Date().toISOString(),
      url: location.href,
      title: document.title,
      scores: { design: currentScan.design, code: currentScan.code },
      confirmedIssues,
      possibleFindings,
      ignored: currentScan.ignoredEntries.map((e) => ({ ruleId: e.id, reason: e.reason || null, help: e.help, severity: e.severityLabel, ts: e.ts })),
      fixed: currentScan.fixedEntries.map((e) => ({ ruleId: e.id, auto: !!e.auto, help: e.help, severity: e.severityLabel, ts: e.ts })),
      needsManualReview: currentScan.humanReview.map((i) => ({ title: i.title, why: i.why, reviewed: !!i.reviewed })),
    };
  }

  function downloadBlob(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function pageNameSlug() {
    return (document.title || "page").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "page";
  }

  function exportJSON() {
    downloadBlob(`chameleon-report-${pageNameSlug()}.json`, JSON.stringify(buildExportData(), null, 2), "application/json");
    announce("JSON export downloaded.");
  }

  function csvEscape(v) {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function exportCSV() {
    const data = buildExportData();
    const headers = ["ruleId", "severity", "confidence", "state", "instances", "wcag", "selector", "blocksTask", "help"];
    const rows = data.confirmedIssues.map((i) => headers.map((h) => csvEscape(i[h])).join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    downloadBlob(`chameleon-report-${pageNameSlug()}.csv`, csv, "text/csv");
    announce("CSV export downloaded.");
  }

  const SARIF_LEVEL = { Critical: "error", Serious: "error", Moderate: "warning" };

  function exportSARIF() {
    const data = buildExportData();
    const ruleIds = Array.from(new Set(data.confirmedIssues.map((i) => i.ruleId)));
    const sarif = {
      $schema: "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
      version: "2.1.0",
      runs: [{
        tool: {
          driver: {
            name: "Chameleon",
            informationUri: "https://github.com/tdcoleman127/Code_Your_Dreams_Hackathon-2026-AL-02",
            version: "0.2.0",
            rules: ruleIds.map((id) => ({ id, shortDescription: { text: id } })),
          },
        },
        results: data.confirmedIssues.map((i) => ({
          ruleId: i.ruleId,
          level: SARIF_LEVEL[i.severity] || "note",
          message: { text: `${i.help} ${i.affected || ""}`.trim() },
          locations: [{
            physicalLocation: {
              artifactLocation: { uri: data.url },
              region: i.selector ? { snippet: { text: i.selector } } : undefined,
            },
          }],
          properties: { confidence: i.confidence, state: i.state, wcag: i.wcag, instances: i.instances },
        })),
      }],
    };
    downloadBlob(`chameleon-report-${pageNameSlug()}.sarif`, JSON.stringify(sarif, null, 2), "application/json");
    announce("SARIF export downloaded.");
  }

  function copySummaryToClipboard() {
    const data = buildExportData();
    const lines = [
      `Chameleon report — ${data.title}`,
      shortSiteLabel(data.url),
      `Design score: ${data.scores.design}  |  Code score: ${data.scores.code}`,
      "",
      `Confirmed issues (${data.confirmedIssues.length}):`,
      ...data.confirmedIssues.slice(0, 20).map((i) => `- [${i.severity}] ${i.help} (${i.instances} on page)`),
    ];
    navigator.clipboard.writeText(lines.join("\n")).then(
      () => announce("Summary copied to clipboard."),
      () => announce("Could not copy to clipboard.")
    );
  }

  function copyForDeveloper(issue) {
    const fix = firstFixFor(issue);
    const text = [
      `## ${issue.help}`,
      `Rule: ${issue.id}  |  Severity: ${issue.severityLabel}${issue.isMinor ? " (minor)" : ""}  |  WCAG: ${issue.wcag || "n/a"}`,
      `Selector: ${exportCssPath(issue.targets[0]) || "n/a"}`,
      `Who's affected: ${issue.affected || "n/a"}`,
      fix ? `\nFix: ${fix.why}\n\nBefore:\n${fix.originalText}\n\nAfter:\n${fix.suggestedText}` : "",
    ].join("\n");
    navigator.clipboard.writeText(text).then(
      () => announce("Copied a developer-ready ticket to the clipboard."),
      () => announce("Could not copy to clipboard.")
    );
  }

  async function exportPDF() {
    announce("Building PDF report…");
    const inject = await sendMessage({ type: "A11Y_INJECT_JSPDF" });
    if (!inject || !inject.ok || !window.jspdf) {
      announce("Could not load the PDF engine on this page.");
      return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const margin = 40;
    const pageWidth = doc.internal.pageSize.getWidth();
    const maxWidth = pageWidth - margin * 2;
    let y = margin;

    const ensureSpace = (needed) => {
      if (y + needed > doc.internal.pageSize.getHeight() - margin) { doc.addPage(); y = margin; }
    };
    const heading = (text, size = 13) => {
      ensureSpace(size + 10);
      doc.setFont(undefined, "bold").setFontSize(size).text(text, margin, y);
      y += size + 8;
      doc.setFont(undefined, "normal");
    };
    const para = (text, size = 10) => {
      doc.setFontSize(size);
      const lines = doc.splitTextToSize(text || "", maxWidth);
      lines.forEach((line) => { ensureSpace(size + 4); doc.text(line, margin, y); y += size + 3; });
    };

    doc.setFont(undefined, "bold").setFontSize(18).text("Chameleon", margin, y);
    y += 24;
    doc.setFont(undefined, "normal").setFontSize(10);
    para(`${document.title}  —  ${shortSiteLabel(location.href)}`);
    para(new Date().toLocaleString());
    para("Triage aid, not a certification. Automated checks catch only part of real barriers.");
    y += 6;

    heading("Scores");
    para(`Design: ${currentScan.design}/100 — ${scoring.verdictFor(currentScan.design).label}`);
    para(`Code: ${currentScan.code}/100 — ${scoring.verdictFor(currentScan.code).label}`);
    para(scoring.FORMULA_EXPLANATION, 8);
    y += 6;

    const openIssues = currentScan.issues.filter((i) => i.nodeCount > 0);
    const counts = { Critical: 0, Serious: 0, Moderate: 0 };
    openIssues.forEach((i) => { counts[i.severityLabel] = (counts[i.severityLabel] || 0) + 1; });
    heading("Counts by severity");
    para(`Critical: ${counts.Critical}   Serious: ${counts.Serious}   Moderate: ${counts.Moderate}`);
    y += 6;

    heading("Confirmed issues");
    openIssues.forEach((issue) => {
      ensureSpace(20);
      para(`[${issue.severityLabel}] ${issue.help}`, 10);
      para(issue.affected || "", 9);
      const fix = firstFixFor(issue);
      if (fix) para(`Fix: ${fix.why}`, 9);
      para(`Selector: ${exportCssPath(issue.targets[0]) || "n/a"}`, 8);
      y += 4;
    });

    if (currentScan.possibleIssues.length) {
      heading("Possible findings (not scored)");
      currentScan.possibleIssues.forEach((i) => para(`• ${i.help}${i.userConfirmed ? " (confirmed by reviewer)" : ""}`, 9));
      y += 6;
    }

    heading("Needs manual review");
    currentScan.humanReview.forEach((i) => para(`• ${i.title} — ${i.why}`, 9));
    y += 6;

    if (currentScan.ignoredEntries.length || currentScan.fixedEntries.length) {
      heading("Ignored / Fixed");
      currentScan.ignoredEntries.forEach((e) => para(`Ignored: ${e.help}${e.reason ? ` (${e.reason})` : ""}`, 9));
      currentScan.fixedEntries.forEach((e) => para(`Fixed: ${e.help}${e.auto ? " (auto-detected)" : ""}`, 9));
      y += 6;
    }

    heading("What a screen reader hears (summary)");
    const srEntries = buildScreenReaderSummary(document).slice(0, 25);
    srEntries.forEach((entry) => para(`${entry.role}: ${entry.problem || entry.name || "(no accessible name)"}`, 8));
    y += 6;

    heading("Roadmap (ordered by user impact)");
    roadmap.ROADMAP_ITEMS.forEach((item) => para(`• ${item.title} — ${item.body}`, 9));

    doc.save(`chameleon-report-${new Date().toISOString().slice(0, 10)}-${pageNameSlug()}.pdf`);
    announce("PDF report downloaded.");
  }

  // ---------- Color Lab tab (spec section 3) ----------
  const WCAG_THRESHOLDS = { aaNormal: 4.5, aaLarge: 3, aaaNormal: 7, aaaLarge: 4.5 };

  function sliderRow(label, id, min, max, step, value, unit) {
    return el("div", { class: "a11y-slider-row" }, [
      el("label", { for: id, text: label }),
      el("input", { type: "range", id, min: String(min), max: String(max), step: String(step), value: String(value) }),
      el("span", { id: `${id}-val`, class: "a11y-slider-val", text: `${value}${unit}` }),
    ]);
  }

  function updateColorLabPreview() {
    const preview = shadowRoot.getElementById("cl-preview");
    const d = colorLabDraft;
    if (preview) {
      preview.style.color = d.textColor;
      preview.style.background = d.bgColor;
      preview.style.fontSize = `${d.fontSize}px`;
      preview.style.lineHeight = String(d.lineHeight);
      preview.style.letterSpacing = `${d.letterSpacing}px`;
      preview.style.wordSpacing = `${d.wordSpacing}px`;
    }
    const resultBox = shadowRoot.getElementById("cl-contrast-result");
    if (!resultBox) return;
    const fgRgb = fixes.parseColor(d.textColor);
    const bgRgb = fixes.parseColor(d.bgColor);
    if (!fgRgb || !bgRgb) return;
    const ratio = fixes.contrastRatio(fgRgb, bgRgb);
    const pass = (threshold) => (ratio >= threshold ? "✓ Pass" : "✕ Fail");
    resultBox.innerHTML = "";
    resultBox.appendChild(el("div", { class: "a11y-contrast-ratio", text: `${ratio.toFixed(2)}:1` }));
    const rows = [
      ["AA, normal text", WCAG_THRESHOLDS.aaNormal],
      ["AA, large text / UI", WCAG_THRESHOLDS.aaLarge],
      ["AAA, normal text", WCAG_THRESHOLDS.aaaNormal],
      ["AAA, large text", WCAG_THRESHOLDS.aaaLarge],
    ];
    const grid = el("div", { class: "a11y-contrast-grid" });
    rows.forEach(([label, threshold]) => {
      const passed = ratio >= threshold;
      grid.appendChild(
        el("div", { class: `a11y-contrast-cell ${passed ? "pass" : "fail"}`, text: `${label}: ${pass(threshold)}` })
      );
    });
    resultBox.appendChild(grid);
  }

  function checkOverflow() {
    const warn = shadowRoot.getElementById("cl-overflow-warning");
    if (!warn) return;
    const overflowX = document.documentElement.scrollWidth > window.innerWidth + 2;
    warn.textContent = overflowX
      ? "⚠ At this zoom level, content overflows horizontally — some of the page may be clipped or require scrolling."
      : "";
  }

  function renderColorLabTab() {
    const panel = panelFor("colorlab");
    panel.innerHTML = "";
    const d = colorLabDraft;

    panel.appendChild(el("p", { class: "a11y-disclaimer", text: "A playground for testing colors, spacing, and simulated color blindness before you ship a fix. \"Apply to page\" changes are reversible and separate from the live page until you choose to apply them." }));

    panel.appendChild(el("div", { class: "a11y-group-heading", text: "Text & background color" }));
    const colorRow = el("div", { class: "a11y-colorlab-row" }, [
      el("label", { for: "cl-text-color", text: "Text" }),
      el("input", { type: "color", id: "cl-text-color", value: d.textColor }),
      el("input", { type: "text", id: "cl-text-hex", value: d.textColor, "aria-label": "Text color hex value", style: "width:80px;" }),
      el("label", { for: "cl-bg-color", text: "Background", style: "margin-left:10px;" }),
      el("input", { type: "color", id: "cl-bg-color", value: d.bgColor }),
      el("input", { type: "text", id: "cl-bg-hex", value: d.bgColor, "aria-label": "Background color hex value", style: "width:80px;" }),
    ]);
    panel.appendChild(colorRow);

    const sliders = el("div", {}, [
      sliderRow("Font size", "cl-font-size", 12, 32, 1, d.fontSize, "px"),
      sliderRow("Line height", "cl-line-height", 1, 3, 0.1, d.lineHeight, ""),
      sliderRow("Letter spacing", "cl-letter-spacing", 0, 6, 0.5, d.letterSpacing, "px"),
      sliderRow("Word spacing", "cl-word-spacing", 0, 20, 1, d.wordSpacing, "px"),
    ]);
    panel.appendChild(sliders);

    panel.appendChild(
      el("div", {
        id: "cl-preview", class: "a11y-colorlab-preview",
        text: "The quick brown fox jumps over the lazy dog. This is sample preview text.",
      })
    );
    panel.appendChild(el("div", { id: "cl-contrast-result" }));

    const actions1 = el("div", { class: "a11y-actions", style: "flex-wrap:wrap;margin-top:8px;" }, [
      el("button", { class: "a11y-btn", text: "Suggest accessible colors", onclick: suggestAccessibleColors }),
      el("button", { class: "a11y-btn primary", text: "Apply to page", onclick: applyColorLabToPage }),
      el("button", { class: "a11y-btn", text: "Reset", onclick: resetColorLabDraft }),
    ]);
    panel.appendChild(actions1);

    // --- Color-blindness simulation ---
    panel.appendChild(el("div", { class: "a11y-group-heading", text: "Color-blindness simulation" }));
    const cbRow = el("div", { class: "a11y-group-toggle", role: "group", "aria-label": "Simulation type" });
    ["protanopia", "deuteranopia", "tritanopia", "achromatopsia"].forEach((type) => {
      cbRow.appendChild(
        el("button", {
          "aria-pressed": d.cbType === type ? "true" : "false",
          text: type[0].toUpperCase() + type.slice(1),
          onclick: () => { colorLabDraft.cbType = type; renderColorLabTab(); },
        })
      );
    });
    panel.appendChild(cbRow);
    const cbApplied = styleManager.getState("colorBlindSim").enabled;
    panel.appendChild(
      el("button", {
        class: "a11y-btn", style: "margin-top:8px;", "aria-pressed": String(cbApplied),
        text: cbApplied ? "Simulating on page — click to stop" : "Apply simulation to page",
        onclick: () => {
          const next = !styleManager.getState("colorBlindSim").enabled;
          styleManager.setState("colorBlindSim", { enabled: next, type: colorLabDraft.cbType });
          announce(next ? `Simulating ${colorLabDraft.cbType} on the page. This is a preview, not a fix.` : "Simulation stopped.");
          renderColorLabTab();
        },
      })
    );
    panel.appendChild(el("p", { class: "a11y-disclaimer", text: "This simulates how the page might look to someone with this type of color vision deficiency — it's a preview, never a fix." }));

    // --- Low vision tools ---
    panel.appendChild(el("div", { class: "a11y-group-heading", text: "Low vision tools" }));

    const magnifyState = styleManager.getState("magnify");
    panel.appendChild(
      el("div", { class: "a11y-slider-row" }, [
        el("label", { for: "cl-magnify", text: "Magnify" }),
        el("input", { type: "range", id: "cl-magnify", min: "100", max: "400", step: "10", value: String(magnifyState.percent) }),
        el("span", { id: "cl-magnify-val", class: "a11y-slider-val", text: `${magnifyState.percent}%` }),
      ])
    );
    panel.appendChild(el("p", { id: "cl-overflow-warning", class: "a11y-disclaimer", style: "color:#b5530d;" }));

    const cursorState = styleManager.getState("cursor");
    panel.appendChild(el("div", { class: "a11y-group-heading", text: "Cursor size", style: "margin-top:12px;" }));
    const cursorRow = el("div", { class: "a11y-group-toggle", role: "group", "aria-label": "Cursor size" }, [
      el("button", {
        "aria-pressed": String(!cursorState.enabled),
        text: "Off",
        onclick: () => { styleManager.setState("cursor", { enabled: false }); renderColorLabTab(); },
      }),
      el("button", {
        "aria-pressed": String(cursorState.enabled && cursorState.size === "large"),
        text: "Large",
        onclick: () => { styleManager.setState("cursor", { enabled: true, size: "large" }); renderColorLabTab(); },
      }),
      el("button", {
        "aria-pressed": String(cursorState.enabled && cursorState.size === "xlarge"),
        text: "Extra large",
        onclick: () => { styleManager.setState("cursor", { enabled: true, size: "xlarge" }); renderColorLabTab(); },
      }),
    ]);
    panel.appendChild(cursorRow);

    const hcState = styleManager.getState("highContrast");
    panel.appendChild(el("div", { class: "a11y-group-heading", text: "High-contrast page mode", style: "margin-top:12px;" }));
    const hcRow = el("div", { class: "a11y-group-toggle", role: "group", "aria-label": "High contrast mode" }, [
      el("button", {
        "aria-pressed": String(!hcState.enabled),
        text: "Off",
        onclick: () => { styleManager.setState("highContrast", { enabled: false }); renderColorLabTab(); },
      }),
      el("button", {
        "aria-pressed": String(hcState.enabled && hcState.mode === "bw"),
        text: "Black/white",
        onclick: () => { styleManager.setState("highContrast", { enabled: true, mode: "bw" }); renderColorLabTab(); },
      }),
      el("button", {
        "aria-pressed": String(hcState.enabled && hcState.mode === "yb"),
        text: "Yellow/black",
        onclick: () => { styleManager.setState("highContrast", { enabled: true, mode: "yb" }); renderColorLabTab(); },
      }),
      el("button", {
        "aria-pressed": String(hcState.enabled && hcState.mode === "invert"),
        text: "Invert",
        onclick: () => { styleManager.setState("highContrast", { enabled: true, mode: "invert" }); renderColorLabTab(); },
      }),
    ]);
    panel.appendChild(hcRow);
    if (hcState.enabled && styleManager.getState("colorLab").enabled) {
      panel.appendChild(el("p", { class: "a11y-disclaimer", text: "Color Lab colors paused while High contrast is on." }));
    }

    const focusState = styleManager.getState("focusBooster");
    panel.appendChild(el("div", { class: "a11y-group-heading", text: "Focus visibility", style: "margin-top:12px;" }));
    panel.appendChild(
      el("button", {
        class: "a11y-btn", "aria-pressed": String(focusState.enabled),
        text: focusState.enabled ? "Focus booster: on" : "Focus booster: off",
        onclick: () => { styleManager.setState("focusBooster", { enabled: !focusState.enabled }); renderColorLabTab(); },
      })
    );

    panel.appendChild(el("div", { style: "margin-top:16px;" }, [
      el("button", { class: "a11y-btn", text: "Reset page", onclick: resetPage }),
    ]));

    // Wire live listeners (after elements exist in the DOM).
    const textColor = shadowRoot.getElementById("cl-text-color");
    const textHex = shadowRoot.getElementById("cl-text-hex");
    const bgColor = shadowRoot.getElementById("cl-bg-color");
    const bgHex = shadowRoot.getElementById("cl-bg-hex");
    const syncColor = (pickerEl, hexEl, key) => {
      pickerEl.addEventListener("input", () => { colorLabDraft[key] = pickerEl.value; hexEl.value = pickerEl.value; updateColorLabPreview(); });
      hexEl.addEventListener("input", () => {
        if (/^#[0-9a-fA-F]{6}$/.test(hexEl.value)) { colorLabDraft[key] = hexEl.value; pickerEl.value = hexEl.value; updateColorLabPreview(); }
      });
    };
    syncColor(textColor, textHex, "textColor");
    syncColor(bgColor, bgHex, "bgColor");

    const sliderDefs = [
      ["cl-font-size", "fontSize", "px", (v) => parseInt(v, 10)],
      ["cl-line-height", "lineHeight", "", (v) => parseFloat(v)],
      ["cl-letter-spacing", "letterSpacing", "px", (v) => parseFloat(v)],
      ["cl-word-spacing", "wordSpacing", "px", (v) => parseFloat(v)],
    ];
    sliderDefs.forEach(([id, key, unit, parse]) => {
      const input = shadowRoot.getElementById(id);
      const out = shadowRoot.getElementById(`${id}-val`);
      input.addEventListener("input", () => {
        colorLabDraft[key] = parse(input.value);
        out.textContent = `${input.value}${unit}`;
        updateColorLabPreview();
      });
    });

    const magnifyInput = shadowRoot.getElementById("cl-magnify");
    magnifyInput.addEventListener("input", () => {
      const percent = parseInt(magnifyInput.value, 10);
      shadowRoot.getElementById("cl-magnify-val").textContent = `${percent}%`;
      styleManager.setState("magnify", { enabled: percent !== 100, percent });
      requestAnimationFrame(checkOverflow);
    });

    updateColorLabPreview();
    checkOverflow();
  }

  function suggestAccessibleColors() {
    const result = fixes.suggestContrastFix(colorLabDraft.textColor, colorLabDraft.bgColor, WCAG_THRESHOLDS.aaNormal);
    if (!result) return;
    colorLabDraft.textColor = result.suggestedHex;
    announce(
      result.reachedTarget
        ? `Suggested ${result.suggestedHex} for text — raises contrast from ${result.originalRatio}:1 to ${result.newRatio}:1 against this background.`
        : `Closest possible match is ${result.suggestedHex}, reaching ${result.newRatio}:1 — this background may need to change too for full AA compliance.`
    );
    renderColorLabTab();
  }

  function applyColorLabToPage() {
    const d = colorLabDraft;
    styleManager.setState("colorLab", {
      enabled: true, textColor: d.textColor, bgColor: d.bgColor,
      fontSize: d.fontSize, lineHeight: d.lineHeight, letterSpacing: d.letterSpacing, wordSpacing: d.wordSpacing,
    });
    announce("Color Lab settings applied to the live page.");
  }

  function resetColorLabDraft() {
    Object.assign(colorLabDraft, { textColor: "#1b1f23", bgColor: "#ffffff", fontSize: 16, lineHeight: 1.5, letterSpacing: 0, wordSpacing: 0 });
    styleManager.setState("colorLab", { enabled: false, textColor: null, bgColor: null, fontSize: null, lineHeight: null, letterSpacing: null, wordSpacing: null });
    renderColorLabTab();
    announce("Color Lab reset.");
  }

  // ---------- "What a screen reader hears" tab (spec section 6) ----------
  // A simplified, independent approximation of the accessible-name/role computation
  // — NOT a real screen reader. Deliberately doesn't depend on axe's own output, so
  // this tab reflects the page even if a scan hasn't been run yet.
  const SR_SELECTOR = [
    "h1", "h2", "h3", "h4", "h5", "h6", '[role="heading"]',
    "nav", "main", "header", "footer", "aside", "form",
    "button", "a[href]", "input", "select", "textarea", "img",
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]', '[role="main"]', '[role="complementary"]',
  ].join(",");

  const IMPLICIT_ROLE = {
    NAV: "navigation", MAIN: "main", HEADER: "banner", FOOTER: "contentinfo", ASIDE: "complementary",
    FORM: "form", BUTTON: "button", IMG: "img", SELECT: "combobox", TEXTAREA: "textbox",
  };

  function srComputeRole(el) {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    if (/^H[1-6]$/.test(el.tagName)) return `heading level ${el.tagName[1]}`;
    if (el.tagName === "A") return "link";
    if (el.tagName === "INPUT") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (["submit", "button", "reset"].includes(type)) return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      return "textbox";
    }
    return IMPLICIT_ROLE[el.tagName] || el.tagName.toLowerCase();
  }

  function srComputeName(el) {
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();
    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      const text = labelledby.split(/\s+/).map((id) => { const t = document.getElementById(id); return t ? t.textContent.trim() : ""; }).filter(Boolean).join(" ");
      if (text) return text;
    }
    if (el.tagName === "IMG") return (el.getAttribute("alt") || "").trim();
    if (["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) {
      if (el.id) {
        const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lbl && lbl.textContent.trim()) return lbl.textContent.trim();
      }
      const wrapping = el.closest("label");
      if (wrapping && wrapping.textContent.trim()) return wrapping.textContent.trim();
      return "";
    }
    if (el.getAttribute("title")) return el.getAttribute("title").trim();
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }

  function buildScreenReaderSummary(doc) {
    return Array.from(doc.querySelectorAll(SR_SELECTOR)).map((el) => {
      const role = srComputeRole(el);
      const name = srComputeName(el);
      const needsName = !["navigation", "main", "banner", "contentinfo", "complementary", "form"].includes(role) || el.hasAttribute("aria-label");
      let problem = null;
      if (!name && needsName) problem = `${role[0].toUpperCase()}${role.slice(1)}, no label`;
      else if (!name && ["navigation", "form"].includes(role) && doc.querySelectorAll(`[role="${role}"], ${role === "navigation" ? "nav" : "form"}`).length > 1) {
        problem = `${role[0].toUpperCase()}${role.slice(1)}, unnamed (hard to tell apart if there's more than one)`;
      }
      return { el, role, name, problem };
    });
  }

  // ---------- Keyboard tab-order audit overlay (spec 11g) ----------
  // Numbered badges only — deliberately does NOT programmatically focus every
  // element to check for a visible focus style, since that risks side effects on
  // the host page (opening menus, triggering focus handlers). Same tradeoff this
  // build already made for "missing focus style" detection in the Fixes tab.
  function focusableElementsInOrder(doc) {
    const sel = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
    const nodes = Array.from(doc.querySelectorAll(sel)).filter((el0) => !el0.closest("#a11y-intel-host") && el0.offsetParent !== null);
    const positive = nodes
      .filter((el0) => parseInt(el0.getAttribute("tabindex") || "0", 10) > 0)
      .sort((a, b) => parseInt(a.getAttribute("tabindex"), 10) - parseInt(b.getAttribute("tabindex"), 10));
    const natural = nodes.filter((el0) => !(parseInt(el0.getAttribute("tabindex") || "0", 10) > 0));
    return [...positive, ...natural];
  }

  function toggleKeyboardAudit() {
    if (keyboardOverlayEls.length) {
      keyboardOverlayEls.forEach((e) => e.remove());
      keyboardOverlayEls = [];
      announce("Tab-order overlay hidden.");
      return;
    }
    const els = focusableElementsInOrder(document);
    els.forEach((el0, i) => {
      const rect = el0.getBoundingClientRect();
      const badge = document.createElement("div");
      badge.textContent = String(i + 1);
      badge.style.cssText =
        `position:fixed; left:${Math.max(0, rect.left - 8)}px; top:${Math.max(0, rect.top - 9)}px; background:#1457c9; color:#fff;` +
        `font:700 10px/16px -apple-system,sans-serif; width:16px; height:16px; text-align:center; border-radius:999px; z-index:2147483001; pointer-events:none;`;
      document.body.appendChild(badge);
      keyboardOverlayEls.push(badge);
    });
    announce(`Showing tab order for ${els.length} focusable elements, numbered 1 to ${els.length}.`);
  }

  // ---------- First-run tour (spec 11l) ----------
  const TOUR_STEPS = [
    { title: "Your scores", body: "Design and Code scores show what's broken, each out of 100. The verdict label (e.g. \"Significant barriers\") tells you how urgent it is." },
    { title: "Task blockers", body: "This lists what's blocking real flows like checkout or sign-up, detected from the page. Fix these first — they cost the most." },
    { title: "\"Fix first\"", body: "Click Fix first to jump straight to the single highest-priority issue and its suggested fix, in order, one at a time." },
  ];

  function showTourStep(i) {
    const existing = shadowRoot.getElementById("a11y-tour");
    if (existing) existing.remove();
    if (i >= TOUR_STEPS.length) { chrome.storage.local.set({ chameleonTourSeen: true }); return; }
    const step = TOUR_STEPS[i];
    const skip = () => { chrome.storage.local.set({ chameleonTourSeen: true }); showTourStep(99); };
    const modal = el("div", { id: "a11y-tour", class: "a11y-tour", role: "dialog", "aria-label": `Welcome tour, step ${i + 1} of ${TOUR_STEPS.length}` }, [
      el("p", { class: "a11y-tour-title", text: `${i + 1}/${TOUR_STEPS.length} — ${step.title}` }),
      el("p", { text: step.body }),
      el("div", { class: "a11y-actions" }, [
        el("button", { class: "a11y-btn", text: "Skip", onclick: skip }),
        el("button", { class: "a11y-btn primary", text: i === TOUR_STEPS.length - 1 ? "Done" : "Next →", onclick: () => showTourStep(i + 1) }),
      ]),
    ]);
    panelEl.appendChild(modal);
    modal.querySelector(".a11y-btn.primary").focus();
  }

  function maybeShowFirstRunTour() {
    chrome.storage.local.get(["chameleonTourSeen"]).then((data) => {
      if (!data.chameleonTourSeen) showTourStep(0);
    });
  }

  // ---------- "Learn more" per issue (spec 11l) ----------
  // Generic, POUR-keyed examples rather than one per rule (~70 rules in lookup.js
  // would need individually authored examples — out of scope for this pass).
  const LEARN_MORE_EXAMPLES = {
    Perceivable: "Example: a gray \"Buy now\" button on white looks fine to some people but fails for low-vision or color-blind users, and for anyone outside in bright light. Fixing contrast fixes it for everyone, automatically, every time.",
    Operable: "Example: a dropdown menu that only opens on mouse hover locks out anyone navigating by keyboard or switch device — they can tab to it but never actually trigger it.",
    Understandable: "Example: a form field labeled only by placeholder text disappears the moment someone starts typing, and a screen reader never announced it as a label to begin with.",
    Robust: "Example: a custom checkbox built from a styled <div> with no role or state looks right visually, but assistive tech has no way to know it's interactive at all.",
  };

  function renderScreenReaderTab() {
    const panel = panelFor("reader");
    panel.innerHTML = "";
    panel.appendChild(
      el("p", { class: "a11y-disclaimer", text: "This is an approximation of reading order, roles, and accessible names — not a real screen reader. Use NVDA, JAWS, or VoiceOver for a true test." })
    );
    panel.appendChild(
      el("button", { class: "a11y-btn primary", text: "Refresh from current page", onclick: () => renderScreenReaderTab() })
    );
    panel.appendChild(
      el("button", { class: "a11y-btn", style: "margin-left:6px;", text: keyboardOverlayEls.length ? "Hide tab-order overlay" : "Show keyboard tab-order overlay", onclick: () => { toggleKeyboardAudit(); renderScreenReaderTab(); } })
    );
    const entries = buildScreenReaderSummary(document);
    const problemCount = entries.filter((e) => e.problem).length;
    panel.appendChild(el("div", { class: "a11y-group-heading", text: `Reading order (${entries.length} landmarks/controls, ${problemCount} flagged)`, style: "margin-top:12px;" }));

    if (!entries.length) {
      panel.appendChild(el("p", { class: "a11y-empty-state", text: "Nothing landmark/control-like detected on this page." }));
      return;
    }

    const list = el("div", { class: "a11y-sr-list" });
    entries.forEach((entry) => {
      const row = el("div", { class: `a11y-sr-row ${entry.problem ? "problem" : ""}` }, [
        el("span", { class: "a11y-badge", text: entry.role }),
        el("span", { class: "a11y-sr-name", text: entry.problem || entry.name || "(no accessible name)" }),
        el("button", { class: "a11y-sr-jump", "aria-label": `Highlight ${entry.role} on page`, text: "⤴", onclick: () => highlightElement(entry.el) }),
      ]);
      list.appendChild(row);
    });
    panel.appendChild(list);
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
