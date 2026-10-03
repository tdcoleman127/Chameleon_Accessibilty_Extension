// Executive summary tab: trend sparkline, top risks in plain language, blocked
// tasks, legal-exposure note, and a self-contained downloadable HTML report.
(function () {
  const ns = (window.__a11yIntel = window.__a11yIntel || {});

  function sparklinePath(values, w, h) {
    if (!values.length) return "";
    const max = 100, min = 0;
    const stepX = values.length > 1 ? w / (values.length - 1) : 0;
    return values
      .map((v, i) => {
        const x = i * stepX;
        const y = h - ((v - min) / (max - min)) * h;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }

  function renderSparklineSvg(history, key, color) {
    const w = 160, h = 36;
    const values = history.map((h2) => h2[key]);
    if (values.length < 2) {
      return `<svg width="${w}" height="${h}" role="img" aria-label="Not enough scan history yet"></svg>`;
    }
    const path = sparklinePath(values, w, h);
    const last = values[values.length - 1];
    const lastX = w;
    const lastY = h - (last / 100) * h;
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${key} score trend, currently ${last}">
      <path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="${lastX}" cy="${lastY}" r="3" fill="${color}" />
    </svg>`;
  }

  function topRisks(issues) {
    return issues.slice(0, 3).map((issue) => {
      const who = issue.affected || "people using assistive technology";
      return `${issue.help}. ${who}`;
    });
  }

  function blockedTasks(issues) {
    const tasks = new Set();
    issues.forEach((issue) => {
      if (issue.elementCritical || issue.pageCritical) {
        tasks.add(issue.taskLabel || "Checkout / sign-up / login flow");
      }
    });
    return Array.from(tasks);
  }

  const LEGAL_NOTE =
    "Automated accessibility failures are commonly cited evidence in ADA Title III lawsuits in the US, and the EU Accessibility Act " +
    "(in force since June 2025) references WCAG 2.1 AA as its conformance baseline. Neither law requires perfection, but an " +
    "unaddressed, high-impact barrier on a core flow like checkout or sign-up is the pattern both regimes penalize most.";

  function buildSummary({ design, code, issues }, history) {
    return {
      design, code,
      trendDesign: history.map((h) => h.design),
      trendCode: history.map((h) => h.code),
      risks: topRisks(issues),
      blocked: blockedTasks(issues),
      legalNote: LEGAL_NOTE,
    };
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function buildReportHtml({ url, title, design, code, issues, history, roadmapNote }) {
    const riskItems = topRisks(issues).map((r) => `<li>${escapeHtml(r)}</li>`).join("");
    const blocked = blockedTasks(issues);
    const blockedItems = blocked.length
      ? blocked.map((b) => `<li>${escapeHtml(b)}</li>`).join("")
      : "<li>No currently blocked critical-path tasks detected.</li>";
    const issueRows = issues
      .slice(0, 25)
      .map(
        (i) => `<tr>
          <td>${escapeHtml(i.help)}</td>
          <td>${escapeHtml(i.pour)}</td>
          <td>${escapeHtml(i.impact)}</td>
          <td>${i.nodeCount}</td>
          <td>${escapeHtml(i.affected || "")}</td>
        </tr>`
      )
      .join("");
    const trendRows = history
      .map((h) => `<tr><td>${new Date(h.ts).toLocaleString()}</td><td>${h.design}</td><td>${h.code}</td></tr>`)
      .join("");

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Accessibility report — ${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, Segoe UI, Arial, sans-serif; max-width: 860px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; line-height: 1.5; }
  h1 { font-size: 1.5rem; } h2 { margin-top: 2rem; font-size: 1.15rem; border-bottom: 1px solid #ddd; padding-bottom: .25rem; }
  .scores { display: flex; gap: 2rem; margin: 1rem 0; }
  .score { font-size: 2rem; font-weight: 700; } .score small { display:block; font-size: .8rem; font-weight: 400; color: #555; }
  table { border-collapse: collapse; width: 100%; margin-top: .5rem; }
  th, td { text-align: left; border-bottom: 1px solid #e5e5e5; padding: .4rem .6rem; font-size: .9rem; }
  .note { background: #fff7e6; border: 1px solid #f0c36d; padding: .75rem 1rem; border-radius: 6px; font-size: .9rem; }
  .disclaimer { color: #555; font-size: .85rem; }
</style>
</head>
<body>
  <h1>Accessibility report</h1>
  <p><strong>Page:</strong> ${escapeHtml(title)}<br/><strong>URL:</strong> ${escapeHtml(url)}<br/><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
  <div class="scores">
    <div class="score">${design}<small>Automated Design score</small></div>
    <div class="score">${code}<small>Automated Code score</small></div>
  </div>
  <p class="disclaimer">Automated checks catch only a portion of real barriers. This is a starting point, not a certification.</p>

  <h2>Top risks</h2>
  <ul>${riskItems}</ul>

  <h2>Blocked tasks</h2>
  <ul>${blockedItems}</ul>

  <h2>Legal exposure</h2>
  <p class="note">${escapeHtml(LEGAL_NOTE)}</p>

  <h2>Issue detail</h2>
  <table>
    <thead><tr><th>Issue</th><th>Principle</th><th>Impact</th><th>Count</th><th>Who's affected</th></tr></thead>
    <tbody>${issueRows}</tbody>
  </table>

  <h2>Score history for this URL</h2>
  <table>
    <thead><tr><th>Scanned</th><th>Design</th><th>Code</th></tr></thead>
    <tbody>${trendRows}</tbody>
  </table>
</body>
</html>`;
  }

  function downloadText(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const urlObj = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = urlObj;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(urlObj);
  }

  ns.executive = { renderSparklineSvg, buildSummary, buildReportHtml, downloadText, LEGAL_NOTE, topRisks, blockedTasks };
})();
