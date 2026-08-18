/**
 * Warstwa trwałego zapisu danych — IndexedDB.
 *
 * Dwa magazyny:
 *  - "series": metadane serii (id, nazwa, liczba klatek, daty)
 *  - "frames": pojedyncze klatki (Blob JPEG) powiązane z serią przez seriesId
 *
 * Zdjęcia trzymane są jako Blob bezpośrednio w IndexedDB — bez kodowania
 * do base64 (mniejszy narzut pamięci/CPU), przeglądarka obsługuje to natywnie.
 */

import { CONFIG } from './config.js';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains(CONFIG.STORE_SERIES)) {
        db.createObjectStore(CONFIG.STORE_SERIES, { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains(CONFIG.STORE_FRAMES)) {
        const frames = db.createObjectStore(CONFIG.STORE_FRAMES, {
          keyPath: 'id',
          autoIncrement: true,
        });
        frames.createIndex('seriesId', 'seriesId', { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

function tx(db, storeName, mode) {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ============================================================================
// Serie
// ============================================================================

function formatAutoName(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `Seria ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
       + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Generator identyfikatora, odporny na przeglądarki bez crypto.randomUUID()
 * (metoda jest stosunkowo nowa i bywa niedostępna w nietypowych/starszych
 * silnikach). Jeśli natywne API jest dostępne, używamy go — w przeciwnym
 * razie lokalny fallback (wystarczający do lokalnych, unikalnych kluczy,
 * nie musi być kryptograficznie bezpieczny).
 */
function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
      // spadamy do fallbacku poniżej
    }
  }
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export async function createSeries() {
  const db = await openDB();
  const now = Date.now();
  const series = {
    id: generateId(),
    name: formatAutoName(new Date(now)),
    createdAt: now,
    updatedAt: now,
    frameCount: 0,
  };
  await wrap(tx(db, CONFIG.STORE_SERIES, 'readwrite').add(series));
  return series;
}

export async function listSeries() {
  const db = await openDB();
  const all = await wrap(tx(db, CONFIG.STORE_SERIES, 'readonly').getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getSeries(id) {
  const db = await openDB();
  return wrap(tx(db, CONFIG.STORE_SERIES, 'readonly').get(id));
}

async function touchSeries(db, id, patch) {
  const store = tx(db, CONFIG.STORE_SERIES, 'readwrite');
  const series = await wrap(store.get(id));
  if (!series) return null;
  Object.assign(series, patch, { updatedAt: Date.now() });
  await wrap(store.put(series));
  return series;
}

export async function deleteSeries(id) {
  const db = await openDB();
  const frameIds = await listFrameIds(db, id);
  const frameStore = tx(db, CONFIG.STORE_FRAMES, 'readwrite');
  await Promise.all(frameIds.map((fid) => wrap(frameStore.delete(fid))));
  await wrap(tx(db, CONFIG.STORE_SERIES, 'readwrite').delete(id));
}

// ============================================================================
// Klatki
// ============================================================================

async function listFrameIds(db, seriesId) {
  const index = tx(db, CONFIG.STORE_FRAMES, 'readonly').index('seriesId');
  const frames = await wrap(index.getAll(IDBKeyRange.only(seriesId)));
  return frames.map((f) => f.id);
}

export async function addFrame(seriesId, blob) {
  const db = await openDB();
  const series = await getSeries(seriesId);
  const order = series ? series.frameCount : 0;

  const frame = {
    seriesId,
    order,
    blob,
    createdAt: Date.now(),
  };

  const id = await wrap(tx(db, CONFIG.STORE_FRAMES, 'readwrite').add(frame));
  frame.id = id;

  await touchSeries(db, seriesId, { frameCount: order + 1 });

  return frame;
}

export async function listFrames(seriesId) {
  const db = await openDB();
  const index = tx(db, CONFIG.STORE_FRAMES, 'readonly').index('seriesId');
  const frames = await wrap(index.getAll(IDBKeyRange.only(seriesId)));
  return frames.sort((a, b) => a.order - b.order);
}

export async function getFirstFrame(seriesId) {
  const frames = await listFrames(seriesId);
  return frames[0] || null;
}

/**
 * Prosi przeglądarkę o trwałe przechowywanie danych (mniejsze ryzyko
 * automatycznego wyczyszczenia storage pod presją pamięci).
 * Wynik zależy od przeglądarki/heurystyk — nie gwarantowane, ale bezpieczne
 * do wywołania zawsze.
 */
export async function requestPersistentStorage() {
  if (navigator.storage && navigator.storage.persist) {
    try {
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }
  return false;
}
