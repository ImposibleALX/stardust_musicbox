'use strict';
// manualPlayer.js

// ---------- Helpers ----------
function createElement(tag, { className, text, html, ...attrs } = {}) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  if (html != null) el.innerHTML = html;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}
function formatTime(seconds = 0) {
  const s = Math.max(0, Math.round(seconds));
  const m = String(Math.floor(s / 60)).padStart(2, '0');
  const r = String(s % 60).padStart(2, '0');
  return `${m}:${r}`;
}
function waitForCanPlay(audio) {
  return new Promise((resolve) => {
    if (!audio) return resolve();
    if (audio.readyState >= 3) return resolve();
    const cb = () => {
      audio.removeEventListener('canplaythrough', cb);
      resolve();
    };
    audio.addEventListener('canplaythrough', cb, { once: true });
  });
}
function debounce(fn, delay = 300) {
  let t = 0;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), delay);
  };
}
function normalizeString(str = '') {
  return String(str).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function getImageMimeType(url = '') {
  const ext = url.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return undefined;
}
function ensureTrailingSlash(path) {
  return !path ? '' : path.endsWith('/') ? path : `${path}/`;
}

// ---------- Rutas base ----------
const imageBaseURL = String(window.IMAGE_BASE_PATH || '../assets/images').replace(/\/$/, '');
const musicBaseURL = ensureTrailingSlash(window.AUDIO_BASE_PATH || '../assets/music/');
const catalogBaseURL = ensureTrailingSlash(window.CATALOG_BASE_PATH || '../assets/catalogs/');
const dataURL = `${catalogBaseURL}music_catalog_all.json`;
const variantDataURL = `${catalogBaseURL}variant_groups.json`;

// ---------- Estado global mínimo ----------
let catalog = [];
let playQueue = [];
let currentIndexInQueue = 0;
let currentlyPlayingCatalogIndex = -1;
let isLooping = false;
let animationFrameId_timer = null;
let reservedIndexSet = new Set(); // cache de la playlist (para “agotados”)
const variantManager = typeof createVariantManager === 'function' ? createVariantManager() : null;

// ---------- Facciones ----------
const factionDisplayNames = {
  bolar: 'Bolar Federation',
  dezariam: 'Dezariam Nation',
  gamilas: 'Greater Garmillan Empire',
  gatlantis: 'White Comet / Gatlantis Empire',
  uncf: 'United Nations Cosmo Force',
  arcadia: "Captain Harlock's Arcadia",
  dinguil: 'Dinguil Empire',
  various: 'THE EXPANSE',
  guia: 'Great Urup Interstellar Alliance',
  cis: 'Confederacy of Independent Systems',
  empire: 'Galactic Empire',
  republic: 'Galactic Republic',
  jedi: 'Jedi Order',
  atlantis: 'ATLANTIS w/ Humans',
  neoatlantis: 'NEO ATLANTIS',
  rebel: 'Rebel Alliance',
  unn: 'United Nations Navy',
  mcrn: 'Martian Republic Navy',
  opa: 'Outer Planets Alliance',
  fn: 'Free Navy',
  zentradi: 'Zentradi',
  uns: 'United Nations Spacy'
};
const factionLogos = {
  bolar: `${imageBaseURL}/mini_logos/bolar_logo.png`,
  dezariam: `${imageBaseURL}/mini_logos/dezariam_logo.png`,
  gamilas: `${imageBaseURL}/logos/gamilas_logo.webp`,
  gatlantis: `${imageBaseURL}/mini_logos/gatlantis_logo.webp`,
  uncf: `${imageBaseURL}/mini_logos/uncf_logo.png`,
  arcadia: `${imageBaseURL}/logos/arcadia_logo.png`,
  dinguil: `${imageBaseURL}/logos/dinguil_logo.png`,
  guia: `${imageBaseURL}/mini_logos/guia_logo.webp`,
  cis: `${imageBaseURL}/mini_logos/cis_logo.png`,
  empire: `${imageBaseURL}/mini_logos/galactic_empire_logo.png`,
  republic: `${imageBaseURL}/mini_logos/galactic_republic_logo.png`,
  atlantis: `${imageBaseURL}/mini_logos/atlantis_logo.png`,
  neoatlantis: `${imageBaseURL}/mini_logos/neoatlantis_logo.png`,
  rebel: `${imageBaseURL}/logos/rebel_logo.png`,
  unn: `${imageBaseURL}/mini_logos/unn_logo.png`,
  mcrn: `${imageBaseURL}/mini_logos/mcrn_logo.png`,
  opa: `${imageBaseURL}/mini_logos/opa_logo.png`,
  fn: `${imageBaseURL}/mini_logos/fn_logo.png`,
  zentradi: `${imageBaseURL}/mini_logos/zentradi_logo.png`,
  uns: `${imageBaseURL}/mini_logos/uns_logo.png`
};
const factionGroups = {
  sby: ['uncf', 'bolar', 'gamilas', 'gatlantis', 'dinguil', 'dezariam', 'guia'],
  expanse: ['mcrn', 'opa', 'fn', 'unn'],
  nadia: ['neoatlantis', 'atlantis'],
  starwars: ['republic', 'empire', 'rebel', 'cis'],
  macross: ['uns', 'zentradi']
};

// ---------- Rotadores de logos ----------
function createPlayerLogoRotator(imageElement) {
  let timerId = null;
  const stop = () => {
    if (timerId) clearInterval(timerId);
    if (imageElement) imageElement.src = '';
    timerId = null;
  };
  const start = (track) => {
    stop();
    if (!imageElement) return;
    const factions = track?.factions || [];
    if (factions.length < 2) {
      const k = factions[0] || null;
      imageElement.src = k ? factionLogos[k] || '' : '';
      imageElement.alt = k ? factionDisplayNames[k] || k : '';
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
    entries.forEach((e) => (e.isIntersecting ? visibleRotators.add(e.target) : visibleRotators.delete(e.target)));
    if (!animationFrameId && visibleRotators.size) requestAnimationFrame(rotateLoop);
  }, { root: null, threshold: 0.1 });

  function rotateLoop(ts) {
    if (!lastTick) lastTick = ts;
    if (ts - lastTick >= interval) {
      lastTick = ts; tick++;
      visibleRotators.forEach((img) => {
        const factions = (img.dataset.factions || '').split(',').filter(Boolean);
        if (!factions.length) return;
        const key = factions[tick % factions.length];
        const src = factionLogos[key];
        if (src && img.src !== src) {
          img.src = src;
          img.alt = factionDisplayNames[key] || '';
        }
      });
    }
    if (visibleRotators.size) animationFrameId = requestAnimationFrame(rotateLoop);
    else animationFrameId = null;
  }
  return {
    observe: (img) => observer.observe(img),
    start: () => { if (!animationFrameId) requestAnimationFrame(rotateLoop); }
  };
}

// ---------- App ----------
document.addEventListener('DOMContentLoaded', () => {
  const ids = [
    'audioPlayer','trackName','factionName','timeDisplay',
    'btnPlayPause','imgPlayPause','btnLoop','imgLoop',
    'allTracksList','secondList','volumeSliderContainer',
    'volumeValue','volumeBar','volumeBarBg'
  ];
  const ctx = ids.reduce((o, id) => ((o[id] = document.getElementById(id)), o), {});
  const {
    audioPlayer, trackName, factionName, timeDisplay,
    btnPlayPause, imgPlayPause, btnLoop, imgLoop,
    allTracksList, secondList, volumeSliderContainer,
    volumeValue, volumeBar, volumeBarBg
  } = ctx;

  const playerLogoRotator = createPlayerLogoRotator(document.querySelector('.faction-section img'));
  const listLogoManager = createListLogoManager();

  const preloader = {
    element: document.createElement('audio'),
    init() { this.element.preload = 'metadata'; },
    preload(track) {
      if (!track) return;
      const filePath = `${musicBaseURL}${track.folder}/${track.file}`;
      if (this.element.src !== filePath) { this.element.src = filePath; this.element.load(); }
    }
  };
  preloader.init();

  function updateMediaSession(track) {
    if (!('mediaSession' in navigator) || !track) return;
    const factions = track.factions || [];
    const artKey = factions[0];
    const artSrc = artKey && factionLogos[artKey] ? factionLogos[artKey] : undefined;
    const mime = artSrc ? getImageMimeType(artSrc) : undefined;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.titles?.en || 'Unknown Title',
      artist: factions.map((f) => factionDisplayNames[f] || f).join(', ') || 'Unknown',
      album: 'Stardust Music Box',
      artwork: artSrc ? [{ src: artSrc, sizes: '96x96', type: mime }].filter(Boolean) : []
    });
  }
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => audioPlayer.play());
    navigator.mediaSession.setActionHandler('pause', () => audioPlayer.pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      if (!playQueue.length) return;
      currentIndexInQueue = (currentIndexInQueue - 1 + playQueue.length) % playQueue.length;
      playSingleTrackByIndex(playQueue[currentIndexInQueue]);
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      if (!playQueue.length) return;
      currentIndexInQueue = (currentIndexInQueue + 1) % playQueue.length;
      playSingleTrackByIndex(playQueue[currentIndexInQueue]);
    });
  }

  async function playSingleTrackByIndex(catalogIndex, offset = 0) {
    const track = catalog[catalogIndex];
    if (!track || !track.file || !track.folder || typeof track.duration !== 'number') {
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
    if (audioPlayer.src !== filePath) { audioPlayer.src = filePath; audioPlayer.load(); }

    try {
      await waitForCanPlay(audioPlayer);
      audioPlayer.currentTime = offset;
      await audioPlayer.play();
    } catch (err) {
      if (err?.name !== 'AbortError') console.error('Playback error:', err);
    }

    trackName.textContent = track.titles?.en?.trim() || 'Unknown Title';
    const factionsText = (track.factions || []).map((f) => factionDisplayNames[f] || f).join(', ');
    factionName.textContent = `Factions: ${factionsText || 'Unknown'}`;

    playerLogoRotator.start(track);
    updateMediaSession(track);
    updateActiveTrackVisuals();
  }

  function createBaseListItem(track, { catalogIndex, searchTokens, classNames = [], groupId, draggable = true } = {}) {
    if (typeof catalogIndex !== 'number') return null;
    const attrs = { 'data-catalog-index': catalogIndex, tabindex: '0' };
    if (draggable) attrs.draggable = 'true';
    const li = createElement('li', attrs);

    if (classNames?.length) {
      const tokens = classNames.flatMap((c) => (typeof c === 'string' ? c.split(/\s+/) : Array.isArray(c) ? c : String(c).split(/\s+/))).filter(Boolean);
      if (tokens.length) li.classList.add(...tokens);
    }
    if (groupId) li.dataset.groupId = groupId;
    if (searchTokens) li.dataset.searchTokens = searchTokens;

    const titleSpan = createElement('span', { className: 'track-title' });
    const durationSpan = createElement('span', { className: 'track-duration', text: formatTime(track?.duration || 0) });
    const factionSpan = createElement('span', { className: 'track-faction' });

    const factions = Array.isArray(track?.factions) ? track.factions : [];
    if (factions.length) {
      const img = createElement('img', {
        src: factionLogos[factions[0]] || '',
        alt: factionDisplayNames[factions[0]] || factions[0] || '',
        title: factionDisplayNames[factions[0]] || factions[0] || '',
        loading: 'lazy', decoding: 'async', width: '28', height: '28'
      });
      if (factions.length > 1) {
        img.dataset.factions = factions.join(',');
        listLogoManager.observe(img);
      }
      factionSpan.appendChild(img);
    }
    li.append(titleSpan, durationSpan, factionSpan);

    // NOTE: accessibility — key handling is delegated centrally (see setupEventListeners)
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
    if (!group?.variants?.length) return null;
    let activeVariant = group.variants[group.activeIndex || 0];
    if (!activeVariant) return null;

    // Evita variantes "agotadas" en playlist
    if (activeVariant && reservedIndexSet.has(activeVariant.catalogIndex)) {
      const total = group.variants.length;
      let hops = 0;
      while (hops < total && reservedIndexSet.has(activeVariant.catalogIndex)) {
        if (typeof variantManager?.stepActiveVariant === 'function') {
          variantManager.stepActiveVariant(group.groupId, +1);
          const updatedGroup = variantManager.getGroup(group.groupId);
          activeVariant = updatedGroup.variants[updatedGroup.activeIndex];
        } else {
          const nextIdx = ((group.activeIndex || 0) + 1) % total;
          group.activeIndex = nextIdx;
          activeVariant = group.variants[nextIdx];
        }
        hops++;
      }
    }

    const allReserved = group.variants.every((v) => reservedIndexSet.has(v.catalogIndex));
    const activeCatalogIndex = activeVariant.catalogIndex;
    const track = !allReserved ? catalog[activeCatalogIndex] : null;
    const displayTrack = track || catalog[group.variants[0].catalogIndex];

    const tokenSet = new Set();
    if (group.title) tokenSet.add(normalizeString(group.title).toLowerCase());
    group.variants.forEach((variant) => {
      if (variant.normalizedLabel) tokenSet.add(variant.normalizedLabel);
      else if (variant.variantLabel) tokenSet.add(normalizeString(variant.variantLabel).toLowerCase());
      const vt = catalog[variant.catalogIndex];
      if (vt?.['_normalizedTitle']) tokenSet.add(vt._normalizedTitle);
    });
    const searchTokens = Array.from(tokenSet).filter(Boolean).join(' ');

    const classNames = ['has-variants'];
    if (allReserved) classNames.push('variants-depleted');

    const base = createBaseListItem(displayTrack, {
      catalogIndex: activeCatalogIndex,
      searchTokens,
      classNames,
      groupId: group.groupId,
      draggable: !allReserved
    });
    if (!base) return null;

    const baseTitle = group.title || displayTrack?.titles?.en?.trim() || 'Unknown Title';
    const mainTitle = createElement('span', { className: 'track-main-title', text: baseTitle });
    const controls = createElement('div', { className: 'variant-controls' });

    const prevBtn = createElement('button', { className: 'variant-btn prev', type: 'button', title: 'Previous version', 'aria-label': 'Previous version' });
    prevBtn.textContent = '◀';
    prevBtn.dataset.groupId = group.groupId;
    prevBtn.dataset.delta = '-1';
    prevBtn.dataset.focus = 'prev';

    const label = createElement('span', { className: 'variant-label', text: allReserved ? 'All queued' : (activeVariant.variantLabel || 'Original') });
    const nextBtn = createElement('button', { className: 'variant-btn next', type: 'button', title: 'Next version', 'aria-label': 'Next version' });
    nextBtn.textContent = '▶';
    nextBtn.dataset.groupId = group.groupId;
    nextBtn.dataset.delta = '1';
    nextBtn.dataset.focus = 'next';

    controls.append(prevBtn, label, nextBtn);
    if (allReserved) { prevBtn.disabled = true; nextBtn.disabled = true; }
    base.titleSpan.append(mainTitle, controls);

    // no per-button closures — handler is delegated (see setupEventListeners)
    return base.li;
  }

  function createPlaylistItem(catalogIndex) {
    const track = catalog[catalogIndex];
    if (!track) return null;
    const base = createBaseListItem(track, { catalogIndex, draggable: false });
    if (!base) return null;
    base.titleSpan.textContent = track.titles?.en?.trim() || 'Unknown Title';
    return base.li;
  }

  function getLibraryEntries() {
    if (variantManager) {
      const entries = variantManager.getLibraryEntries();
      if (entries.length) return entries;
    }
    return catalog.map((_, index) => ({ type: 'single', catalogIndex: index }));
  }

  function renderLibrary() {
    if (!allTracksList) return;
    const frag = document.createDocumentFragment();
    const entries = getLibraryEntries();
    for (const entry of entries) {
      let node = null;
      if (entry.type === 'group' && variantManager) {
        const group = variantManager.getGroup(entry.groupId);
        if (group) node = createGroupListItem(group);
      } else if (entry.type === 'single') {
        node = createSingleLibraryItem(entry.catalogIndex);
      }
      if (node) frag.appendChild(node);
    }
    // Single DOM write
    allTracksList.replaceChildren(frag);
    updateActiveTrackVisuals();
  }

  function renderPlaylist() {
    if (!secondList) return;
    const frag = document.createDocumentFragment();
    for (const index of playQueue) {
      const node = createPlaylistItem(index);
      if (node) frag.appendChild(node);
    }
    secondList.replaceChildren(frag);
    updateActiveTrackVisuals();
  }

  async function handleVariantToggle(groupId, delta, focusSide = 'next', currentNode) {
    if (!variantManager || !allTracksList || !currentNode) return;
    let group = variantManager.stepActiveVariant(groupId, delta);
    if (!group) return;

    if (Array.isArray(group.variants)) {
      const total = group.variants.length;
      let hops = 0;
      let activeIdx = group.activeIndex || 0;
      while (hops < total && reservedIndexSet.has(group.variants[activeIdx].catalogIndex)) {
        group = variantManager.stepActiveVariant(groupId, delta);
        if (!group) return;
        activeIdx = group.activeIndex || 0;
        hops++;
      }
    }
    const replacement = createGroupListItem(group);
    if (!replacement) return;
    allTracksList.replaceChild(replacement, currentNode);
    const selector = focusSide === 'prev' ? '.variant-btn.prev' : '.variant-btn.next';
    replacement.querySelector(selector)?.focus();
  }

  function stopPlaybackAndResetUI() {
    audioPlayer.pause();
    audioPlayer.src = '';
    currentlyPlayingCatalogIndex = -1;
    trackName.textContent = 'Drag & drop your favourite tracks';
    factionName.textContent = 'No faction selected';
    timeDisplay.textContent = formatTime(0);
    playerLogoRotator.stop();
    updatePlayerControlsState();
    updateActiveTrackVisuals();
  }

  function validateCurrentAudioSource() {
    if (!audioPlayer.src) return;
    if (!playQueue.includes(currentlyPlayingCatalogIndex)) stopPlaybackAndResetUI();
  }

  function updatePlayerControlsState() {
    const isEmpty = playQueue.length === 0;
    btnPlayPause.disabled = isEmpty;
    btnLoop.disabled = isEmpty;
    btnPlayPause.classList.toggle('disabled', isEmpty);
    btnLoop.classList.toggle('disabled', isEmpty);
    btnLoop.setAttribute('aria-pressed', String(isLooping && !isEmpty));
    audioPlayer.loop = isLooping && playQueue.length === 1;
  }

  function updateQueue() {
    // Read DOM once to compute new queue
    const children = secondList.children;
    const newQueue = new Array(children.length);
    for (let i = 0; i < children.length; i++) newQueue[i] = Number(children[i].dataset.catalogIndex);
    playQueue = newQueue;
    reservedIndexSet = new Set(playQueue);
    if (currentlyPlayingCatalogIndex !== -1) {
      const newIdx = playQueue.indexOf(currentlyPlayingCatalogIndex);
      if (newIdx !== -1) currentIndexInQueue = newIdx;
      else validateCurrentAudioSource();
    }
    audioPlayer.loop = isLooping && playQueue.length === 1;
    renderPlaylist();
    updatePlayerControlsState();
    renderLibrary();
  }

  function startTimerUpdates() {
    if (animationFrameId_timer) cancelAnimationFrame(animationFrameId_timer);
    const update = () => {
      if (!audioPlayer.paused) {
        timeDisplay.textContent = formatTime(audioPlayer.currentTime);
        animationFrameId_timer = requestAnimationFrame(update);
      } else {
        animationFrameId_timer = null;
      }
    };
    animationFrameId_timer = requestAnimationFrame(update);
  }
  function stopTimerUpdates() {
    if (animationFrameId_timer) cancelAnimationFrame(animationFrameId_timer);
    animationFrameId_timer = null;
  }

  function updateActiveTrackVisuals() {
    // Marca activo en playlist — batch DOM writes as toggles, read once
    const children = secondList.children;
    for (let i = 0; i < children.length; i++) {
      const item = children[i];
      const itemIndex = Number(item.dataset.catalogIndex);
      const playing = itemIndex === currentlyPlayingCatalogIndex;
      item.classList.toggle('active', playing);
      item.classList.toggle('is-playing', playing);
      if (playing) item.setAttribute('aria-current', 'true');
      else item.removeAttribute('aria-current');
    }
  }

  function setupEventListeners() {
    // Click al item en playlist reproduce — delegation
    secondList.addEventListener('click', (e) => {
      const li = e.target.closest('li[data-catalog-index]');
      if (!li) return;
      const idx = Number(li.dataset.catalogIndex);
      if (idx !== currentlyPlayingCatalogIndex || audioPlayer.paused) playSingleTrackByIndex(idx);
    });

    // Keyboard: delegated Enter/Space on both lists (accessible)
    document.addEventListener('keydown', (e) => {
      if (!(e.code === 'Enter' || e.key === ' ' || e.key === 'Spacebar')) return;
      const el = document.activeElement;
      if (!el) return;
      const li = el.closest && el.closest('li[data-catalog-index]');
      if (!li) return;
      const idx = Number(li.dataset.catalogIndex);
      if (isNaN(idx)) return;
      // only allow activation from playlist
      if (li.closest('#secondList')) {
        if (idx !== currentlyPlayingCatalogIndex || audioPlayer.paused) playSingleTrackByIndex(idx);
        e.preventDefault();
      }
    });

    // Preload en hover en la biblioteca (use pointerenter on container, delegated)
    allTracksList.addEventListener('pointerenter', (e) => {
      const li = e.target.closest('li[data-catalog-index]');
      if (!li) return;
      preloader.preload(catalog[Number(li.dataset.catalogIndex)]);
    }, true);

    // Play/Pause
    btnPlayPause.addEventListener('click', () => {
      if (audioPlayer.paused) {
        if (audioPlayer.src) audioPlayer.play().catch(()=>{});
        else if (playQueue.length) playSingleTrackByIndex(playQueue[0]);
      } else audioPlayer.pause();
    });

    // Loop
    btnLoop.addEventListener('click', () => {
      isLooping = !isLooping;
      audioPlayer.loop = isLooping && playQueue.length === 1;
      btnLoop.title = isLooping ? 'Loop On' : 'Loop Off';
      imgLoop.classList.toggle('active', isLooping);
      btnLoop.classList.toggle('active', isLooping);
      btnLoop.setAttribute('aria-pressed', String(isLooping));
    });

    // Reacciones del audio
    audioPlayer.addEventListener('play', () => {
      imgPlayPause.src = `${imageBaseURL}/buttons/pause_button.png`;
      startTimerUpdates();
      updateActiveTrackVisuals();
      if (navigator.mediaSession) navigator.mediaSession.playbackState = 'playing';
    });
    audioPlayer.addEventListener('pause', () => {
      imgPlayPause.src = `${imageBaseURL}/buttons/play_button.png`;
      stopTimerUpdates();
      if (navigator.mediaSession) navigator.mediaSession.playbackState = 'paused';
    });
    audioPlayer.addEventListener('ended', () => {
      stopTimerUpdates();
      timeDisplay.textContent = formatTime(0);
      if (!playQueue.length) { stopPlaybackAndResetUI(); return; }
      if (audioPlayer.loop) return;
      if (isLooping) playSingleTrackByIndex(playQueue[currentIndexInQueue]);
      else {
        currentIndexInQueue = (currentIndexInQueue + 1) % playQueue.length;
        playSingleTrackByIndex(playQueue[currentIndexInQueue]);
      }
    });

    // Variant button clicks — delegated (avoids closures per button)
    allTracksList.addEventListener('click', (e) => {
      const btn = e.target.closest('.variant-btn');
      if (!btn) return;
      e.preventDefault(); e.stopPropagation();
      const gid = btn.dataset.groupId;
      const delta = Number(btn.dataset.delta) || 0;
      const focusSide = btn.dataset.focus || 'next';
      const parentLi = btn.closest('li[data-group-id]');
      if (gid && parentLi) handleVariantToggle(gid, delta, focusSide, parentLi);
    });

    // Volumen: usa módulo si existe, si no fallback accesible
    if (typeof initVolumeControl === 'function' && volumeSliderContainer) {
      const vc = initVolumeControl({
        audioEl: audioPlayer,
        bgEl: volumeBarBg || volumeSliderContainer,
        barEl: volumeBar || null,
        labelEl: volumeValue || null
      });
      const updateAria = () => {
        const percent = Math.round((vc.getVolume?.() || 0) * 100);
        (volumeBarBg || volumeSliderContainer).setAttribute('aria-valuenow', String(percent));
        (volumeBarBg || volumeSliderContainer).setAttribute('aria-valuemin', '0');
        (volumeBarBg || volumeSliderContainer).setAttribute('aria-valuemax', '100');
      };
      (volumeBarBg || volumeSliderContainer).addEventListener('vc:change', updateAria);
      audioPlayer.addEventListener('volumechange', updateAria);
      updateAria();
      window.volumeController = vc;
    } else if (volumeSliderContainer) {
      // Fallback simple (rueda + teclado) con ARIA
      const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
      const bg = volumeBarBg || volumeSliderContainer;
      const render = () => {
        const p = Math.round(audioPlayer.volume * 100);
        if (volumeBar) volumeBar.style.height = p + '%';
        if (volumeValue) volumeValue.textContent = p + '%';
        bg.setAttribute('aria-valuenow', String(p));
      };
      bg.addEventListener('wheel', (e) => {
        e.preventDefault();
        audioPlayer.volume = clamp01(audioPlayer.volume + (e.deltaY > 0 ? -0.05 : 0.05));
        render();
      }, { passive: false });
      bg.addEventListener('keydown', (e) => {
        const map = { ArrowUp: +0.05, ArrowDown: -0.05, PageUp: +0.25, PageDown: -0.25, Home: -1, End: +1 };
        if (!(e.code in map)) return;
        e.preventDefault();
        if (e.code === 'Home') audioPlayer.volume = 0;
        else if (e.code === 'End') audioPlayer.volume = 1;
        else audioPlayer.volume = clamp01(audioPlayer.volume + map[e.code]);
        render();
      }, { passive: false });
      audioPlayer.addEventListener('volumechange', render);
      render();
    }
    // Volumen — estado visual de mute por clases (CSS)
    const volumeSection = document.querySelector('.volume-section');
    if (volumeSection && (volumeBarBg || volumeSliderContainer)) {
      (volumeBarBg || volumeSliderContainer).addEventListener('vc:mute', () => {
        volumeSection.classList.add('muted');
      });
      (volumeBarBg || volumeSliderContainer).addEventListener('vc:unmute', () => {
        volumeSection.classList.remove('muted');
      });
    }

    // Scroll wheel suave en listas
    [allTracksList, secondList].forEach((el) => {
      if (!el) return;
      el.addEventListener('wheel', (e) => { e.preventDefault(); e.currentTarget.scrollTop += e.deltaY; }, { passive: false });
    });

    // Desbloqueo móvil de autoplay tras primer toque
    let unlocked = false;
    const unlock = async () => {
      if (unlocked) return;
      try { await audioPlayer.play(); audioPlayer.pause(); unlocked = true; } catch (_) {}
      document.removeEventListener('touchend', unlock);
      document.removeEventListener('click', unlock);
    };
    document.addEventListener('touchend', unlock, { passive: true });
    document.addEventListener('click', unlock, { passive: true });
  }

  function safeRemoveByNode(itemNode) {
    const id = Number(itemNode?.dataset?.catalogIndex);
    if (!Number.isFinite(id) || !playQueue.includes(id)) return;
    removeFromQueueByCatalogIndex(id);
    itemNode?.remove?.();
  }

  function removeFromQueueByCatalogIndex(removedCatalogIndex) {
    const pos = playQueue.indexOf(removedCatalogIndex);
    if (pos === -1) return;
    const wasPlaying = removedCatalogIndex === currentlyPlayingCatalogIndex;
    playQueue.splice(pos, 1);
    reservedIndexSet = new Set(playQueue);
    if (!wasPlaying && pos < currentIndexInQueue) currentIndexInQueue = Math.max(0, currentIndexInQueue - 1);
    audioPlayer.loop = isLooping && playQueue.length === 1;
    renderPlaylist();
    updatePlayerControlsState();
    updateActiveTrackVisuals();
    renderLibrary();
    if (wasPlaying) {
      if (!playQueue.length) stopPlaybackAndResetUI();
      else {
        currentIndexInQueue = pos >= playQueue.length ? 0 : pos;
        playSingleTrackByIndex(playQueue[currentIndexInQueue]);
      }
    }
  }

  function setupSortable() {
    if (!allTracksList || !secondList) return console.error('Lists not found');
    if (typeof Sortable === 'undefined') return console.error('Sortable.js library not loaded.');

    const isCoarse = window.matchMedia?.('(pointer: coarse)')?.matches || ('ontouchstart' in window);

    try {
      if (Sortable.mount && window.RemoveOnSpill && window.RevertOnSpill) {
        Sortable.mount(window.RemoveOnSpill, window.RevertOnSpill);
      }
    } catch (_) {}

    const filterNotDraggable = '.variant-btn, .track-faction, .track-duration';
    const sharedGroup = { name: 'shared' };
    const common = {
      animation: 150,
      direction: 'vertical',
      filter: filterNotDraggable,
      preventOnFilter: true,
      scroll: true,
      bubbleScroll: true,
      scrollSensitivity: isCoarse ? 90 : 60,
      scrollSpeed: isCoarse ? 16 : 12,
      dragClass: 'is-dragging',
      ghostClass: 'is-ghost',
      chosenClass: 'is-chosen',
      fallbackOnBody: isCoarse,
      onChoose: () => { if (isCoarse) document.body.classList.add('drag-touching'); },
      onUnchoose: () => { if (isCoarse) document.body.classList.remove('drag-touching'); },
      onEnd:   () => { if (isCoarse) document.body.classList.remove('drag-touching'); }
    };

    const touchTweaks = isCoarse ? {
      forceFallback: true,
      delayOnTouchOnly: true,
      delay: 70,
      touchStartThreshold: 8,
      fallbackTolerance: 14
    } : { forceFallback: false };

    // Biblioteca: clona hacia la playlist
    Sortable.create(allTracksList, {
      ...common,
      ...touchTweaks,
      group: { ...sharedGroup, pull: 'clone', put: false },
      sort: false,
      revertOnSpill: true
    });

    const isPointerOutsideSecondList = (evt) => {
      const e = evt.originalEvent || evt;
      const t = e?.changedTouches?.[0] || null;
      const x = typeof e?.clientX === 'number' ? e.clientX : t?.clientX;
      const y = typeof e?.clientY === 'number' ? e.clientY : t?.clientY;
      if (typeof x === 'number' && typeof y === 'number') {
        const under = document.elementFromPoint(x, y);
        return !secondList.contains(under);
      }
      return evt.to !== secondList;
    };

    // Playlist: únicos, reordenable, elimina por derrame
    Sortable.create(secondList, {
      ...common,
      ...touchTweaks,
      group: {
        ...sharedGroup,
        put: (to, _from, dragged) => {
          const id = dragged?.dataset?.catalogIndex;
          if (!id) return false;
          for (const li of to.el.children) if (li.dataset.catalogIndex === id) return false;
          return true;
        },
        pull: true
      },
      removeOnSpill: true,
      onSpill: (evt) => safeRemoveByNode(evt.item),
      onRemove: (evt) => safeRemoveByNode(evt.item),
      onEnd: (evt) => {
        if (evt.from === secondList && isPointerOutsideSecondList(evt)) safeRemoveByNode(evt.item);
      },
      onAdd: updateQueue,
      onUpdate: updateQueue
    });
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

    const handleSearch = (event) => {
      const queryRaw = event.target.value || '';
      const query = queryRaw.toLowerCase().trim();
      const items = allTracksList.children;
      if (!query) {
        // show all — single pass
        for (let i = 0; i < items.length; i++) items[i].classList.remove('hidden');
        return;
      }

      if (query.startsWith('/')) {
        const factionKey = query.substring(1);
        for (let i = 0; i < items.length; i++) {
          const idx = parseInt(items[i].dataset.catalogIndex, 10);
          const t = catalog[idx];
          const match = t && (t.factions || []).includes(factionKey);
          items[i].classList.toggle('hidden', !match);
        }
        return;
      }
      if (query.startsWith('#')) {
        const gf = factionGroups[query.substring(1)] || [];
        for (let i = 0; i < items.length; i++) {
          const idx = parseInt(items[i].dataset.catalogIndex, 10);
          const t = catalog[idx];
          const match = t && (t.factions || []).some((tf) => gf.includes(tf));
          items[i].classList.toggle('hidden', !match);
        }
        return;
      }

      const normalizedQuery = normalizeString(query).toLowerCase();
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const idx = parseInt(item.dataset.catalogIndex, 10);
        if (isNaN(idx)) continue;
        const tokens = item.dataset.searchTokens || (catalog[idx]?._normalizedTitle || '');
        const isMatch = tokens.toLowerCase().includes(normalizedQuery);
        item.classList.toggle('hidden', !isMatch);
      }
    };
    searchInput.addEventListener('input', debounce(handleSearch, 250));
  }

  async function fetchWithRetry(url, options, retries = 3, backoff = 1000) {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url, options);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response;
      } catch (err) {
        if (i < retries - 1) await new Promise((res) => setTimeout(res, backoff));
        backoff *= 2;
      }
    }
    throw new Error(`Failed to fetch ${url} after ${retries} attempts.`);
  }
  async function fetchVariantGroupsData() {
    try {
      const response = await fetch(`${variantDataURL}?_=${Date.now()}`, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    } catch { return []; }
  }

  async function initializeApp() {
    try {
      const critical = [audioPlayer, allTracksList, secondList, btnPlayPause, imgPlayPause, btnLoop, imgLoop, trackName, factionName, timeDisplay, volumeSliderContainer];
      if (critical.some((el) => !el)) {
        (document.getElementById('appRoot') || document.body).innerHTML =
          `<div class="error-box"><h3>Initialization Error</h3><p>A critical UI component failed to load. Please check element IDs.</p></div>`;
        return;
      }

      const response = await fetchWithRetry(`${dataURL}?_=${Date.now()}`, { cache: 'no-cache' });
      catalog = await response.json();
      if (!Array.isArray(catalog)) throw new Error('Catalog data is not an array.');
      window.catalog = catalog;

      for (let i = 0; i < catalog.length; i++) {
        const track = catalog[i];
        const title = track?.titles?.en || '';
        track._normalizedTitle = normalizeString(title).toLowerCase();
      }

      const variantGroups = await fetchVariantGroupsData();
      if (variantManager) variantManager.load({ catalog, variantGroups });

      playQueue = [];
      reservedIndexSet = new Set();
      renderLibrary();
      renderPlaylist();

      setupSearchBar();
      setupEventListeners();
      setupSortable();
      updatePlayerControlsState();
      listLogoManager.start();

      imgPlayPause.src = `${imageBaseURL}/buttons/play_button.png`;
      imgLoop.src = `${imageBaseURL}/buttons/loop_button.png`;
    } catch (err) {
      const root = document.getElementById('appRoot') || document.body;
      root.innerHTML = `<div class="error-box"><h3>Failed to load catalog</h3><p>${String(err?.message || err)}</p></div>`;
    }
  }
  initializeApp();
});
