// The ONE module allowed to touch page styles for every page-altering feature
// (Dyslexia, Color Lab, High contrast, Magnify, Cursor, Focus booster, Color-blind
// simulation). Spec 0.7. Features call setState(); nothing else ever writes CSS to
// the page directly. Fix-preview changes are intentionally NOT managed here — they
// go through fixes.js's own per-element patch/undo stack so Undo never touches these
// page-wide modes, exactly as the spec requires.
//
// Everything below is scoped to `body` rather than `html`. content.js appends the
// Chameleon Shadow DOM host to document.documentElement — a *sibling* of <body>, not
// a descendant — so body-scoped rules and the body-scoped color-blind filter never
// reach the panel or launcher. That's what keeps the logo and panel readable under
// every mode, per spec 0.7's "excluded from every filter and style change" rule.
(function () {
  const ns = (window.__a11yIntel = window.__a11yIntel || {});

  const STYLE_ID = "chameleon-page-style";
  const SVG_FILTER_ID = "chameleon-svg-filters";

  const state = {
    dyslexia: { enabled: false, tint: false },
    colorLab: { enabled: false, textColor: null, bgColor: null, fontSize: null, lineHeight: null, letterSpacing: null, wordSpacing: null },
    highContrast: { enabled: false, mode: "bw" }, // "bw" | "yb" | "invert"
    magnify: { enabled: false, percent: 100 },
    cursor: { enabled: false, size: "large" }, // "large" | "xlarge"
    focusBooster: { enabled: false },
    colorBlindSim: { enabled: false, type: "protanopia" }, // protanopia | deuteranopia | tritanopia | achromatopsia
    soundAlternatives: { enabled: false }, // caption/transcript badges on media (spec section 7)
  };

  // Sound-alternatives badges aren't CSS — they're small inserted DOM nodes next to
  // each <video>/<audio>, so they get their own apply/remove pair instead of a CSS
  // rule, but still live in this one module per spec 0.7.
  function applySoundBadges() {
    document.querySelectorAll("video, audio").forEach((media) => {
      if (media.closest("#a11y-intel-host")) return;
      const next = media.nextElementSibling;
      if (next && next.classList && next.classList.contains("chameleon-sound-badge")) return;
      const hasTrack = !!media.querySelector('track[kind="captions"], track[kind="subtitles"]');
      const badge = document.createElement("div");
      badge.className = "chameleon-sound-badge";
      badge.textContent = hasTrack ? "✓ Captions available" : "⚠ No captions detected";
      badge.style.cssText =
        `font:600 12px -apple-system,sans-serif; padding:3px 9px; border-radius:6px; display:inline-block; margin:4px 0;` +
        `background:${hasTrack ? "#e3f3ec" : "#fde2e1"}; color:${hasTrack ? "#0b5a38" : "#7a1a12"};`;
      media.insertAdjacentElement("afterend", badge);
    });
  }

  function removeSoundBadges() {
    document.querySelectorAll(".chameleon-sound-badge").forEach((b) => b.remove());
  }

  function getStyleEl() {
    let el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement("style");
      el.id = STYLE_ID;
      document.head.appendChild(el);
    }
    return el;
  }

  // Standard approximation matrices used by common color-blindness simulators.
  const CVD_MATRICES = {
    protanopia: "0.567 0.433 0 0 0  0.558 0.442 0 0 0  0 0.242 0.758 0 0  0 0 0 1 0",
    deuteranopia: "0.625 0.375 0 0 0  0.7 0.3 0 0 0  0 0.3 0.7 0 0  0 0 0 1 0",
    tritanopia: "0.95 0.05 0 0 0  0 0.433 0.567 0 0  0 0.475 0.525 0 0  0 0 0 1 0",
    achromatopsia: "0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0 0 0 1 0",
  };

  function getSvgFilterContainer() {
    let el = document.getElementById(SVG_FILTER_ID);
    if (el) return el;
    el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    el.id = SVG_FILTER_ID;
    el.setAttribute("aria-hidden", "true");
    el.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;";
    const defs = Object.entries(CVD_MATRICES)
      .map(([name, matrix]) => `<filter id="chameleon-filter-${name}"><feColorMatrix type="matrix" values="${matrix}"/></filter>`)
      .join("");
    el.innerHTML = `<defs>${defs}</defs>`;
    document.body.appendChild(el);
    return el;
  }

  function cursorDataUri(size) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"><path d="M3 2 L3 20 L8 16 L11 22 L14 20.5 L11 14.5 L18 14.5 Z" fill="black" stroke="white" stroke-width="1.5"/></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  // Precedence, lowest to highest (spec 0.7): Dyslexia -> Color Lab -> High contrast
  // (overrides Color Lab colors) -> Magnify + Cursor (independent, stack) -> Focus
  // booster (always on top) -> Color-blind simulation (applied last, as a filter).
  function rebuild() {
    const rules = [];

    if (state.dyslexia.enabled) {
      rules.push(`
        body, body *:not(#a11y-intel-host):not(#a11y-intel-host *) {
          font-family: 'Comic Sans MS', Verdana, Tahoma, sans-serif !important;
          letter-spacing: 0.06em !important;
          word-spacing: 0.12em !important;
          line-height: 1.6 !important;
          text-align: left !important;
          font-style: normal !important;
          text-decoration: none !important;
        }
        body :not(script):not(style):not(#a11y-intel-host) { max-width: 70ch; }
      `);
      if (state.dyslexia.tint) rules.push(`body { background: #fdf6e3 !important; }`);
    }

    if (state.colorLab.enabled) {
      const cl = state.colorLab;
      let clText = "";
      if (cl.textColor) clText += `color: ${cl.textColor} !important;`;
      if (cl.bgColor) clText += `background: ${cl.bgColor} !important;`;
      if (cl.fontSize) clText += `font-size: ${cl.fontSize}px !important;`;
      // Spacing values use the larger of Dyslexia and Color Lab.
      const lineHeight = Math.max(cl.lineHeight || 0, state.dyslexia.enabled ? 1.6 : 0);
      if (lineHeight) clText += `line-height: ${lineHeight} !important;`;
      if (cl.letterSpacing) clText += `letter-spacing: ${cl.letterSpacing}px !important;`;
      if (cl.wordSpacing) clText += `word-spacing: ${cl.wordSpacing}px !important;`;
      if (clText) rules.push(`body, body *:not(#a11y-intel-host):not(#a11y-intel-host *) { ${clText} }`);
      // An explicit Color Lab background beats the Dyslexia tint.
      if (cl.bgColor) rules.push(`body { background: ${cl.bgColor} !important; }`);
    }

    if (state.highContrast.enabled) {
      const hc = state.highContrast;
      if (hc.mode === "bw") {
        rules.push(`body, body *:not(#a11y-intel-host):not(#a11y-intel-host *) { background: #fff !important; color: #000 !important; border-color: #000 !important; }`);
      } else if (hc.mode === "yb") {
        rules.push(`body, body *:not(#a11y-intel-host):not(#a11y-intel-host *) { background: #000 !important; color: #ffff00 !important; border-color: #ffff00 !important; }`);
      } else if (hc.mode === "invert") {
        rules.push(`body { filter: invert(1) hue-rotate(180deg) !important; }`);
      }
    }

    if (state.magnify.enabled) rules.push(`body { zoom: ${state.magnify.percent}% !important; }`);
    if (state.cursor.enabled) {
      const size = state.cursor.size === "xlarge" ? 48 : 32;
      const uri = cursorDataUri(size);
      rules.push(`body, body *:not(#a11y-intel-host):not(#a11y-intel-host *) { cursor: url("${uri}") ${Math.floor(size / 2)} ${Math.floor(size / 2)}, auto !important; }`);
    }

    if (state.focusBooster.enabled) {
      rules.push(`body :focus-visible:not(#a11y-intel-host *) { outline: 4px solid #ffbf00 !important; outline-offset: 3px !important; box-shadow: 0 0 0 7px rgba(255,191,0,0.35) !important; }`);
    }

    getStyleEl().textContent = rules.join("\n");

    if (state.colorBlindSim.enabled) {
      getSvgFilterContainer();
      document.body.style.setProperty("filter", `url(#chameleon-filter-${state.colorBlindSim.type})`, "important");
    } else if (document.body) {
      document.body.style.removeProperty("filter");
    }
  }

  function setState(feature, patch) {
    if (!state[feature]) return;
    Object.assign(state[feature], patch);
    if (feature === "soundAlternatives") {
      if (state.soundAlternatives.enabled) applySoundBadges();
      else removeSoundBadges();
    }
    rebuild();
  }

  function getState(feature) {
    return feature ? state[feature] : state;
  }

  // "Reset page" — one button clears all state and removes every injected element.
  function resetAll() {
    Object.keys(state).forEach((k) => {
      Object.keys(state[k]).forEach((prop) => {
        if (typeof state[k][prop] === "boolean") state[k][prop] = false;
      });
    });
    state.magnify.percent = 100;
    state.highContrast.mode = "bw";
    state.cursor.size = "large";
    state.colorBlindSim.type = "protanopia";
    const styleEl = document.getElementById(STYLE_ID);
    if (styleEl) styleEl.remove();
    if (document.body) document.body.style.removeProperty("filter");
    const svgEl = document.getElementById(SVG_FILTER_ID);
    if (svgEl) svgEl.remove();
    removeSoundBadges();
  }

  // Temporarily suspends all page styling (used by the scan pipeline so scores
  // describe the real, unmodified page), then restores exactly what was active.
  // Async-aware: awaits fn() before restoring, since axe's DOM/style inspection
  // spans multiple microtasks/frames, not a single synchronous call.
  async function withSuspended(fn) {
    const styleEl = document.getElementById(STYLE_ID);
    const hadStyle = styleEl ? styleEl.textContent : null;
    const hadFilter = document.body ? document.body.style.filter : "";
    if (styleEl) styleEl.textContent = "";
    if (document.body) document.body.style.removeProperty("filter");
    try {
      return await fn();
    } finally {
      if (hadStyle !== null) getStyleEl().textContent = hadStyle;
      if (hadFilter && document.body) document.body.style.setProperty("filter", hadFilter, "important");
    }
  }

  ns.styleManager = { state, setState, getState, rebuild, resetAll, withSuspended };
})();
