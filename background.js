// Service worker: the only context allowed to call chrome.scripting.executeScript.
// activeTab grants host access to the current tab only after the user invokes the
// toolbar action, so every injection below happens in direct response to that click
// or to a message that originated from a tab we already have activeTab access to.

const RESTRICTED_SCHEMES = ["chrome:", "chrome-extension:", "edge:", "about:", "devtools:"];
const CHROME_WEB_STORE = "https://chrome.google.com/webstore";

function isRestricted(url) {
  if (!url) return true;
  if (url.startsWith(CHROME_WEB_STORE)) return true;
  try {
    const scheme = new URL(url).protocol;
    return RESTRICTED_SCHEMES.includes(scheme);
  } catch {
    return true;
  }
}

const CONTENT_FILES = [
  "lookup.js",
  "scoring.js",
  "checks.js",
  "fixes.js",
  "executive.js",
  "roadmap.js",
  "content.js",
];

// chrome:// / Web Store pages can't host a content script at all, so the only
// channel left to tell the user anything is the toolbar icon itself.
async function flashBadgeError(tabId, text, title) {
  await chrome.action.setBadgeText({ tabId, text });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#b3261e" });
  await chrome.action.setTitle({ tabId, title });
  setTimeout(() => {
    chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
    chrome.action.setTitle({ tabId, title: "Scan this page for accessibility issues" }).catch(() => {});
  }, 4000);
}

async function activateOnTab(tab) {
  if (!tab || !tab.id) return;
  if (isRestricted(tab.url)) {
    await flashBadgeError(tab.id, "!", "Can't scan this page — browser/store pages are off-limits to extensions.");
    return;
  }
  try {
    // widget.css is injected into the Shadow DOM by content.js itself (a page-level
    // stylesheet via insertCSS would never penetrate shadow DOM encapsulation).
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES });
  } catch (err) {
    // Page blocked injection (e.g. CSP, PDF viewer) or tab closed mid-flight.
    console.warn("[A11y Intelligence] could not activate on tab:", err && err.message);
    await flashBadgeError(tab.id, "!", "This page blocked the scanner from loading (CSP or similar restriction).");
  }
}

chrome.action.onClicked.addListener((tab) => {
  activateOnTab(tab);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !sender.tab || !sender.tab.id) return;

  if (message.type === "A11Y_INJECT_AXE") {
    chrome.scripting
      .executeScript({ target: { tabId: sender.tab.id, allFrames: false }, files: ["lib/axe.min.js"] })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message) }));
    return true; // keep the message channel open for the async response
  }

  if (message.type === "A11Y_GET_SCAN_HISTORY") {
    chrome.storage.local.get(["scans"]).then((data) => {
      const scans = (data.scans && data.scans[message.url]) || [];
      sendResponse({ scans });
    });
    return true;
  }

  if (message.type === "A11Y_SAVE_SCAN") {
    chrome.storage.local.get(["scans"]).then((data) => {
      const scans = data.scans || {};
      const forUrl = scans[message.url] || [];
      forUrl.push(message.entry);
      // Keep a reasonable rolling window so storage doesn't grow unbounded.
      scans[message.url] = forUrl.slice(-50);
      chrome.storage.local.set({ scans }).then(() => sendResponse({ ok: true }));
    });
    return true;
  }
});
