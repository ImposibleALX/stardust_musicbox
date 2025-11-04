// catalogLoader.js — Loader modular para catálogos con cache TTL y stale-while-revalidate
(function (global) {
  'use strict';

  const DEFAULT_BASE_PATH = global.CATALOG_BASE_PATH || 'https://imposiblealx.github.io/stardust_musicbox/assets/catalogs/';
  const DEFAULT_FILE = 'music_catalog_all.json';
  const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
  const DEFAULT_FETCH_TIMEOUT_MS = 8000; // 8s

  const BASE_PATH = DEFAULT_BASE_PATH;
  const DEFAULTS = {
    ttlMs: DEFAULT_TTL_MS,
    fetchTimeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
    useStaleWhileRevalidate: true
  };

  global.catalogCache = global.catalogCache || {};

  function getCatalogFileFromDoc() {
    try {
      const attr = document.body && document.body.dataset && document.body.dataset.catalog;
      return attr ? String(attr).trim() : DEFAULT_FILE;
    } catch {
      return DEFAULT_FILE;
    }
  }

  function fetchWithTimeout(url, timeoutMs) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { signal: controller.signal, cache: 'no-store' })
      .finally(() => clearTimeout(id));
  }

  function saveCache(fileName, data) {
    try {
      localStorage.setItem(`catalog:${fileName}`, JSON.stringify({ ts: Date.now(), data }));
    } catch (e) {
      console.warn('catalogLoader: could not write cache', e);
    }
  }

  function readCache(fileName) {
    try {
      const raw = localStorage.getItem(`catalog:${fileName}`);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async function _fetchAndStore(file, timeoutMs) {
    const url = `${BASE_PATH}${file}`;
    const res = await fetchWithTimeout(url, timeoutMs);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new TypeError('Catalog data is not an array.');
    saveCache(file, data);
    return data;
  }

  async function loadCatalog(fileName, options = {}) {
    const file = fileName || getCatalogFileFromDoc();
    const opt = { ...DEFAULTS, ...options };
    const cached = readCache(file);

    if (cached && (Date.now() - cached.ts) < opt.ttlMs && !opt.bypassCache) {
      applyCatalog(file, cached.data);
      return cached.data;
    }

    if (cached && opt.useStaleWhileRevalidate && !opt.bypassCache) {
      applyCatalog(file, cached.data);
      _fetchAndStore(file, opt.fetchTimeoutMs).catch((err) => console.warn('catalogLoader reval error', err));
      return cached.data;
    }

    try {
      const data = await _fetchAndStore(file, opt.fetchTimeoutMs);
      applyCatalog(file, data);
      return data;
    } catch (err) {
      console.warn('catalogLoader fetch failed', err);
      if (cached && cached.data) {
        applyCatalog(file, cached.data);
        return cached.data;
      }
      applyCatalog(file, []);
      return [];
    }
  }

  function applyCatalog(file, data) {
    if (typeof global.setCatalog === 'function') {
      try { global.setCatalog(data); }
      catch (e) { console.error('catalogLoader: setCatalog threw', e); }
    } else {
      global.catalogCache[file] = data;
    }
  }

  function clearCatalogCache(fileName) {
    try { localStorage.removeItem(`catalog:${fileName}`); return true; } catch { return false; }
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

  global.catalogLoader = {
    loadCatalog,
    forceReloadCatalog,
    clearCatalogCache,
    readCache
  };

  (function autoStart() {
    const startTime = performance.now();
    const maxWait = 5000;

    function pollForSetCatalog() {
      if (typeof global.setCatalog === 'function') {
        loadCatalog();
        flushPendingCache();
        return;
      }
      const elapsed = performance.now() - startTime;
      if (elapsed < maxWait) requestAnimationFrame(pollForSetCatalog);
      else {
        console.warn('catalogLoader: autoStart timed out waiting for setCatalog.');
        loadCatalog().catch(()=>{});
      }
    }
    requestAnimationFrame(pollForSetCatalog);
  })();
})(window);
