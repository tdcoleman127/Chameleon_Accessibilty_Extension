// Display-only roadmap content. Nothing here is built; it's shown so reviewers
// can see where this tool is headed and, just as importantly, where it refuses to go.
(function () {
  const ns = (window.__a11yIntel = window.__a11yIntel || {});

  const DEV_SNIPPET = `<script
  src="https://cdn.a11y-intelligence.dev/v1/monitor.min.js"
  integrity="sha384-REPLACE_WITH_REAL_SRI_HASH"
  crossorigin="anonymous"
  data-mode="read-only"
></script>`;

  const SNIPPET_NOTE =
    "Read-only: it would observe and score pages in production, never modify them. Verified with Subresource Integrity (SRI) " +
    "so the served file can't be swapped without the hash changing. Fixes would be delivered as pull requests against the " +
    "site's source, not live edits — matching the \"Open PR\" button above once it ships.";

  const ROADMAP_ITEMS = [
    {
      title: "Figma plugin",
      body: "Flag the same Design-score issues (contrast, spacing, target size) before a screen ever ships to code, using the same deterministic color math as this extension.",
    },
    {
      title: "Simulated personas, validated against real disabled testers",
      body: "The Experiential layer (comfort + task completion) needs people, not just rules. Personas would be built from real usability sessions and re-validated periodically, not invented once and assumed accurate forever.",
    },
    {
      title: "Competitor benchmark",
      body: "Score a competitor's page alongside your own so \"are we better or worse than X\" has a real number behind it.",
    },
    {
      title: "Haptic / multi-channel alerts",
      body: "For deaf-blind and situational-impairment users, critical alerts could also trigger a vibration pattern on supported devices or wearables — a channel neither color nor sound can reach. Try the demo below.",
    },
  ];

  const EXCLUSIONS_NOTE =
    "Explicitly excluded by design: live-patching overlay widgets, and auto-routing users to a separate \"accessible\" version of the " +
    "site. Both approaches create a second, divergent version of the product — one real users didn't choose and one the team doesn't " +
    "actually maintain. This tool only ever suggests changes to the one real site everyone uses.";

  const COMPETITOR_TABLE = [
    { name: "axe / Lighthouse", note: "Developer-only output. No impact ranking, no plain-language guidance for non-engineers, no fixes." },
    { name: "Overlays (accessiBe, UserWay, etc.)", note: "Patch the page at runtime with a JS layer. Widely criticized by disability advocates and have lost ADA lawsuits themselves — a separate layer, not a fix to the real site." },
    { name: "Enterprise audits (Deque, Level Access)", note: "Thorough and expert, but expensive, manual, and periodic — the score is stale the day after the audit ships." },
    { name: "This tool", note: "Continuous, runs in the browser you're already using, plain language for decision-makers, and every fix is a change to the real source — not an overlay." },
  ];

  function vibrateDemo() {
    if (!("vibrate" in navigator)) return false;
    // SOS-ish pattern to demonstrate a distinguishable, non-visual, non-audio alert channel.
    navigator.vibrate([80, 40, 80, 40, 200, 80, 200]);
    return true;
  }

  ns.roadmap = { DEV_SNIPPET, SNIPPET_NOTE, ROADMAP_ITEMS, EXCLUSIONS_NOTE, COMPETITOR_TABLE, vibrateDemo };
})();
