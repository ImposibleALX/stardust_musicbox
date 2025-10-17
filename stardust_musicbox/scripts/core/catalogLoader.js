// catalogLoader.js
// Loader modular para catálogos: data-catalog + fetch + localStorage (TTL)
(function (global) {
  'use strict';

  // CONFIG: puedes sobrescribir estos valores antes de incluir el script
  // e.g. <script>window.CATALOG_BASE_PATH = '/stardust_musicbox/assets/catalogs/'</script>
  const DEFAULT_BASE_PATH = 'https://imposiblealx.github.io/stardust_musicbox/assets/catalogs/';
  const DEFAULT_FILE = 'music_catalog_all.json';
  const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
  const DEFAULT_FETCH_TIMEOUT_MS = 8000; // 8s

  const BASE_PATH = global.CATALOG_BASE_PATH || DEFAULT_BASE_PATH;
  const DEFAULTS = {
    ttlMs: DEFAULT_TTL_MS,
    fetchTimeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
    useStaleWhileRevalidate: true
  };

  // internal cache holder (temporal si setCatalog no está disponible aún)
  global.catalogCache = global.catalogCache || {};

  // helpers
  function getCatalogFileFromDoc() {
    try {
      const attr = document.body && document.body.dataset && document.body.dataset.catalog;
      return attr ? String(attr).trim() : DEFAULT_FILE;
    } catch (e) {
      return DEFAULT_FILE;
    }
  }

  function fetchWithTimeout(url, timeoutMs) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { signal: controller.signal, credentials: 'same-origin' })
      .finally(() => clearTimeout(id));
  }

  function saveCache(fileName, data) {
    try {
      localStorage.setItem(`catalog:${fileName}`, JSON.stringify({ ts: Date.now(), data }));
    } catch (e) {
      // quota or disabled localStorage
      console.warn('catalogLoader: could not write cache', e);
    }
  }

  function readCache(fileName) {
    try {
      const raw = localStorage.getItem(`catalog:${fileName}`);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  async function _fetchAndStore(file, timeoutMs) {
    const url = `${BASE_PATH}${file}`;
    const res = await fetchWithTimeout(url, timeoutMs);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    const data = await res.json();
    saveCache(file, data);
    return data;
  }

  // API pública: loadCatalog(fileName, options)
  async function loadCatalog(fileName, options = {}) {
    const file = fileName || getCatalogFileFromDoc();
    const opt = { ...DEFAULTS, ...options };

    const cached = readCache(file);

    // Caso: cache válida
    if (cached && (Date.now() - cached.ts) < opt.ttlMs && !opt.bypassCache) {
      applyCatalog(file, cached.data);
      return cached.data;
    }

    // stale-while-revalidate: mostrar cache stale mientras se revalida en background
    if (cached && opt.useStaleWhileRevalidate && !opt.bypassCache) {
      applyCatalog(file, cached.data);
      // no "await": background update
      _fetchAndStore(file, opt.fetchTimeoutMs).catch(err => console.warn('catalogLoader reval error', err));
      return cached.data;
    }

    // Intentar fetch directo
    try {
      const data = await _fetchAndStore(file, opt.fetchTimeoutMs);
      applyCatalog(file, data);
      return data;
    } catch (err) {
      console.warn('catalogLoader fetch failed', err);
      // fallback: usar cache stale si existe
      if (cached && cached.data) {
        applyCatalog(file, cached.data);
        return cached.data;
      }
      // último recurso: enviar array vacío
      applyCatalog(file, []);
      return [];
    }
  }

  function applyCatalog(file, data) {
    if (typeof global.setCatalog === 'function') {
      try { global.setCatalog(data); }
      catch (e) { console.error('catalogLoader: setCatalog threw', e); }
    } else {
      // si setCatalog no existe aún, lo guardamos temporalmente
      global.catalogCache[file] = data;
    }
  }

  // utilidades públicas
  function clearCatalogCache(fileName) {
    try { localStorage.removeItem(`catalog:${fileName}`); return true; } catch (e) { return false; }
  }

  async function forceReloadCatalog(fileName) {
    const file = fileName || getCatalogFileFromDoc();
    clearCatalogCache(file);
    return loadCatalog(file, { bypassCache: true, useStaleWhileRevalidate: false });
  }

  function flushPendingCache() {
    if (typeof global.setCatalog !== 'function') return;
    for (const file in global.catalogCache) {
      try { global.setCatalog(global.catalogCache[file]); } catch (e) { console.warn(e); }
      delete global.catalogCache[file];
    }
  }

  // Exponer API en global
  global.catalogLoader = {
    loadCatalog,
    forceReloadCatalog,
    clearCatalogCache,
    readCache
  };

  // Auto-start: si setCatalog existe ya, carga; si no, espera corto tiempo
  (function autoStart() {
    if (typeof global.setCatalog === 'function') {
      loadCatalog();
      flushPendingCache();
      return;
    }
    // poll corto (5s max) para detectar setCatalog si viene después
    const maxWait = 5000; let waited = 0; const step = 100;
    const id = setInterval(() => {
      waited += step;
      if (typeof global.setCatalog === 'function') {
        clearInterval(id);
        loadCatalog();
        flushPendingCache();
      } else if (waited >= maxWait) {
        clearInterval(id);
        // aún sin setCatalog: hacemos la carga para poblar cache (no aplicamos)
        loadCatalog().catch(()=>{});
      }
    }, step);
  })();

})(window);