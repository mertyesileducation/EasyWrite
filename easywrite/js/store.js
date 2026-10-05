/* EasyWrite — IndexedDB tabanlı belge deposu */
(() => {
  'use strict';

  const DB_NAME = 'easywrite';
  const DB_VERSION = 1;
  const MAX_VERSIONS = 40;

  let dbPromise = null;
  let memory = null; // IndexedDB kullanılamazsa bellek içi yedek

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB yok')); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('docs')) {
          const docs = db.createObjectStore('docs', { keyPath: 'id' });
          docs.createIndex('updated', 'updated');
        }
        if (!db.objectStoreNames.contains('versions')) {
          const versions = db.createObjectStore('versions', { keyPath: 'vid', autoIncrement: true });
          versions.createIndex('docId', 'docId');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch(err => {
      console.warn('EasyWrite: IndexedDB kullanılamıyor, belgeler yalnızca bu oturumda tutulacak.', err);
      memory = { docs: new Map(), versions: [] };
      return null;
    });
    return dbPromise;
  }

  function tx(db, store, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let result;
      Promise.resolve(fn(s, v => { result = v; })).catch(reject);
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  function reqValue(req, set) {
    req.onsuccess = () => set(req.result);
  }

  function uid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  const EWStore = {
    uid,

    async all() {
      const db = await open();
      if (!db) return Array.from(memory.docs.values());
      return tx(db, 'docs', 'readonly', (s, set) => reqValue(s.getAll(), set));
    },

    async get(id) {
      const db = await open();
      if (!db) return memory.docs.get(id) || null;
      const doc = await tx(db, 'docs', 'readonly', (s, set) => reqValue(s.get(id), set));
      return doc || null;
    },

    async put(doc) {
      const db = await open();
      if (!db) { memory.docs.set(doc.id, structuredClone(doc)); return doc; }
      await tx(db, 'docs', 'readwrite', s => { s.put(doc); });
      return doc;
    },

    async remove(id) {
      const db = await open();
      if (!db) {
        memory.docs.delete(id);
        memory.versions = memory.versions.filter(v => v.docId !== id);
        return;
      }
      await tx(db, 'docs', 'readwrite', s => { s.delete(id); });
      await EWStore.clearVersions(id);
    },

    async addVersion(docId, snapshot) {
      const db = await open();
      const entry = { docId, at: Date.now(), ...snapshot };
      if (!db) { memory.versions.push({ vid: memory.versions.length + 1, ...entry }); return; }
      await tx(db, 'versions', 'readwrite', s => { s.add(entry); });
      // En eski sürümleri buda
      const list = await EWStore.versions(docId);
      if (list.length > MAX_VERSIONS) {
        const extra = list.slice(MAX_VERSIONS);
        await tx(db, 'versions', 'readwrite', s => { extra.forEach(v => s.delete(v.vid)); });
      }
    },

    async versions(docId) {
      const db = await open();
      let list;
      if (!db) list = memory.versions.filter(v => v.docId === docId);
      else list = await tx(db, 'versions', 'readonly', (s, set) => reqValue(s.index('docId').getAll(docId), set));
      return list.sort((a, b) => b.at - a.at);
    },

    async clearVersions(docId) {
      const db = await open();
      if (!db) return;
      const list = await EWStore.versions(docId);
      await tx(db, 'versions', 'readwrite', s => { list.forEach(v => s.delete(v.vid)); });
    },

    async estimate() {
      try {
        if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate();
      } catch { /* yok say */ }
      return null;
    },

    async persist() {
      try {
        if (navigator.storage && navigator.storage.persist) {
          if (await navigator.storage.persisted()) return true;
          return await navigator.storage.persist();
        }
      } catch { /* yok say */ }
      return false;
    },

    get available() { return !memory; },
  };

  window.EWStore = EWStore;
})();
