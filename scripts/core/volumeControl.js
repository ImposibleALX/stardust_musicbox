/*!
 * volumecontrol.js — Control de volumen independiente (UMD)
 * Autor: tú ♥ (refactor por ChatGPT)
 * API: const vc = initVolumeControl({ audioEl, bgEl, barEl?, labelEl?, handleEl?, preserveGrab?, initial?, step?, curve? });
 * Eventos custom: bgEl.dispatchEvent(new CustomEvent('vc:change', { detail: { linear, volume } }))
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.initVolumeControl = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const clamp = (v, a = 0, b = 1) => Math.min(Math.max(v, a), b);
  const defaultCurve = (x) => x ** 4; // perceptual

  function initVolumeControl({
    audioEl,
    bgEl,
    barEl = null,
    labelEl = null,
    handleEl = null,
    preserveGrab = false,
    initial = 0.9,
    step = 0.05,
    curve = defaultCurve
  } = {}) {
    if (!audioEl || !bgEl) {
      throw new Error('initVolumeControl: faltan elementos requeridos (audioEl, bgEl).');
    }

    // Estado
    let linear = clamp(Number(initial) || 0.9);
    let isDragging = false;
    let pendingY = null;
    let rafId = null;
    let cachedRect = null;
    let grabOffsetPx = 0;
    let lastPercent = -1;
    let prevVolumeBeforeMute = null;
    let disabled = false;
    let activePointerId = null;
    let ro = null;
    const unsubs = [];

    // Helper eventos
    const on = (el, type, fn, opts) => {
      el.addEventListener(type, fn, opts);
      unsubs.push(() => el.removeEventListener(type, fn, opts));
    };

    // Atributos mínimos
    try {
      const st = typeof window !== 'undefined' ? window.getComputedStyle(bgEl) : { position: '' };
      if (st.position === 'static') bgEl.style.position = bgEl.style.position || 'relative';
    } catch (_) {}
    bgEl.style.touchAction = bgEl.style.touchAction || 'none';
    if (!bgEl.hasAttribute('tabindex')) bgEl.setAttribute('tabindex', '0');
    bgEl.setAttribute('role', 'slider');
    bgEl.setAttribute('aria-label', bgEl.getAttribute('aria-label') || 'Volume');
    bgEl.setAttribute('aria-valuemin', '0');
    bgEl.setAttribute('aria-valuemax', '100');

    if (handleEl) {
      handleEl.style.position = handleEl.style.position || 'absolute';
      handleEl.style.left = '50%';
      handleEl.style.transform = 'translate(-50%, -50%)';
      handleEl.style.touchAction = handleEl.style.touchAction || 'none';
      handleEl.style.cursor = handleEl.style.cursor || 'grab';
    }

    // Render + cálculo en un único RAF
    const tick = () => {
      rafId = null;

      if (isDragging && pendingY != null) {
        // Recalcular rect en cada frame durante el drag para máxima precisión (scroll/layout)
        cachedRect = bgEl.getBoundingClientRect();
        const correctedY = pendingY - grabOffsetPx;
        const relY = clamp(correctedY - cachedRect.top, 0, cachedRect.height || 1);
        const newLinear = clamp(1 - (relY / (cachedRect.height || 1)));
        if (newLinear !== linear) setLinear(newLinear, /*skipSchedule*/ true, /*skipAudio*/ false);
      }

      const percent = Math.round(linear * 100);
      if (percent !== lastPercent) {
        lastPercent = percent;
        if (barEl) barEl.style.height = percent + '%';
        if (labelEl) labelEl.textContent = percent + '%';
        if (handleEl) handleEl.style.top = (100 - percent) + '%';
        bgEl.setAttribute('aria-valuenow', String(percent));
      }
    };

    const schedule = () => { if (!rafId) rafId = requestAnimationFrame(tick); };

    // Aplicar volumen real (curva perceptual -> 0..1)
    const applyAudio = () => { audioEl.volume = clamp(curve(linear), 0, 1); };

    // Setter
    function setLinear(v, skipSchedule = false, skipAudio = false) {
      const nv = clamp(Number(v) || 0);
      if (nv === linear && !isDragging) return linear;
      linear = nv;
      if (!skipAudio) applyAudio();
      if (!skipSchedule) schedule();

      // Notificar a consumidores externos
      try {
        bgEl.dispatchEvent(new CustomEvent('vc:change', {
          detail: { linear, volume: audioEl.volume }
        }));
      } catch (_) {}
      return linear;
    }

    const setVolume = (v) => setLinear(v);
    const getVolume = () => linear;

    function mute() {
      if (audioEl.volume > 0.001) {
        prevVolumeBeforeMute = linear;
        setLinear(0);
        try { bgEl.dispatchEvent(new CustomEvent('vc:mute')); } catch (_) {}
      }
    }

    function unmute() {
      if (prevVolumeBeforeMute != null) {
        setLinear(prevVolumeBeforeMute);
        prevVolumeBeforeMute = null;
      } else {
        setLinear(Math.max(linear, 0.5));
      }
      try { bgEl.dispatchEvent(new CustomEvent('vc:unmute')); } catch (_) {}
    }

    function setCurve(fn) {
      if (typeof fn === 'function') {
        curve = fn;
        applyAudio();
        schedule();
      }
    }

    function enable() { disabled = false; bgEl.classList.remove('vc-disabled'); }
    function disable() { disabled = true;  bgEl.classList.add('vc-disabled'); }

    function destroy() {
      if (rafId) cancelAnimationFrame(rafId);
      pendingY = null;
      cachedRect = null;
      isDragging = false;
      activePointerId = null;
      while (unsubs.length) { try { unsubs.pop()(); } catch (_) {} }
      try { ro && ro.disconnect && ro.disconnect(); } catch (_) {}
      try { delete bgEl.__volumeControl; } catch (_) {}
    }

    // —— Eventos —— //
    function computeGrabOffset(e) {
      // Si se agarró el handle, usa su centro real:
      if (handleEl && (e.target === handleEl || handleEl.contains(e.target))) {
        const hr = handleEl.getBoundingClientRect();
        const handleCenterY = hr.top + (hr.height || 0) / 2;
        return e.clientY - handleCenterY;
      }
      // Si preserveGrab está activo, respeta el punto de agarre relativo al “centro” esperado:
      if (preserveGrab && handleEl) {
        cachedRect = cachedRect || bgEl.getBoundingClientRect();
        const expectedHandleCenterY = cachedRect.top + (cachedRect.height || 1) * (1 - linear);
        return e.clientY - expectedHandleCenterY;
      }
      // Por defecto, sin offset:
      return 0;
    }

    function startObservers() {
      // Observa cambios de tamaño / layout durante el drag
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(() => {
          if (isDragging) { cachedRect = bgEl.getBoundingClientRect(); schedule(); }
        });
        ro.observe(bgEl);
      }
      const onWinResize = () => { if (isDragging) { cachedRect = bgEl.getBoundingClientRect(); schedule(); } };
      on(window, 'resize', onWinResize, { passive: true });
      on(window, 'scroll', onWinResize, { passive: true });
    }

    function onPointerDown(e) {
      if (disabled) return;
      if (e.button != null && e.button !== 0) return;
      e.preventDefault();

      isDragging = true;
      activePointerId = e.pointerId != null ? e.pointerId : 'mouse';
      cachedRect = bgEl.getBoundingClientRect();
      grabOffsetPx = computeGrabOffset(e);
      pendingY = e.clientY;

      // Captura en el bgEl para no perder el drag
      try { bgEl.setPointerCapture && bgEl.setPointerCapture(e.pointerId); } catch (_) {}

      const move = (ev) => {
        if (!isDragging) return;
        if (activePointerId != null && ev.pointerId != null && ev.pointerId !== activePointerId) return;
        if (ev.cancelable) ev.preventDefault();
        pendingY = ev.clientY;
        schedule();
      };

      const upOrCancel = (ev) => {
        if (activePointerId != null && ev.pointerId != null && ev.pointerId !== activePointerId) return;
        isDragging = false;
        pendingY = null;
        cachedRect = null;
        grabOffsetPx = 0;
        activePointerId = null;
        try { bgEl.releasePointerCapture && bgEl.releasePointerCapture(ev.pointerId); } catch (_) {}
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', upOrCancel);
        document.removeEventListener('pointercancel', upOrCancel);
        if (handleEl) handleEl.style.cursor = 'grab';
        // Detach observers si no se usan fuera del drag
        try { ro && ro.disconnect && ro.disconnect(); } catch (_) {}
      };

      document.addEventListener('pointermove', move, { passive: false });
      document.addEventListener('pointerup', upOrCancel, { passive: false });
      document.addEventListener('pointercancel', upOrCancel, { passive: false });
      if (handleEl) handleEl.style.cursor = 'grabbing';

      // Observadores para cambios de layout/scroll mientras se arrastra
      startObservers();

      schedule();
    }

    function onWheel(e) {
      if (disabled) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -step : step; // rueda abajo => baja volumen
      setLinear(linear + delta);
    }

    function onDblClick() {
      if (disabled) return;
      if (audioEl.volume > 0.001) mute();
      else unmute();
    }

    function onKeyDown(e) {
      if (disabled) return;
      const { code } = e;
      if (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(code)) return;
      e.preventDefault();
      if (code === 'ArrowUp')   setLinear(linear + step);
      if (code === 'ArrowDown') setLinear(linear - step);
      if (code === 'PageUp')    setLinear(linear + step * 5);
      if (code === 'PageDown')  setLinear(linear - step * 5);
      if (code === 'Home')      setLinear(0);
      if (code === 'End')       setLinear(1);
    }

    on(bgEl, 'pointerdown', onPointerDown, { passive: false });
    on(bgEl, 'wheel',       onWheel,       { passive: false });
    on(bgEl, 'dblclick',    onDblClick,    { passive: true  });
    on(bgEl, 'keydown',     onKeyDown,     { passive: false });
    if (handleEl) on(handleEl, 'pointerdown', onPointerDown, { passive: false });

    // Init
    setLinear(linear); // aplica audio + agenda render
    bgEl.__volumeControl = { setVolume, getVolume, mute, unmute, setCurve, enable, disable, destroy };

    return bgEl.__volumeControl;
  }

  return initVolumeControl;
}));
