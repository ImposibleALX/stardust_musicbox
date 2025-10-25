(function (global) {
  'use strict';

  function normalizePath(value) {
    if (!value) return value;
    return value.endsWith('/') ? value : `${value}/`;
  }

  function mergeDisplayNames(next = {}) {
    const current = global.FACTION_DISPLAY_NAMES || {};
    global.FACTION_DISPLAY_NAMES = { ...current, ...next };
  }

  function updateManualLink(href) {
    if (!href) return;
    const anchor = global.document && global.document.querySelector('.manual-btn-topright');
    if (anchor) anchor.href = href;
  }

  function configureFactionPage(options = {}) {
    const {
      catalogBasePath,
      audioBasePath,
      imageBasePath,
      displayNames,
      manualHref,
      pageTitle
    } = options;

    if (catalogBasePath) {
      global.CATALOG_BASE_PATH = normalizePath(catalogBasePath);
    }
    if (audioBasePath) {
      global.AUDIO_BASE_PATH = normalizePath(audioBasePath);
    }
    if (imageBasePath) {
      global.IMAGE_BASE_PATH = normalizePath(imageBasePath);
    }
    if (displayNames) {
      mergeDisplayNames(displayNames);
    }
    if (manualHref) {
      updateManualLink(manualHref);
    }
    if (pageTitle && global.document) {
      global.document.title = pageTitle;
    }
  }

  global.configureFactionPage = configureFactionPage;
})(window);