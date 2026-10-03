// Deterministic fix suggestions. Color math only (no LLM). Preview mutates the
// live page in memory only — nothing here ever persists to the site.
(function () {
  const ns = (window.__a11yIntel = window.__a11yIntel || {});

  // ---------- Color math ----------
  function parseColor(str) {
    const el = document.createElement("div");
    el.style.color = str;
    document.body.appendChild(el);
    const computed = getComputedStyle(el).color;
    document.body.removeChild(el);
    const m = computed.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }

  function toHex({ r, g, b }) {
    const h = (n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");
    return `#${h(r)}${h(g)}${h(b)}`;
  }

  function relLuminance({ r, g, b }) {
    const lin = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  function contrastRatio(rgb1, rgb2) {
    const l1 = relLuminance(rgb1) + 0.05;
    const l2 = relLuminance(rgb2) + 0.05;
    return l1 > l2 ? l1 / l2 : l2 / l1;
  }

  function rgbToHsl({ r, g, b }) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s;
    const l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4;
      }
      h /= 6;
    }
    return { h, s, l };
  }

  function hslToRgb({ h, s, l }) {
    if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return {
      r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
      g: Math.round(hue2rgb(p, q, h) * 255),
      b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
    };
  }

  // Keep hue + saturation fixed; binary-search lightness toward whichever
  // extreme (black/white) increases contrast against a fixed background,
  // stopping at the smallest lightness change that reaches targetRatio.
  function suggestContrastFix(fgStr, bgStr, targetRatio) {
    const fgRgb = parseColor(fgStr);
    const bgRgb = parseColor(bgStr);
    if (!fgRgb || !bgRgb) return null;
    const originalRatio = contrastRatio(fgRgb, bgRgb);
    const hsl = rgbToHsl(fgRgb);
    const bgLum = relLuminance(bgRgb);
    const goDark = bgLum > 0.5; // light background -> darken foreground, and vice versa
    const extreme = goDark ? 0 : 1;

    const ratioAt = (l) => contrastRatio(hslToRgb({ h: hsl.h, s: hsl.s, l }), bgRgb);
    if (ratioAt(extreme) < targetRatio) {
      // Even black/white on this hue can't reach target — return the closest we can get.
      const bestRgb = hslToRgb({ h: hsl.h, s: hsl.s, l: extreme });
      return {
        originalHex: toHex(fgRgb), suggestedHex: toHex(bestRgb),
        originalRatio: round2(originalRatio), newRatio: round2(ratioAt(extreme)),
        targetRatio, reachedTarget: false,
      };
    }

    let lo = goDark ? 0 : hsl.l;
    let hi = goDark ? hsl.l : 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (ratioAt(mid) >= targetRatio) {
        if (goDark) lo = mid; else hi = mid;
      } else {
        if (goDark) hi = mid; else lo = mid;
      }
    }
    const finalL = goDark ? lo : hi;
    const suggestedRgb = hslToRgb({ h: hsl.h, s: hsl.s, l: finalL });
    return {
      originalHex: toHex(fgRgb), suggestedHex: toHex(suggestedRgb),
      originalRatio: round2(originalRatio), newRatio: round2(ratioAt(finalL)),
      targetRatio, reachedTarget: true,
    };
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  // ---------- Other deterministic fix generators ----------
  function suggestTargetSizeFix(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width >= 24 && rect.height >= 24) return null;
    return {
      kind: "design",
      property: "min-width / min-height",
      original: `width: ${Math.round(rect.width)}px; height: ${Math.round(rect.height)}px;`,
      suggested: `min-width: 24px; min-height: 24px; padding: ${Math.max(4, Math.round((24 - rect.height) / 2))}px ${Math.max(4, Math.round((24 - rect.width) / 2))}px;`,
      why: "People with tremors, motor impairments, or anyone on a touchscreen need at least a 24×24px target to tap reliably (WCAG 2.2, 2.5.8).",
    };
  }

  function guessAccessibleName(el) {
    const icon = el.querySelector('[class*="icon"], svg, i');
    const classHint = icon && icon.className && String(icon.className.baseVal || icon.className);
    if (classHint) {
      const m = classHint.match(/icon-([a-z-]+)/i) || classHint.match(/fa-([a-z-]+)/i);
      if (m) return m[1].replace(/-/g, " ");
    }
    if (el.href) {
      try {
        const path = new URL(el.href, location.href).pathname.split("/").filter(Boolean).pop();
        if (path) return path.replace(/[-_]/g, " ");
      } catch { /* ignore */ }
    }
    return null;
  }

  function suggestNameFix(el) {
    const tag = el.tagName.toLowerCase();
    const guess = guessAccessibleName(el);
    const label = guess ? guess[0].toUpperCase() + guess.slice(1) : "Describe this control";
    return {
      kind: "code",
      original: el.outerHTML.slice(0, 200),
      suggested: el.outerHTML.replace(/^<(\w+)/, `<$1 aria-label="${label}"`).slice(0, 220),
      why: `Screen reader and voice-control users currently hear just "${tag}" with no name to act on.`,
      needsHumanConfirmation: !guess,
    };
  }

  function suggestLabelFix(el) {
    const guess = el.getAttribute("placeholder") || el.getAttribute("name") || el.type || "field";
    const id = el.id || `field-${Math.random().toString(36).slice(2, 8)}`;
    const labelText = guess.replace(/[-_]/g, " ");
    return {
      kind: "code",
      original: el.outerHTML.slice(0, 200),
      suggested: `<label for="${id}">${labelText[0].toUpperCase() + labelText.slice(1)}</label>\n${el.outerHTML.replace("<input", `<input id="${id}"`).slice(0, 180)}`,
      why: "Screen reader users hear \"edit text, blank\" with nothing to go on, and voice-control users can't target this field by name.",
      needsHumanConfirmation: !el.getAttribute("placeholder") && !el.getAttribute("name"),
      id,
    };
  }

  function suggestAltFix(el) {
    const srcHint = (el.getAttribute("src") || "").split("/").pop().split(/[?#]/)[0].replace(/[-_.]/g, " ");
    return {
      kind: "code",
      original: el.outerHTML.slice(0, 200),
      suggested: el.outerHTML.replace("<img", `<img alt="[describe: ${srcHint || "image content"}]"`).slice(0, 220),
      why: "Screen reader users get nothing, and the alt text disappears entirely if the image fails to load.",
      needsHumanConfirmation: true,
    };
  }

  function suggestFocusFix(el) {
    return {
      kind: "design",
      property: "outline",
      original: "outline: none; (or no :focus-visible style)",
      suggested: "outline: 3px solid #005fcc; outline-offset: 2px;",
      why: "Keyboard users need a visible indicator of where focus currently is, or they navigate blind.",
    };
  }

  // ---------- Preview / Undo ----------
  const patches = new Map(); // element -> [{type:'style', prevCssText} | {type:'attr', name, prevValue}]

  function record(el, patch) {
    if (!patches.has(el)) patches.set(el, []);
    patches.get(el).push(patch);
  }

  function applyStylePatch(el, cssText) {
    record(el, { type: "style", prevCssText: el.style.cssText });
    el.style.cssText += `;${cssText}`;
    el.setAttribute("data-a11y-intel-preview", "true");
  }

  function applyAttrPatch(el, name, value) {
    record(el, { type: "attr", name, prevValue: el.hasAttribute(name) ? el.getAttribute(name) : null });
    el.setAttribute(name, value);
    el.setAttribute("data-a11y-intel-preview", "true");
  }

  function undo(el) {
    const stack = patches.get(el);
    if (!stack || !stack.length) return;
    const patch = stack.pop();
    if (patch.type === "style") el.style.cssText = patch.prevCssText;
    else if (patch.prevValue === null) el.removeAttribute(patch.name);
    else el.setAttribute(patch.name, patch.prevValue);
    if (!stack.length) {
      patches.delete(el);
      el.removeAttribute("data-a11y-intel-preview");
    }
  }

  function resetAll() {
    for (const el of Array.from(patches.keys())) {
      while (patches.get(el) && patches.get(el).length) undo(el);
    }
  }

  function buildCopyPatch() {
    const cssLines = [];
    const htmlLines = [];
    for (const [el, stack] of patches.entries()) {
      stack.forEach((p) => {
        if (p.type === "style") cssLines.push(`${cssPathFor(el)} { ${el.style.cssText} }`);
        else htmlLines.push(el.outerHTML.slice(0, 300));
      });
    }
    return [
      cssLines.length ? `/* CSS changes */\n${cssLines.join("\n")}` : "",
      htmlLines.length ? `<!-- HTML changes -->\n${htmlLines.join("\n")}` : "",
    ].filter(Boolean).join("\n\n");
  }

  function cssPathFor(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    return el.tagName.toLowerCase() + (el.className ? "." + String(el.className).split(/\s+/).filter(Boolean).map((c) => CSS.escape(c)).join(".") : "");
  }

  ns.fixes = {
    suggestContrastFix, suggestTargetSizeFix, suggestNameFix, suggestLabelFix,
    suggestAltFix, suggestFocusFix, applyStylePatch, applyAttrPatch, undo, resetAll,
    buildCopyPatch, contrastRatio, parseColor, toHex,
  };
})();
