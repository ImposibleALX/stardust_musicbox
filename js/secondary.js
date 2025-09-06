// —— Helpers (con nuevas adiciones) ——
function createElement(tag, { className, text, html, ...attrs } = {}) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  if (html) el.innerHTML = html;
  Object.entries(attrs).forEach(([key, val]) => {
    el.setAttribute(key, val);
  });
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
    const handler = () => {
      audio.removeEventListener('canplaythrough', handler);
      resolve();
    };
    audio.addEventListener('canplaythrough', handler);
  });
}

function debounce(func, delay = 300) {
    let timeoutId;
    return function(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}

function normalizeString(str) {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}


// —— Variables Globales (solo datos, no elementos DOM) ——
// [DTP #8] These variables form the authoritative state of the player.
let catalog = [];
let playQueue = []; // This array is the single source of truth for the playlist.
let currentIndexInQueue = 0;
let currentlyPlayingCatalogIndex = -1; // Tracks the specific ID of the playing song.
let isLooping = false;
let animationFrameId_timer;

// Rutas base y de datos
const baseURL = "https://imposiblealx.github.io/stardust_musicbox/assets/images";
const musicBaseURL = "../assets/music";
const dataURL = "../assets/data/music_catalog_all.json";

// Datos de facciones y grupos
const factionDisplayNames = {
  bolar: "Bolar Federation", dezariam: "Dezariam Nation", gamilas: "Greater Garmillan Empire",
  gatlantis: "White Comet / Gatlantis Empire", uncf: "United Nations Cosmo Force",
  arcadia: "Captain Harlock's Arcadia", dinguil: "Dinguil Empire", various: "THE EXPANSE",
  guia: "Great Urup Interstellar Alliance", cis: "Confederacy of Independent Systems",
  empire: "Galactic Empire", republic: "Galactic Republic", jedi: "Jedi Order",
  atlantis: "ATLANTIS w/ Humans", neoatlantis: "NEO ATLANTIS", rebel: "Rebel Alliance",
  unn: "United Nations Navy", mcrn: "Martian Republic Navy", opa: "Outer Planets Alliance", fn: "Free Navy",
  zentradi: "Zentradi", uns: "United Nations Spacy"
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
  atlantis: `${baseURL}/logos/atlantis_logo.png`,
  neoatlantis: `${baseURL}/logos/neoatlantis_logo.png`,
  rebel: `${baseURL}/logos/rebel_logo.png`,
  unn: `${baseURL}/mini_logos/unn_logo.png`,
  mcrn: `${baseURL}/mini_logos/mcrn_logo.png`,
  opa: `${baseURL}/mini_logos/opa_logo.png`,
  fn: `${baseURL}/mini_logos/fn_logo.png`,
  atlantis: `${baseURL}/mini_logos/atlantis_logo.png`,
  neoatlantis: `${baseURL}/mini_logos/neoatlantis_logo.png`,
  zentradi: `${baseURL}/mini_logos/zentradi_logo.png`,
  uns: `${baseURL}/mini_logos/uns_logo.png`,
};

const factionGroups = {
    sby: ['uncf', 'bolar', 'gamilas', 'gatlantis', 'dinguil', 'dezariam', 'guia'],
    expanse: ['mcrn', 'opa', 'fn', 'unn'],
    nadia: ['neoatlantis', 'atlantis'],
    starwars: ['republic', 'empire', 'rebel', 'cis'],
    macross: ['uns', 'zentradi']
};


// —— Definiciones de Gestores (optimizados) ——
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
      const factionKey = factions.length === 1 ? factions[0] : null;
      imageElement.src = factionKey ? (factionLogos[factionKey] || '') : '';
      return;
    }
    let currentIndex = 0;
    const rotate = () => {
      const factionKey = factions[currentIndex % factions.length];
      if (factionLogos[factionKey]) imageElement.src = factionLogos[factionKey];
      currentIndex++;
    };
    rotate();
    timerId = setInterval(rotate, 4000);
  };
  return { start, stop };
}

function createListLogoManager() {
  let animationFrameId = null;
  let lastTickTime = 0;
  const interval = 3000;
  let tick = 0;

  const visibleRotators = new Set();
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) visibleRotators.add(entry.target);
      else visibleRotators.delete(entry.target);
    });
  }, { root: null, threshold: 0.1 });
  
  function rotateLoop(timestamp) {
    if (!lastTickTime) lastTickTime = timestamp;
    const elapsed = timestamp - lastTickTime;

    if (elapsed >= interval) {
      lastTickTime = timestamp;
      tick++;
      visibleRotators.forEach(imgElement => {
        const factions = imgElement.dataset.factions.split(',');
        const currentFaction = factions[tick % factions.length];
        const newSrc = factionLogos[currentFaction];
        if (newSrc && imgElement.src !== newSrc) imgElement.src = newSrc;
      });
    }
    animationFrameId = requestAnimationFrame(rotateLoop);
  }

  const start = () => {
    if (animationFrameId) return;
    requestAnimationFrame(rotateLoop);
  };
  const observe = (imageElement) => observer.observe(imageElement);
  return { observe, start };
}


// —— INICIA LA APLICACIÓN CUANDO EL DOM ESTÉ LISTO ——
document.addEventListener('DOMContentLoaded', () => {

  // 1. OBTENER ELEMENTOS DEL DOM
  const {
    audioPlayer, trackName, factionName, timeDisplay, btnPlayPause, imgPlayPause,
    btnLoop, imgLoop, allTracksList, secondList, volumeSliderContainer, volumeValue, volumeBar
  } = ['audioPlayer', 'trackName', 'factionName', 'timeDisplay', 'btnPlayPause', 'imgPlayPause', 'btnLoop', 'imgLoop', 'allTracksList', 'secondList', 'volumeSliderContainer', 'volumeValue', 'volumeBar']
    .reduce((o, id) => (o[id] = document.getElementById(id), o), {});

  // 2. INSTANCIAR GESTORES Y PRECargador
  const playerLogoRotator = createPlayerLogoRotator(document.querySelector('.faction-section img'));
  const listLogoManager = createListLogoManager();
  
  const preloader = {
      element: document.createElement('audio'),
      init() { this.element.preload = 'metadata'; },
      preload(track) {
          if (!track) return;
          const filePath = `${musicBaseURL}/${track.folder}/${track.file}`;
          if (this.element.src !== filePath) {
              this.element.src = filePath;
              this.element.load();
          }
      }
  };
  preloader.init();


  // 3. DEFINIR FUNCIONES PRINCIPALES QUE DEPENDEN DEL DOM
  async function playSingleTrackByIndex(catalogIndex, offset = 0) {
    const track = catalog[catalogIndex];
    
    // [DTP #7] Validate track object before playback to prevent runtime errors.
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

    const filePath = `${musicBaseURL}/${track.folder}/${track.file}`;
    if (audioPlayer.src !== filePath) {
        audioPlayer.src = filePath;
        audioPlayer.load();
    }
    
    try {
      await waitForCanPlay(audioPlayer);
      audioPlayer.currentTime = offset;
      await audioPlayer.play();
    } catch (err) {
      if (err.name !== 'AbortError') console.error('Playback error:', err);
    }

    trackName.textContent = track.titles?.en?.trim() || 'Unknown Title';
    const factionsText = (track.factions || []).map(f => factionDisplayNames[f] || f).join(', ');
    factionName.textContent = `Factions: ${factionsText || 'Unknown'}`;
    playerLogoRotator.start(track);
    updateActiveTrackVisuals();
  }

  function renderTrackList(containerEl, trackIndices) {
    const frag = document.createDocumentFragment();
    trackIndices.forEach(index => {
      const track = catalog[index];
      if (!track) return;
      const li = createElement('li', { 'data-catalog-index': index, draggable: 'true' });
      const titleSpan = createElement('span', { className: 'track-title', text: track.titles?.en?.trim() || 'Unknown Title' });
      const durationSpan = createElement('span', { className: 'track-duration', text: formatTime(track.duration || 0) });
      const factionSpan = createElement('span', { className: 'track-faction' });
      const factions = track.factions || [];
      if (factions.length > 0) {
        const img = createElement('img', { src: factionLogos[factions[0]], alt: factionDisplayNames[factions[0]] || factions[0], title: factionDisplayNames[factions[0]] || factions[0], loading: 'lazy' });
        if (factions.length > 1) {
          img.dataset.factions = factions.join(',');
          listLogoManager.observe(img);
        }
        factionSpan.appendChild(img);
      }
      li.append(titleSpan, durationSpan, factionSpan);
      frag.appendChild(li);
    });
    containerEl.replaceChildren(frag);
    updateActiveTrackVisuals();
  }
  
  // [DTP #6] Centralized function to reset the UI and player state.
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
  
  // [DTP #2] Dedicated handler for robust track removal.
  function handleTrackRemoval(removedCatalogIndex, oldQueueIndex) {
      const wasPlaying = (removedCatalogIndex === currentlyPlayingCatalogIndex);
      
      // First, update the internal state to reflect the removal.
      updateQueue(); 

      if (wasPlaying) {
          if (playQueue.length === 0) {
              stopPlaybackAndResetUI();
          } else {
              // Play the next track relative to the one that was removed.
              const newIndexToPlay = oldQueueIndex % playQueue.length;
              currentIndexInQueue = newIndexToPlay;
              playSingleTrackByIndex(playQueue[currentIndexInQueue]);
          }
      }
  }
  
  // [DTP #3] A safety check to ensure the currently playing track still exists in the queue.
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
  }

  // [DTP #8] This function is central to maintaining state. It syncs the playQueue array
  // with the DOM and updates all related player states.
  function updateQueue() {
    playQueue = Array.from(secondList.children).map(li => Number(li.dataset.catalogIndex));

    // [DTP #5] Recompute the current index after a reorder to maintain playback flow.
    if (currentlyPlayingCatalogIndex !== -1) {
        const newIdx = playQueue.indexOf(currentlyPlayingCatalogIndex);
        if (newIdx !== -1) {
            currentIndexInQueue = newIdx;
        } else {
             // [DTP #3] The playing track was removed, validate and reset.
            validateCurrentAudioSource();
        }
    }
    
    // [DTP #4] Ensure the audio element's loop property is always in sync with the state.
    // This prevents a deleted track from looping if it was the only one in the playlist.
    audioPlayer.loop = isLooping && playQueue.length === 1;

    updatePlayerControlsState();
    updateActiveTrackVisuals();
  }

  function startTimerUpdates() {
    if (animationFrameId_timer) cancelAnimationFrame(animationFrameId_timer);
    function update() {
        if (!audioPlayer.paused) {
            timeDisplay.textContent = formatTime(audioPlayer.currentTime);
            animationFrameId_timer = requestAnimationFrame(update);
        }
    }
    animationFrameId_timer = requestAnimationFrame(update);
  }

  function stopTimerUpdates() {
      if (animationFrameId_timer) cancelAnimationFrame(animationFrameId_timer);
      animationFrameId_timer = null;
  }
  
  function updateActiveTrackVisuals() {
    const listItems = secondList.children;
    for (const item of listItems) {
        const itemIndex = Number(item.dataset.catalogIndex);
        item.classList.toggle('active', itemIndex === currentlyPlayingCatalogIndex);
    }
  }

  // 4. CONFIGURAR EVENTOS Y SORTABLE
  function setupEventListeners() {
    secondList.addEventListener('click', e => {
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
        if (audioPlayer.src) {
            audioPlayer.play();
        } else if (playQueue.length > 0) {
            playSingleTrackByIndex(playQueue[0]);
        }
      } else {
        audioPlayer.pause();
      }
    });

    // [DTP #1] Clicking the loop button toggles the state and updates the audio element's loop property.
    btnLoop.addEventListener('click', () => {
      isLooping = !isLooping;
      audioPlayer.loop = isLooping && playQueue.length === 1;
      
      btnLoop.title = isLooping ? 'Loop On' : 'Loop Off';
      imgLoop.classList.toggle('active', isLooping);
      btnLoop.classList.toggle('active', isLooping);
    });
    
    audioPlayer.addEventListener('play', () => {
        imgPlayPause.src = `${baseURL}/buttons/pause_button.png`;
        startTimerUpdates();
        updateActiveTrackVisuals();
    });
    audioPlayer.addEventListener('pause', () => {
        imgPlayPause.src = `${baseURL}/buttons/play_button.png`;
        stopTimerUpdates();
    });
    
    // [DTP #1] This handler defines the playback flow when a track ends.
    audioPlayer.addEventListener('ended', () => {
        stopTimerUpdates();
        timeDisplay.textContent = formatTime(0);
        
        if (playQueue.length === 0) {
          stopPlaybackAndResetUI();
          return;
        }

        // If native HTML5 audio loop is active (for single track loop), let it handle itself.
        if (audioPlayer.loop) return;

        if (isLooping) {
            // Loop ON, multiple tracks: Replay the current track.
            playSingleTrackByIndex(playQueue[currentIndexInQueue]);
        } else {
            // Loop OFF: Advance to the next track, and wrap around to the start at the end of the playlist.
            currentIndexInQueue = (currentIndexInQueue + 1) % playQueue.length;
            playSingleTrackByIndex(playQueue[currentIndexInQueue]);
        }
    });

    // Se inicializa el control de volumen llamando a la API externa
    if (typeof initVolumeControl === 'function') {
      initVolumeControl({
        audioEl: audioPlayer,
        bgEl: volumeSliderContainer,
        barEl: volumeBar,
        labelEl: volumeValue
      });
    }

    [allTracksList, secondList].forEach(el => {
      el.addEventListener('wheel', e => {
        e.preventDefault();
        e.currentTarget.scrollTop += e.deltaY;
      });
    });
  }

  // Lógica de SortableJS completamente reescrita para #secondList.
  function setupSortable() {
    // Se añaden las comprobaciones aquí
    if (!allTracksList || !secondList) {
      console.error('No se encontraron los contenedores de listas de reproducción (#allTracksList, #secondList) para inicializar Sortable.js.');
      return;
    }
    Sortable.create(allTracksList, {
      group: { name: 'shared', pull: 'clone', put: false },
      animation: 150,
      sort: false
    });
    
    Sortable.create(secondList, {
      group: {
          name: 'shared',
          put: function (to, from, draggedEl) {
            const newTrackId = draggedEl.dataset.catalogIndex;
            const existingTrackIds = Array.from(to.el.children).map(li => li.dataset.catalogIndex);
            // Previene que se añadan duplicados a la playlist.
            return !existingTrackIds.includes(newTrackId);
          }
      },
      animation: 150,
      onAdd: updateQueue,    // Se dispara al añadir un track desde la lista principal.
      onUpdate: updateQueue, // Se dispara al reordenar tracks dentro de la playlist.
      
      // Nueva lógica para reemplazar 'removeOnSpill'.
      // El evento onEnd se dispara al final de cualquier operación de arrastre.
      onEnd: (evt) => {
        // Obtenemos el elemento sobre el que se soltó el track usando las coordenadas del evento.
        const dropTarget = document.elementFromPoint(evt.originalEvent.clientX, evt.originalEvent.clientY);

        // Verificamos si el track se soltó FUERA del contenedor de la playlist (#secondList).
        // El método .contains() también cubre el caso de soltar en el espacio vacío DENTRO de la lista.
        if (!secondList.contains(dropTarget)) {
          const removedItem = evt.item; // El elemento <li> que fue arrastrado.
          const removedCatalogIndex = Number(removedItem.dataset.catalogIndex);
          const originalIndex = evt.oldDraggableIndex; // El índice original del track.

          // 1. Eliminamos el elemento del DOM.
          // SortableJS revierte el elemento a su lugar original si el drop es inválido,
          // así que lo eliminamos desde ahí.
          if(removedItem.parentNode) {
            removedItem.parentNode.removeChild(removedItem);
          }
          
          // 2. Disparamos nuestra función personalizada para actualizar el estado del reproductor.
          handleTrackRemoval(removedCatalogIndex, originalIndex);
        }
      }
    });
  }

  // 5. NUEVAS FUNCIONES PARA LA BÚSQUEDA
  function injectSearchBarCSS() {
      const style = createElement('style', { html: `
        .search-container { margin-bottom: 16px; position: relative; }
        #trackSearchInput {
          width: 100%; padding: 10px 12px;
          font-family: 'Orbitron', sans-serif; font-size: 1rem; font-weight: 500;
          background-color: #080816; color: #ddd;
          border: 1px solid #333; border-radius: 8px;
          outline: none;
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
        .controls button.disabled, .player-controls button.disabled {
            opacity: 0.4;
            cursor: not-allowed;
            filter: grayscale(80%);
        }
        #secondList li.active { background-color: #24243aff; border-left: 3px solid #6cf; }
      `});
      document.head.appendChild(style);
  }
  
  function setupSearchBar() {
      const listContainer = allTracksList.closest('.manual-list');
      const heading = listContainer.querySelector('h2');
      
      const searchContainer = createElement('div', { className: 'search-container' });
      const searchInput = createElement('input', {
          type: 'search',
          id: 'trackSearchInput',
          placeholder: 'Search by title, /faction, or #franchise'
      });

      searchContainer.appendChild(searchInput);
      heading.after(searchContainer);
      
      const SANITIZE_REGEX = /^[A-Za-z0-9 _\-\/#]{0,50}$/;

      const handleSearch = (event) => {
          const rawQuery = event.target.value;

          if (!SANITIZE_REGEX.test(rawQuery)) {
              event.target.value = rawQuery.slice(0, -1);
              return;
          }

          const query = rawQuery.toLowerCase().trim();
          const listItems = allTracksList.children;

          for (const item of listItems) {
              const catalogIndex = parseInt(item.dataset.catalogIndex, 10);
              const track = catalog[catalogIndex];
              if (!track) continue;

              let isMatch = false;
              if (!query) {
                  isMatch = true;
              } else if (query.startsWith('/')) {
                  const factionQuery = query.substring(1);
                  isMatch = track.factions?.includes(factionQuery);
              } else if (query.startsWith('#')) {
                  const groupQuery = query.substring(1);
                  const groupFactions = factionGroups[groupQuery] || [];
                  isMatch = track.factions?.some(tf => groupFactions.includes(tf));
              } else {
                  const normalizedTitle = normalizeString(track.titles.en);
                  const normalizedQuery = normalizeString(query);
                  isMatch = normalizedTitle.toLowerCase().includes(normalizedQuery);
              }

              item.classList.toggle('hidden', !isMatch);
          }
      };

      searchInput.addEventListener('input', debounce(handleSearch, 300));
  }


  // 6. INICIALIZACIÓN PRINCIPAL
  async function initializeApp() {
  try {
    // Prefer no-cache + query param para evitar versiones stale en GH Pages / navegador
    const fetchUrl = `${dataURL}?_=${Date.now()}`;
    console.log('Fetching catalog ->', fetchUrl);
    const response = await fetch(fetchUrl, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    catalog = await response.json();
    // útil para debug temporalmente
    window.catalog = catalog;

    playQueue = [];

    const allTrackIndices = catalog.map((_, i) => i);
    renderTrackList(allTracksList, allTrackIndices);
    // expose for console debugging
    window.renderTrackList = renderTrackList;

    // sanity check: si el número de <li> no coincide con catalog.length, reintentar forzando otro fetch
    if (allTracksList.children.length !== catalog.length) {
      console.warn('Mismatch between catalog length and DOM children — retrying with hard reload.');
      const resp2 = await fetch(`${dataURL}?_=${Date.now()}&retry=1`, { cache: 'no-cache' });
      if (resp2.ok) {
        catalog = await resp2.json();
        window.catalog = catalog;
        renderTrackList(allTracksList, catalog.map((_, i) => i));
        console.log('Re-rendered after retry — children:', allTracksList.children.length, 'catalog:', catalog.length);
      }
    }

    renderTrackList(secondList, playQueue);
    injectSearchBarCSS();
    setupSearchBar();
    setupEventListeners();
    setupSortable();
    updatePlayerControlsState();
    listLogoManager.start();

    imgPlayPause.src = `${baseURL}/buttons/play_button.png`;
    btnLoop.title = 'Loop Off';
  } catch (error) {
    console.error("Failed to initialize application:", error);
    trackName.textContent = "Error loading catalog.";
    }
  }
  initializeApp();
});