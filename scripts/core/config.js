(function (global) {
  'use strict';

  /** CONFIG FORTIFICADO: configureFactionPage(options) */
  var hasDocument = !!(global && global.document);
  function isStr(x){ return typeof x === 'string'; }
  function isObj(x){ return x && typeof x === 'object' && !Array.isArray(x); }

  function safeAssign(dst, src) {
    if (!isObj(dst) || !isObj(src)) return dst;
    for (var k in src) {
      if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      dst[k] = src[k];
    }
    return dst;
  }

  function sanitizeDisplayNames(map) {
    if (!isObj(map)) return {};
    var out = {};
    for (var k in map) {
      if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      var key = String(k).trim();
      var val = map[k];
      if (!key) continue;
      out[key] = isStr(val) ? val.trim() : String(val);
    }
    return out;
  }

  function toAbsoluteUrlMaybe(href) {
    if (!hasDocument || !isStr(href)) return href;
    try {
      if (/^(data:|blob:|mailto:|tel:)/i.test(href) || href.startsWith('#') || href.startsWith('?')) return href;
      return new URL(href, (global.location && global.location.href) || undefined).toString();
    } catch (_e) {
      return href;
    }
  }

  function normalizePath(value) {
    if (!isStr(value)) return value;
    var v = value.trim();
    if (!v) return v;
    if (/^(data:|blob:|mailto:|tel:)/i.test(v) || v.startsWith('#') || v.startsWith('?')) return v;
    v = v.replace(/\\/g, '/');
    var m = v.match(/^([a-z]+:\/\/)(.*)$/i);
    var proto = '';
    if (m) { proto = m[1]; v = m[2]; }
    v = v.replace(/\/{2,}/g, '/');
    v = proto + v;
    if (/[?#]$/.test(v)) return v;
    var hasExt = /\.[a-z0-9]{1,8}(?:[?#]|$)/i.test(v);
    if (!hasExt && !v.endsWith('/')) v += '/';
    return v;
  }

  function mergeDisplayNames(next, replace) {
    var current = isObj(global.FACTION_DISPLAY_NAMES) ? global.FACTION_DISPLAY_NAMES : {};
    var out = replace ? {} : {};
    if (!replace) safeAssign(out, current);
    safeAssign(out, sanitizeDisplayNames(next));
    global.FACTION_DISPLAY_NAMES = out;
    return out;
  }

  function updateManualLink(href, selector) {
    if (!hasDocument || !isStr(selector) || !href) return;
    var apply = function () {
      var anchor = global.document.querySelector(selector);
      if (!anchor) return;
      try {
        var abs = toAbsoluteUrlMaybe(href);
        anchor.href = abs;
        if (!anchor.target) anchor.target = '_blank';
        if (!anchor.rel) anchor.rel = 'noopener noreferrer';
      } catch (_e) {
        anchor.href = href;
      }
    };
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', apply, { once: true });
    } else {
      apply();
    }
  }

  function setPageTitle(title) {
    if (!hasDocument || !isStr(title)) return;
    var fn = function () { global.document.title = title; };
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  function defineGlobalConst(key, value) {
    try {
      Object.defineProperty(global, key, {
        value: value,
        writable: false,
        enumerable: true,
        configurable: false
      });
    } catch (_e) {
      global[key] = value;
    }
  }

  var FLAG = '__FACTION_CONFIG_LOCK__';

  function configureFactionPage(options) {
    if (!isObj(options)) options = {};
    var catalogBasePath   = isStr(options.catalogBasePath) ? options.catalogBasePath : null;
    var audioBasePath     = isStr(options.audioBasePath)   ? options.audioBasePath   : null;
    var imageBasePath     = isStr(options.imageBasePath)   ? options.imageBasePath   : null;
    var displayNames      = isObj(options.displayNames)    ? options.displayNames    : null;
    var replaceDisplay    = options.replaceDisplayNames === true;
    var manualHref        = isStr(options.manualHref)      ? options.manualHref      : null;
    var manualSelector    = isStr(options.manualSelector)  ? options.manualSelector  : '.manual-btn-topright';
    var pageTitle         = isStr(options.pageTitle)       ? options.pageTitle       : null;
    var makeAbsolute      = (options.makeAbsolute !== false); // default true

    if (catalogBasePath) {
      var rawC = makeAbsolute ? toAbsoluteUrlMaybe(catalogBasePath) : catalogBasePath;
      var normC = normalizePath(rawC);
      defineGlobalConst('CATALOG_BASE_PATH', normC);
    }
    if (audioBasePath) {
      var rawA = makeAbsolute ? toAbsoluteUrlMaybe(audioBasePath) : audioBasePath;
      var normA = normalizePath(rawA);
      global.AUDIO_BASE_PATH = normA;
    }
    if (imageBasePath) {
      var rawI = makeAbsolute ? toAbsoluteUrlMaybe(imageBasePath) : imageBasePath;
      var normI = normalizePath(rawI);
      global.IMAGE_BASE_PATH = normI;
    }

    var merged = null;
    if (displayNames) {
      merged = mergeDisplayNames(displayNames, replaceDisplay);
    }

    if (manualHref) updateManualLink(manualHref, manualSelector);
    if (pageTitle)  setPageTitle(pageTitle);

    try {
      if (!global[FLAG]) {
        Object.defineProperty(global, FLAG, {
          value: true, writable: false, enumerable: false, configurable: false
        });
      }
    } catch (_e) {}

    var applied = {
      CATALOG_BASE_PATH: global.CATALOG_BASE_PATH || null,
      AUDIO_BASE_PATH:   global.AUDIO_BASE_PATH   || null,
      IMAGE_BASE_PATH:   global.IMAGE_BASE_PATH   || null,
      FACTION_DISPLAY_NAMES: merged || (global.FACTION_DISPLAY_NAMES || null),
      manualHref: manualHref,
      manualSelector: manualSelector,
      pageTitle: pageTitle
    };
    if (Object.freeze) return Object.freeze(applied);
    return applied;
  }

  try {
    Object.defineProperty(global, 'configureFactionPage', {
      value: configureFactionPage,
      writable: false,
      enumerable: true,
      configurable: false
    });
  } catch (_e) {
    global.configureFactionPage = configureFactionPage;
  }
})(window);
