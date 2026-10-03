// Fixed lookup table: axe rule ID -> who it affects, in plain language.
// Deliberately not LLM-generated — every string here is authored once and reused,
// so the same violation always gets the same explanation.
(function () {
  const ns = (window.__a11yIntel = window.__a11yIntel || {});

  const POUR = { P: "Perceivable", O: "Operable", U: "Understandable", R: "Robust" };

  // table[ruleId] = { pour, component, affected, taskHint }
  // component is one of: buttons, forms, navigation, media, content, structure
  const table = {
    "color-contrast": {
      pour: POUR.P, component: "content",
      affected: "Low-vision users, people with color blindness, and anyone using a phone outdoors or in bright light can't read this text.",
    },
    "color-contrast-enhanced": {
      pour: POUR.P, component: "content",
      affected: "Low-vision users relying on the stricter AAA contrast level can't reliably read this text.",
    },
    "link-in-text-block": {
      pour: POUR.P, component: "content",
      affected: "Color-blind users and anyone skimming in low light can't tell this link apart from surrounding text.",
    },
    "image-alt": {
      pour: POUR.P, component: "content",
      affected: "Screen reader users hear nothing meaningful for this image, and it disappears entirely if the image fails to load.",
    },
    "image-redundant-alt": {
      pour: POUR.P, component: "content",
      affected: "Screen reader users hear the same information announced twice, slowing them down.",
    },
    "input-image-alt": {
      pour: POUR.P, component: "forms",
      affected: "Screen reader users can't tell what this image-based form control does.",
    },
    "role-img-alt": {
      pour: POUR.P, component: "content",
      affected: "Screen reader users hear nothing for an image that was marked as meaningful content.",
    },
    "svg-img-alt": {
      pour: POUR.P, component: "content",
      affected: "Screen reader users get no description for this graphic.",
    },
    "object-alt": {
      pour: POUR.P, component: "media",
      affected: "Screen reader users have no idea what this embedded object is or does.",
    },
    "video-caption": {
      pour: POUR.P, component: "media",
      affected: "Deaf and hard-of-hearing users, and anyone watching with sound off, miss all spoken content.",
    },
    "audio-caption": {
      pour: POUR.P, component: "media",
      affected: "Deaf and hard-of-hearing users get no access to this audio content at all.",
    },
    "no-autoplay-audio": {
      pour: POUR.O, component: "media",
      affected: "Screen reader users can't hear their own screen reader over unexpected audio, and people with ADHD or sensory sensitivities get involuntarily interrupted.",
    },
    "css-orientation-lock": {
      pour: POUR.O, component: "structure",
      affected: "People with mounted or fixed-position devices (wheelchairs, hospital beds) who can't rotate their device are locked out.",
    },
    "meta-viewport": {
      pour: POUR.O, component: "structure",
      affected: "Low-vision users who need to pinch-zoom to read content are blocked from doing so.",
    },
    "label": {
      pour: POUR.U, component: "forms",
      affected: "Screen reader users hear \"edit text, blank\" with no idea what to type, and voice-control users can't say the field's name to target it.",
    },
    "label-title-only": {
      pour: POUR.U, component: "forms",
      affected: "Screen reader users only get this field's name as a tooltip, which many screen readers skip entirely.",
    },
    "label-content-name-mismatch": {
      pour: POUR.U, component: "forms",
      affected: "Voice-control users who speak the visible label can't activate this control because its accessible name doesn't match.",
    },
    "form-field-multiple-labels": {
      pour: POUR.U, component: "forms",
      affected: "Screen readers may announce conflicting or duplicated instructions for this field.",
    },
    "autocomplete-valid": {
      pour: POUR.U, component: "forms",
      affected: "People using browser/assistive autofill (common for motor-impairment and cognitive-load reasons) don't get this field filled automatically.",
    },
    "button-name": {
      pour: POUR.O, component: "buttons",
      affected: "Screen reader users hear just \"button\" with no indication of what it does, and voice-control users have nothing to say to activate it.",
    },
    "input-button-name": {
      pour: POUR.O, component: "buttons",
      affected: "Screen reader and voice-control users can't tell what this button submits or does.",
    },
    "link-name": {
      pour: POUR.O, component: "navigation",
      affected: "Screen reader users hear \"link\" with no destination, and often have to open it just to find out where it goes.",
    },
    "select-name": {
      pour: POUR.U, component: "forms",
      affected: "Screen reader users can't tell what this dropdown is for before they open it.",
    },
    "nested-interactive": {
      pour: POUR.O, component: "structure",
      affected: "Screen reader and keyboard users get unpredictable or double activation when controls are nested inside each other.",
    },
    "focusable-content": {
      pour: POUR.O, component: "structure",
      affected: "Keyboard users can tab into a container that has nothing usable inside it, wasting navigation steps.",
    },
    "scrollable-region-focusable": {
      pour: POUR.O, component: "structure",
      affected: "Keyboard-only users can't scroll this region at all, since it's never reachable by Tab.",
    },
    "tabindex": {
      pour: POUR.O, component: "structure",
      affected: "Keyboard users get a confusing, out-of-order tab sequence that doesn't match the visual layout.",
    },
    "focus-order-semantics": {
      pour: POUR.O, component: "structure",
      affected: "Keyboard and screen reader users land on an element that doesn't behave the way its role implies.",
    },
    "skip-link": {
      pour: POUR.O, component: "navigation",
      affected: "Keyboard users have no way to skip repeated navigation and must tab through it on every single page.",
    },
    "heading-order": {
      pour: POUR.U, component: "structure",
      affected: "Screen reader users who navigate by heading level lose the page's outline and may miss sections entirely.",
    },
    "p-as-heading": {
      pour: POUR.U, component: "structure",
      affected: "Screen reader users navigating by heading won't find this section at all, because it isn't marked as one.",
    },
    "landmark-one-main": {
      pour: POUR.R, component: "structure",
      affected: "Screen reader users can't jump straight to the main content and must wade through everything else first.",
    },
    "landmark-unique": {
      pour: POUR.R, component: "structure",
      affected: "Screen reader users hear duplicate landmark names and can't tell regions apart when jumping between them.",
    },
    "landmark-no-duplicate-main": {
      pour: POUR.R, component: "structure",
      affected: "Screen reader users can't reliably jump to \"the\" main content when there's more than one.",
    },
    "landmark-no-duplicate-banner": {
      pour: POUR.R, component: "navigation",
      affected: "Screen reader users get confused about which header region is the page's actual banner.",
    },
    "landmark-no-duplicate-contentinfo": {
      pour: POUR.R, component: "navigation",
      affected: "Screen reader users get confused about which footer region is the page's actual contentinfo.",
    },
    "region": {
      pour: POUR.R, component: "structure",
      affected: "Screen reader users navigating by landmark lose content that falls outside any named region.",
    },
    "html-has-lang": {
      pour: POUR.U, component: "structure",
      affected: "Screen reader users hear the page read in the wrong language's pronunciation rules.",
    },
    "html-lang-valid": {
      pour: POUR.U, component: "structure",
      affected: "Screen readers can't reliably pick the right voice and pronunciation for this page.",
    },
    "valid-lang": {
      pour: POUR.U, component: "content",
      affected: "Screen reader users hear this specific passage mispronounced in the wrong language.",
    },
    "document-title": {
      pour: POUR.U, component: "structure",
      affected: "Screen reader users and anyone with many tabs open can't tell which tab this is without switching to it.",
    },
    "frame-title": {
      pour: POUR.R, component: "structure",
      affected: "Screen reader users hear \"frame\" with no indication of what content it contains.",
    },
    "frame-focusable-content": {
      pour: POUR.O, component: "structure",
      affected: "Keyboard users can tab into an embedded frame with nothing reachable inside it.",
    },
    "duplicate-id": {
      pour: POUR.R, component: "structure",
      affected: "Screen readers and form labels can bind to the wrong element entirely when IDs repeat.",
    },
    "duplicate-id-active": {
      pour: POUR.R, component: "structure",
      affected: "Assistive tech may focus or announce the wrong interactive element due to a duplicate ID.",
    },
    "duplicate-id-aria": {
      pour: POUR.R, component: "structure",
      affected: "Screen readers may read the wrong description or label because an ARIA reference ID is duplicated.",
    },
    "aria-allowed-attr": {
      pour: POUR.R, component: "structure",
      affected: "Screen readers may ignore this element's ARIA entirely because the attribute isn't valid for its role.",
    },
    "aria-required-attr": {
      pour: POUR.R, component: "structure",
      affected: "Screen reader users don't get the state or value information this control's role requires.",
    },
    "aria-required-children": {
      pour: POUR.R, component: "structure",
      affected: "Screen readers can't correctly announce this composite widget's structure to the user.",
    },
    "aria-required-parent": {
      pour: POUR.R, component: "structure",
      affected: "Screen readers announce this element outside the context it needs to make sense.",
    },
    "aria-roles": {
      pour: POUR.R, component: "structure",
      affected: "Screen reader users hear an incorrect or nonexistent role, misrepresenting what this element is.",
    },
    "aria-valid-attr-value": {
      pour: POUR.R, component: "structure",
      affected: "Screen readers may report the wrong state (e.g. expanded/checked) because the ARIA value is invalid.",
    },
    "aria-valid-attr": {
      pour: POUR.R, component: "structure",
      affected: "Screen readers ignore an ARIA attribute entirely because it isn't a real attribute name.",
    },
    "aria-hidden-focus": {
      pour: POUR.O, component: "structure",
      affected: "Screen reader users can tab to an element that's simultaneously hidden from them, landing nowhere.",
    },
    "aria-input-field-name": {
      pour: POUR.U, component: "forms",
      affected: "Screen reader users hear this input field with no accessible name at all.",
    },
    "aria-command-name": {
      pour: POUR.O, component: "buttons",
      affected: "Screen reader users encounter a button, link, or menu item with no announced name.",
    },
    "aria-toggle-field-name": {
      pour: POUR.U, component: "forms",
      affected: "Screen reader users hear a checkbox or switch with no label describing what it toggles.",
    },
    "presentation-role-conflict": {
      pour: POUR.R, component: "structure",
      affected: "Screen readers get conflicting signals about whether this element matters, and may hide real content.",
    },
    "list": {
      pour: POUR.R, component: "structure",
      affected: "Screen reader users don't hear \"list, N items,\" losing the grouping relationship between these items.",
    },
    "listitem": {
      pour: POUR.R, component: "structure",
      affected: "Screen reader users lose track of which list this item belongs to.",
    },
    "table-duplicate-name": {
      pour: POUR.U, component: "structure",
      affected: "Screen reader users may confuse this table with another one that shares its accessible name.",
    },
    "table-fake-caption": {
      pour: POUR.U, component: "structure",
      affected: "Screen reader users relying on a real caption element to understand this table's purpose get nothing.",
    },
    "td-headers-attr": {
      pour: POUR.R, component: "structure",
      affected: "Screen reader users navigating this data table cell-by-cell lose track of which row/column headers apply.",
    },
    "th-has-data-cells": {
      pour: POUR.R, component: "structure",
      affected: "Screen reader users hear a column or row header that announces for no actual data.",
    },
    "scope-attr-valid": {
      pour: POUR.R, component: "structure",
      affected: "Screen reader users may hear the wrong header associated with this table cell.",
    },
    "server-side-image-map": {
      pour: POUR.O, component: "navigation",
      affected: "Keyboard and screen reader users can't access any of the destinations behind this image map at all.",
    },
    "marquee": {
      pour: POUR.O, component: "content",
      affected: "People with ADHD, vestibular disorders, or low vision can't stop this moving text to read it at their own pace.",
    },
    "meta-refresh": {
      pour: POUR.O, component: "structure",
      affected: "Screen reader and low-vision users get redirected or refreshed before they've finished reading or filling out the page.",
    },
    "avoid-inline-spacing": {
      pour: POUR.P, component: "content",
      affected: "Low-vision users who override text spacing for readability (WCAG 1.4.12) find this text still collapses or overlaps.",
    },
    "identical-links-same-purpose": {
      pour: POUR.U, component: "navigation",
      affected: "Screen reader users hear several links with the same name that actually go to different places.",
    },
    "target-size": {
      pour: POUR.O, component: "buttons",
      affected: "People with tremors, motor impairments, or anyone on a touchscreen regularly mis-tap this control or an adjacent one.",
    },
    "hidden-content": {
      pour: POUR.R, component: "structure",
      affected: "Content exists that may be unreachable or inconsistently exposed to assistive technology.",
    },
  };

  // Generic fallback grouped by axe "cat.*" tag, used when a specific rule isn't
  // in the table above (axe-core ships ~90 rules; this covers the long tail).
  const catFallback = {
    "cat.color": { pour: POUR.P, component: "content", affected: "People with low vision or color blindness may not perceive this correctly." },
    "cat.text-alternatives": { pour: POUR.P, component: "content", affected: "Screen reader users don't get an equivalent description of this content." },
    "cat.time-and-media": { pour: POUR.P, component: "media", affected: "Deaf, hard-of-hearing, or low-vision users may miss information carried only through audio or video." },
    "cat.sensory-and-visual-cues": { pour: POUR.P, component: "content", affected: "Users who can't perceive color, shape, or sound alone may miss this cue." },
    "cat.name-role-value": { pour: POUR.R, component: "structure", affected: "Screen reader and voice-control users don't get a reliable name or role for this element." },
    "cat.semantics": { pour: POUR.U, component: "structure", affected: "Assistive technology may misrepresent what this element is or does." },
    "cat.forms": { pour: POUR.U, component: "forms", affected: "Screen reader and voice-control users may not understand this form control." },
    "cat.keyboard": { pour: POUR.O, component: "structure", affected: "Keyboard-only users may not be able to reach or operate this." },
    "cat.structure": { pour: POUR.R, component: "structure", affected: "Screen reader users may lose the structural relationships needed to understand this content." },
    "cat.aria": { pour: POUR.R, component: "structure", affected: "Screen readers may misreport or ignore this element because of invalid ARIA usage." },
    "cat.language": { pour: POUR.U, component: "content", affected: "Screen reader users may hear mispronounced or wrongly-voiced content." },
    "cat.tables": { pour: POUR.R, component: "structure", affected: "Screen reader users navigating this table may lose track of headers and relationships." },
    "cat.parsing": { pour: POUR.R, component: "structure", affected: "Assistive technology may parse this markup unpredictably across browsers and screen readers." },
  };

  function lookupRule(ruleId, tags) {
    if (table[ruleId]) return table[ruleId];
    const tag = (tags || []).find((t) => catFallback[t]);
    if (tag) return catFallback[tag];
    return { pour: POUR.R, component: "content", affected: "This may create a barrier for people using assistive technology." };
  }

  ns.lookup = { table, catFallback, lookupRule, POUR };
})();
