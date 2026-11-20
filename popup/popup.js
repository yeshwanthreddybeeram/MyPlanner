import {
  getCollection,
  getActiveCollectionMeta,
  listCollections,
  setActiveCollection,
  createCollection,
  deleteCollection,
  removeHotel,
  mergeCollection,
  toExportPayload,
  clearCollection,
  hotelOpenUrl,
  setHotelVote,
  setHotelNote,
  reorderCollection,
  reorderByVote,
} from "../lib/storage.js";

const hotelList = document.getElementById("hotel-list");
const countLabel = document.getElementById("count-label");
const statusEl = document.getElementById("status");
const mapHint = document.getElementById("map-hint");
const exportBtn = document.getElementById("export-btn");
const shareBtn = document.getElementById("share-btn");
const clearBtn = document.getElementById("clear-btn");
const importInput = document.getElementById("import-input");
const addFromPageBtn = document.getElementById("add-from-page-btn");
const reorderBtn = document.getElementById("reorder-btn");
const collectionsScroll = document.getElementById("collections-scroll");
const newCollectionBtn = document.getElementById("new-collection-btn");

let map;
let markerLayer;
const markersById = new Map();
let dragId = null;
/** Ignore storage→refresh while we save a note from this panel (keeps caret). */
let skipStorageRefresh = 0;
let pendingRefresh = false;

function isEditingNote() {
  return Boolean(
    document.activeElement?.closest?.(".hotel-note-wrap.is-editing")
  );
}

function setStatus(message) {
  statusEl.textContent = message;
  if (message) {
    setTimeout(() => {
      if (statusEl.textContent === message) statusEl.textContent = "";
    }, 2800);
  }
}

function initMap() {
  // eslint-disable-next-line no-undef
  delete L.Icon.Default.prototype._getIconUrl;
  // eslint-disable-next-line no-undef
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "../vendor/leaflet/images/marker-icon-2x.png",
    iconUrl: "../vendor/leaflet/images/marker-icon.png",
    shadowUrl: "../vendor/leaflet/images/marker-shadow.png",
  });

  // eslint-disable-next-line no-undef
  map = L.map("map", {
    zoomControl: true,
    attributionControl: true,
  }).setView([20, 0], 2);

  // eslint-disable-next-line no-undef
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);

  // eslint-disable-next-line no-undef
  markerLayer = L.layerGroup().addTo(map);
}

function hotelsWithCoords(collection) {
  return collection.filter(
    (h) => typeof h.lat === "number" && typeof h.lng === "number"
  );
}

function renderMap(collection, collectionName) {
  markerLayer.clearLayers();
  markersById.clear();

  const pinned = hotelsWithCoords(collection);
  const label = collectionName || "your collection";
  if (!pinned.length) {
    mapHint.textContent = `Map shows only hotels in ${label} that have coordinates.`;
    map.setView([20, 0], 2);
    return;
  }

  mapHint.textContent = `${pinned.length} pin${pinned.length === 1 ? "" : "s"} from ${label}`;
  // eslint-disable-next-line no-undef
  const bounds = L.latLngBounds([]);

  for (const hotel of pinned) {
    // eslint-disable-next-line no-undef
    const marker = L.marker([hotel.lat, hotel.lng]).addTo(markerLayer);
    marker.bindPopup(
      `<strong>${escapeHtml(hotel.name)}</strong>${
        hotel.priceText ? `<br>${escapeHtml(hotel.priceText)}` : ""
      }`
    );
    markersById.set(hotel.id, marker);
    bounds.extend([hotel.lat, hotel.lng]);
  }

  if (pinned.length === 1) {
    map.setView([pinned[0].lat, pinned[0].lng], 13);
  } else {
    map.fitBounds(bounds.pad(0.2));
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function focusMap(hotel) {
  document
    .querySelectorAll(".hotel-item")
    .forEach((el) => el.classList.toggle("active", el.dataset.id === hotel.id));

  const marker = markersById.get(hotel.id);
  if (marker) {
    map.setView(marker.getLatLng(), 14);
    marker.openPopup();
  }
}

/** Open the URL that was saved when the hotel was added. */
async function openHotel(hotel) {
  const url = hotelOpenUrl(hotel);
  if (!url) {
    setStatus("No link for this hotel");
    return;
  }
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const travelTab = tabs.find(
    (t) => t.url && /google\.[^/]+\/(travel|maps)/i.test(t.url)
  );
  const [active] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  const target = travelTab || active;
  if (target?.id) {
    await chrome.tabs.update(target.id, { url, active: true });
    setStatus(`Opened: ${hotel.name}`);
  }
}

function renderCollectionsBar(lists) {
  collectionsScroll.innerHTML = "";
  for (const col of lists) {
    const chip = document.createElement("div");
    chip.className = `collection-chip${col.active ? " active" : ""}`;
    chip.title = col.name;
    chip.setAttribute("role", "button");
    chip.tabIndex = 0;

    const nameEl = document.createElement("span");
    nameEl.className = "collection-chip-name";
    nameEl.textContent = col.name;

    const countEl = document.createElement("span");
    countEl.className = "collection-chip-count";
    countEl.textContent = String(col.count);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "collection-chip-delete";
    del.title = "Delete collection";
    del.setAttribute("aria-label", `Delete ${col.name}`);
    del.textContent = "×";
    del.disabled = lists.length <= 1;
    del.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (lists.length <= 1) {
        setStatus("Keep at least one collection");
        return;
      }
      const ok = confirm(
        `Are you sure you want to delete collection “${col.name}”?`
      );
      if (!ok) return;
      const result = await deleteCollection(col.id);
      if (!result.ok) {
        setStatus(result.error || "Could not delete");
        return;
      }
      await refresh();
      setStatus(`Deleted “${result.name}”`);
    });

    const select = async () => {
      if (col.active) return;
      await setActiveCollection(col.id);
      await refresh();
    };

    chip.addEventListener("click", (e) => {
      if (e.target.closest(".collection-chip-delete")) return;
      select();
    });
    chip.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        select();
      }
    });

    chip.append(nameEl, countEl, del);
    collectionsScroll.appendChild(chip);
  }
}

function renderList(collection, collectionName) {
  hotelList.innerHTML = "";
  countLabel.textContent = `${collection.length} hotel${
    collection.length === 1 ? "" : "s"
  }${collectionName ? ` in ${collectionName}` : ""}`;

  if (reorderBtn) {
    reorderBtn.hidden = collection.length < 2;
  }

  collection.forEach((hotel, index) => {
    const li = document.createElement("li");
    li.className = `hotel-item${hotel.vote === "love" ? " loved" : ""}${
      hotel.vote === "dislike" ? " disliked" : ""
    }`;
    li.dataset.id = hotel.id;
    li.draggable = true;
    let suppressClick = false;

    const handle = document.createElement("span");
    handle.className = "drag-handle";
    handle.title = "Drag to rank";
    handle.textContent = "⠿";
    handle.setAttribute("aria-hidden", "true");

    const rank = document.createElement("span");
    rank.className = "rank-num";
    rank.textContent = String(index + 1);

    if (hotel.imageUrl) {
      const img = document.createElement("img");
      img.className = "hotel-thumb";
      img.src = hotel.imageUrl;
      img.alt = "";
      img.draggable = false;
      img.referrerPolicy = "no-referrer";
      li.append(handle, rank, img);
    } else {
      const ph = document.createElement("div");
      ph.className = "hotel-thumb placeholder";
      ph.textContent = "⌂";
      li.append(handle, rank, ph);
    }

    const meta = document.createElement("div");
    meta.className = "hotel-meta";
    const name = document.createElement("div");
    name.className = "hotel-name";
    name.textContent = hotel.name;
    const sub = document.createElement("div");
    sub.className = "hotel-sub";
    const bits = [];
    if (hotel.rating != null) bits.push(`${hotel.rating}★`);
    if (hotel.priceText) bits.push(hotel.priceText);
    if (hotel.lat == null) bits.push("no pin");
    sub.textContent = bits.join(" · ") || "Saved from Google Hotels";
    meta.append(name, sub);

    const noteWrap = document.createElement("div");
    noteWrap.className = "hotel-note-wrap";
    noteWrap.addEventListener("click", (e) => e.stopPropagation());
    noteWrap.addEventListener("mousedown", (e) => e.stopPropagation());
    noteWrap.addEventListener("dragstart", (e) => e.preventDefault());

    const NOTE_PREVIEW_LEN = 90;
    let noteText = hotel.note || "";

    const preview = document.createElement("button");
    preview.type = "button";
    preview.className = "hotel-note-preview";

    const previewText = document.createElement("span");
    previewText.className = "hotel-note-preview-text";

    const readMore = document.createElement("span");
    readMore.className = "hotel-note-more";
    readMore.textContent = "Read more";

    preview.append(previewText, readMore);

    const editor = document.createElement("div");
    editor.className = "hotel-note-editor";

    const note = document.createElement("textarea");
    note.className = "hotel-note";
    note.rows = 3;
    note.maxLength = 240;
    note.placeholder = "Add notes";
    note.draggable = false;

    const noteActions = document.createElement("div");
    noteActions.className = "hotel-note-actions";

    const saveNoteBtn = document.createElement("button");
    saveNoteBtn.type = "button";
    saveNoteBtn.className = "note-save-btn";
    saveNoteBtn.textContent = "Save";

    const cancelNoteBtn = document.createElement("button");
    cancelNoteBtn.type = "button";
    cancelNoteBtn.className = "note-cancel-btn";
    cancelNoteBtn.textContent = "Cancel";

    noteActions.append(cancelNoteBtn, saveNoteBtn);
    editor.append(note, noteActions);

    const updatePreview = () => {
      const trimmed = noteText.trim();
      if (!trimmed) {
        previewText.textContent = "Add notes";
        preview.classList.add("is-empty");
        readMore.hidden = true;
        return;
      }
      preview.classList.remove("is-empty");
      const needsMore = trimmed.length > NOTE_PREVIEW_LEN;
      previewText.textContent = needsMore
        ? `${trimmed.slice(0, NOTE_PREVIEW_LEN).trimEnd()}…`
        : trimmed;
      readMore.hidden = !needsMore;
    };

    const showPreview = () => {
      noteWrap.classList.remove("is-editing");
      updatePreview();
    };

    const showEditor = () => {
      noteWrap.classList.add("is-editing");
      note.value = noteText;
      note.focus();
      // Caret at start so you see the beginning while editing
      note.setSelectionRange(0, 0);
      note.scrollTop = 0;
    };

    const persistNote = async (value) => {
      skipStorageRefresh += 1;
      try {
        await setHotelNote(hotel.id, value);
        noteText = value;
        hotel.note = value;
      } finally {
        setTimeout(() => {
          skipStorageRefresh = Math.max(0, skipStorageRefresh - 1);
        }, 50);
      }
    };

    preview.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showEditor();
    });

    saveNoteBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      saveNoteBtn.disabled = true;
      try {
        await persistNote(note.value);
        showPreview();
        setStatus("Note saved");
        if (pendingRefresh) {
          pendingRefresh = false;
          await refresh();
        }
      } finally {
        saveNoteBtn.disabled = false;
      }
    });

    cancelNoteBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      note.value = noteText;
      showPreview();
    });

    noteWrap.append(preview, editor);
    meta.appendChild(noteWrap);
    updatePreview();

    li.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "hotel-actions";

    const voteRow = document.createElement("div");
    voteRow.className = "vote-row";

    const love = document.createElement("button");
    love.type = "button";
    love.className = `vote-btn love${hotel.vote === "love" ? " active" : ""}`;
    love.title = "Love";
    love.setAttribute("aria-label", "Love");
    love.innerHTML = '<span class="vote-icon">♥</span>';
    love.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      love.classList.remove("pop");
      void love.offsetWidth;
      love.classList.add("pop");
      await setHotelVote(hotel.id, "love");
      await refresh();
    });

    const dislike = document.createElement("button");
    dislike.type = "button";
    dislike.className = `vote-btn dislike${
      hotel.vote === "dislike" ? " active" : ""
    }`;
    dislike.title = "Dislike";
    dislike.setAttribute("aria-label", "Dislike");
    // SVG so inactive state can be grey (emoji thumbs stay yellow otherwise)
    dislike.innerHTML =
      '<span class="vote-icon" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">' +
      '<path d="M15 3H6c-.8 0-1.5.5-1.8 1.2l-3 7.1c-.2.4-.2.8-.2 1.2V14c0 1.1.9 2 2 2h6.3l-1 4.7v.3c0 .4.2.8.4 1.1l1.1 1.1 6.6-6.6c.4-.4.6-.9.6-1.4V5c0-1.1-.9-2-2-2zm4 0v10h4V3h-4z"/>' +
      "</svg></span>";
    dislike.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      dislike.classList.remove("pop");
      void dislike.offsetWidth;
      dislike.classList.add("pop");
      await setHotelVote(hotel.id, "dislike");
      await refresh();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "vote-btn remove-btn";
    remove.title = "Remove";
    remove.setAttribute("aria-label", "Remove");
    remove.textContent = "✕";
    remove.addEventListener("click", async (e) => {
      e.stopPropagation();
      await removeHotel(hotel.id);
      await refresh();
      setStatus("Removed");
    });

    voteRow.append(love, dislike);
    actions.append(voteRow, remove);
    li.appendChild(actions);

    // Click card to open (not after a drag, not on vote/remove/note)
    li.addEventListener("click", (e) => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      if (e.target.closest(".hotel-actions, .hotel-note-wrap")) return;
      focusMap(hotel);
      openHotel(hotel);
    });

    // Entire card is draggable (except vote/remove/note)
    li.addEventListener("dragstart", (e) => {
      if (e.target.closest(".hotel-actions, .hotel-note-wrap")) {
        e.preventDefault();
        return;
      }
      suppressClick = true;
      dragId = hotel.id;
      li.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", hotel.id);
    });

    li.addEventListener("dragend", () => {
      dragId = null;
      li.classList.remove("dragging");
      hotelList
        .querySelectorAll(".hotel-item")
        .forEach((el) => el.classList.remove("drag-over"));
      // Keep suppressClick until after the click event that follows dragend
      setTimeout(() => {
        suppressClick = false;
      }, 50);
    });

    li.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      li.classList.add("drag-over");
    });

    li.addEventListener("dragleave", () => {
      li.classList.remove("drag-over");
    });

    li.addEventListener("drop", async (e) => {
      e.preventDefault();
      li.classList.remove("drag-over");
      const fromId = e.dataTransfer.getData("text/plain") || dragId;
      const toId = hotel.id;
      if (!fromId || fromId === toId) return;

      const ids = [...hotelList.querySelectorAll(".hotel-item")].map(
        (el) => el.dataset.id
      );
      const fromIndex = ids.indexOf(fromId);
      const toIndex = ids.indexOf(toId);
      if (fromIndex < 0 || toIndex < 0) return;

      ids.splice(fromIndex, 1);
      ids.splice(toIndex, 0, fromId);
      await reorderCollection(ids);
      await refresh();
      setStatus("Ranking updated");
    });

    hotelList.appendChild(li);
  });
}

async function refresh() {
  const [collection, meta, lists] = await Promise.all([
    getCollection(),
    getActiveCollectionMeta(),
    listCollections(),
  ]);
  renderCollectionsBar(lists);
  renderList(collection, meta?.name);
  renderMap(collection, meta?.name);
  setTimeout(() => map.invalidateSize(), 50);
}

async function addFromActiveHotelTab() {
  addFromPageBtn.disabled = true;
  setStatus("Adding…");
  try {
    const result = await chrome.runtime.sendMessage({ type: "ADD_FROM_PANEL" });
    if (chrome.runtime.lastError) {
      setStatus(chrome.runtime.lastError.message || "Extension error — reload");
      return;
    }
    if (!result?.ok) {
      setStatus(result?.error || "Could not add hotel");
      return;
    }
    if (result.existing) {
      setStatus(`Already in collection: ${result.hotel?.name || "hotel"}`);
    } else {
      setStatus(`Added: ${result.hotel?.name || "hotel"}`);
    }
    await refresh();
  } catch (err) {
    setStatus(err?.message || "Open a Google Hotels place first");
  } finally {
    addFromPageBtn.disabled = false;
  }
}

addFromPageBtn.addEventListener("click", () => {
  addFromActiveHotelTab();
});

reorderBtn.addEventListener("click", async () => {
  reorderBtn.disabled = true;
  try {
    await reorderByVote();
    await refresh();
    setStatus("Reordered: loved → normal → disliked");
  } finally {
    reorderBtn.disabled = false;
  }
});

newCollectionBtn.addEventListener("click", async () => {
  const name = prompt("New collection name", "Goa collection");
  if (name == null) return;
  const trimmed = name.trim();
  if (!trimmed) {
    setStatus("Enter a collection name");
    return;
  }
  await createCollection(trimmed);
  await refresh();
  setStatus(`Created “${trimmed}”`);
});

clearBtn.addEventListener("click", async () => {
  const meta = await getActiveCollectionMeta();
  const label = meta?.name || "this collection";
  if (!confirm(`Clear all hotels in “${label}”?`)) return;
  await clearCollection();
  await refresh();
  setStatus(`Cleared “${label}”`);
});

async function buildExportArtifact() {
  const [collection, meta] = await Promise.all([
    getCollection(),
    getActiveCollectionMeta(),
  ]);
  const payload = toExportPayload(collection, meta);
  const json = JSON.stringify(payload, null, 2);
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = (meta?.name || "collection")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const filename = `hotel-${slug || "collection"}-${stamp}.json`;
  const file = new File([json], filename, { type: "application/json" });
  return { collection, meta, payload, json, filename, file };
}

function downloadBlobFile(file, filename) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

exportBtn.addEventListener("click", async () => {
  const { collection, file, filename } = await buildExportArtifact();
  downloadBlobFile(file, filename);
  setStatus(
    `Exported ${collection.length} hotel${collection.length === 1 ? "" : "s"}`
  );
});

shareBtn.addEventListener("click", async () => {
  shareBtn.disabled = true;
  try {
    const { collection, meta, file, filename } = await buildExportArtifact();
    if (!collection.length) {
      setStatus("Nothing to share — add hotels first");
      return;
    }

    const title = meta?.name || "Hotel collection";
    const lines = collection
      .slice(0, 10)
      .map((h, i) => `${i + 1}. ${h.name}`)
      .join("\n");
    const more =
      collection.length > 10 ? `\n… +${collection.length - 10} more` : "";
    const waText =
      `${title} (${collection.length} hotel${collection.length === 1 ? "" : "s"})\n` +
      `${lines}${more}\n\n` +
      `Attach the JSON file “${filename}” in this chat (downloaded to your computer).`;

    // Native share with file when the OS/browser supports it (often mobile)
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title,
          text: `${title} — hotel collection JSON`,
        });
        setStatus("Shared");
        return;
      } catch (err) {
        if (err?.name === "AbortError") return;
      }
    }

    // Desktop fallback: download JSON, open WhatsApp with a ready message
    downloadBlobFile(file, filename);
    const waUrl = `https://wa.me/?text=${encodeURIComponent(waText)}`;
    await chrome.tabs.create({ url: waUrl });
    setStatus("JSON downloaded — attach that file in WhatsApp");
  } catch (err) {
    setStatus(err?.message || "Could not share");
  } finally {
    shareBtn.disabled = false;
  }
});

importInput.addEventListener("change", async () => {
  const file = importInput.files?.[0];
  importInput.value = "";
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const { imported, skipped } = await mergeCollection(data);
    await refresh();
    setStatus(`Imported ${imported}, skipped ${skipped}`);
  } catch {
    setStatus("Import failed — invalid JSON");
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (!changes.collectionsStore && !changes.collection) return;
  if (skipStorageRefresh > 0) return;
  if (isEditingNote()) {
    pendingRefresh = true;
    return;
  }
  refresh();
});

initMap();
refresh();
