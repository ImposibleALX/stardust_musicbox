/*!
 * logoShadow.js — “Sombreado inteligente” para logos
 * --------------------------------------------------
 * - Extrae un color dominante rápido (canvas downscale + cuantización ligera).
 * - Expone CSS variables (--logo-h, --logo-s, --logo-l, --logo-alpha) en el nodo host.
 * - Aplica un fondo radial suave y/o drop-shadow eficiente, sin jank.
 * - Solo procesa cuando el logo está en viewport (IntersectionObserver).
 * - Un único repaint por cambio (batch via requestAnimationFrame).
 * - Respeta prefers-reduced-motion y reduce filtros en dispositivos débiles.
 *
 * USO MÍNIMO (auto-init):
 *   <img class="js-logo-shadow" src="...">
 *   <script src="scripts/core/logoShadow.js"></script>
 *
 * Personalización:
 *   window.initLogoShadow({ selector: '.faction-buttons img, .js-logo-shadow' });
 *
 * Accesibilidad:
 *   No altera el contenido semántico. Efectos visuales via CSS únicamente.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) { define([], factory); }
  else if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.initLogoShadow = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- Utilidades generales ----------
  const clamp = (v, a = 0, b = 1) => Math.min(Math.max(v, a), b);

  // Convierte RGB [0..255] → HSL {h:0..360, s:0..100, l:0..100}
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; }
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

  // Hash simple para fallback determinista (según URL del logo)
  function stringHashHue(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return (h % 360);
  }

  // Detección de “bajo rendimiento” para atenuar filtros
  function isLowPerfDevice() {
    try {
      const mem = navigator.deviceMemory || 0;           // ~GB
      const cores = navigator.hardwareConcurrency || 0;  // núcleos lógicos
      const coarse = matchMedia('(pointer: coarse)').matches;
      return (mem && mem < 4) || (cores && cores < 4) || coarse;
    } catch { return false; }
  }

  const REDUCED_MOTION = typeof matchMedia === 'function'
    ? matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  // ---------- CSS (inyectado una sola vez) ----------
  function ensureStyles() {
    if (document.getElementById('logo-shadow-styles')) return;

    const style = document.createElement('style');
    style.id = 'logo-shadow-styles';
    style.textContent = `
      /* Host que recibe variables y fondo radial */
      .logo-shadow-host {
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

      /* Imagen con drop-shadow ligero usando el mismo color */
      .logo-shadow-img {
        filter:
          drop-shadow(0 0 var(--logo-radius) hsla(var(--logo-h) var(--logo-s) var(--logo-l) / calc(var(--logo-alpha) * .55)))
          drop-shadow(0 6px calc(var(--logo-radius) * 1.2) hsla(var(--logo-h) var(--logo-s) calc(var(--logo-l) * .85) / calc(var(--logo-alpha) * .35)));
        transition: filter .2s ease;
        will-change: filter;
      }

      /* Dispositivos de bajo rendimiento: sombras más baratas */
      .logo-shadow-lowperf .logo-shadow-img {
        filter:
          drop-shadow(0 0 10px hsla(var(--logo-h) var(--logo-s) var(--logo-l) / .45));
      }
      .logo-shadow-lowperf.logo-shadow-host {
        --logo-spread: 58%;
        --logo-radius: 14px;
      }

      /* Respeto a reduced motion: no animaciones ni filtros intensos */
      @media (prefers-reduced-motion: reduce) {
        .logo-shadow-img {
          filter: drop-shadow(0 0 8px hsla(var(--logo-h) var(--logo-s) var(--logo-l) / .35));
        }
      }
    `;
    document.head.appendChild(style);
  }

  // ---------- Extracción de color dominante (rápida) ----------
  /**
   * Obtiene un color dominante aproximado:
   * - Reescala a 24x24 (o sampleSize) para minimizar trabajo.
   * - Cuantiza a 4 bits por canal (4096 buckets) y usa el modo.
   * - Refina promediando los píxeles del bucket ganador.
   * Devuelve { h, s, l } o null si falla (CORS tainted canvas → fallback).
   */
  function extractDominantHsl(img, sampleSize = 24) {
    // OffscreenCanvas si existe (sin afectar layout)
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

      // Histograma por bucket 4-4-4 bits
      const counts = new Map();
      // Para refinamiento, acumulamos sumas por bucket ganador luego.
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a < 100) continue; // ignora casi transparentes
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const br = r >> 4, bg = g >> 4, bb = b >> 4;
        const key = (br << 8) | (bg << 4) | bb;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      if (counts.size === 0) return null;

      // bucket dominante
      let bestKey = 0, bestCount = -1;
      for (const [k, c] of counts) {
        if (c > bestCount) { bestCount = c; bestKey = k; }
      }

      // Refina promedio dentro del bucket dominante
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
      const { h, s, l } = rgbToHsl(avgR, avgG, avgB);

      return {
        h: Math.round(h),
        s: Math.round(s),
        l: Math.round(l)
      };
    } catch {
      // Tainted canvas o error → null (usaremos fallback)
      return null;
    } finally {
      canvas = null; ctx = null;
    }
  }

  // ---------- Núcleo: procesar un <img> ----------
  function processImage(img, opts, perfFlags) {
    if (!img || img.__logoShadowReady) return;

    // Si la imagen no está cargada, esperar a decode/load
    const start = () => {
      // Extracción potencialmente “cara”: hacer en requestIdleCallback si existe.
      const run = () => {
        const hsl = extractDominantHsl(img, opts.sampleSize);
        applyStyles(img, hsl, opts, perfFlags);
        img.__logoShadowReady = true;
      };

      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(run, { timeout: 120 });
      } else {
        // Cola micro/macro si no hay rIC
        setTimeout(run, 0);
      }
    };

    if (img.complete && img.naturalWidth > 0) {
      start();
    } else {
      // Mejora de carga
      if (!img.getAttribute('decoding')) img.decoding = 'async';
      if (!img.getAttribute('loading')) img.loading = 'lazy';
      const onload = () => { img.removeEventListener('load', onload); start(); };
      img.addEventListener('load', onload, { once: true });
    }
  }

  // Aplica variables y clases con un único repaint (rAF)
  function applyStyles(img, hsl, opts, perfFlags) {
    const host = opts.wrap === 'parent' ? (img.parentElement || img) : img;
    const classHost = host;
    const classImg = img;

    const hue = hsl?.h ?? stringHashHue(img.currentSrc || img.src || '');
    const sat = clamp((hsl?.s ?? 70), 20, 98);
    const lig = clamp((hsl?.l ?? 50), 20, 85);

    // En bajo rendimiento, bajar alfa y radios
    const alpha = perfFlags.lowPerf || REDUCED_MOTION ? 0.45 : (opts.alpha ?? 0.55);
    const radius = perfFlags.lowPerf || REDUCED_MOTION ? 14 : (opts.radius ?? 18);
    const spread = perfFlags.lowPerf ? '58%' : (opts.spread || '65%');

    // Un único frame para todas las escrituras de estilo/clases
    requestAnimationFrame(() => {
      // Clases para estilos inyectados
      classHost.classList.add('logo-shadow-host');
      classImg.classList.add('logo-shadow-img');
      if (perfFlags.lowPerf) classHost.classList.add('logo-shadow-lowperf');
      else classHost.classList.remove('logo-shadow-lowperf');

      // CSS variables en el HOST (para afectar bg + img)
      classHost.style.setProperty('--logo-h', String(hue));
      classHost.style.setProperty('--logo-s', `${sat}%`);
      classHost.style.setProperty('--logo-l', `${lig}%`);
      classHost.style.setProperty('--logo-alpha', String(alpha));
      classHost.style.setProperty('--logo-radius', `${radius}px`);
      classHost.style.setProperty('--logo-spread', spread);

      if (opts.mode === 'shadow-only') {
        // Si solo queremos sombra, evita fondo radial
        classHost.style.background = 'none';
      }
    });
  }

  // Observa visibilidad y (opcional) cambios de src para re-procesar
  function createObserver(opts, perfFlags) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          processImage(e.target, opts, perfFlags);
          // Ya procesado; podemos dejar de observar para ahorrar.
          io.unobserve(e.target);
        }
      }
    }, { root: null, threshold: 0.1 });

    return io;
  }

  // Permite reprocesar cuando cambia el src (poco común)
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
      // Guardar referencia para posible limpieza, si se requiere.
      img.__logoShadowMO = mo;
    } catch { /* opcional */ }
  }

  // ---------- API pública ----------
  /**
   * initLogoShadow(options?)
   *  - selector: string (default: '.js-logo-shadow')
   *  - wrap: 'parent' | 'self' (dónde setear variables y fondo radial)
   *  - sampleSize: número (8..48, default 24)
   *  - alpha: 0..1 opacidad base del glow (default .55)
   *  - radius: px del drop-shadow principal (default 18)
   *  - spread: % del radio del gradiente (default '65%')
   *  - mode: 'glow+bg' | 'shadow-only' (default 'glow+bg')
   */
  function initLogoShadow(options) {
    if (!document || !document.querySelectorAll) return;
    ensureStyles();

    const opts = {
      selector: '.js-logo-shadow',
      wrap: 'parent',
      sampleSize: 24,
      alpha: 0.55,
      radius: 18,
      spread: '65%',
      mode: 'glow+bg',
      ...options
    };

    const perfFlags = { lowPerf: isLowPerfDevice() };

    const imgs = document.querySelectorAll(opts.selector);
    if (!imgs.length) return;

    const io = createObserver(opts, perfFlags);

    imgs.forEach(img => {
      // Preparativos menores (no forzar si ya están)
      if (!img.getAttribute('decoding')) img.decoding = 'async';
      if (!img.getAttribute('loading')) img.loading = 'lazy';

      // Observa visibilidad (procesa al entrar)
      io.observe(img);

      // Observa cambios de src para re-aplicar si cambia
      watchSrc(img, opts, perfFlags);
    });

    // Devolver manejadores por si el integrador quiere limpiar
    return {
      disconnect() { try { io.disconnect(); } catch {} },
      reprocess() {
        imgs.forEach(img => {
          img.__logoShadowReady = false;
          processImage(img, opts, perfFlags);
        });
      }
    };
  }

  // Auto-init con un selector razonable para este proyecto
  // (logos en botones de facciones + cualquier img con clase .js-logo-shadow)
  if (document && document.readyState !== 'loading') {
    initLogoShadow({ selector: '.faction-buttons img, .faction-section img, img.js-logo-shadow' });
  } else if (document) {
    document.addEventListener('DOMContentLoaded', () => {
      initLogoShadow({ selector: '.faction-buttons img, .faction-section img, img.js-logo-shadow' });
    }, { once: true });
  }

  return initLogoShadow;
}));
