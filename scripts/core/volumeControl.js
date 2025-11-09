/*!
 * volumecontrol.js — Control de volumen independiente (UMD)
 * API: const vc = initVolumeControl({
 *   audioEl, bgEl, barEl?, labelEl?, handleEl?,
 *   preserveGrab?, initial?, step?, wheelStep?, pageStep?,
 *   curve?, inverseCurve?, orientation? ('vertical'|'horizontal')
 * });
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.initVolumeControl = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- Utils ----------
  const clamp = (v, a = 0, b = 1) => Math.min(Math.max(+v, a), b);
  const defaultCurve = (x) => x ** 4;                 // perceptual
  const defaultInverseCurve = (y) => Math.pow(y, 1/4); // inversa exacta del defaultCurve
  // Inversor genérico por búsqueda binaria para curvas monótonas crecientes [0..1]→[0..1]
  function invertMono(fn, y, eps = 1e-4, maxIter = 24) {
    y = clamp(y, 0, 1);
    let lo = 0, hi = 1, it = 0;
    while (it++ < maxIter) {
      const mid = (lo + hi) * 0.5;
      const fm = fn(mid);
      if (Math.abs(fm - y) <= eps) return mid;
      (fm < y ? lo = mid : hi = mid);
    }
    return (lo + hi) * 0.5;
  }

  function initVolumeControl(opts = {}) {
    const {
      audioEl, bgEl, barEl = null, labelEl = null, handleEl = null,
      preserveGrab = false, initial = 0.9, step = 0.05,
      wheelStep = step, pageStep = step * 5,
      curve = defaultCurve, inverseCurve: invOpt = null,
      orientation = 'vertical'
    } = opts;

    if (!audioEl || !bgEl) throw new Error('initVolumeControl: faltan elementos requeridos (audioEl, bgEl).');

    // Evita doble inicialización en el mismo bgEl
    if (bgEl.__volumeControl) {
      try { bgEl.__volumeControl.destroy(); } catch {}
    }

    // Estado interno (con “linear” 0..1 y mapping vía curve→audio.volume)
    let linear = clamp(initial);
    let isDragging = false;
    let pendingPos = null; // clientY o clientX según orientación
    let rafId = null;
    let cachedRect = null;
    let grabOffsetPx = 0;
    let lastPercent = -1;
    let prevVolumeBeforeMute = null;
    let disabled = false;
    let activePointerId = null;
    let ro = null;
    let wheelAcc = 0;      // acumulador de wheel
    let wheelT = null;
    const unsubs = [];

    const inverseCurve = typeof invOpt === 'function'
      ? invOpt
      : (y) => invertMono(curve, y);

    const on = (el, type, fn, opts) => { el.addEventListener(type, fn, opts); unsubs.push(() => el.removeEventListener(type, fn, opts)); };

    // --------- A11y / Semántica ----------
    try {
      const st = typeof window !== 'undefined' ? window.getComputedStyle(bgEl) : { position: '' };
      if (st.position === 'static') bgEl.style.position = bgEl.style.position || 'relative';
    } catch {}
    bgEl.style.touchAction = bgEl.style.touchAction || 'none';
    if (!bgEl.hasAttribute('tabindex')) bgEl.setAttribute('tabindex', '0');
    bgEl.setAttribute('role', 'slider');
    bgEl.setAttribute('aria-label', bgEl.getAttribute('aria-label') || 'Volume');
    bgEl.setAttribute('aria-valuemin', '0');
    bgEl.setAttribute('aria-valuemax', '100');
    bgEl.setAttribute('aria-orientation', orientation === 'horizontal' ? 'horizontal' : 'vertical');

    if (handleEl) {
      handleEl.style.position = handleEl.style.position || 'absolute';
      if (orientation === 'vertical') {
        handleEl.style.left = '50%';
        handleEl.style.transform = 'translate(-50%, -50%)';
      } else {
        handleEl.style.top = '50%';
        handleEl.style.transform = 'translate(-50%, -50%)';
      }
      handleEl.style.touchAction = handleEl.style.touchAction || 'none';
      handleEl.style.cursor = handleEl.style.cursor || 'grab';
    }

    // ---------- Render y RAF ----------
    const schedule = () => { if (!rafId) rafId = requestAnimationFrame(tick); };

    const applyAudio = () => {
      // mapea linear→audio.volume con curva perceptual
      audioEl.volume = clamp(curve(linear), 0, 1);
    };

    const reflectUI = () => {
      const percent = Math.round(linear * 100);
      if (percent !== lastPercent) {
        lastPercent = percent;
        if (barEl) {
          if (orientation === 'vertical') barEl.style.height = percent + '%';
          else barEl.style.width = percent + '%';
        }
        if (labelEl) labelEl.textContent = percent + '%';
        if (handleEl) {
          if (orientation === 'vertical') handleEl.style.top = (100 - percent) + '%';
          else handleEl.style.left = percent + '%';
        }
        bgEl.setAttribute('aria-valuenow', String(percent));
      }
    };

    const tick = () => {
      rafId = null;
      if (isDragging && pendingPos != null) {
        cachedRect = bgEl.getBoundingClientRect();
        const size = orientation === 'vertical' ? (cachedRect.height || 1) : (cachedRect.width || 1);
        const start = orientation === 'vertical' ? cachedRect.top : cachedRect.left;
        const corrected = pendingPos - grabOffsetPx;
        const rel = clamp(corrected - start, 0, size);
        const ratio = rel / size;
        const newLinear = orientation === 'vertical' ? clamp(1 - ratio) : clamp(ratio);
        setLinear(newLinear, /*skipSchedule*/true, /*skipAudio*/false);
      }
      reflectUI();
    };

    // ---------- Mutadores ----------
    function setLinear(v, skipSchedule = false, skipAudio = false) {
      const nv = clamp(v);
      if (nv === linear && !isDragging) return linear;
      linear = nv;
      if (!skipAudio) applyAudio();
      if (!skipSchedule) schedule();
      try { bgEl.dispatchEvent(new CustomEvent('vc:change', { detail: { linear, volume: audioEl.volume } })); } catch {}
      return linear;
    }
    const setVolume = (v) => setLinear(v);
    const setVolumeAudio = (vol01) => setLinear(clamp(inverseCurve(clamp(vol01))), false, true);
    const getVolume = () => linear;
    const getVolumeAudio = () => audioEl.volume;

    // ---------- Mute ----------
    function mute() {
      if (audioEl.volume > 0.001) {
        prevVolumeBeforeMute = linear;
        setLinear(0);
        try { bgEl.dispatchEvent(new CustomEvent('vc:mute')); } catch {}
      }
    }
    function unmute() {
      if (prevVolumeBeforeMute != null) {
        setLinear(prevVolumeBeforeMute);
        prevVolumeBeforeMute = null;
      } else {
        setLinear(Math.max(linear, 0.5));
      }
      try { bgEl.dispatchEvent(new CustomEvent('vc:unmute')); } catch {}
    }

    function setCurve(fn, invFn) {
      if (typeof fn === 'function') {
        // Nota: mantenemos "stateful": solo cambiamos mapping, no forzamos re-linearizar.
        // Si pasas invFn la usaremos; si no, seguimos con la inversa numérica.
        applyAudio();
        schedule();
      }
    }

    function enable() { disabled = false; bgEl.classList.remove('vc-disabled'); bgEl.setAttribute('aria-disabled', 'false'); }
    function disable() { disabled = true;  bgEl.classList.add('vc-disabled');   bgEl.setAttribute('aria-disabled', 'true'); }

    function destroy() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      pendingPos = null; cachedRect = null; isDragging = false; activePointerId = null;
      while (unsubs.length) { try { unsubs.pop()(); } catch {} }
      try { ro && ro.disconnect && ro.disconnect(); } catch {}
      if (wheelT) { clearTimeout(wheelT); wheelT = null; }
      try { delete bgEl.__volumeControl; } catch {}
    }

    // ---------- Cálculos de arrastre ----------
    function computeGrabOffset(e) {
      if (!handleEl) return 0;
      const targetIsHandle = (e.target === handleEl) || handleEl.contains(e.target);
      if (targetIsHandle) {
        const hr = handleEl.getBoundingClientRect();
        const center = orientation === 'vertical'
          ? (hr.top + (hr.height || 0) / 2)
          : (hr.left + (hr.width || 0) / 2);
        return (orientation === 'vertical') ? (e.clientY - center) : (e.clientX - center);
      }
      if (preserveGrab && handleEl) {
        cachedRect = cachedRect || bgEl.getBoundingClientRect();
        const size = orientation === 'vertical' ? (cachedRect.height || 1) : (cachedRect.width || 1);
        const expectedCenter = orientation === 'vertical'
          ? (cachedRect.top + size * (1 - linear))
          : (cachedRect.left + size * (linear));
        return (orientation === 'vertical') ? (e.clientY - expectedCenter) : (e.clientX - expectedCenter);
      }
      return 0;
    }

    // ---------- Observers ----------
    function startObservers() {
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(() => { if (isDragging) { cachedRect = bgEl.getBoundingClientRect(); schedule(); } });
        ro.observe(bgEl);
      }
      const onWinResize = () => { if (isDragging) { cachedRect = bgEl.getBoundingClientRect(); schedule(); } };
      on(window, 'resize', onWinResize, { passive: true });
      on(window, 'scroll', onWinResize, { passive: true });
    }

    // ---------- Handlers ----------
    function onPointerDown(e) {
      if (disabled) return;
      if (e.button != null && e.button !== 0) return;
      e.preventDefault();

      isDragging = true;
      activePointerId = (e.pointerId != null) ? e.pointerId : 'mouse';
      cachedRect = bgEl.getBoundingClientRect();
      grabOffsetPx = computeGrabOffset(e);
      pendingPos = orientation === 'vertical' ? e.clientY : e.clientX;

      try { bgEl.setPointerCapture && e.pointerId != null && bgEl.setPointerCapture(e.pointerId); } catch {}

      const move = (ev) => {
        if (!isDragging) return;
        if (activePointerId != null && ev.pointerId != null && ev.pointerId !== activePointerId) return;
        if (ev.cancelable) ev.preventDefault();
        pendingPos = orientation === 'vertical' ? ev.clientY : ev.clientX;
        schedule();
      };
      const upOrCancel = (ev) => {
        if (activePointerId != null && ev.pointerId != null && ev.pointerId !== activePointerId) return;
        isDragging = false; pendingPos = null; cachedRect = null; grabOffsetPx = 0; activePointerId = null;
        try { bgEl.releasePointerCapture && ev.pointerId != null && bgEl.releasePointerCapture(ev.pointerId); } catch {}
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', upOrCancel);
        document.removeEventListener('pointercancel', upOrCancel);
        if (handleEl) handleEl.style.cursor = 'grab';
        try { ro && ro.disconnect && ro.disconnect(); } catch {}
      };

      document.addEventListener('pointermove', move, { passive: false });
      document.addEventListener('pointerup', upOrCancel, { passive: false });
      document.addEventListener('pointercancel', upOrCancel, { passive: false });
      if (handleEl) handleEl.style.cursor = 'grabbing';
      startObservers();
      schedule();
    }

    function onWheel(e) {
      if (disabled) return;
      // Acumula deltas y aplica con pequeño debounce para evitar “escalera”
      e.preventDefault();
      const delta = (e.deltaY > 0 ? -wheelStep : wheelStep);
      wheelAcc += delta;
      if (wheelT) clearTimeout(wheelT);
      wheelT = setTimeout(() => {
        setLinear(linear + wheelAcc);
        wheelAcc = 0;
      }, 16);
    }

    function onDblClick() { if (!disabled) { if (audioEl.volume > 0.001) mute(); else unmute(); } }

    function onKeyDown(e) {
      if (disabled) return;
      const { code } = e;
      if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown','Home','End'].includes(code)) return;
      e.preventDefault();
      // Vertical: Up = +, Down = -
      // Horizontal: Right = +, Left = -
      const incKey = orientation === 'vertical' ? ['ArrowUp'] : ['ArrowRight'];
      const decKey = orientation === 'vertical' ? ['ArrowDown'] : ['ArrowLeft'];

      if (incKey.includes(code)) setLinear(linear + step);
      else if (decKey.includes(code)) setLinear(linear - step);
      else if (code === 'PageUp') setLinear(linear + pageStep);
      else if (code === 'PageDown') setLinear(linear - pageStep);
      else if (code === 'Home') setLinear(0);
      else if (code === 'End') setLinear(1);
    }

    // Sincroniza si alguien cambia audioEl.volume por fuera (p.ej. controles del sistema)
    function onAudioVolumeChange() {
      // Mantén módulo con estado propio: mapea solo si el cambio vino de “fuera” (cuando no estamos arrastrando)
      if (isDragging) return;
      const expected = curve(linear);
      const actual = clamp(audioEl.volume);
      if (Math.abs(actual - expected) > 0.005) {
        // trae “linear” hacia la inversa de actual
        const ln = clamp(inverseCurve(actual));
        setLinear(ln);
      } else {
        // solo reflejar UI si el porcentaje cambió por redondeos
        schedule();
      }
    }

    // ---------- Bind ----------
    on(bgEl, 'pointerdown', onPointerDown, { passive: false });
    on(bgEl, 'wheel',       onWheel,       { passive: false });
    on(bgEl, 'dblclick',    onDblClick,    { passive: true  });
    on(bgEl, 'keydown',     onKeyDown,     { passive: false });
    if (handleEl) on(handleEl, 'pointerdown', onPointerDown, { passive: false });
    on(audioEl, 'volumechange', onAudioVolumeChange, { passive: true });

    // ---------- Init ----------
    setLinear(linear); // esto aplica curva→audio y agenda primer render
    bgEl.__volumeControl = {
      // API pública
      setVolume,           // 0..1 linear
      getVolume,           // 0..1 linear
      setVolumeAudio,      // 0..1 audio (post-curva)
      getVolumeAudio,      // 0..1 audio (post-curva)
      mute, unmute,
      setCurve, enable, disable, destroy
    };
    return bgEl.__volumeControl;
  }

  return initVolumeControl;
}));
