/* ============================================================
   ViperEdit — IndexedDB wrapper with per-account namespacing
     window.VE_IDB = {
       setNamespace(ns), getNamespace(),
       get, set, delete, getAll, clear,
       estimate()   — storage usage / quota
     }
     window.VE_migrate()   — migrates legacy data (localStorage v2 → IDB,
                             and unprefixed IDB keys → "guest:" prefix).
   ============================================================ */

(function () {
  'use strict';

  const DB_NAME = 'viperedit';
  const DB_VERSION = 1;
  const STORES = ['docs', 'meta'];

  let dbPromise = null;
  let available = true;
  let namespace = 'guest';

  function open() {
    if (dbPromise) return dbPromise;
    if (!('indexedDB' in window)) {
      available = false;
      console.warn('ViperEdit: IndexedDB not available — falling back to localStorage.');
      return Promise.reject(new Error('no-idb'));
    }
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        for (const s of STORES) {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { available = false; reject(req.error); };
    });
    return dbPromise;
  }

  function txReq(store, mode, op) {
    return open().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const os = tx.objectStore(store);
      const req = op(os);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    })).catch((err) => { available = false; throw err; });
  }

  // Namespaced keys live under `${namespace}:${key}`.
  const nsKey = (k) => namespace + ':' + k;

  // --- localStorage fallback (used only when IDB is unavailable) ---
  const LS_PREFIX = 've_fb:';
  const lsKey = (store, k) => LS_PREFIX + store + ':' + nsKey(k);
  function lsGet(store, k)   { try { return JSON.parse(localStorage.getItem(lsKey(store, k)) || 'null'); } catch { return null; } }
  function lsSet(store, k, v){ try { localStorage.setItem(lsKey(store, k), JSON.stringify(v)); } catch (e) { console.warn(e); } }
  function lsDelete(store, k){ try { localStorage.removeItem(lsKey(store, k)); } catch {} }
  function lsGetAll(store) {
    const out = [];
    const pre = LS_PREFIX + store + ':' + namespace + ':';
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(pre)) {
        try { out.push(JSON.parse(localStorage.getItem(k))); } catch {}
      }
    }
    return out;
  }

  window.VE_IDB = {
    open,
    get available() { return available; },

    setNamespace(ns) {
      if (typeof ns !== 'string' || !ns) return;
      namespace = ns;
    },
    getNamespace() { return namespace; },

    async get(store, key) {
      try { return await txReq(store, 'readonly', (os) => os.get(nsKey(key))); }
      catch { return lsGet(store, key); }
    },
    async set(store, key, val) {
      try { return await txReq(store, 'readwrite', (os) => os.put(val, nsKey(key))); }
      catch { lsSet(store, key, val); }
    },
    async delete(store, key) {
      try { return await txReq(store, 'readwrite', (os) => os.delete(nsKey(key))); }
      catch { lsDelete(store, key); }
    },
    async getAll(store) {
      try {
        const prefix = namespace + ':';
        const range = IDBKeyRange.bound(prefix, prefix + '￿');
        return await txReq(store, 'readonly', (os) => os.getAll(range));
      } catch { return lsGetAll(store); }
    },
    async clear(store) {
      // Only clears the current namespace.
      try {
        const prefix = namespace + ':';
        const range = IDBKeyRange.bound(prefix, prefix + '￿');
        return await txReq(store, 'readwrite', (os) => os.delete(range));
      } catch {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && k.startsWith(LS_PREFIX + store + ':' + namespace + ':')) localStorage.removeItem(k);
        }
      }
    },

    async estimate() {
      if (navigator.storage && navigator.storage.estimate) {
        try { return await navigator.storage.estimate(); }
        catch { return null; }
      }
      return null;
    }
  };

  /* ------------------------------------------------------------
     Migration helper: invoked once at app start from editor.js.
     - Moves legacy v2 localStorage keys to IDB (namespace = "guest").
     - Renames any unprefixed IDB keys (pre-namespace era) to "guest:".
     ------------------------------------------------------------ */
  window.VE_migrate = async function () {
    // We always perform migration work under the "guest" namespace, then
    // restore whatever namespace was active.
    const priorNs = namespace;
    namespace = 'guest';

    try {
      // ---- (a) localStorage v2 → IDB guest ----
      const flagV2 = await window.VE_IDB.get('meta', 'migrated-v2');
      if (!flagV2) {
        const rawDocs = localStorage.getItem('viperedit:v2:docs');
        const rawCur  = localStorage.getItem('viperedit:v2:current');
        const rawSet  = localStorage.getItem('viperedit:v2:settings');
        const rawTh   = localStorage.getItem('viperedit:v2:theme');
        const rawBg   = localStorage.getItem('viperedit:v2:bg');

        if (rawDocs) {
          try {
            const docs = JSON.parse(rawDocs) || [];
            for (const d of docs) if (d && d.id) await window.VE_IDB.set('docs', d.id, d);
          } catch (e) { console.warn('v2 docs migration', e); }
        }
        if (rawCur) { try { await window.VE_IDB.set('meta', 'currentId',  JSON.parse(rawCur)); } catch {} }
        if (rawSet) { try { await window.VE_IDB.set('meta', 'settings',   JSON.parse(rawSet)); } catch {} }
        if (rawTh)  { try { await window.VE_IDB.set('meta', 'theme',      JSON.parse(rawTh));  } catch {} }
        if (rawBg)  { try { await window.VE_IDB.set('meta', 'background', JSON.parse(rawBg));  } catch {} }

        await window.VE_IDB.set('meta', 'migrated-v2', true);
        ['viperedit:v2:docs','viperedit:v2:current','viperedit:v2:settings',
         'viperedit:v2:theme','viperedit:v2:bg','viperedit:doc:v1'
        ].forEach((k) => { try { localStorage.removeItem(k); } catch {} });
      }

      // ---- (b) Unprefixed keys → "guest:" prefix (pre-namespacing) ----
      const flagV4 = await window.VE_IDB.get('meta', 'migrated-v4');
      if (!flagV4 && available) {
        try {
          await renameUnprefixedKeys('docs');
          await renameUnprefixedKeys('meta');
          await window.VE_IDB.set('meta', 'migrated-v4', true);
        } catch (e) { console.warn('v4 rename failed', e); }
      }
    } finally {
      namespace = priorNs;
    }
  };

  // Copy any entries whose key does NOT contain ':' into "guest:key" and delete the original.
  async function renameUnprefixedKeys(store) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      const req = os.openCursor();
      const renames = [];
      req.onsuccess = (e) => {
        const cur = e.target.result;
        if (!cur) {
          // Nothing to do inside tx (we already queued deletes below if needed).
          resolve(renames.length);
          return;
        }
        const key = cur.key;
        if (typeof key === 'string' && !key.includes(':')) {
          const value = cur.value;
          os.put(value, 'guest:' + key);
          os.delete(key);
          renames.push(key);
        }
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }

  // Begin opening right away so the first read isn't a cold start.
  open().catch(() => {});
})();
