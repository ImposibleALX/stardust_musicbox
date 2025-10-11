/* evangelion.js
 * Inicializador específico para la vista de Evangelion.
 * - Sustituye los manejadores inline por delegación de eventos.
 * - Añade comprobaciones defensivas y mensajes de error útiles.
 * - Mantiene sincronizado el estado aria-pressed para accesibilidad.
 */
(function evangelionBootstrap(doc, win) {
  'use strict';

  if (!doc || !win) {
    console.error('evangelion.js: Document or window is not available.');
    return;
  }

  const SAFE_GLOBAL = win;

  function warnUnavailable(action) {
    console.warn(`evangelion.js: Acción "${action}" no disponible en este contexto.`);
  }

  function callPlayFaction(faction) {
    if (typeof SAFE_GLOBAL.playFaction !== 'function') {
      warnUnavailable('playFaction');
      return false;
    }
    try {
      SAFE_GLOBAL.playFaction(faction);
      return true;
    } catch (error) {
      console.error('evangelion.js: Error al invocar playFaction', error);
      return false;
    }
  }

  function callPlayNoFactions() {
    if (typeof SAFE_GLOBAL.playNoFactions !== 'function') {
      warnUnavailable('playNoFactions');
      return false;
    }
    try {
      SAFE_GLOBAL.playNoFactions();
      return true;
    } catch (error) {
      console.error('evangelion.js: Error al invocar playNoFactions', error);
      return false;
    }
  }

  function setActiveButton(newButton, container) {
    const buttons = container.querySelectorAll('button[aria-pressed]');
    buttons.forEach(btn => {
      btn.setAttribute('aria-pressed', String(btn === newButton));
      btn.classList.toggle('is-active', btn === newButton);
    });
  }

  function handleClick(event, container) {
    const target = event.target.closest('button[data-faction], button[data-action]');
    if (!target || !container.contains(target)) return;

    const { faction, action } = target.dataset;

    let performed = false;
    if (action === 'no-factions') {
      performed = callPlayNoFactions();
      if (performed) {
        setActiveButton(null, container);
      }
      return;
    }

    if (!faction) {
      console.warn('evangelion.js: Botón sin data-faction ni data-action detectado.');
      return;
    }

    performed = callPlayFaction(faction);
    if (performed) {
      setActiveButton(target, container);
    }
  }

  function init() {
    const container = doc.querySelector('.faction-buttons');
    if (!container) {
      console.warn('evangelion.js: No se encontró el contenedor de facciones.');
      return;
    }

    const buttons = container.querySelectorAll('button');
    if (!buttons.length) {
      console.warn('evangelion.js: No hay botones de facción disponibles.');
      return;
    }

    container.addEventListener('click', (event) => {
      try {
        handleClick(event, container);
      } catch (error) {
        console.error('evangelion.js: Error inesperado procesando un clic', error);
      }
    });

    // Previene que la vista quede con un botón marcado por defecto.
    setActiveButton(null, container);
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

})(document, typeof window !== 'undefined' ? window : undefined);
