/*!
 * logoShadow.js — “Sombreado inteligente” para logos (coherente con radioPlayer/manualPlayer)
 * -------------------------------------------------------------------------------------------
 * - Extrae color dominante rápido (downscale + cuantización ligera) con cache LRU.
 * - Expone CSS vars (--logo-h, --logo-s, --logo-l, --logo-alpha, --logo-radius, --logo-spread).
 * - Fondo radial suave + drop-shadow; reduce costo en dispositivos lentos y con reduced motion.
 * - Procesa solo en viewport (IntersectionObserver) y en ocio (requestIdleCallback) con cola (batch).
 * - Un único repaint por cambio (rAF). Re-procesa si cambia el src.
 * - Debug/HUD activable por consola: enableLogoShadowDebug(true) / toggleLogoShadowDebug().
 *
 * USO:
 *   <img class="js-logo-shadow" src="...">
 *   <script src="scripts/core/logoShadow.js"></script>
 *
 * Personalización:
 *   window.initLogoShadow({ selector: '.faction-buttons img, .js-logo-shadow' });
 *   // Overrides por imagen:
 *   <img data-logo-hsl="210,75,45" data-logo-alpha="0.45" data-logo-radius="20" data-logo-spread="60%">
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) { define([], factory); }
  else if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.initLogoShadow = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- Utilidades ----------
  const clamp = (v, a = 0, b = 1) => Math.min(Math.max(v, a), b);
  const pct = (x) => `${Math.round(x)}%`;
  const isStr = (x) => typeof x === 'string';
  const REDUCED_MOTION = typeof matchMedia === 'function'
    ? matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) { h = 0; s = 0; }
    else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4; break;
      }
      h *= 60;
    }
    return { h, s: s * 100, l: l * 100 };
  }

  // Hash simple (determinista por URL) para fallback de tono
  function stringHashHue(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return (h % 360);
  }

  function isLowPerfDevice() {
    try {
      const mem = navigator.deviceMemory || 0;
      const cores = navigator.hardwareConcurrency || 0;
      const coarse = matchMedia && matchMedia('(pointer: coarse)').matches;
      return (mem && mem < 4) || (cores && cores < 4) || !!coarse;
    } catch { return false; }
  }

  // ---------- Debug / HUD ----------
  let LOGO_SHADOW_DEBUG = false;
  let debugEl = null;
  let lastDebugText = '';

  function ensureDebugEl() {
    if (!LOGO_SHADOW_DEBUG) return null;
    if (debugEl) return debugEl;
    const el = document.createElement('div');
    el.id = 'logoShadowDebug';
    el.style.cssText = `
      position: fixed; right: 8px; bottom: 8px;
      font: 500 12px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
      padding: 6px 8px; border-radius: 8px;
      background: rgba(0,0,0,.55); color: #fff;
      pointer-events: none; z-index: 9999;
    `;
    document.body.appendChild(el);
    debugEl = el;
    return el;
  }
  function updateDebugHUD(countQueued, lastHSL) {
    if (!LOGO_SHADOW_DEBUG) {
      if (debugEl && debugEl.parentNode) debugEl.parentNode.removeChild(debugEl);
      debugEl = null; lastDebugText = '';
      return;
    }
    const el = ensureDebugEl();
    if (!el) return;
    const text = `logoShadow · queued=${countQueued}${lastHSL ? ` · hsl=${lastHSL}` : ''}${REDUCED_MOTION ? ' · RM' : ''}`;
    if (text !== lastDebugText) { lastDebugText = text; el.textContent = text; }
  }
  // API de consola tipo radioPlayer
  window.enableLogoShadowDebug = function (flag) { LOGO_SHADOW_DEBUG = !!flag; updateDebugHUD(queue.length); };
  window.toggleLogoShadowDebug = function () { LOGO_SHADOW_DEBUG = !LOGO_SHADOW_DEBUG; updateDebugHUD(queue.length); };

  // ---------- CSS inyectado (una vez) ----------
  function ensureStyles() {
    if (document.getElementById('logo-shadow-styles')) return;
    const style = document.createElement('style');
    style.id = 'logo-shadow-styles';
    style.textContent = `
      :where(.logo-shadow-host){
        --logo-h: 200;
        --logo-s: 70%;
        --logo-l: 50%;
        --logo-alpha: .55;
        --logo-shadow-strength: .9;
        --logo-spread: 65%;
        --logo-radius: 18px;
        position: relative;
        background:
          radial-gradient(
            circle at 50% 45%,
            hsla(var(--logo-h) var(--logo-s) var(--logo-l) / calc(var(--logo-alpha) * .65)) 0%,
            hsla(var(--logo-h) var(--logo-s) calc(var(--logo-l) * .85) / calc(var(--logo-alpha) * .22)) 35%,
            transparent var(--logo-spread)
          );
        transition: background-color .2s ease;
        will-change: background;
      }
      :where(.logo-shadow-img){
        filter:
          drop-shadow(0 0 var(--logo-radius) hsla(var(--logo-h) var(--logo-s) var(--logo-l) / calc(var(--logo-alpha) * .55)))
          drop-shadow(0 6px calc(var(--logo-radius) * 1.2) hsla(var(--logo-h) var(--logo-s) calc(var(--logo-l) * .85) / calc(var(--logo-alpha) * .35)));
        transition: filter .2s ease;
        will-change: filter;
      }
      :where(.logo-shadow-lowperf).logo-shadow-host{
        --logo-spread: 58%;
        --logo-radius: 14px;
      }
      :where(.logo-shadow-lowperf) .logo-shadow-img{
        filter: drop-shadow(0 0 10px hsla(var(--logo-h) var(--logo-s) var(--logo-l) / .45));
      }
      @media (prefers-reduced-motion: reduce) {
        :where(.logo-shadow-img){
          filter: drop-shadow(0 0 8px hsla(var(--logo-h) var(--logo-s) var(--logo-l) / .35));
        }
      }
    `;
    document.head.appendChild(style);
  }

  // ---------- Cache LRU por src ----------
  const MAX_CACHE = 200;
  const colorCache = new Map(); // key -> {h,s,l}
  function cacheKey(img, sampleSize) {
    const src = img.currentSrc || img.src || '';
    return `${src}::${sampleSize}`;
  }
  function cacheGet(k) {
    if (!colorCache.has(k)) return null;
    const v = colorCache.get(k);
    // LRU: refresh
    colorCache.delete(k); colorCache.set(k, v);
    return v;
  }
  function cacheSet(k, v) {
    colorCache.set(k, v);
    if (colorCache.size > MAX_CACHE) {
      const first = colorCache.keys().next().value;
      colorCache.delete(first);
    }
  }

  // ---------- Extracción de color dominante (rápida + robusta) ----------
  function extractDominantHsl(img, sampleSize = 24) {
    const k = cacheKey(img, sampleSize);
    const fromCache = cacheGet(k);
    if (fromCache) return fromCache;

    const size = Math.max(8, Math.min(48, sampleSize)) | 0;
    let canvas, ctx;
    try {
      if (typeof OffscreenCanvas !== 'undefined') {
        canvas = new OffscreenCanvas(size, size);
        ctx = canvas.getContext('2d', { willReadFrequently: true });
      } else {
        canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        ctx = canvas.getContext('2d', { willReadFrequently: true });
      }
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, 0, 0, size, size);
      const { data } = ctx.getImageData(0, 0, size, size);

      const counts = new Map();
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a < 100) continue; // ignora casi transparentes
        const r = data[i], g = data[i + 1], b = data[i + 2];
        // descartar casi-grises muy oscuros o muy claros (fondos neutros)
        const { s, l } = rgbToHsl(r, g, b);
        if (s < 8 || l < 15 || l > 90) continue;

        const br = r >> 4, bg = g >> 4, bb = b >> 4; // 4 bits
        const key = (br << 8) | (bg << 4) | bb;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      if (counts.size === 0) {
        // todo fue descartado → null para fallback
        return null;
      }

      let bestKey = 0, bestCount = -1;
      for (const [k, c] of counts) { if (c > bestCount) { bestCount = c; bestKey = k; } }

      let sumR = 0, sumG = 0, sumB = 0, n = 0;
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a < 100) continue;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const br = r >> 4, bg = g >> 4, bb = b >> 4;
        const key = (br << 8) | (bg << 4) | bb;
        if (key === bestKey) { sumR += r; sumG += g; sumB += b; n++; }
      }
      if (!n) return null;

      const avgR = (sumR / n) | 0, avgG = (sumG / n) | 0, avgB = (sumB / n) | 0;
      let { h, s, l } = rgbToHsl(avgR, avgG, avgB);

      // S/L saneadas para brillos cómodos
      s = clamp(s, 20, 98);
      l = clamp(l, 20, 85);

      const out = { h: Math.round(h), s: Math.round(s), l: Math.round(l) };
      cacheSet(k, out);
      return out;
    } catch {
      return null; // Tainted canvas o error → fallback
    } finally {
      canvas = null; ctx = null;
    }
  }

  // ---------- Aplicación de estilos (un solo frame) ----------
  function applyStyles(img, hsl, opts, perf) {
    const host = opts.wrap === 'parent' ? (img.parentElement || img) : img;
    const classHost = host;
    const classImg = img;

    // Overrides por data-*
    const dataHsl = img.getAttribute('data-logo-hsl'); // "h,s,l"
    let hue = hsl?.h ?? stringHashHue(img.currentSrc || img.src || '');
    let sat = hsl?.s ?? 70;
    let lig = hsl?.l ?? 50;
    if (dataHsl && isStr(dataHsl)) {
      const parts = dataHsl.split(',').map(x => +x);
      if (parts.length === 3 && parts.every(n => Number.isFinite(n))) {
        hue = parts[0]; sat = clamp(parts[1], 0, 100); lig = clamp(parts[2], 0, 100);
      }
    }

    const alpha = parseFloat(img.getAttribute('data-logo-alpha') ?? '') || (perf.lowPerf || REDUCED_MOTION ? 0.45 : (opts.alpha ?? 0.55));
    const radius = parseFloat(img.getAttribute('data-logo-radius') ?? '') || (perf.lowPerf || REDUCED_MOTION ? 14 : (opts.radius ?? 18));
    const spread = img.getAttribute('data-logo-spread') || (perf.lowPerf ? '58%' : (opts.spread || '65%'));

    // Un frame para escribir
    requestAnimationFrame(() => {
      classHost.classList.add('logo-shadow-host');
      classImg.classList.add('logo-shadow-img');
      if (perf.lowPerf) classHost.classList.add('logo-shadow-lowperf');
      else classHost.classList.remove('logo-shadow-lowperf');

      classHost.style.setProperty('--logo-h', String(Math.round(hue)));
      classHost.style.setProperty('--logo-s', pct(sat));
      classHost.style.setProperty('--logo-l', pct(lig));
      classHost.style.setProperty('--logo-alpha', String(alpha));
      classHost.style.setProperty('--logo-radius', `${Math.round(radius)}px`);
      classHost.style.setProperty('--logo-spread', spread);

      if (opts.mode === 'shadow-only') {
        classHost.style.background = 'none';
      }

      if (LOGO_SHADOW_DEBUG) {
        const htxt = `H:${Math.round(hue)} S:${Math.round(sat)} L:${Math.round(lig)}`;
        updateDebugHUD(queue.length, htxt);
      }
    });
  }

  // ---------- Cola/batching para procesar en idle ----------
  const queue = [];
  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    const run = () => {
      scheduled = false;
      // Procesa pocas por frame para no bloquear (2 por rIC; fallback setTimeout)
      const step = () => {
        const startT = performance.now();
        let processed = 0;
        while (queue.length && (processed < 2) && (performance.now() - startT < 12)) {
          const task = queue.shift();
          task && task();
          processed++;
        }
        updateDebugHUD(queue.length);
        if (queue.length) {
          if ('requestIdleCallback' in window) {
            window.requestIdleCallback(step, { timeout: 120 });
          } else {
            setTimeout(step, 16);
          }
        }
      };
      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(step, { timeout: 120 });
      } else {
        setTimeout(step, 16);
      }
    };
    if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 120 });
    else setTimeout(run, 16);
  }

  function enqueue(fn) { queue.push(fn); schedule(); }

  // ---------- Procesar una imagen ----------
  function processImage(img, opts, perfFlags) {
    if (!img || img.__logoShadowReady) return;
    const doWork = () => {
      // Intentar decode() antes para asegurar tamaño real
      const proceed = () => {
        const hsl = extractDominantHsl(img, opts.sampleSize);
        // fallback si no pudimos leer color (CORS/tainted o sin datos)
        const finalHsl = hsl ?? { h: stringHashHue(img.currentSrc || img.src || ''), s: 70, l: 50 };
        applyStyles(img, finalHsl, opts, perfFlags);
        img.__logoShadowReady = true;
      };
      if (typeof img.decode === 'function') {
        img.decode().then(proceed).catch(proceed);
      } else {
        proceed();
      }
    };

    // Solo cuando está lista (o se cargue)
    if (img.complete && img.naturalWidth > 0) {
      enqueue(doWork);
    } else {
      if (!img.getAttribute('decoding')) img.decoding = 'async';
      if (!img.getAttribute('loading')) img.loading = 'lazy';
      img.addEventListener('load', () => enqueue(doWork), { once: true });
    }
  }

  // Re-procesa al cambiar src
  function watchSrc(img, opts, perfFlags) {
    try {
      const mo = new MutationObserver((mut) => {
        for (const m of mut) {
          if (m.type === 'attributes' && m.attributeName === 'src') {
            img.__logoShadowReady = false;
            processImage(img, opts, perfFlags);
          }
        }
      });
      mo.observe(img, { attributes: true, attributeFilter: ['src'] });
      img.__logoShadowMO = mo;
    } catch {}
  }

  // ---------- Observador de visibilidad ----------
  function createObserver(opts, perfFlags) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          processImage(e.target, opts, perfFlags);
          io.unobserve(e.target); // ahorrar
        }
      }
    }, { root: null, threshold: 0.1 });
    return io;
  }

  // ---------- API pública ----------
  /**
   * initLogoShadow(options?)
   *  - selector: string (default: '.js-logo-shadow')
   *  - wrap: 'parent' | 'self' (default 'parent')
   *  - sampleSize: 8..48 (default 24; en lowPerf se usa Math.min(24, sampleSize))
   *  - alpha: 0..1 (default .55; en lowPerf/RM reduce)
   *  - radius: px (default 18; en lowPerf/RM reduce)
   *  - spread: CSS % (default '65%'; en lowPerf '58%')
   *  - mode: 'glow+bg' | 'shadow-only' (default 'glow+bg')
   */
  function initLogoShadow(options) {
    if (!document || !document.querySelectorAll) return;
    ensureStyles();

    const perfFlags = { lowPerf: isLowPerfDevice() };
    const opts = {
      selector: '.js-logo-shadow',
      wrap: 'parent',
      sampleSize: perfFlags.lowPerf ? 16 : 24,
      alpha: 0.55,
      radius: 18,
      spread: '65%',
      mode: 'glow+bg',
      ...options
    };

    const imgs = document.querySelectorAll(opts.selector);
    if (!imgs.length) return { disconnect(){}, reprocess(){} };

    const io = createObserver(opts, perfFlags);
    imgs.forEach(img => {
      if (!img.getAttribute('decoding')) img.decoding = 'async';
      if (!img.getAttribute('loading')) img.loading = 'lazy';
      io.observe(img);
      watchSrc(img, opts, perfFlags);
    });

    const api = {
      disconnect() {
        try { io.disconnect(); } catch {}
        imgs.forEach(img => {
          if (img.__logoShadowMO) { try { img.__logoShadowMO.disconnect(); } catch {} }
        });
      },
      reprocess() {
        imgs.forEach(img => {
          img.__logoShadowReady = false;
          processImage(img, opts, perfFlags);
        });
      }
    };

    // Atajo global (opcional) para coherencia con radio: window.logoShadow
    if (!window.logoShadow) window.logoShadow = api;
    return api;
  }

  // ---------- Auto-init coherente con tu proyecto ----------
  if (typeof document !== 'undefined') {
    const auto = () => initLogoShadow({ selector: '.faction-buttons img, .faction-section img, img.js-logo-shadow' });
    if (document.readyState !== 'loading') auto();
    else document.addEventListener('DOMContentLoaded', auto, { once: true });
  }

  return initLogoShadow;
}));
