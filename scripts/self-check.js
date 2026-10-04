// Dev script (spec 12.4): runs axe-core against Chameleon's OWN panel UI and
// fails if it finds any Critical or Serious issues. The panel is held to the
// same standard the extension holds everyone else to.
//
// Requires playwright-core and a Chromium-family browser on PATH (Edge or
// Chrome). Not wired into package.json (this project has none, by design — see
// README) — run directly:
//
//   node scripts/self-check.js
//   node scripts/self-check.js --edge "C:\path\to\msedge.exe"
//
// Exit code 0 = pass (zero Critical/Serious on the panel). Non-zero = fail.
const path = require("path");
const fs = require("fs");
const os = require("os");

function findChromiumPath() {
  const flagIdx = process.argv.indexOf("--edge");
  if (flagIdx !== -1 && process.argv[flagIdx + 1]) return process.argv[flagIdx + 1];
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

async function main() {
  let chromium;
  try {
    ({ chromium } = require("playwright-core"));
  } catch {
    console.error("playwright-core isn't installed. Run: npm install playwright-core --no-save (from this folder)");
    process.exit(2);
  }

  const executablePath = findChromiumPath();
  if (!executablePath) {
    console.error("No Chromium-family browser found. Pass one explicitly: node scripts/self-check.js --edge \"C:\\path\\to\\msedge.exe\"");
    process.exit(2);
  }

  // Work from a throwaway copy with file:// access pre-granted, so this is a
  // true zero-setup "just run it" script — the real manifest.json this repo
  // ships is untouched and still correctly defaults to NOT trusting file://.
  const realExtDir = path.join(__dirname, "..");
  const extDir = path.join(os.tmpdir(), "chameleon-self-check-ext");
  fs.rmSync(extDir, { recursive: true, force: true });
  fs.mkdirSync(extDir, { recursive: true });
  for (const entry of fs.readdirSync(realExtDir)) {
    if (entry === ".git" || entry === "scripts") continue;
    fs.cpSync(path.join(realExtDir, entry), path.join(extDir, entry), { recursive: true });
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(extDir, "manifest.json"), "utf8"));
  manifest.host_permissions = ["file:///*"];
  fs.writeFileSync(path.join(extDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  const userDataDir = path.join(os.tmpdir(), "chameleon-self-check-profile");
  fs.rmSync(userDataDir, { recursive: true, force: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false, // MV3 extensions require a headed context to load reliably
    executablePath,
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, "--no-first-run"],
  });

  try {
    const page = await context.newPage();
    const demoUrl = `file://${path.join(extDir, "demo.html").replace(/\\/g, "/")}`;
    await page.goto(demoUrl, { waitUntil: "load" });

    // Activate the extension the same way a real click would, via the service
    // worker's own activateOnTab() — see SESSION-NOTES.md for why this is the
    // standard way to drive this extension under automation.
    let sw = context.serviceWorkers()[0];
    if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 10000 });
    await sw.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((t) => t.url && t.url.includes("demo.html"));
      await activateOnTab(tab);
    });

    // state: "attached", not the default "visible" — the host div itself has no
    // box (its content lives in an open shadow root via fixed-positioned children).
    await page.waitForSelector("#a11y-intel-host", { state: "attached", timeout: 10000 });
    await page.waitForFunction(() => {
      const root = document.getElementById("a11y-intel-host")?.shadowRoot;
      return root && root.querySelector(".a11y-score-num");
    }, { timeout: 20000 });

    // Inject axe-core (same vendored copy the extension itself uses) and run it
    // scoped to just the panel element, reaching into the open shadow root.
    await page.addScriptTag({ path: path.join(extDir, "lib", "axe.min.js") });
    const results = await page.evaluate(async () => {
      const panel = document.getElementById("a11y-intel-host").shadowRoot.getElementById("a11y-panel");
      return await window.axe.run(panel, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"] } });
    });

    const bad = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
    const other = results.violations.filter((v) => v.impact !== "critical" && v.impact !== "serious");

    console.log(`Self-check: ${results.violations.length} total violations on the panel (${bad.length} Critical/Serious, ${other.length} Moderate/Minor).`);
    results.violations.forEach((v) => console.log(`  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`));

    await context.close();
    if (bad.length > 0) {
      console.error(`FAIL: ${bad.length} Critical/Serious issue(s) on Chameleon's own panel.`);
      process.exit(1);
    }
    console.log("PASS: zero Critical/Serious issues on the panel.");
    process.exit(0);
  } catch (err) {
    await context.close();
    console.error("Self-check errored:", err);
    process.exit(2);
  }
}

main();
