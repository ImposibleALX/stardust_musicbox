/**
 * volumecontrol.js — Control de volumen optimizado
 *
 * Uso:
 *   const vc = initVolumeControl({
 *     audioEl: audioPlayer,
 *     bgEl: document.getElementById('volumeBarBg'),
 *     barEl: document.getElementById('volumeBar'),
 *     labelEl: document.getElementById('volumeValue'),
 *     handleEl: optionalHandleElement,
 *     preserveGrab: false, // true para mantener offset cuando agarras el handle
 *     initial: 0.9,
 *     step: 0.05,
 *     curve: (x) => x ** 4
 *   });
 *
 * Notas:
 * - Internamente usa requestAnimationFrame para las actualizaciones visuales (sin bloqueos).
 * - Reduce llamadas a getBoundingClientRect al mínimo (cache durante drag).
 */

(function (global) {
  'use strict';

  function clamp(v, a = 0, b = 1) { return Math.min(Math.max(v, a), b); }

  function defaultCurve(x) { return x ** 4; }

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

    // Estado interno
    const initialNumeric = Number(initial);
    let linear = clamp(Number.isFinite(initialNumeric) ? initialNumeric : 0.9);
    let cachedRect = null;           // bounding rect cache usado durante drag
    let isDragging = false;
    let pendingY = null;             // Y más reciente (viewport) recibido por pointermove
    let rafId = null;                // requestAnimationFrame id para UI
    let lastRendered = -1;           // evita renders redundantes
    let grabOffsetPx = 0;            // offset en px entre cursor y centro del handle
    let prevVolumeBeforeMute = null;
    let disabled = false;

    // Optimización: asegurar contenedor posicionable para handle absoluto
    const computed = window.getComputedStyle(bgEl);
    if (computed.position === 'static') bgEl.style.position = bgEl.style.position || 'relative';
    bgEl.style.touchAction = bgEl.style.touchAction || 'none'; // evita scroll táctil en bg

    // Prepara handle si existe (centro con transform)
    if (handleEl) {
      handleEl.style.position = handleEl.style.position || 'absolute';
      handleEl.style.left = '50%';
      handleEl.style.transform = 'translate(-50%, -50%)';
      handleEl.style.touchAction = handleEl.style.touchAction || 'none';
      // pointer cursor
      handleEl.style.cursor = handleEl.style.cursor || 'grab';
    }

    // Aplica volumen al audio con curva y actualiza UI (usando RAF)
    function applyVolumeToAudio() {
      audioEl.volume = clamp(curve(linear), 0, 1);
    }

    function scheduleRender() {
      if (rafId) return;
      rafId = requestAnimationFrame(renderUI);
    }

    function renderUI() {
      rafId = null;
      // redondeo a 2 decimales para evitar repaints innecesarios
      const percent = Math.round(linear * 100);
      if (lastRendered === percent) return;
      lastRendered = percent;

      // barra (height en porcentaje)
      barEl.style.height = `${percent}%`;
      // etiqueta porcentaje
      labelEl.textContent = `${percent}%`;

      // handle (posicion relativa por porcentaje para evitar layout thrash)
      if (handleEl) {
        // top en porcentaje relativo al contenedor (0% top, 100% bottom)
        const topPercent = (1 - linear) * 100;
        handleEl.style.top = `${topPercent}%`;
      }
    }

    function setLinearValue(v, { skipAudio = false } = {}) {
      const numeric = Number(v);
      linear = clamp(Number.isFinite(numeric) ? numeric : 0);
      if (!skipAudio) applyVolumeToAudio();
      scheduleRender();
      return linear;
    }

    function setVolume(linearValue) {
      return setLinearValue(linearValue, { skipAudio: false });
    }

    function getVolume() { return linear; }

    // Convertir clientY -> linear usando rect (top..height)
    function clientYToLinear(clientY) {
      if (!cachedRect) cachedRect = bgEl.getBoundingClientRect();
      const relY = clamp(clientY - cachedRect.top, 0, cachedRect.height);
      const newLinear = 1 - (relY / (cachedRect.height || 1));
      return clamp(newLinear);
    }

    // Establecer desde Y, respectando grabOffsetPx si aplica
    function setVolumeFromClientY(clientY) {
      const correctedY = clientY - grabOffsetPx;
      const newLinear = clientYToLinear(correctedY);
      setVolume(newLinear);
    }

    // MOUSE / TOUCH / POINTER unified handlers
    function onPointerDown(e) {
      if (disabled) return;
      // sólo botón primario o touch
      if (e.button && e.button !== 0) return;
      e.preventDefault();
      isDragging = true;
      cachedRect = bgEl.getBoundingClientRect();

      // calcular grabOffset en px si preserveGrab: diferencia entre cursor y centro del handle
      if (preserveGrab && handleEl) {
        const handleCenterY = cachedRect.top + cachedRect.height * (1 - linear);
        grabOffsetPx = e.clientY - handleCenterY;
      } else {
        grabOffsetPx = 0;
      }

      // intentar capturar pointer para seguir el movimiento fuera del bg
      try { e.target.setPointerCapture?.(e.pointerId); } catch (err) {}
      // primera posición
      setVolumeFromClientY(e.clientY);
      // registrar listeners a nivel documento (para capturar fuera del elemento)
      document.addEventListener('pointermove', onPointerMove, { passive: false });
      document.addEventListener('pointerup', onPointerUp, { passive: false });
      // cambiar cursor del handle si existe
      if (handleEl) handleEl.style.cursor = 'grabbing';
    }

    function onPointerMove(e) {
      if (!isDragging) return;
      if (e.cancelable) e.preventDefault();
      // throttle: guardar último Y y procesarlo en RAF
      pendingY = e.clientY;
      scheduleDragProcess();
    }

    function onPointerUp(e) {
      if (!isDragging) return;
      isDragging = false;
      pendingY = null;
      cachedRect = null;
      grabOffsetPx = 0;

      // release pointer capture
      try { e.target.releasePointerCapture?.(e.pointerId); } catch (err) {}
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      if (handleEl) handleEl.style.cursor = 'grab';
    }

    // Procesa drag en RAF (evita flood de events)
    let dragRaf = null;
    function scheduleDragProcess() {
      if (dragRaf) return;
      dragRaf = requestAnimationFrame(() => {
        dragRaf = null;
        if (pendingY == null) return;
        setVolumeFromClientY(pendingY);
      });
    }

    // Rueda del ratón para ajustar en pasos
    function onWheel(e) {
      if (disabled) return;
      e.preventDefault();
      cachedRect = bgEl.getBoundingClientRect(); // rect necesario si queremos posicion relativa en futuro
      const delta = e.deltaY > 0 ? -step : step;
      setVolume(linear + delta);
    }

    // Doble click para MUTE / UNMUTE
    function onDblClick(e) {
      if (disabled) return;
      if (audioEl.volume > 0.001) {
        prevVolumeBeforeMute = linear;
        setVolume(0);
      } else if (prevVolumeBeforeMute != null) {
        setVolume(prevVolumeBeforeMute);
        prevVolumeBeforeMute = null;
      } else {
        setVolume(0.9);
      }
    }

    // Keybindings para accesibilidad cuando bg tiene tabindex
    function onKeyDown(e) {
      if (disabled) return;
      const code = e.code;
      if (!['ArrowUp','ArrowDown','PageUp','PageDown','Home','End'].includes(code)) return;
      e.preventDefault();
      if (code === 'ArrowUp') setVolume(linear + step);
      if (code === 'ArrowDown') setVolume(linear - step);
      if (code === 'PageUp') setVolume(linear + (step * 5));
      if (code === 'PageDown') setVolume(linear - (step * 5));
      if (code === 'Home') setVolume(0);
      if (code === 'End') setVolume(1);
    }

    // API pública adicional
    function mute() {
      if (audioEl.volume > 0.001) {
        prevVolumeBeforeMute = linear;
        setVolume(0);
      }
    }
    function unmute() {
      if (prevVolumeBeforeMute != null) {
        setVolume(prevVolumeBeforeMute);
        prevVolumeBeforeMute = null;
      } else {
        setVolume(Math.max(linear, 0.5));
      }
    }

    function setCurve(fn) {
      if (typeof fn === 'function') {
        curve = fn;
        applyVolumeToAudio();
        scheduleRender();
      }
    }

    function enable() { disabled = false; bgEl.classList.remove('vc-disabled'); }
    function disable() { disabled = true; bgEl.classList.add('vc-disabled'); }

    function destroy() {
      cancelAnimationFrame(rafId); rafId = null;
      cancelAnimationFrame(dragRaf); dragRaf = null;
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      bgEl.removeEventListener('pointerdown', onPointerDown);
      bgEl.removeEventListener('wheel', onWheel);
      bgEl.removeEventListener('dblclick', onDblClick);
      bgEl.removeEventListener('keydown', onKeyDown);
      if (handleEl) {
        handleEl.removeEventListener('pointerdown', onPointerDown);
      }
      // no tocamos el audioEl event listeners externos
    }

    // Init: attach listeners
    bgEl.addEventListener('pointerdown', onPointerDown, { passive: false });
    bgEl.addEventListener('wheel', onWheel, { passive: false });
    bgEl.addEventListener('dblclick', onDblClick, { passive: true });
    bgEl.addEventListener('keydown', onKeyDown, { passive: false });

    // Si hay handle, permitir arrastrarlo (delegar down en handle también)
    if (handleEl) handleEl.addEventListener('pointerdown', onPointerDown, { passive: false });

    // Hacer bg focusable para recibir key events si no lo es
    if (!bgEl.hasAttribute('tabindex')) bgEl.setAttribute('tabindex', '0');

    // Inicializar UI y audio
    setLinearValue(linear);
    applyVolumeToAudio();

    // Exponer instancia
    const instance = {
      setVolume,
      getVolume,
      mute,
      unmute,
      setCurve,
      enable,
      disable,
      destroy
    };

    // también guardarla en el elemento DOM para debugging (opcional)
    try { bgEl.__volumeControl = instance; } catch (e) {}

    return instance;
  }

  // Exportar a window
  if (!global.initVolumeControl) global.initVolumeControl = initVolumeControl;

})(window);
