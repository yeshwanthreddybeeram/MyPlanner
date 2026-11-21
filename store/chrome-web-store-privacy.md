# Chrome Web Store — Privacy practices (copy/paste)

Use these on the item’s **Privacy practices** tab, then **Save draft**.

---

## Single purpose description

```
Hotel Collection lets users save hotels from Google Hotels/Maps into named local collections, view them on a map, reorder and note them, and export/import the list as JSON to share offline.
```

---

## Permission justifications

### storage

```
Stores the user’s hotel collections (names, hotel details, votes, notes, order) in chrome.storage.local on their device so collections persist between sessions. No data is sent to a remote server.
```

### contextMenus

```
Adds a “Add to collection” item to the Chrome context menu on Google Hotels/Maps pages so the user can save the current hotel with a right-click.
```

### activeTab

```
Lets the extension read the active Google Hotels/Maps tab when the user explicitly adds a hotel (from the side panel or context menu) so hotel details can be scraped from the page the user is viewing.
```

### scripting

```
Injects the content script and styles into Google Hotels/Maps pages (and re-injects after navigation) to show the “Add to collection” button and to scrape hotel name, URL, image, rating, and coordinates when the user adds a hotel.
```

### tabs

```
Finds or updates the Google Hotels/Maps tab when opening a saved hotel from the side panel, and opens WhatsApp Web when the user chooses Share. Also used to message the correct tab during add/scrape flows.
```

### sidePanel

```
Opens the Hotel Collection UI in Chrome’s side panel so the user can manage collections, map, notes, and export/import while browsing Google Hotels without a temporary popup.
```

### Host permission use

```
Access is limited to Google Travel/Hotels and Google Maps hosts so the extension can inject the Add button and scrape hotel details only on those pages when the user adds a hotel. OpenStreetMap tile hosts are used only to render the collection map in the side panel. The extension does not access unrelated websites.
```

Paste the host list from the listing if asked to name hosts; your manifest includes:
- `https://*.google.com/travel/*` and country Google Travel hosts
- `https://*.google.com/maps/*` and related Maps hosts
- `https://*.tile.openstreetmap.org/*`

---

## Remote code / data disclosure (typical answers)

Answer according to what the store form asks (wording varies):

| Question | Answer |
| --- | --- |
| Does this extension collect user data? | **No** (or: only stores hotel collection data locally; does not transmit it) |
| Is user data sold / used for ads / creditworthiness? | **No** |
| Does this extension use remote code? | **No** |
| Certify compliance with Developer Program Policies | **Check the box** |

If there is a free-text “data usage” / “privacy policy” field and you have no website yet:

```
Hotel Collection does not collect, sell, or transmit personal data. Saved hotels and notes stay in chrome.storage.local on the user’s device. Export/Share creates a JSON file the user chooses to send themselves (e.g. WhatsApp). Map tiles are loaded from OpenStreetMap; no analytics or advertising SDKs are included.
```

---

## Settings page (required before publish)

1. Open [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) → **Settings** (account/publisher, not the item).
2. Enter a **publisher contact email**.
3. Click **Verify** and confirm via the email Google sends.
4. Return to the item → **Privacy practices** → paste the texts above → save draft → publish.

You cannot publish until the email is verified, even if every justification is filled in.
