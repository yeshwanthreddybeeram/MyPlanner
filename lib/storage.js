const LEGACY_KEY = "collection";
const STORE_KEY = "collectionsStore";

function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function newId() {
  return crypto.randomUUID();
}

function makeCollection(name, hotels = []) {
  return {
    id: newId(),
    name: String(name || "My collection").trim() || "My collection",
    hotels: Array.isArray(hotels) ? hotels : [],
    createdAt: Date.now(),
  };
}

function defaultStore(legacyHotels = []) {
  const first = makeCollection("My collection", legacyHotels);
  return {
    activeId: first.id,
    collections: [first],
  };
}

/** Load store; migrate legacy single `collection` array once. */
export async function getStore() {
  const data = await chrome.storage.local.get([STORE_KEY, LEGACY_KEY]);
  let store = data[STORE_KEY];

  if (
    store &&
    Array.isArray(store.collections) &&
    store.collections.length > 0
  ) {
    if (!store.activeId || !store.collections.some((c) => c.id === store.activeId)) {
      store = { ...store, activeId: store.collections[0].id };
      await chrome.storage.local.set({ [STORE_KEY]: store });
    }
    return store;
  }

  const legacy = Array.isArray(data[LEGACY_KEY]) ? data[LEGACY_KEY] : [];
  store = defaultStore(legacy);
  await chrome.storage.local.set({ [STORE_KEY]: store });
  if (legacy.length) {
    await chrome.storage.local.remove(LEGACY_KEY);
  }
  return store;
}

async function saveStore(store) {
  await chrome.storage.local.set({ [STORE_KEY]: store });
  return store;
}

function activeOf(store) {
  return (
    store.collections.find((c) => c.id === store.activeId) ||
    store.collections[0] ||
    null
  );
}

function cleanHotels(hotels) {
  return (Array.isArray(hotels) ? hotels : []).filter((h) => {
    const name = String(h?.name || "").trim();
    return name && !/^(sponsored|ad|ads)$/i.test(name);
  });
}

export async function listCollections() {
  const store = await getStore();
  return store.collections.map((c) => ({
    id: c.id,
    name: c.name,
    count: cleanHotels(c.hotels).length,
    active: c.id === store.activeId,
  }));
}

export async function getActiveCollectionMeta() {
  const store = await getStore();
  const active = activeOf(store);
  if (!active) return null;
  return {
    id: active.id,
    name: active.name,
    count: cleanHotels(active.hotels).length,
  };
}

export async function setActiveCollection(id) {
  const store = await getStore();
  if (!store.collections.some((c) => c.id === id)) return store;
  store.activeId = id;
  return saveStore(store);
}

export async function createCollection(name) {
  const store = await getStore();
  const col = makeCollection(name);
  store.collections.push(col);
  store.activeId = col.id;
  await saveStore(store);
  return col;
}

export async function deleteCollection(id) {
  const store = await getStore();
  if (store.collections.length <= 1) {
    return { ok: false, error: "Keep at least one collection." };
  }
  const target = store.collections.find((c) => c.id === id);
  if (!target) return { ok: false, error: "Collection not found." };

  store.collections = store.collections.filter((c) => c.id !== id);
  if (store.activeId === id) {
    store.activeId = store.collections[0].id;
  }
  await saveStore(store);
  return { ok: true, name: target.name };
}

export async function renameCollection(id, name) {
  const store = await getStore();
  const col = store.collections.find((c) => c.id === id);
  if (!col) return store;
  col.name = String(name || "").trim() || col.name;
  return saveStore(store);
}

/** Hotels in the active collection. */
export async function getCollection() {
  const store = await getStore();
  const active = activeOf(store);
  if (!active) return [];

  const cleaned = cleanHotels(active.hotels);
  if (cleaned.length !== (active.hotels || []).length) {
    active.hotels = cleaned;
    await saveStore(store);
  }
  return cleaned;
}

async function saveActiveHotels(hotels) {
  const store = await getStore();
  const active = activeOf(store);
  if (!active) return [];
  active.hotels = hotels;
  await saveStore(store);
  return hotels;
}

export async function clearCollection() {
  return saveActiveHotels([]);
}

function placeKeyFromUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    const place = u.pathname.match(/\/maps\/place\/([^/]+)/i);
    if (place) return `placepath:${decodeURIComponent(place[1]).toLowerCase()}`;
    const ftid = url.match(/!1s(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)/);
    if (ftid) return `ftid:${ftid[1].toLowerCase()}`;
  } catch {
    // ignore
  }
  return "";
}

/** Prefer Maps place identity, then name. */
export function hotelKey(hotel) {
  if (hotel.placeId) return `place:${String(hotel.placeId).toLowerCase()}`;
  const fromUrl = placeKeyFromUrl(hotel.url);
  if (fromUrl) return fromUrl;
  const name = normalizeName(hotel.name);
  return name ? `name:${name}` : "";
}

/**
 * Add a hotel to the active collection; skip if same key already exists.
 */
export async function addHotel(hotel) {
  const collection = await getCollection();
  const key = hotelKey(hotel);
  if (!key) {
    return {
      added: false,
      existing: false,
      collection,
      hotel: null,
      error: "Missing hotel name",
    };
  }

  const existing = collection.find((h) => hotelKey(h) === key);
  if (existing) {
    return { added: false, existing: true, collection, hotel: existing };
  }

  const entry = {
    id: newId(),
    name: String(hotel.name).trim(),
    url: hotel.url || "",
    placeId: hotel.placeId || "",
    rating: hotel.rating ?? null,
    priceText: hotel.priceText || "",
    lat: typeof hotel.lat === "number" ? hotel.lat : null,
    lng: typeof hotel.lng === "number" ? hotel.lng : null,
    imageUrl: hotel.imageUrl || "",
    source: hotel.source || "google_hotels",
    vote: null,
    note: "",
    addedAt: Date.now(),
  };

  collection.unshift(entry);
  await saveActiveHotels(collection);
  return { added: true, existing: false, collection, hotel: entry };
}

export async function removeHotel(id) {
  const collection = (await getCollection()).filter((h) => h.id !== id);
  await saveActiveHotels(collection);
  return collection;
}

/** vote: 'love' | 'dislike' | null — toggles off if same vote clicked again. */
export async function setHotelVote(id, vote) {
  const collection = await getCollection();
  const hotel = collection.find((h) => h.id === id);
  if (!hotel) return collection;

  hotel.vote = hotel.vote === vote ? null : vote;
  await saveActiveHotels(collection);
  return collection;
}

/** Save a short note (capped) on a hotel. */
export async function setHotelNote(id, note) {
  const collection = await getCollection();
  const hotel = collection.find((h) => h.id === id);
  if (!hotel) return collection;
  hotel.note = String(note || "").slice(0, 240);
  await saveActiveHotels(collection);
  return collection;
}

/** Persist a new ranking order from an array of hotel ids. */
export async function reorderCollection(orderedIds) {
  const collection = await getCollection();
  const byId = new Map(collection.map((h) => [h.id, h]));
  const next = [];
  for (const id of orderedIds) {
    const h = byId.get(id);
    if (h) {
      next.push(h);
      byId.delete(id);
    }
  }
  for (const h of byId.values()) next.push(h);
  await saveActiveHotels(next);
  return next;
}

/** Loved on top, then unmarked, then disliked (keeps order within each group). */
export async function reorderByVote() {
  const collection = await getCollection();
  const loved = [];
  const normal = [];
  const disliked = [];
  for (const h of collection) {
    if (h.vote === "love") loved.push(h);
    else if (h.vote === "dislike") disliked.push(h);
    else normal.push(h);
  }
  const next = [...loved, ...normal, ...disliked];
  await saveActiveHotels(next);
  return next;
}

export async function mergeCollection(incoming) {
  const list = Array.isArray(incoming)
    ? incoming
    : Array.isArray(incoming?.collection)
      ? incoming.collection
      : [];

  const collection = await getCollection();
  const keys = new Set(collection.map(hotelKey).filter(Boolean));
  let imported = 0;
  let skipped = 0;

  for (const raw of list) {
    if (!raw || typeof raw !== "object") {
      skipped += 1;
      continue;
    }
    const key = hotelKey(raw);
    if (!key || keys.has(key)) {
      skipped += 1;
      continue;
    }
    keys.add(key);
    collection.push({
      id: raw.id || newId(),
      name: String(raw.name || "").trim() || "Untitled hotel",
      url: raw.url || "",
      placeId: raw.placeId || "",
      rating: raw.rating ?? null,
      priceText: raw.priceText || "",
      lat: typeof raw.lat === "number" ? raw.lat : null,
      lng: typeof raw.lng === "number" ? raw.lng : null,
      imageUrl: raw.imageUrl || "",
      source: raw.source || "google_hotels",
      vote: raw.vote === "love" || raw.vote === "dislike" ? raw.vote : null,
      note: typeof raw.note === "string" ? raw.note.slice(0, 240) : "",
      addedAt: raw.addedAt || Date.now(),
    });
    imported += 1;
  }

  await saveActiveHotels(collection);
  return { collection, imported, skipped };
}

export function toExportPayload(collection, meta = null) {
  return {
    version: 2,
    exportedAt: new Date().toISOString(),
    collectionName: meta?.name || undefined,
    collection,
  };
}

/** Open the URL that was saved when the hotel was added (current page at add time). */
export function hotelOpenUrl(hotel) {
  return hotel?.url || "";
}
