import { addHotel } from "./lib/storage.js";

const MENU_ID = "add-to-collection";

const GOOGLE_HOTEL_PATTERNS = [
  "https://www.google.com/travel/*",
  "https://www.google.co.in/travel/*",
  "https://www.google.co.uk/travel/*",
  "https://www.google.com.au/travel/*",
  "https://www.google.ca/travel/*",
  "https://www.google.com/maps/*",
  "https://www.google.co.in/maps/*",
];

async function ensureContextMenu() {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Add to collection",
    contexts: ["page", "selection", "link", "image"],
    documentUrlPatterns: GOOGLE_HOTEL_PATTERNS,
  });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureContextMenu();
});

ensureContextMenu();

// Keep collection UI open beside the page while browsing / opening hotels
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});

function isGoogleTravelUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return (
      /(^|\.)google\./.test(u.hostname) &&
      (u.pathname.startsWith("/travel") || u.pathname.startsWith("/maps"))
    );
  } catch {
    return false;
  }
}

async function injectIntoTab(tabId) {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId, allFrames: true },
      files: ["content.css"],
    });
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["content.js"],
    });
  } catch {
    // Missing host permission or restricted page.
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && isGoogleTravelUrl(tab.url)) {
    injectIntoTab(tabId);
  }
});

async function scrapeFromTab(tabId) {
  // Scan every frame — hotel detail often isn't in the top frame only.
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        try {
          if (typeof window.__hcScrapeHotel === "function") {
            return window.__hcScrapeHotel();
          }
        } catch {
          // ignore frame errors
        }
        return { ok: false, error: "Content script not ready" };
      },
    });

    const payloads = (results || [])
      .map((r) => r?.result)
      .filter(Boolean);
    const ok = payloads.find((p) => p.ok && p.hotel?.name);
    if (ok) return ok;

    const withError = payloads.find(
      (p) => p.error && !/not ready/i.test(p.error)
    );
    if (withError) return withError;
  } catch {
    // Fall through to message-based scrape
  }

  try {
    return await chrome.tabs.sendMessage(tabId, { type: "SCRAPE_HOTEL" });
  } catch {
    return {
      ok: false,
      error: "Open a Google Hotels or Maps place, then try again.",
    };
  }
}

async function findHotelTab() {
  const windows = await chrome.windows.getAll({ populate: true });
  const lastFocused = windows.find((w) => w.focused) || windows[0];
  const candidates = [];

  for (const win of windows) {
    for (const tab of win.tabs || []) {
      if (!isGoogleTravelUrl(tab.url)) continue;
      candidates.push({
        tab,
        score:
          (win.id === lastFocused?.id ? 4 : 0) +
          (tab.active ? 2 : 0) +
          (tab.highlighted ? 1 : 0),
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.tab || null;
}

async function saveScrapedHotel(payload) {
  if (!payload?.ok || !payload.hotel) {
    return {
      ok: false,
      error: payload?.error || "Could not read hotel details.",
    };
  }

  const result = await addHotel(payload.hotel);
  if (result.error) {
    return { ok: false, error: result.error };
  }
  return {
    ok: true,
    added: result.added,
    existing: result.existing,
    hotel: result.hotel,
  };
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return;

  const scraped = await scrapeFromTab(tab.id);
  const result = await saveScrapedHotel(scraped);

  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: "ADD_RESULT",
      ...result,
    });
  } catch {
    // Tab may not have content script.
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "ADD_HOTEL") {
    (async () => {
      const result = await saveScrapedHotel({
        ok: true,
        hotel: message.hotel,
      });
      if (sender.tab?.id) {
        try {
          await chrome.tabs.sendMessage(sender.tab.id, {
            type: "ADD_RESULT",
            ...result,
          });
        } catch {
          // ignore
        }
      }
      sendResponse(result);
    })();
    return true;
  }

  if (message?.type === "SCRAPE_AND_ADD") {
    (async () => {
      const tabId = sender.tab?.id;
      if (!tabId) {
        sendResponse({ ok: false, error: "No active tab." });
        return;
      }
      const scraped = await scrapeFromTab(tabId);
      const result = await saveScrapedHotel(scraped);
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: "ADD_RESULT",
          ...result,
        });
      } catch {
        // ignore
      }
      sendResponse(result);
    })();
    return true;
  }

  // Side panel: scrape the current Google Hotels / Maps tab and save
  if (message?.type === "ADD_FROM_PANEL") {
    (async () => {
      try {
        const tab = await findHotelTab();
        if (!tab?.id) {
          sendResponse({
            ok: false,
            error: "Open a Google Hotels or Maps place first.",
          });
          return;
        }

        await injectIntoTab(tab.id);
        // Give content script a beat to register after inject
        await new Promise((r) => setTimeout(r, 150));

        let scraped = await scrapeFromTab(tab.id);
        if (!scraped?.ok) {
          // One retry — Maps panels render late
          await new Promise((r) => setTimeout(r, 350));
          scraped = await scrapeFromTab(tab.id);
        }

        const result = await saveScrapedHotel(scraped);
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: "ADD_RESULT",
            ...result,
          });
        } catch {
          // ignore
        }
        sendResponse(result);
      } catch (err) {
        sendResponse({
          ok: false,
          error: err?.message || "Could not add hotel",
        });
      }
    })();
    return true;
  }
});
