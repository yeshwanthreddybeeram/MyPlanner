(function () {
  // Always redefine scrape helpers on reinject (after extension reload).
  // Only skip observers/listeners if we already booted once in this frame.
  const alreadyBooted = Boolean(window.__hotelCollectionLoaded);

  const TOAST_ID = "hc-toast";
  const IDS = {
    underCheck: "hc-add-under-check",
    fab: "hc-add-fab",
  };

  function showToast(message) {
    const existing = document.getElementById(TOAST_ID);
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = TOAST_ID;
    toast.textContent = message;
    document.documentElement.appendChild(toast);
    setTimeout(() => toast.remove(), 2800);
  }

  function textOf(el) {
    return (el?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function cleanName(t) {
    return String(t || "")
      .replace(/[\uE000-\uF8FF]/g, "") // private-use icons (Sponsored glyph)
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isBadHotelName(t) {
    const s = cleanName(t);
    if (!s || s.length < 2 || s.length > 160) return true;
    if (/sponsored/i.test(s)) return true;
    if (
      /^(ad|ads|results|overview|prices|reviews|about|hotels?|search|google|maps)$/i.test(
        s
      )
    ) {
      return true;
    }
    return false;
  }

  function findCheckAvailability() {
    const labels = [
      ...findLabelNodes("Check availability"),
      ...findLabelNodes("Check Availability"),
    ];
    for (const labelEl of labels) {
      const btn =
        labelEl.closest("button, a, div[role='button'], span[role='button']") ||
        labelEl;
      if (btn.getBoundingClientRect?.().width > 120) return btn;
      return btn;
    }
    const byAria = document.querySelector(
      '[aria-label*="Check availability" i], [aria-label*="Check Availability" i]'
    );
    if (byAria) return byAria;
    const all = document.querySelectorAll("button, a, div[role='button']");
    for (const el of all) {
      const t = textOf(el).toLowerCase();
      if (t.includes("check availability") && t.length < 40) return el;
    }
    return null;
  }

  function inSameColumn(elRect, colRect) {
    // Overlap horizontally with the detail panel / Check availability column
    const overlap =
      Math.min(elRect.right, colRect.right) - Math.max(elRect.left, colRect.left);
    return overlap > Math.min(elRect.width, colRect.width) * 0.4;
  }

  /** Heading in the open detail panel only (same column as Check availability). */
  function findHotelHeading() {
    const checkBtn = findCheckAvailability();
    if (!checkBtn) return null;

    const checkRect = checkBtn.getBoundingClientRect();
    let scope = checkBtn;
    let best = null;
    let bestDist = Infinity;

    for (let i = 0; i < 14 && scope; i += 1) {
      const headings = scope.querySelectorAll(
        'h1, h2, [role="heading"], [aria-level="1"], [aria-level="2"]'
      );
      for (const h of headings) {
        const t = cleanName(textOf(h));
        if (isBadHotelName(t) || /search|results/i.test(t)) continue;
        // Own text only — avoid parent that concatenates "Sponsored" + other stuff
        const own = cleanName(
          Array.from(h.childNodes)
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent)
            .join(" ") || textOf(h)
        );
        const label = !isBadHotelName(own) ? own : t;
        if (isBadHotelName(label)) continue;

        const hr = h.getBoundingClientRect();
        if (hr.width < 40 || hr.height < 12) continue;
        if (!inSameColumn(hr, checkRect)) continue;
        if (hr.bottom > checkRect.top + 8) continue;

        const dist = checkRect.top - hr.bottom;
        if (dist >= 0 && dist < bestDist) {
          best = h;
          bestDist = dist;
          best._hcName = label;
        }
      }
      // Stop once we have a tight match in a reasonably sized panel
      if (best && bestDist < 400 && scope.clientWidth < 700) break;
      scope = scope.parentElement;
    }

    return best;
  }

  function nameFromMeta() {
    const og =
      document.querySelector('meta[property="og:title"]')?.content ||
      document.querySelector('meta[name="twitter:title"]')?.content ||
      "";
    const cleaned = cleanName(og.split(" - ")[0]);
    return isBadHotelName(cleaned) ? "" : cleaned;
  }

  function nameFromNearbyDirections() {
    // Name is usually the prominent text above the Directions / Save row
    const dirLabels = findLabelNodes("Directions");
    for (const labelEl of dirLabels) {
      const row =
        labelEl.closest("div, span, c-wiz")?.parentElement ||
        labelEl.parentElement;
      if (!row) continue;
      let scope = row;
      for (let i = 0; i < 8 && scope; i += 1) {
        const headings = scope.querySelectorAll(
          'h1, h2, [role="heading"], [aria-level="1"]'
        );
        for (const h of headings) {
          const t = cleanName(textOf(h));
          if (!isBadHotelName(t)) return t;
        }
        scope = scope.parentElement;
      }
    }
    return "";
  }

  function findDetailRoot(heading, checkBtn) {
    if (checkBtn) {
      let el = checkBtn;
      for (let i = 0; i < 12 && el; i += 1) {
        const t = textOf(el).toLowerCase();
        if (
          t.includes("check availability") &&
          (t.includes("directions") || t.includes("overview")) &&
          el.scrollHeight > 180
        ) {
          return el;
        }
        el = el.parentElement;
      }
    }
    if (!heading) return document.body;
    let el = heading;
    for (let i = 0; i < 8 && el; i += 1) {
      if (el.scrollHeight > 200 && el.querySelector) return el;
      el = el.parentElement;
    }
    return heading.closest("c-wiz, [role='main'], main") || document.body;
  }

  function parseRating(root) {
    const labeled = root.querySelector(
      '[aria-label*="star" i], [aria-label*="rating" i], [aria-label*="out of" i]'
    );
    if (labeled) {
      const m = (labeled.getAttribute("aria-label") || "").match(
        /(\d+(?:\.\d+)?)/
      );
      if (m) return Number(m[1]);
    }
    return null;
  }

  function parsePrice(root) {
    // Prefer prices near "Compare prices" / booking rows, skip left-rail cards
    const walk = root.querySelectorAll("span, div, a");
    for (const el of walk) {
      const t = textOf(el);
      if (!t || t.length > 40) continue;
      if (/^[₹$€£]\s?[\d,]+(\.\d+)?$/.test(t)) return t;
      if (/from\s+[₹$€£]/i.test(t)) {
        const m = t.match(/[₹$€£]\s?[\d,]+/);
        if (m) return m[0];
      }
    }
    return "";
  }

  function parseImage(root, heading) {
    const candidates = [];
    const imgs = root.querySelectorAll("img[src]");
    for (const img of imgs) {
      const src = img.getAttribute("src") || "";
      if (!src.startsWith("http")) continue;
      if (/icon|sprite|logo|pixel|maps\.gstatic\.com\/.*map/i.test(src)) continue;
      const r = img.getBoundingClientRect();
      const area = Math.max(0, r.width) * Math.max(0, r.height);
      if (area < 80 * 80 && img.naturalWidth && img.naturalWidth < 80) continue;
      let score = area;
      // Prefer images above Check availability / near heading
      if (heading) {
        const hr = heading.getBoundingClientRect();
        if (r.top <= hr.bottom + 220) score += 50000;
      }
      candidates.push({ src, score });
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.src || "";
  }

  function nameFromMapsPlaceUrl(href) {
    try {
      const m = href.match(/\/maps\/place\/([^/@]+)/i);
      if (!m) return "";
      return decodeURIComponent(m[1].replace(/\+/g, " ")).trim();
    } catch {
      return "";
    }
  }

  function placeIdFromUrl(href) {
    const m =
      href.match(/!1s(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)/) ||
      href.match(/[?&]ftid=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }

  /** Prefer place marker (!3d!4d) over map camera (@). */
  function coordsFromPageUrl(href) {
    const place = href.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (place) return { lat: Number(place[1]), lng: Number(place[2]) };
    const at = href.match(/\/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (at) return { lat: Number(at[1]), lng: Number(at[2]) };
    return { lat: null, lng: null };
  }

  function parseCoordsFromHref(href) {
    if (!href) return { lat: null, lng: null };
    const dest = href.match(
      /(?:destination|query|q)=(-?\d+\.\d+),(-?\d+\.\d+)/i
    );
    if (dest) return { lat: Number(dest[1]), lng: Number(dest[2]) };
    return coordsFromPageUrl(href);
  }

  function parseCoordsFromDetail(root) {
    if (!root) return { lat: null, lng: null };
    const links = root.querySelectorAll("a[href]");
    for (const a of links) {
      const label = (
        a.getAttribute("aria-label") ||
        textOf(a) ||
        ""
      ).toLowerCase();
      const href = a.getAttribute("href") || "";
      if (
        label.includes("direction") ||
        href.includes("dir/") ||
        href.includes("destination=")
      ) {
        const coords = parseCoordsFromHref(href);
        if (coords.lat != null) return coords;
      }
    }
    return { lat: null, lng: null };
  }

  function resolveHotelName(heading) {
    // 1) Maps place URL path — most reliable on maps.google place pages
    const fromMaps = cleanName(nameFromMapsPlaceUrl(location.href));
    if (fromMaps && !isBadHotelName(fromMaps)) return fromMaps;

    // 2) Heading stored from detail-column search
    const fromHeading = cleanName(heading?._hcName || textOf(heading));
    if (fromHeading && !isBadHotelName(fromHeading)) return fromHeading;

    // 3) Near Directions / Save row
    const fromDir = nameFromNearbyDirections();
    if (fromDir) return fromDir;

    // 4) Open Graph / Twitter title
    const fromMeta = nameFromMeta();
    if (fromMeta) return fromMeta;

    // 5) document.title ("Holiday Inn … - Google Maps")
    const title = cleanName((document.title || "").split(/\s+[-–|]\s+/)[0]);
    if (title && !isBadHotelName(title) && !/google/i.test(title)) return title;

    return "";
  }

  function scrapeHotel() {
    const checkBtn = findCheckAvailability();
    const heading = findHotelHeading();
    const name = resolveHotelName(heading);
    if (!name) {
      return {
        ok: false,
        error: "Could not read hotel name — open the hotel place page.",
      };
    }

    const root = findDetailRoot(heading, checkBtn);
    let { lat, lng } = parseCoordsFromDetail(root);
    if (lat == null) {
      ({ lat, lng } = coordsFromPageUrl(location.href));
    }

    return {
      ok: true,
      hotel: {
        name,
        // Always the current tab URL (Maps place / Hotels page user is on)
        url: location.href,
        placeId: placeIdFromUrl(location.href) || "",
        rating: parseRating(root),
        priceText: parsePrice(root),
        lat,
        lng,
        imageUrl: parseImage(root, heading),
        source: "google_hotels",
      },
    };
  }

  // Used by the side panel / background via scripting.executeScript (all frames)
  window.__hcScrapeHotel = scrapeHotel;

  if (alreadyBooted) return;
  window.__hotelCollectionLoaded = true;

  function onAddClick(e) {
    e.preventDefault();
    e.stopPropagation();
    const btn =
      e.currentTarget?.querySelector?.(".hc-add-btn") ||
      (e.currentTarget?.classList?.contains("hc-add-btn")
        ? e.currentTarget
        : e.target.closest(".hc-add-btn"));
    (async () => {
      if (btn) btn.disabled = true;
      document.querySelectorAll(".hc-add-btn, #hc-add-fab").forEach((b) => {
        b.disabled = true;
      });
      const scraped = scrapeHotel();
      if (!scraped.ok) {
        showToast(scraped.error);
        document.querySelectorAll(".hc-add-btn, #hc-add-fab").forEach((b) => {
          b.disabled = false;
        });
        return;
      }
      try {
        const result = await chrome.runtime.sendMessage({
          type: "ADD_HOTEL",
          hotel: scraped.hotel,
        });
        if (result?.existing) {
          showToast(
            `Already saved as “${result.hotel?.name || scraped.hotel.name}”`
          );
        } else if (result?.ok && result.added) {
          showToast(`Added: ${scraped.hotel.name}`);
        } else {
          showToast(result?.error || "Could not add hotel");
        }
      } catch {
        showToast("Extension error — reload the extension and page");
      }
      document.querySelectorAll(".hc-add-btn, #hc-add-fab").forEach((b) => {
        b.disabled = false;
      });
    })();
  }

  function findLabelNodes(label) {
    const out = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const v = (node.nodeValue || "").trim();
          return v === label
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      }
    );
    let n;
    while ((n = walker.nextNode())) {
      if (n.parentElement) out.push(n.parentElement);
    }
    return out;
  }

  const PANEL_BTN_ID = "hc-add-in-panel";

  function styleLikeCheck(btn, checkBtn) {
    if (!checkBtn) {
      btn.style.setProperty("background", "#FF5A5F", "important");
      btn.style.setProperty("color", "#fff", "important");
      return;
    }
    const s = window.getComputedStyle(checkBtn);
    if (s.backgroundColor && s.backgroundColor !== "rgba(0, 0, 0, 0)") {
      btn.style.setProperty("background", s.backgroundColor, "important");
    } else {
      btn.style.setProperty("background", "#FF5A5F", "important");
    }
    btn.style.setProperty("color", "#fff", "important");
    if (s.borderRadius) {
      btn.style.setProperty("border-radius", s.borderRadius, "important");
    }
    if (s.height && s.height !== "auto") {
      btn.style.setProperty("min-height", s.height, "important");
    }
    btn.style.setProperty("border", "none", "important");
  }

  function createAddButtonEl(id) {
    const wrap = document.createElement("div");
    wrap.id = id;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hc-add-btn";
    btn.textContent = "+ Add to collection";
    wrap.appendChild(btn);
    wrap.addEventListener("click", onAddClick, true);
    return wrap;
  }

  /** Best anchor inside the hotel detail panel. */
  function findPanelAnchor() {
    const check = findCheckAvailability();
    if (check) return { el: check, kind: "check" };

    // Action row: Directions / Save / Nearby / Share
    const share = findLabelNodes("Share");
    for (const labelEl of share) {
      let el = labelEl;
      for (let i = 0; i < 8 && el; i += 1) {
        const t = textOf(el).toLowerCase();
        if (
          t.includes("directions") &&
          t.includes("save") &&
          t.includes("share")
        ) {
          return { el, kind: "actions" };
        }
        el = el.parentElement;
      }
    }

    const compare = findLabelNodes("Compare prices");
    if (compare[0]) {
      return { el: compare[0].closest("div") || compare[0], kind: "compare" };
    }
    return null;
  }

  function isRowFlex(el) {
    if (!el) return false;
    const s = window.getComputedStyle(el);
    return (
      (s.display === "flex" || s.display === "inline-flex") &&
      (s.flexDirection === "row" ||
        s.flexDirection === "row-reverse" ||
        s.flexDirection === "")
    );
  }

  function findInsertAfter(anchorEl) {
    let el = anchorEl;
    let row = null;
    for (let i = 0; i < 8 && el?.parentElement; i += 1) {
      const parent = el.parentElement;
      if (isRowFlex(parent)) row = parent;
      else if (row) return { host: parent, after: row };
      el = parent;
    }
    const wrap = anchorEl.parentElement;
    if (wrap?.parentElement) return { host: wrap.parentElement, after: wrap };
    return null;
  }

  /**
   * Inject into the panel DOM. Google may delete this on re-render —
   * we put it back every time refreshButton runs.
   */
  function ensurePanelButton() {
    const anchor = findPanelAnchor();
    const existing = document.getElementById(PANEL_BTN_ID);

    if (!anchor) {
      existing?.remove();
      return false;
    }

    const slot = findInsertAfter(anchor.el);
    if (!slot) {
      existing?.remove();
      return false;
    }

    let wrap = existing;
    if (!wrap || !slot.host.contains(wrap)) {
      wrap?.remove();
      wrap = createAddButtonEl(PANEL_BTN_ID);
      wrap.className = "hc-add-panel";
      slot.host.insertBefore(wrap, slot.after.nextSibling);
    } else if (slot.after.nextElementSibling !== wrap) {
      slot.host.insertBefore(wrap, slot.after.nextSibling);
    }

    const btn = wrap.querySelector(".hc-add-btn");
    if (btn && anchor.kind === "check") styleLikeCheck(btn, anchor.el);
    else if (btn) styleLikeCheck(btn, null);

    wrap.style.display = "block";
    wrap.style.width = "100%";
    wrap.style.margin = "8px 0";
    return true;
  }

  /** Fixed overlay under Check availability — survives Google DOM wipes. */
  function ensureFixedUnderCheck() {
    const checkBtn = findCheckAvailability();
    let wrap = document.getElementById(IDS.underCheck);
    if (!wrap || !document.documentElement.contains(wrap)) {
      wrap?.remove();
      wrap = createAddButtonEl(IDS.underCheck);
      document.documentElement.appendChild(wrap);
    }

    if (!checkBtn) {
      // If panel button exists, hide fixed duplicate
      if (document.getElementById(PANEL_BTN_ID)) {
        wrap.style.display = "none";
      }
      return false;
    }

    // Prefer in-panel button; hide fixed clone when panel inject succeeded
    if (document.getElementById(PANEL_BTN_ID)?.isConnected) {
      wrap.style.display = "none";
      return true;
    }

    const rect = checkBtn.getBoundingClientRect();
    if (!rect.width || rect.bottom < 40 || rect.top > window.innerHeight) {
      wrap.style.display = "none";
      return false;
    }
    wrap.style.display = "block";
    wrap.style.position = "fixed";
    wrap.style.left = `${Math.round(rect.left)}px`;
    wrap.style.top = `${Math.round(rect.bottom + 8)}px`;
    wrap.style.width = `${Math.round(rect.width)}px`;
    wrap.style.zIndex = "2147483645";
    const btn = wrap.querySelector(".hc-add-btn");
    if (btn) styleLikeCheck(btn, checkBtn);
    return true;
  }

  function cleanupRemovedPlacements() {
    document.getElementById("hc-add-beside-name")?.remove();
    document.getElementById("hc-add-beside-save")?.remove();
    // FAB moved into the extension side panel
    document.getElementById(IDS.fab)?.remove();
  }

  function refreshButton() {
    cleanupRemovedPlacements();
    // Re-add into hotel detail panel whenever Google wiped it
    ensurePanelButton();
    ensureFixedUnderCheck();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "SCRAPE_HOTEL") {
      sendResponse(scrapeHotel());
      return false;
    }
    if (message?.type === "PING") {
      sendResponse({ ok: true, href: location.href });
      return false;
    }
    if (message?.type === "ADD_RESULT") {
      if (message.existing) {
        showToast(`Already in collection: ${message.hotel?.name || "hotel"}`);
      } else if (message.ok) {
        showToast(`Added: ${message.hotel?.name || "hotel"}`);
      } else {
        showToast(message.error || "Could not add hotel");
      }
    }
  });

  refreshButton();
  // Fast loop: Google re-renders often; put the button back immediately
  setInterval(refreshButton, 400);

  window.addEventListener("scroll", refreshButton, true);
  window.addEventListener("resize", refreshButton);

  let debounceTimer = 0;
  const observer = new MutationObserver(() => {
    window.clearTimeout(debounceTimer);
    // Near-immediate re-inject after DOM changes
    debounceTimer = window.setTimeout(refreshButton, 50);
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
