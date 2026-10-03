// Custom checks that axe-core doesn't cover: deaf/hard-of-hearing and
// neurodivergent-impact signals. Each scored check returns issues shaped like
// axe violations so they flow through the same scoring + card pipeline.
// Human-review items are kept separate and are never scored.
(function () {
  const ns = (window.__a11yIntel = window.__a11yIntel || {});
  const { POUR } = ns.lookup;

  function cssPath(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      let part = node.tagName.toLowerCase();
      if (node.classList.length) part += "." + Array.from(node.classList).slice(0, 2).map((c) => CSS.escape(c)).join(".");
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  function makeIssue({ id, impact, pour, component, help, description, elements }) {
    if (!elements.length) return null;
    return {
      id,
      source: "custom",
      impact,
      pour,
      component,
      help,
      description,
      tags: [],
      nodeCount: elements.length,
      targets: elements,
      nodes: elements.slice(0, 25).map((el) => ({ target: [cssPath(el)], html: el.outerHTML.slice(0, 300) })),
    };
  }

  function hasTranscriptNearby(el) {
    const scope = el.closest("figure, section, article, div") || el.parentElement;
    if (!scope) return false;
    const links = scope.querySelectorAll("a");
    return Array.from(links).some((a) => /transcript/i.test(a.textContent || ""));
  }

  function checkMediaCaptions(doc) {
    const flagged = [];
    const reviewIframes = [];
    doc.querySelectorAll("video").forEach((v) => {
      const hasTrack = v.querySelector('track[kind="captions"], track[kind="subtitles"]');
      if (!hasTrack && !hasTranscriptNearby(v)) flagged.push(v);
    });
    doc.querySelectorAll("audio").forEach((a) => {
      if (!hasTranscriptNearby(a)) flagged.push(a);
    });
    doc.querySelectorAll('iframe[src*="youtube"], iframe[src*="vimeo"], iframe[src*="player"]').forEach((f) => {
      reviewIframes.push(f);
    });
    return { flagged, reviewIframes };
  }

  function checkAutoplay(doc) {
    const flagged = [];
    doc.querySelectorAll("video[autoplay], audio[autoplay]").forEach((el) => flagged.push(el));
    return flagged;
  }

  function pageHasReducedMotionQuery(doc) {
    for (const sheet of Array.from(doc.styleSheets)) {
      try {
        const rules = sheet.cssRules;
        if (!rules) continue;
        for (const rule of Array.from(rules)) {
          if (rule.conditionText && /prefers-reduced-motion/i.test(rule.conditionText)) return true;
          if (rule.media && /prefers-reduced-motion/i.test(rule.media.mediaText || "")) return true;
        }
      } catch {
        // Cross-origin stylesheet; can't inspect, skip.
      }
    }
    return false;
  }

  function pageHasAnimationUsage(doc) {
    try {
      if (typeof doc.defaultView.document.getAnimations === "function") {
        if (doc.defaultView.document.getAnimations().length > 0) return true;
      }
    } catch {
      /* ignore */
    }
    for (const sheet of Array.from(doc.styleSheets)) {
      try {
        const rules = sheet.cssRules;
        if (!rules) continue;
        for (const rule of Array.from(rules)) {
          if (rule.type === CSSRule.KEYFRAMES_RULE) return true;
        }
      } catch {
        /* cross-origin, skip */
      }
    }
    return false;
  }

  function checkLongLines(doc) {
    const flagged = [];
    const candidates = doc.querySelectorAll("p, li, dd, blockquote, td");
    candidates.forEach((el) => {
      const text = (el.textContent || "").trim();
      if (text.length < 60) return;
      if (el.children.length > 3) return; // likely a layout container, not a text block
      const rect = el.getBoundingClientRect();
      if (rect.width < 50) return;
      const fontSize = parseFloat(getComputedStyle(el).fontSize) || 16;
      const avgCharWidth = fontSize * 0.5;
      const charsPerLine = rect.width / avgCharWidth;
      if (charsPerLine > 90) flagged.push(el);
    });
    return flagged.slice(0, 20);
  }

  function checkColorOrSoundOnlyAlerts(doc) {
    const flagged = [];
    const selector = '[role="alert"], [role="status"], [aria-live], [class*="alert"], [class*="error"], [class*="success"], [class*="warning"], [class*="invalid"]';
    doc.querySelectorAll(selector).forEach((el) => {
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      const hasIcon = el.querySelector('svg, img, [class*="icon"]');
      if (text.length < 2 && hasIcon) flagged.push(el); // icon/color-only, no readable text
    });
    return flagged;
  }

  function runScoredChecks(doc) {
    const issues = [];
    const { flagged: captionFlagged, reviewIframes } = checkMediaCaptions(doc);
    issues.push(
      makeIssue({
        id: "custom-media-captions",
        impact: "serious",
        pour: POUR.P,
        component: "media",
        help: "Media missing captions or a transcript link",
        description: "Deaf and hard-of-hearing users, and anyone browsing with sound off, get no access to spoken or audible content.",
        elements: captionFlagged,
      })
    );
    issues.push(
      makeIssue({
        id: "custom-autoplay-media",
        impact: "moderate",
        pour: POUR.O,
        component: "media",
        help: "Media plays automatically without user control",
        description: "Screen reader users can't hear their own screen reader over unexpected audio, and people with ADHD or sensory sensitivities get involuntarily interrupted.",
        elements: checkAutoplay(doc),
      })
    );
    const longLines = checkLongLines(doc);
    issues.push(
      makeIssue({
        id: "custom-long-line-length",
        impact: "minor",
        pour: POUR.P,
        component: "content",
        help: "Text block exceeds a comfortable reading line length",
        description: "People with dyslexia or low vision lose their place line-to-line when a block of text runs much wider than ~80 characters.",
        elements: longLines,
      })
    );
    issues.push(
      makeIssue({
        id: "custom-color-or-sound-only-alert",
        impact: "serious",
        pour: POUR.P,
        component: "content",
        help: "Alert conveys meaning only through color or icon, with no text",
        description: "Color-blind users and screen reader users relying on text can't tell what state this alert is communicating.",
        elements: checkColorOrSoundOnlyAlerts(doc),
      })
    );
    if (pageHasAnimationUsage(doc) && !pageHasReducedMotionQuery(doc)) {
      issues.push(
        makeIssue({
          id: "custom-reduced-motion",
          impact: "moderate",
          pour: POUR.O,
          component: "content",
          help: "Animations run with no prefers-reduced-motion handling",
          description: "People with vestibular disorders, migraines, or ADHD can get real physical symptoms from motion they can't turn off.",
          elements: [doc.documentElement],
        })
      );
    }

    return { issues: issues.filter(Boolean), reviewIframes };
  }

  function runHumanReview(doc, reviewIframes) {
    const items = [
      {
        title: "Plain-language error messages",
        why: "Judging whether wording is genuinely clear to someone with a cognitive disability or limited English proficiency requires human reading comprehension, not pattern matching.",
      },
      {
        title: "Consistent layout across pages",
        why: "Consistency is a judgment about the whole site's navigation and visual language over time, which a single-page scan can't evaluate.",
      },
      {
        title: "Caption accuracy",
        why: "Detecting that captions exist is automatable; verifying they actually match the spoken audio requires a human to watch and listen.",
      },
      {
        title: "Flashing content (seizure risk)",
        why: "The general flash and red flash thresholds require frame-by-frame luminance analysis of rendered video, which static DOM/CSS inspection can't perform.",
      },
      {
        title: "Overall cognitive load",
        why: "Whether a page's information density and complexity overwhelm a user is a holistic judgment, not a per-element rule.",
      },
    ];
    if (reviewIframes && reviewIframes.length) {
      items.push({
        title: `${reviewIframes.length} embedded video player${reviewIframes.length > 1 ? "s" : ""} (YouTube/Vimeo/etc.)`,
        why: "The extension can't inspect caption tracks inside a cross-origin embedded player; open the video and check for a CC option by hand.",
      });
    }
    return items;
  }

  // Rule IDs (axe or custom) that belong in the "deaf/HoH & neurodivergent" extra
  // checks grouping in the UI, even though some are detected by axe itself.
  const EXTRA_CHECK_RULE_IDS = new Set([
    "video-caption",
    "audio-caption",
    "no-autoplay-audio",
    "meta-refresh",
    "avoid-inline-spacing",
    "custom-media-captions",
    "custom-autoplay-media",
    "custom-long-line-length",
    "custom-color-or-sound-only-alert",
    "custom-reduced-motion",
  ]);

  ns.checks = { runScoredChecks, runHumanReview, EXTRA_CHECK_RULE_IDS };
})();
