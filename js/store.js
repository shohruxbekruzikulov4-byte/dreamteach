/* DreamTeach local storage: IndexedDB with an in-memory fallback (private mode, blocked storage). */
(function (root) {
  'use strict';
  var NAME = 'dreamteach', VERSION = 2;
  var STORES = ['kv', 'media', 'progress', 'quiz', 'notes', 'outbox', 'chat', 'lessons', 'docs'];
  var dbp = null, mem = {};
  STORES.forEach(function (s) { mem[s] = new Map(); });

  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve) {
      try {
        if (!root.indexedDB) return resolve(null);
        var req = root.indexedDB.open(NAME, VERSION);
        req.onupgradeneeded = function () {
          var db = req.result;
          STORES.forEach(function (s) { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s); });
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
        setTimeout(function () { resolve(null); }, 4000);
      } catch (e) { resolve(null); }
    });
    return dbp;
  }

  function tx(store, mode, fn) {
    return open().then(function (db) {
      if (!db) return fn(null);
      return new Promise(function (resolve, reject) {
        try {
          var t = db.transaction(store, mode), os = t.objectStore(store), out;
          var r = fn(os);
          if (r && 'onsuccess' in r) r.onsuccess = function () { out = r.result; };
          t.oncomplete = function () { resolve(out); };
          t.onerror = t.onabort = function () { reject(t.error); };
        } catch (e) { reject(e); }
      });
    });
  }

  var Store = {
    persistent: false,
    init: function () {
      return open().then(function (db) {
        Store.persistent = !!db;
        try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
        return !!db;
      });
    },
    get: function (store, key) {
      return tx(store, 'readonly', function (os) { return os ? os.get(key) : null; })
        .then(function (v) { return v === undefined || v === null ? (mem[store].has(key) ? mem[store].get(key) : null) : v; })
        .catch(function () { return mem[store].has(key) ? mem[store].get(key) : null; });
    },
    put: function (store, key, val) {
      mem[store].set(key, val);
      return tx(store, 'readwrite', function (os) { return os ? os.put(val, key) : null; }).catch(function () {});
    },
    del: function (store, key) {
      mem[store].delete(key);
      return tx(store, 'readwrite', function (os) { return os ? os.delete(key) : null; }).catch(function () {});
    },
    all: function (store) {
      return open().then(function (db) {
        if (!db) return Array.from(mem[store].entries()).map(function (e) { return { key: e[0], value: e[1] }; });
        return new Promise(function (resolve) {
          var out = [];
          try {
            var t = db.transaction(store, 'readonly'), req = t.objectStore(store).openCursor();
            req.onsuccess = function () {
              var c = req.result;
              if (c) { out.push({ key: c.key, value: c.value }); c.continue(); } else resolve(out);
            };
            req.onerror = function () { resolve(out); };
          } catch (e) { resolve(out); }
        });
      });
    },
    estimate: function () {
      try { if (navigator.storage && navigator.storage.estimate) return navigator.storage.estimate(); } catch (e) {}
      return Promise.resolve(null);
    }
  };
  root.DTStore = Store;
})(window);
