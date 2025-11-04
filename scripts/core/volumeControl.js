/*!
 * volumecontrol.js — Control de volumen independiente (UMD)
 * API: const vc = initVolumeControl({ audioEl, bgEl, barEl?, labelEl?, handleEl?, preserveGrab?, initial?, step?, curve? });
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.initVolumeControl = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const clamp = (v, a = 0, b = 1) => Math.min(Math.max(v, a), b);
  const defaultCurve = (x) => x ** 4; // perceptual

  function initVolumeControl({
    audioEl, bgEl, barEl = null, labelEl = null, handleEl = null,
    preserveGrab = false, initial = 0.9, step = 0.05, curve = defaultCurve
  } = {}) {
    if (!audioEl || !bgEl) throw new Error('initVolumeControl: faltan elementos requeridos (audioEl, bgEl).');

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

    const on = (el, type, fn, opts) => { el.addEventListener(type, fn, opts); unsubs.push(() => el.removeEventListener(type, fn, opts)); };

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

    if (handleEl) {
      handleEl.style.position = handleEl.style.position || 'absolute';
      handleEl.style.left = '50%';
      handleEl.style.transform = 'translate(-50%, -50%)';
      handleEl.style.touchAction = handleEl.style.touchAction || 'none';
      handleEl.style.cursor = handleEl.style.cursor || 'grab';
    }

    const tick = () => {
      rafId = null;
      if (isDragging && pendingY != null) {
        cachedRect = bgEl.getBoundingClientRect();
        const correctedY = pendingY - grabOffsetPx;
        const relY = clamp(correctedY - cachedRect.top, 0, cachedRect.height || 1);
        const newLinear = clamp(1 - (relY / (cachedRect.height || 1)));
        setLinear(newLinear, true, false);
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
    const applyAudio = () => { audioEl.volume = clamp(curve(linear), 0, 1); };

    function setLinear(v, skipSchedule = false, skipAudio = false) {
      const nv = clamp(Number(v) || 0);
      if (nv === linear && !isDragging) return linear;
      linear = nv;
      if (!skipAudio) applyAudio();
      if (!skipSchedule) schedule();
      try { bgEl.dispatchEvent(new CustomEvent('vc:change', { detail: { linear, volume: audioEl.volume } })); } catch {}
      return linear;
    }

    const setVolume = (v) => setLinear(v);
    const getVolume = () => linear;

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
      } else setLinear(Math.max(linear, 0.5));
      try { bgEl.dispatchEvent(new CustomEvent('vc:unmute')); } catch {}
    }
    function setCurve(fn) { if (typeof fn === 'function') { curve = fn; applyAudio(); schedule(); } }
    function enable() { disabled = false; bgEl.classList.remove('vc-disabled'); }
    function disable() { disabled = true;  bgEl.classList.add('vc-disabled'); }
    function destroy() {
      if (rafId) cancelAnimationFrame(rafId);
      pendingY = null; cachedRect = null; isDragging = false; activePointerId = null;
      while (unsubs.length) { try { unsubs.pop()(); } catch {} }
      try { ro && ro.disconnect && ro.disconnect(); } catch {}
      try { delete bgEl.__volumeControl; } catch {}
    }

    function computeGrabOffset(e) {
      if (handleEl && (e.target === handleEl || handleEl.contains(e.target))) {
        const hr = handleEl.getBoundingClientRect();
        return e.clientY - (hr.top + (hr.height || 0) / 2);
      }
      if (preserveGrab && handleEl) {
        cachedRect = cachedRect || bgEl.getBoundingClientRect();
        const expectedHandleCenterY = cachedRect.top + (cachedRect.height || 1) * (1 - linear);
        return e.clientY - expectedHandleCenterY;
      }
      return 0;
    }

    function startObservers() {
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(() => { if (isDragging) { cachedRect = bgEl.getBoundingClientRect(); schedule(); } });
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

      try { bgEl.setPointerCapture && bgEl.setPointerCapture(e.pointerId); } catch {}

      const move = (ev) => {
        if (!isDragging) return;
        if (activePointerId != null && ev.pointerId != null && ev.pointerId !== activePointerId) return;
        if (ev.cancelable) ev.preventDefault();
        pendingY = ev.clientY;
        schedule();
      };
      const upOrCancel = (ev) => {
        if (activePointerId != null && ev.pointerId != null && ev.pointerId !== activePointerId) return;
        isDragging = false; pendingY = null; cachedRect = null; grabOffsetPx = 0; activePointerId = null;
        try { bgEl.releasePointerCapture && bgEl.releasePointerCapture(ev.pointerId); } catch {}
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

    function onWheel(e) { if (!disabled) { e.preventDefault(); setLinear(linear + (e.deltaY > 0 ? -step : step)); } }
    function onDblClick() { if (!disabled) { if (audioEl.volume > 0.001) mute(); else unmute(); } }
    function onKeyDown(e) {
      if (disabled) return;
      const { code } = e;
      if (!['ArrowUp','ArrowDown','PageUp','PageDown','Home','End'].includes(code)) return;
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

    setLinear(linear);
    bgEl.__volumeControl = { setVolume, getVolume, mute, unmute, setCurve, enable, disable, destroy };
    return bgEl.__volumeControl;
  }

  return initVolumeControl;
}));
