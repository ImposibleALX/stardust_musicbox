// —— Helpers —— //
function createElement(tag, { className, text, html, ...attrs } = {}) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  if (html) el.innerHTML = html;
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}
function formatTime(seconds = 0) {
  seconds = Math.round(seconds);
  const m = String(Math.floor(seconds / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}
function waitForCanPlay(audio) {
  return new Promise(resolve => {
    if (audio.readyState >= 3) return resolve();
    const handler = () => { audio.removeEventListener('canplaythrough', handler); resolve(); };
    audio.addEventListener('canplaythrough', handler, { once: true });
  });
}
function debounce(fn, delay = 300) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}
function normalizeString(str = '') {
  return String(str).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Infer basic image mime type from file extension (used for Media Session artwork)
function getImageMimeType(url = '') {
  const ext = url.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return undefined;
}

// —— Estado —— //
let catalog = [];
let playQueue = []; // fuente única de verdad para la playlist
let currentIndexInQueue = 0;
let currentlyPlayingCatalogIndex = -1;
let isLooping = false;
let animationFrameId_timer;

// *** OPTIMIZACIÓN ***
// Este Set mantiene un caché de los índices en la playlist.
// Se actualiza solo en updateQueue() y removeFromQueueByCatalogIndex().
let reservedIndexSet = new Set();
// La función original (abajo) leía el DOM CIENTOS de veces.
// function getReservedCatalogIndexSet_OLD() {
//   return new Set(Array.from(secondList?.children || []).map(li => Number(li.dataset.catalogIndex)).filter(Number.isFinite));
// }
function getReservedCatalogIndexSet() {
  return reservedIndexSet;
}


const variantManager = typeof createVariantManager === 'function' ? createVariantManager() : null;

function ensureTrailingSlash(path) {
  if (!path) return '';
  return path.endsWith('/') ? path : `${path}/`;
}

const imageBaseURL = (window.IMAGE_BASE_PATH || '../assets/images');
const musicBaseURL = ensureTrailingSlash(window.AUDIO_BASE_PATH || '../assets/music/');
const catalogBaseURL = ensureTrailingSlash(window.CATALOG_BASE_PATH || '../assets/catalogs/');
const baseURL = imageBaseURL.replace(/\/$/, '');
const dataURL = `${catalogBaseURL}music_catalog_all.json`;
const variantDataURL = `${catalogBaseURL}variant_groups.json`;

// Facciones (sin duplicados)
const factionDisplayNames = {
  bolar: "Bolar Federation", dezariam: "Dezariam Nation", gamilas: "Greater Garmillan Empire",
  gatlantis: "White Comet / Gatlantis Empire", uncf: "United Nations Cosmo Force",
  arcadia: "Captain Harlock's Arcadia", dinguil: "Dinguil Empire", various: "THE EXPANSE",
  guia: "Great Urup Interstellar Alliance", cis: "Confederacy of Independent Systems",
  empire: "Galactic Empire", republic: "Galactic Republic", jedi: "Jedi Order",
  atlantis: "ATLANTIS w/ Humans", neoatlantis: "NEO ATLANTIS", rebel: "Rebel Alliance",
  unn: "United Nations Navy", mcrn: "Martian Republic Navy", opa: "Outer Planets Alliance",
  fn: "Free Navy", zentradi: "Zentradi", uns: "United Nations Spacy"
};
const factionLogos = {
  bolar: `${baseURL}/mini_logos/bolar_logo.png`,
  dezariam: `${baseURL}/mini_logos/dezariam_logo.png`,
  gamilas: `${baseURL}/logos/gamilas_logo.webp`,
  gatlantis: `${baseURL}/mini_logos/gatlantis_logo.webp`,
  uncf: `${baseURL}/mini_logos/uncf_logo.png`,
  arcadia: `${baseURL}/logos/arcadia_logo.png`,
  dinguil: `${baseURL}/logos/dinguil_logo.png`,
  guia: `${baseURL}/mini_logos/guia_logo.webp`,
  cis: `${baseURL}/mini_logos/cis_logo.png`,
  empire: `${baseURL}/mini_logos/galactic_empire_logo.png`,
  republic: `${baseURL}/mini_logos/galactic_republic_logo.png`,
  atlantis: `${baseURL}/mini_logos/atlantis_logo.png`,
  neoatlantis: `${baseURL}/mini_logos/neoatlantis_logo.png`,
  rebel: `${baseURL}/logos/rebel_logo.png`,
  unn: `${baseURL}/mini_logos/unn_logo.png`,
  mcrn: `${baseURL}/mini_logos/mcrn_logo.png`,
  opa: `${baseURL}/mini_logos/opa_logo.png`,
  fn: `${baseURL}/mini_logos/fn_logo.png`,
  zentradi: `${baseURL}/mini_logos/zentradi_logo.png`,
  uns: `${baseURL}/mini_logos/uns_logo.png`
};
const factionGroups = {
  sby: ['uncf','bolar','gamilas','gatlantis','dinguil','dezariam','guia'],
  expanse: ['mcrn','opa','fn','unn'],
  nadia: ['neoatlantis','atlantis'],
  starwars: ['republic','empire','rebel','cis'],
  macross: ['uns','zentradi']
};

// —— Rotadores de logos —— //
function createPlayerLogoRotator(imageElement) {
  let timerId = null;
  const stop = () => { if (timerId) clearInterval(timerId); if (imageElement) imageElement.src = ''; timerId = null; };
  const start = (track) => {
    stop();
    if (!imageElement) return;
    const factions = track?.factions || [];
    if (factions.length < 2) {
      const k = factions.length === 1 ? factions[0] : null;
      imageElement.src = k ? (factionLogos[k] || '') : '';
      imageElement.alt = k ? (factionDisplayNames[k] || k) : '';
      return;
    }
    let i = 0;
    const rotate = () => {
      const key = factions[i % factions.length];
      if (factionLogos[key]) {
        imageElement.src = factionLogos[key];
        imageElement.alt = factionDisplayNames[key] || key;
      }
      i++;
    };
    rotate();
    timerId = setInterval(rotate, 4000);
  };
  return { start, stop };
}
function createListLogoManager() {
  let animationFrameId = null, lastTick = 0, interval = 3000, tick = 0;
  const visibleRotators = new Set();
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        visibleRotators.add(e.target);
      } else {
        visibleRotators.delete(e.target);
      }
    });
  }, { root: null, threshold: 0.1 });

  function rotateLoop(ts) {
    if (!lastTick) lastTick = ts;
    const elapsed = ts - lastTick;
    if (elapsed >= interval) {
      lastTick = ts; tick++;
      if (visibleRotators.size > 0) {
        visibleRotators.forEach(img => {
          const factions = (img.dataset.factions || '').split(',').filter(Boolean);
          if (factions.length === 0) return;
          const current = factions[tick % factions.length];
          const src = factionLogos[current];
          if (src && img.src !== src) {
            img.src = src;
            img.alt = factionDisplayNames[current] || current;
          }
        });
      }
    }
    if (visibleRotators.size > 0) {
      animationFrameId = requestAnimationFrame(rotateLoop);
    } else {
      animationFrameId = null;
    }
  }
  return {
    observe: (img) => {
      observer.observe(img);
      if (!animationFrameId && visibleRotators.size > 0) {
        requestAnimationFrame(rotateLoop);
      }
    },
    start: () => { if (!animationFrameId && visibleRotators.size > 0) requestAnimationFrame(rotateLoop); }
  };
}

// —— App —— //
document.addEventListener('DOMContentLoaded', () => {

  // 1. OBTENER ELEMENTOS DEL DOM
  const {
    audioPlayer, trackName, factionName, timeDisplay, btnPlayPause, imgPlayPause,
    btnLoop, imgLoop, allTracksList, secondList, volumeSliderContainer, volumeValue, volumeBar
  } = ['audioPlayer', 'trackName', 'factionName', 'timeDisplay', 'btnPlayPause', 'imgPlayPause', 'btnLoop', 'imgLoop', 'allTracksList', 'secondList', 'volumeSliderContainer', 'volumeValue', 'volumeBar']
    .reduce((o, id) => (o[id] = document.getElementById(id), o), {});

  // 2. INSTANCIAR GESTORES Y PRECARGADOR
  const playerLogoRotator = createPlayerLogoRotator(document.querySelector('.faction-section img'));
  const listLogoManager = createListLogoManager();

  // Preloader muy ligero
  const preloader = {
    element: document.createElement('audio'),
    init() { this.element.preload = 'metadata'; },
    preload(track) {
      if (!track) return;
      const filePath = `${musicBaseURL}${track.folder}/${track.file}`;
      if (this.element.src !== filePath) {
        this.element.src = filePath;
        this.element.load();
      }
    }
  };
  preloader.init();

  // —— Media Session (móvil pro) —— //
  function updateMediaSession(track) {
    if (!('mediaSession' in navigator) || !track) return;
    const factions = track.factions || [];
    const artKey = factions[0];
    const artSrc = artKey && factionLogos[artKey] ? factionLogos[artKey] : undefined;
    const mime = artSrc ? getImageMimeType(artSrc) : undefined;
    const artwork = artSrc ? [{ src: artSrc, sizes: '96x96', type: mime }].filter(Boolean) : [];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.titles?.en || 'Unknown Title',
      artist: (factions.map(f => factionDisplayNames[f] || f)).join(', ') || 'Unknown',
      album: 'Stardust Music Box',
      artwork
    });
  }
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => { audioPlayer.play(); });
    navigator.mediaSession.setActionHandler('pause', () => { audioPlayer.pause(); });
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      if (playQueue.length === 0) return;
      currentIndexInQueue = (currentIndexInQueue - 1 + playQueue.length) % playQueue.length;
      playSingleTrackByIndex(playQueue[currentIndexInQueue]);
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      if (playQueue.length === 0) return;
      currentIndexInQueue = (currentIndexInQueue + 1) % playQueue.length;
      playSingleTrackByIndex(playQueue[currentIndexInQueue]);
    });
  }

  // —— Funciones principales —— //
  async function playSingleTrackByIndex(catalogIndex, offset = 0) {
    const track = catalog[catalogIndex];
    if (!track || !track.file || !track.folder || typeof track.duration !== 'number') {
      console.error(`Skipping malformed track at index ${catalogIndex}:`, track);
      if (playQueue.length > 1) {
        currentIndexInQueue = (currentIndexInQueue + 1) % playQueue.length;
        playSingleTrackByIndex(playQueue[currentIndexInQueue]);
      } else {
        stopPlaybackAndResetUI();
      }
      return;
    }

    currentlyPlayingCatalogIndex = catalogIndex;
    currentIndexInQueue = playQueue.indexOf(catalogIndex);

    const filePath = `${musicBaseURL}${track.folder}/${track.file}`;
    if (audioPlayer.src !== filePath) {
      audioPlayer.src = filePath;
      audioPlayer.load();
    }

    try {
      await waitForCanPlay(audioPlayer);
      audioPlayer.currentTime = offset;
      await audioPlayer.play();
    } catch (err) {
      if (err?.name !== 'AbortError') console.error('Playback error:', err);
    }

    trackName.textContent = track.titles?.en?.trim() || 'Unknown Title';
    const factionsText = (track.factions || []).map(f => factionDisplayNames[f] || f).join(', ');
    factionName.textContent = `Factions: ${factionsText || 'Unknown'}`;

    playerLogoRotator.start(track);
    updateMediaSession(track);
    updateActiveTrackVisuals();
  }

  function createBaseListItem(track, {
    catalogIndex,
    searchTokens,
    classNames = [],
    groupId,
    draggable = true
  } = {}) {
    if (typeof catalogIndex !== 'number') return null;
    const safeTrack = track || {}; // Safety for allReserved case
    const attrs = { 'data-catalog-index': catalogIndex };
    if (draggable) attrs.draggable = 'true';
    const li = createElement('li', attrs);
    if (Array.isArray(classNames) && classNames.length > 0) {
      li.classList.add(...classNames);
    }
    if (groupId) li.dataset.groupId = groupId;
    if (searchTokens) li.dataset.searchTokens = searchTokens;

    const titleSpan = createElement('span', { className: 'track-title' });
    const durationSpan = createElement('span', { className: 'track-duration', text: formatTime(safeTrack.duration || 0) });
    const factionSpan = createElement('span', { className: 'track-faction' });
    const factions = Array.isArray(safeTrack.factions) ? safeTrack.factions : [];
    if (factions.length > 0) {
      const img = createElement('img', {
        src: factionLogos[factions[0]] || '',
        alt: factionDisplayNames[factions[0]] || factions[0] || '',
        title: factionDisplayNames[factions[0]] || factions[0] || '',
        loading: 'lazy',
        decoding: 'async'
      });
      if (factions.length > 1) {
        img.dataset.factions = factions.join(',');
        listLogoManager.observe(img);
      }
      factionSpan.appendChild(img);
    }

    li.append(titleSpan, durationSpan, factionSpan);
    return { li, titleSpan };
  }

  function createSingleLibraryItem(catalogIndex) {
    const track = catalog[catalogIndex];
    if (!track) return null;
    const searchTokens = track._normalizedTitle || normalizeString(track.titles?.en || '').toLowerCase();
    const base = createBaseListItem(track, { catalogIndex, searchTokens });
    if (!base) return null;
    base.titleSpan.textContent = track.titles?.en?.trim() || 'Unknown Title';
    return base.li;
  }

  function createGroupListItem(group) {
    const reserved = getReservedCatalogIndexSet(); // Ahora usa el Set cacheado
    if (!group || !Array.isArray(group.variants) || group.variants.length === 0) return null;
    let activeVariant = group.variants[group.activeIndex || 0];
    if (!activeVariant) return null;

    // If activeVariant is already queued, advance to the next available (wrap), skipping reserved ones
    if (activeVariant && reserved.has(activeVariant.catalogIndex)) {
      const total = group.variants.length;
      let hops = 0;
      while (hops < total && (reserved.has(activeVariant.catalogIndex))) {
        // try to use variantManager step to keep state consistent, else manual rotate
        if (typeof variantManager?.stepActiveVariant === 'function') {
          variantManager.stepActiveVariant(group.groupId, +1);
          const updatedGroup = variantManager.getGroup(group.groupId); // Re-fetch group state
          activeVariant = updatedGroup.variants[updatedGroup.activeIndex];
        } else {
          const nextIdx = ((group.activeIndex || 0) + 1) % total;
          group.activeIndex = nextIdx;
          activeVariant = group.variants[nextIdx];
        }
        hops++;
      }
    }

    // If still reserved (i.e., all variants are reserved), mark as unavailable
    const allReserved = group.variants.every(v => reserved.has(v.catalogIndex));
    const activeCatalogIndex = activeVariant.catalogIndex;
    const track = !allReserved ? catalog[activeCatalogIndex] : null;
    
    // Use the *first* variant's track for metadata if the active one isn't valid
    const displayTrack = track || catalog[group.variants[0].catalogIndex];

    const tokenSet = new Set();
    if (group.title) tokenSet.add(normalizeString(group.title).toLowerCase());
    group.variants.forEach(variant => {
      if (variant.normalizedLabel) tokenSet.add(variant.normalizedLabel);
      else if (variant.variantLabel) tokenSet.add(normalizeString(variant.variantLabel).toLowerCase());
      const variantTrack = catalog[variant.catalogIndex];
      if (variantTrack && typeof variantTrack._normalizedTitle === 'string') {
        tokenSet.add(variantTrack._normalizedTitle);
      }
    });
    const searchTokens = Array.from(tokenSet).filter(Boolean).join(' ');

    const base = createBaseListItem(displayTrack, { // Usa displayTrack
      catalogIndex: activeCatalogIndex,
      searchTokens,
      classNames: ['has-variants' + (allReserved ? ' variants-depleted' : '')],
      groupId: group.groupId,
      draggable: !allReserved
    });
    if (!base) return null;

    const baseTitle = group.title || (displayTrack?.titles?.en?.trim() || 'Unknown Title');
    const mainTitle = createElement('span', { className: 'track-main-title', text: baseTitle });
    const controls = createElement('div', { className: 'variant-controls' });

    const prevBtn = createElement('button', {
      className: 'variant-btn prev',
      type: 'button',
      title: 'Previous version',
      'aria-label': 'Previous version'
    });
    prevBtn.textContent = '◀';

    const label = createElement('span', {
      className: 'variant-label',
      text: allReserved ? 'All queued' : (activeVariant.variantLabel || 'Original')
    });

    const nextBtn = createElement('button', {
      className: 'variant-btn next',
      type: 'button',
      title: 'Next version',
      'aria-label': 'Next version'
    });
    nextBtn.textContent = '▶';

    controls.append(prevBtn, label, nextBtn);
    if (allReserved) { prevBtn.disabled = true; nextBtn.disabled = true; }
    base.titleSpan.append(mainTitle, controls);

    // Pass the element itself (base.li) to the handler
    const attachHandler = (delta, focusSide) => (event) => {
      event.preventDefault();
      event.stopPropagation();
      handleVariantToggle(group.groupId, delta, focusSide, base.li);
    };

    prevBtn.addEventListener('click', attachHandler(-1, 'prev'));
    nextBtn.addEventListener('click', attachHandler(1, 'next'));

    return base.li;
  }

  function createPlaylistItem(catalogIndex) {
    const track = catalog[catalogIndex];
    if (!track) return null;
    const base = createBaseListItem(track, { catalogIndex, draggable: false }); // Draggable false en playlist
    if (!base) return null;
        // Variant label intentionally NOT appended to playlist title
    const titleText = track.titles?.en?.trim() || 'Unknown Title';

        base.titleSpan.textContent = titleText;
    return base.li;
  }
  function getLibraryEntries() {
    if (variantManager) {
      const entries = variantManager.getLibraryEntries();
      if (entries.length > 0) return entries;
    }
    return catalog.map((_, index) => ({ type: 'single', catalogIndex: index }));
  }

  function renderLibrary() {
    if (!allTracksList) return;
    const frag = document.createDocumentFragment();
    const entries = getLibraryEntries();
    entries.forEach(entry => {
      let node = null;
      if (entry.type === 'group' && variantManager) {
        const group = variantManager.getGroup(entry.groupId);
        if (group) node = createGroupListItem(group);
      } else if (entry.type === 'single') {
        node = createSingleLibraryItem(entry.catalogIndex);
      }
      if (node) frag.appendChild(node);
    });
    allTracksList.replaceChildren(frag);
    updateActiveTrackVisuals();
  }

  function renderPlaylist() {
    if (!secondList) return;
    const frag = document.createDocumentFragment();
    playQueue.forEach(index => {
      const node = createPlaylistItem(index);
      if (node) frag.appendChild(node);
    });
    secondList.replaceChildren(frag);
    updateActiveTrackVisuals();
  }

  // Accept 'currentNode' as the element to be replaced
  function handleVariantToggle(groupId, delta, focusSide = 'next', currentNode) {
    if (!variantManager || !allTracksList || !currentNode) return; // Check for currentNode

    let group = variantManager.stepActiveVariant(groupId, delta);
    if (!group) return;

    // Ensure new active variant is not already queued; if it is, keep stepping until free or full loop
    const reserved = getReservedCatalogIndexSet(); // Ahora usa el Set cacheado
    if (Array.isArray(group.variants)) {
      const total = group.variants.length;
      let hops = 0;
      let activeIdx = group.activeIndex || 0;
      
      while (hops < total && reserved.has(group.variants[activeIdx].catalogIndex)) {
        group = variantManager.stepActiveVariant(groupId, delta);
        if (!group) return; // Should not happen, but safety
        activeIdx = group.activeIndex || 0;
        hops++;
      }
    }

    const replacement = createGroupListItem(group);
    if (!replacement) return;
    
    // Use 'currentNode' from the argument
    allTracksList.replaceChild(replacement, currentNode); 
    
    const selector = focusSide === 'prev' ? '.variant-btn.prev' : '.variant-btn.next';
    const focusTarget = replacement.querySelector(selector);
    if (focusTarget) focusTarget.focus();
  }

  function stopPlaybackAndResetUI() {
    audioPlayer.pause();
    audioPlayer.src = '';
    currentlyPlayingCatalogIndex = -1;
    trackName.textContent = "Drag & drop your favourite tracks";
    factionName.textContent = "No faction selected";
    timeDisplay.textContent = formatTime(0);
    playerLogoRotator.stop();
    updatePlayerControlsState();
    updateActiveTrackVisuals();
  }

  function validateCurrentAudioSource() {
    if (!audioPlayer.src) return;
    if (!playQueue.includes(currentlyPlayingCatalogIndex)) {
      stopPlaybackAndResetUI();
    }
  }

  function updatePlayerControlsState() {
    const isEmpty = playQueue.length === 0;
    btnPlayPause.disabled = isEmpty;
    btnLoop.disabled = isEmpty;
    btnPlayPause.classList.toggle('disabled', isEmpty);
    btnLoop.classList.toggle('disabled', isEmpty);
    btnLoop.setAttribute('aria-pressed', String(isLooping && !isEmpty));
  }

  function updateQueue() {
    playQueue = Array.from(secondList.children).map(li => Number(li.dataset.catalogIndex));
    reservedIndexSet = new Set(playQueue); // *** OPTIMIZACIÓN: Actualiza el caché ***

    if (currentlyPlayingCatalogIndex !== -1) {
      const newIdx = playQueue.indexOf(currentlyPlayingCatalogIndex);
      if (newIdx !== -1) currentIndexInQueue = newIdx;
      else validateCurrentAudioSource();
    }
    audioPlayer.loop = isLooping && playQueue.length === 1;
    
    renderPlaylist(); // Re-dibuja la playlist (simple)
    updatePlayerControlsState();
    renderLibrary(); // Re-dibuja la biblioteca (para marcar 'agotados')
}

  function startTimerUpdates() {
    if (animationFrameId_timer) cancelAnimationFrame(animationFrameId_timer);
    const update = () => {
      if (!audioPlayer.paused) {
        timeDisplay.textContent = formatTime(audioPlayer.currentTime);
        animationFrameId_timer = requestAnimationFrame(update);
      }
    };
    animationFrameId_timer = requestAnimationFrame(update);
  }
  function stopTimerUpdates() {
    if (animationFrameId_timer) cancelAnimationFrame(animationFrameId_timer);
    animationFrameId_timer = null;
  }

  function updateActiveTrackVisuals() {
    for (const item of secondList.children) {
      const itemIndex = Number(item.dataset.catalogIndex);
      item.classList.toggle('active', itemIndex === currentlyPlayingCatalogIndex);
    }
  }

  // —— Eventos —— //
  function setupEventListeners() {
    secondList.addEventListener('click', e => {
      // Pre-validación de elementos críticos
      const elements = [audioPlayer, trackName, factionName, timeDisplay, btnPlayPause, imgPlayPause, btnLoop, imgLoop, allTracksList, secondList];
      if (elements.some(el => !el)) {
        console.error("Manual Player: One or more critical DOM elements are missing. Aborting setup.");
        const root = document.getElementById('appRoot');
        if (root) {
          root.innerHTML = `<div class="error-box"><h3>Initialization Error</h3><p>A critical UI component failed to load. Please refresh the page.</p></div>`;
        }
        return;
      }
      const li = e.target.closest('li[data-catalog-index]');
      if (!li) return;
      const idx = Number(li.dataset.catalogIndex);
      if (idx !== currentlyPlayingCatalogIndex || audioPlayer.paused) {
        playSingleTrackByIndex(idx);
      }
    });

    allTracksList.addEventListener('pointerenter', e => {
      const li = e.target.closest('li[data-catalog-index]');
      if (!li) return;
      const idx = Number(li.dataset.catalogIndex);
      preloader.preload(catalog[idx]);
    }, true);

    btnPlayPause.addEventListener('click', () => {
      if (audioPlayer.paused) {
        if (audioPlayer.src) audioPlayer.play();
        else if (playQueue.length > 0) playSingleTrackByIndex(playQueue[0]);
      } else {
        audioPlayer.pause();
      }
    });

    btnLoop.addEventListener('click', () => {
      isLooping = !isLooping;
      audioPlayer.loop = isLooping && playQueue.length === 1;
      btnLoop.title = isLooping ? 'Loop On' : 'Loop Off';
      imgLoop.classList.toggle('active', isLooping);
      btnLoop.classList.toggle('active', isLooping);
      btnLoop.setAttribute('aria-pressed', String(isLooping));
    });

    audioPlayer.addEventListener('play', () => {
      imgPlayPause.src = `${baseURL}/buttons/pause_button.png`;
      startTimerUpdates();
      updateActiveTrackVisuals();
      if (navigator.mediaSession) {
        navigator.mediaSession.playbackState = 'playing';
      }
    });
    audioPlayer.addEventListener('pause', () => {
      imgPlayPause.src = `${baseURL}/buttons/play_button.png`;
      stopTimerUpdates();
      if (navigator.mediaSession) {
        navigator.mediaSession.playbackState = 'paused';
      }
    });

    audioPlayer.addEventListener('ended', () => {
      stopTimerUpdates();
      timeDisplay.textContent = formatTime(0);
      if (playQueue.length === 0) { stopPlaybackAndResetUI(); return; }
      if (audioPlayer.loop) return;
      if (isLooping) {
        playSingleTrackByIndex(playQueue[currentIndexInQueue]); // mismo track
      } else {
        currentIndexInQueue = (currentIndexInQueue + 1) % playQueue.length;
        playSingleTrackByIndex(playQueue[currentIndexInQueue]);
      }
    });

    // Volumen
    if (typeof initVolumeControl === 'function') {
      const inst = initVolumeControl({
        audioEl: audioPlayer,
        bgEl: volumeSliderContainer,
        barEl: volumeBar,
        labelEl: volumeValue
      });
      // Sincroniza aria-valuenow
      const sync = () => {
        const bg = document.getElementById('volumeBarBg');
        if (bg) bg.setAttribute('aria-valuenow', String(Math.round(inst.getVolume() * 100)));
      }
      audioPlayer.addEventListener('volumechange', sync);
      sync();
    }

    [allTracksList, secondList].forEach(el => {
      if (!el) return;
      el.addEventListener('wheel', e => {
        e.preventDefault();
        e.currentTarget.scrollTop += e.deltaY;
      }, { passive: false });
    });

    // iOS/Android: unlock de audio con primer gesto del usuario
    let unlocked = false;
    const unlock = async () => {
      if (unlocked) return;
      try {
        await audioPlayer.play();
        audioPlayer.pause();
        unlocked = true;
        document.removeEventListener('touchend', unlock);
        document.removeEventListener('click', unlock);
      } catch (_) {}
    };
    document.addEventListener('touchend', unlock, { passive: true });
    document.addEventListener('click', unlock, { passive: true });
  }

  // Quita un track de la cola y mantiene reproducción/punteros/loop coherentes.
  function removeFromQueueByCatalogIndex(removedCatalogIndex) {
    const pos = playQueue.indexOf(removedCatalogIndex);
    if (pos === -1) return;

    const wasPlaying = (removedCatalogIndex === currentlyPlayingCatalogIndex);

    // quita del array fuente de verdad
    playQueue.splice(pos, 1);
    reservedIndexSet = new Set(playQueue); // *** OPTIMIZACIÓN: Actualiza el caché ***

    // si quitaste algo antes del puntero actual y NO era el que sonaba, corre el puntero una a la izq.
    if (!wasPlaying && pos < currentIndexInQueue) {
      currentIndexInQueue = Math.max(0, currentIndexInQueue - 1);
    }

    // loop solo si queda 1
    audioPlayer.loop = isLooping && playQueue.length === 1;

    // re-render UI
    renderPlaylist();
    updatePlayerControlsState();
    updateActiveTrackVisuals();
    renderLibrary(); // Re-render library to update depleted status

    // si quitaste el que sonaba → avanza al siguiente en la misma posición
    if (wasPlaying) {
      if (playQueue.length === 0) {
        stopPlaybackAndResetUI();
      } else {
        // mismo hueco 'pos' (o 0 si el hueco quedó fuera)
        currentIndexInQueue = (pos >= playQueue.length) ? 0 : pos;
        playSingleTrackByIndex(playQueue[currentIndexInQueue]);
      }
    }
  }

  // —— Sortable —— //
function setupSortable() {
  if (!allTracksList || !secondList) {
    console.error('Lists not found');
    return;
  }
  if (typeof Sortable === 'undefined') {
    console.error('Sortable.js library not loaded.');
    return;
  }

  // Biblioteca: arrastras clon; no acepta drops; revierte en spill visual
  Sortable.create(allTracksList, {
    group: { name: 'shared', pull: 'clone', put: false },
    animation: 150,
    sort: false,
    revertOnSpill: true
  });

  // Utilidad: borra por id + asegura DOM fuera
  const safeRemoveByNode = (itemNode) => {
    const id = Number(itemNode?.dataset?.catalogIndex);
    if (!Number.isFinite(id)) return;
    if (!playQueue.includes(id)) return; // ya fue borrado
    removeFromQueueByCatalogIndex(id);   // avanza si era el que sonaba
    itemNode?.remove?.();                // garantía si el plugin no quitó el nodo
  };

  // ¿El puntero terminó fuera de la playlist?
  const isPointerOutsideSecondList = (evt) => {
    const e = evt.originalEvent || evt;
    const t = (e && e.changedTouches && e.changedTouches[0]) || null;
    const x = typeof e?.clientX === 'number' ? e.clientX : (t ? t.clientX : undefined);
    const y = typeof e?.clientY === 'number' ? e.clientY : (t ? t.clientY : undefined);
    if (typeof x === 'number' && typeof y === 'number') {
      const under = document.elementFromPoint(x, y);
      return !secondList.contains(under); // fuera = true
    }
    // Fallback
    return evt.to !== secondList;
  };

  // Playlist
  Sortable.create(secondList, {
    group: {
      name: 'shared',
      put: (to, from, dragged) => {
        const id = dragged?.dataset?.catalogIndex;
        if (!id) return false;
        // ❌ no duplicar EXACTO el mismo catalogIndex
        for (const li of to.el.children) {
          if (li.dataset.catalogIndex === id) return false;
        }
        return true; // ✅ permitir si es variante distinta (otro catalogIndex)
      }
    },
    animation: 150,

    // Si el build tiene el plugin, úsalo; si no, el onEnd de abajo cubre todo.
    removeOnSpill: true,

    // Camino plugin: derrame => borrar
    onSpill: (evt) => {
      safeRemoveByNode(evt.item);
    },

    // Futuro: si alguna vez otra lista acepta el ítem, también borramos del estado
    onRemove: (evt) => {
      safeRemoveByNode(evt.item);
    },

    // Plan B robusto (independiente del plugin):
    // Si el drag vino de la playlist y terminó fuera de la playlist -> BORRAR.
    // Esto incluye: soltar sobre la biblioteca o en cualquier zona fuera de la UL.
    onEnd: (evt) => {
      if (evt.from === secondList && isPointerOutsideSecondList(evt)) {
        safeRemoveByNode(evt.item);
      }
    },

    // Altas / reorden dentro de la playlist
    onAdd: updateQueue,
    onUpdate: updateQueue
  });
}


  // —— Búsqueda —— //
  function injectSearchBarCSS() {
    const style = createElement('style', { html: `
      .search-container { margin-bottom: 12px; position: relative; }
      #trackSearchInput {
        width: 100%; padding: 10px 12px;
        font-family: 'Orbitron', sans-serif; font-size: 1rem; font-weight: 500;
        background-color: #080816; color: #ddd;
        border: 1px solid #333; border-radius: 8px; outline: none;
        box-shadow: inset 0 1px 3px rgba(0,0,0,0.4);
        transition: border-color 0.2s, box-shadow 0.2s;
      }
      #trackSearchInput:focus { border-color: #6cf; box-shadow: 0 0 8px rgba(108, 207, 255, 0.5), inset 0 1px 3px rgba(0,0,0,0.4); }
      #trackSearchInput::placeholder { color: #777; }
      #trackSearchInput::-webkit-search-cancel-button {
        -webkit-appearance: none; height: 16px; width: 16px; cursor: pointer;
        background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23999'><path d='M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'/></svg>");
      }
      #allTracksList li.hidden { display: none; }
    `});
    document.head.appendChild(style);
  }

  function setupSearchBar() {
    const listContainer = allTracksList?.closest('.manual-list');
    const heading = listContainer?.querySelector('h2');
    if (!heading) return;

    const searchContainer = createElement('div', { className: 'search-container' });
    const searchInput = createElement('input', {
      type: 'search', id: 'trackSearchInput',
      placeholder: 'Search by title, /faction, or #franchise',
      enterkeyhint: 'search', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false'
    });
    searchContainer.appendChild(searchInput);
    heading.after(searchContainer);

    // *** SIMPLIFICACIÓN: Se elimina SANITIZE regex restrictivo ***
    // const SANITIZE = /^[A-Za-z0-9 _\-\/#]{0,50}$/; 
    const handleSearch = (event) => {
      const raw = event.target.value;
      // if (!SANITIZE.test(raw)) { event.target.value = raw.slice(0, -1); return; } // Eliminado
      const query = raw.toLowerCase().trim();
      const items = allTracksList.children;
      for (const item of items) {
        const idx = parseInt(item.dataset.catalogIndex, 10);
        if (isNaN(idx)) continue;
        const track = catalog[idx]; if (!track) continue;
        let isMatch = false;
        if (!query) isMatch = true;
        else if (query.startsWith('/')) {
          const fq = query.substring(1);
          isMatch = (track.factions || []).includes(fq);
        } else if (query.startsWith('#')) {
          const gq = query.substring(1);
          const gfs = factionGroups[gq] || [];
          isMatch = (track.factions || []).some(tf => gfs.includes(tf));
        } else {
          const normalizedQuery = normalizeString(query).toLowerCase();
          const tokens = (item.dataset.searchTokens || '').toLowerCase();
          if (tokens) {
            isMatch = tokens.includes(normalizedQuery);
          } else {
            const normalizedTitle = track._normalizedTitle || normalizeString(track.titles?.en || '').toLowerCase();
            isMatch = normalizedTitle.includes(normalizedQuery);
          }
        }
        item.classList.toggle('hidden', !isMatch);
      }
    };
    searchInput.addEventListener('input', debounce(handleSearch, 250));
  }

  // —— Init —— //
  async function fetchWithRetry(url, options, retries = 3, backoff = 1000) {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url, options);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response;
      } catch (err) {
        console.warn(`Fetch attempt ${i + 1} failed: ${err.message}. Retrying in ${backoff}ms...`);
        if (i < retries - 1) await new Promise(res => setTimeout(res, backoff));
        backoff *= 2; // Exponential backoff
      }
    }
    throw new Error(`Failed to fetch ${url} after ${retries} attempts.`);
  }

  async function fetchVariantGroupsData() {
    try {
      const url = `${variantDataURL}?_=${Date.now()}`;
      const response = await fetch(url, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    } catch (err) {
      console.warn('Variant groups unavailable:', err?.message || err);
      return [];
    }
  }

  async function initializeApp() {
    try {
      // Validar elementos críticos del DOM antes de fetchear
      const criticalElements = [audioPlayer, allTracksList, secondList, btnPlayPause, imgPlayPause, btnLoop, imgLoop, trackName, factionName, timeDisplay, volumeSliderContainer, volumeBar, volumeValue];
      if (criticalElements.some(el => !el)) {
        console.error('Initialization failed: Critical DOM elements are missing.');
        const root = document.getElementById('appRoot') || document.body;
        root.innerHTML = `<div class="error-box"><h3>Initialization Error</h3><p>A critical UI component failed to load. Please check element IDs.</p></div>`;
        return;
      }

      const fetchUrl = `${dataURL}?_=${Date.now()}`;
      const response = await fetchWithRetry(fetchUrl, { cache: 'no-cache' });

      catalog = await response.json();
      if (!Array.isArray(catalog)) throw new Error("Catalog data is not an array.");
      
      window.catalog = catalog;

      // Precompute normalized titles for faster search matching
      for (const track of catalog) {
        if (!track) continue;
        const title = track?.titles?.en || '';
        track._normalizedTitle = normalizeString(title).toLowerCase();
      }

      const variantGroups = await fetchVariantGroupsData();
      if (variantManager) {
        variantManager.load({ catalog, variantGroups });
      }

      playQueue = [];
      reservedIndexSet = new Set(); // Inicializa el caché
      renderLibrary();
      renderPlaylist();

      injectSearchBarCSS();
      setupSearchBar();
      setupEventListeners();
      setupSortable();
      updatePlayerControlsState();
      listLogoManager.start();

      imgPlayPause.src = `${baseURL}/buttons/play_button.png`;
      imgLoop.src = `${baseURL}/buttons/loop_button.png`;
    } catch (err) {
      console.error('Initialization error:', err);
      const root = document.getElementById('appRoot') || document.body;
      if (root) {
        root.innerHTML = `
          <div class="error-box">
            <h3>Failed to load catalog</h3>
            <p>${String(err?.message || err)}</p>
          </div>`;
      }
    }
  }

  initializeApp();
});