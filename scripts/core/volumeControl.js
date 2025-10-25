/**
 * volumecontrol.min.js — Control de volumen simplificado y optimizado
 *
 * Uso:
 * const vc = initVolumeControl({
 *   audioEl,
 *   bgEl,
 *   barEl,
 *   labelEl,
 *   handleEl,            // opcional
 *   preserveGrab: false, // true = respeta el offset del cursor al agarrar el handle
 *   initial: 0.9,
 *   step: 0.05,
 *   curve: (x) => x ** 4  // curva perceptual
 * });
 */
(function (global) {
  'use strict';

  const clamp = (v, a = 0, b = 1) => Math.min(Math.max(v, a), b);
  const defaultCurve = (x) => x ** 4;

  function initVolumeControl({
    audioEl,
    bgEl,
    barEl,
    labelEl,
    handleEl = null,
    preserveGrab = false,
    initial = 0.9,
    step = 0.05,
    curve = defaultCurve
  } = {}) {
    if (!audioEl || !bgEl || !barEl || !labelEl) {
      throw new Error('initVolumeControl: faltan elementos requeridos (audioEl, bgEl, barEl, labelEl).');
    }

    // Estado mínimo
    let linear = clamp(Number(initial) || 0.9);
    let isDragging = false;
    let pendingY = null;       // último Y recibido (viewport)
    let rafId = null;          // único RAF para drag + render
    let cachedRect = null;     // rect del BG cacheado durante drag
    let grabOffsetPx = 0;      // offset cursor/handle cuando preserveGrab = true
    let lastPercent = -1;      // evita renders idénticos
    let prevVolumeBeforeMute = null;
    let disabled = false;
    const unsubs = [];

    // Helpers de eventos (para destroy limpio)
    const on = (el, type, fn, opts) => {
      el.addEventListener(type, fn, opts);
      unsubs.push(() => el.removeEventListener(type, fn, opts));
    };

    // Preparar estilos mínimos (sin forzar layout)
    const st = window.getComputedStyle(bgEl);
    if (st.position === 'static') bgEl.style.position = bgEl.style.position || 'relative';
    bgEl.style.touchAction = bgEl.style.touchAction || 'none';
    if (!bgEl.hasAttribute('tabindex')) bgEl.setAttribute('tabindex', '0');

    if (handleEl) {
      handleEl.style.position = handleEl.style.position || 'absolute';
      handleEl.style.left = '50%';
      handleEl.style.transform = 'translate(-50%, -50%)';
      handleEl.style.touchAction = handleEl.style.touchAction || 'none';
      handleEl.style.cursor = handleEl.style.cursor || 'grab';
    }

    // —— Núcleo: único bucle RAF para procesar drag y render —— //
    const tick = () => {
      rafId = null;

      if (isDragging && pendingY != null) {
        // Solo leemos el rect al iniciar el drag (o si no existe)
        if (!cachedRect) cachedRect = bgEl.getBoundingClientRect();
        const correctedY = pendingY - grabOffsetPx;
        const relY = clamp(correctedY - cachedRect.top, 0, cachedRect.height || 1);
        const newLinear = clamp(1 - (relY / (cachedRect.height || 1)));
        if (newLinear !== linear) setLinear(newLinear, /*skipSchedule*/ true, /*skipAudio*/ false);
      }

      // Render UI solo si cambia el % visible
      const percent = Math.round(linear * 100);
      if (percent !== lastPercent) {
        lastPercent = percent;
        barEl.style.height = percent + '%';
        labelEl.textContent = percent + '%';
        if (handleEl) handleEl.style.top = (100 - percent) + '%';
      }
    };

    const schedule = () => { if (!rafId) rafId = requestAnimationFrame(tick); };

    // Aplicar volumen real (curva perceptual -> volumen 0..1)
    const applyAudio = () => { audioEl.volume = clamp(curve(linear), 0, 1); };

    // Setter único (con opciones internas para evitar RAF redundantes)
    function setLinear(v, skipSchedule = false, skipAudio = false) {
      const nv = clamp(Number(v) || 0);
      if (nv === linear && !isDragging) return linear;
      linear = nv;
      if (!skipAudio) applyAudio();
      if (!skipSchedule) schedule();
      return linear;
    }

    // API pública (compatible)
    const setVolume = (v) => setLinear(v);
    const getVolume = () => linear;

    function mute() {
      if (audioEl.volume > 0.001) {
        prevVolumeBeforeMute = linear;
        setLinear(0);
      }
    }

    function unmute() {
      if (prevVolumeBeforeMute != null) {
        setLinear(prevVolumeBeforeMute);
        prevVolumeBeforeMute = null;
      } else {
        setLinear(Math.max(linear, 0.5));
      }
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
      while (unsubs.length) { try { unsubs.pop()(); } catch (_) {} }
      try { delete bgEl.__volumeControl; } catch (_) {}
    }

    // —— Eventos —— //
    function onPointerDown(e) {
      if (disabled) return;
      if (e.button && e.button !== 0) return;
      e.preventDefault();
      isDragging = true;
      cachedRect = bgEl.getBoundingClientRect();

      if (preserveGrab && handleEl) {
        const handleCenterY = cachedRect.top + cachedRect.height * (1 - linear);
        grabOffsetPx = e.clientY - handleCenterY;
      } else {
        grabOffsetPx = 0;
      }

      pendingY = e.clientY;
      e.target.setPointerCapture?.(e.pointerId);

      // Listeners a nivel documento para seguir el drag fuera del BG
      const move = (ev) => { if (ev.cancelable) ev.preventDefault(); pendingY = ev.clientY; schedule(); };
      const up = (ev) => {
        isDragging = false;
        pendingY = null;
        cachedRect = null;
        grabOffsetPx = 0;
        ev.target.releasePointerCapture?.(ev.pointerId);
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        if (handleEl) handleEl.style.cursor = 'grab';
      };
      document.addEventListener('pointermove', move, { passive: false });
      document.addEventListener('pointerup', up, { passive: false });
      if (handleEl) handleEl.style.cursor = 'grabbing';
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

    // Retornar instancia pública
    return bgEl.__volumeControl;
  }

  if (!global.initVolumeControl) global.initVolumeControl = initVolumeControl;
})(window);
