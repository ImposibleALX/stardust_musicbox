// —— Al principio de radioPlayer.js ——

// ---------- UI refs ----------
const ids = [
  'volumeBarBg', 'volumeBar', 'volumeValue', 'audioPlayer',
  'trackName', 'factionName', 'timeDisplay', 'volumeSliderContainer'
];
const [
  volumeBarBg, volumeBar, volumeValue, audioPlayer,
  trackName, factionName, timeDisplay, volumeSliderContainer
] = ids.map(id => document.getElementById(id));

// ---------- Config de sincronización ----------
const SYNC_ANCHOR_MS   = Date.UTC(2025, 0, 1); // Ancla estable 2025-01-01T00:00:00Z
const USE_UTC_FOR_SEED = true;                 // UTC
const PERIOD_SEED      = 'day';                // cambio diario
const DRIFT_TOLERANCE_SEC = 1.0;               // corrección de deriva (~1s)

// Tuning: frecuencias de corrección (ms)
const CORRECT_VISIBLE_MS = 1500;
const CORRECT_HIDDEN_MS  = 6000;

// ---------- Reloj global ----------
function nowMs() { return Date.now(); }
function getGlobalClockSec() { return (nowMs() - SYNC_ANCHOR_MS) / 1000; }

// ---------- Seed diaria cacheada (sin Date() continuo) ----------
let cachedPeriodSeed = null;
let nextSeedUpdateTimer = null;

function computePeriodSeed(period = PERIOD_SEED) {
  const d = new Date();
  const y  = USE_UTC_FOR_SEED ? d.getUTCFullYear()  : d.getFullYear();
  const mo = (USE_UTC_FOR_SEED ? d.getUTCMonth()    : d.getMonth()) + 1;
  const da = USE_UTC_FOR_SEED ? d.getUTCDate()      : d.getDate();
  const ho = USE_UTC_FOR_SEED ? d.getUTCHours()     : d.getHours();

  if (period === 'hour') {
    return (y * 1e6 + mo * 1e4 + da * 1e2 + ho) | 0; // YYYYMMDDHH
  }
  if (period === 'week') {
    const utcDate   = new Date(Date.UTC(y, mo - 1, da));
    const startYear = new Date(Date.UTC(y, 0, 1));
    const days = Math.floor((utcDate - startYear) / 86400000);
    const week = Math.floor((days + ((utcDate.getUTCDay() + 6) % 7)) / 7);
    return (y * 100 + week) | 0; // YYYYWW
  }
  // 'day' (YYYYMMDD)
  return (y * 1e4 + mo * 1e2 + da) | 0;
}

function msToNextUtcDay() {
  const n = new Date();
  const next = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1, 0, 0, 0));
  return next.getTime() - n.getTime();
}

function primePeriodSeed() {
  cachedPeriodSeed = computePeriodSeed(PERIOD_SEED);
  if (nextSeedUpdateTimer) clearTimeout(nextSeedUpdateTimer);
  // programa actualización exacta al cambio de día UTC
  nextSeedUpdateTimer = setTimeout(() => {
    cachedPeriodSeed = computePeriodSeed(PERIOD_SEED);
    purgeOldFactionCache();
    // Si hay facción sonando, re-sync para tomar el nuevo orden diario
    if (currentFaction) forceResync();
    scheduleSeedTick(); // por si la pestaña cambió de visibilidad
  }, msToNextUtcDay() + 50);
}
function scheduleSeedTick() {
  // re-arma el timer cuando vuelve a visible
  if (document.visibilityState === 'visible') {
    primePeriodSeed();
  }
}
primePeriodSeed();
document.addEventListener('visibilitychange', scheduleSeedTick, { passive: true });

// Posición t0 dentro del ciclo total
function getT0(totalDuration) {
  if (!isFinite(totalDuration) || totalDuration <= 0) return 0;
  const t = getGlobalClockSec() % totalDuration;
  return t < 0 ? 0 : t;
}

// ---------- Catálogo / estado ----------
const factionCache = Object.create(null); // cache rotativo por (facción:semilla)
let catalog = [];
let currentFaction = '';
let lastPlayRequestId = 0;

// Estado playback + controlador para limpiar listeners
let currentPlaylist = {
  faction: null,    // 'NoFactions' o facción
  tracks: [],       // array de tracks (orden barajado)
  durations: [],    // duraciones (Float32Array)
  prefix: [],       // prefix sums (Float64Array)
  index: 0,         // idx actual
  totalDuration: 0  // suma duraciones
};
let endedAbort = null; // AbortController para listeners 'ended'

// ---------- Rutas de audio ----------
const DEFAULT_AUDIO_BASE = '../assets/music/';
const audioBase = window.AUDIO_BASE_PATH || DEFAULT_AUDIO_BASE;
const audioRoot = audioBase.endsWith('/') ? audioBase : `${audioBase}/`;

// ---------- Nombres de facciones ----------
const baseFactionDisplayNames = {
  "bolar": "Bolar Federation",
  "dezariam": "Dezariam Nation",
  "gamilas": "Greater Garmillan Empire",
  "gatlantis": "White Comet / Gatlantis Empire",
  "uncf": "United Nations Cosmo Force",
  "arcadia": "Captain Harlock's Arcadia",
  "dinguil": "Dinguil Empire",
  "guia": "Great Urup Interstellar Alliance",
  "cis": "Confederacy of Independent Systems",
  "empire": "Galactic Empire",
  "republic": "Galactic Republic",
  "jedi": "Jedi Order",
  "atlantis": "ATLANTIS w/ Humans",
  "neoatlantis": "NEO ATLANTIS",
  "rebel": "Rebel Alliance",
  "unn": "United Nations Navy",
  "mcrn": "Martian Congressional Republic Navy",
  "opa": "Outer Planets Alliance",
  "fn": "Free Navy",
  "various": "The Expanse",
  "uns": "United Nations Spacy",
  "zentradi": "Zentradi"
};
const names = { ...baseFactionDisplayNames, ...(window.FACTION_DISPLAY_NAMES || {}) };
window.FACTION_DISPLAY_NAMES = names;

// ---------- Hash / PRNG ----------
function hashCode(str) {
  let hash = 0;
  for (let i = 0, len = str.length; i < len; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}
function mulberry32(a) {
  return () => {
    let t = (a += 0x6d2b89f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Helpers de playlist optimizados ----------
function buildPrefixSums(durations) {
  const n = durations.length;
  const prefix = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += durations[i];
    prefix[i] = acc;
  }
  return { prefix, total: acc };
}
function binarySearchPrefix(prefix, t0) {
  // encuentra el primer i con prefix[i] > t0
  let lo = 0, hi = prefix.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (prefix[mid] > t0) { ans = mid; hi = mid - 1; }
    else { lo = mid + 1; }
  }
  return ans;
}
function computeIndexAndOffsetByPrefix(prefix, durations, t0) {
  if (prefix.length === 0) return { idx: 0, offset: 0 };
  const idx = binarySearchPrefix(prefix, t0);
  const prev = idx > 0 ? prefix[idx - 1] : 0;
  const d = durations[idx] || 0;
  const offset = Math.min(Math.max(t0 - prev, 0), (d > 0 ? d - 0.01 : 0));
  return { idx, offset };
}

// ---------- Reproducción ----------
function handleCanPlay() {
  if (audioPlayer._playRequestId === lastPlayRequestId) {
    audioPlayer.play().catch(() => {});
  }
}
audioPlayer.addEventListener('canplay', handleCanPlay, { passive: true });

// Cambiar de facción
function playFaction(faction) {
  if (currentFaction === faction) return;
  audioPlayer.pause();
  currentFaction = faction;
  startFactionRadio(faction);
}

// Cache para la última src y evitar recargas innecesarias
let lastSrc = '';
function playTrack(track, offset = 0, faction, playRequestId, dispName = names[faction] || faction) {
  const filePath = `${audioRoot}${track.folder}/${track.file}`;
  if (lastSrc !== filePath) {
    lastSrc = audioPlayer.src = filePath;
    audioPlayer.load();
  }
  audioPlayer._playRequestId = playRequestId;
  audioPlayer.currentTime = offset;

  // Menos repaints: 1 RAF
  requestAnimationFrame(() => {
    const title = (track.titles?.en ?? '').trim();
    if (trackName.textContent !== (title || "Unknown Title")) {
      trackName.textContent = title || "Unknown Title";
    }
    const facText = faction === "NoFactions"
      ? `Factions: ${(track.factions || []).map(f => names[f] || f).join(", ") || "Unknown"}`
      : `Faction: ${dispName}`;
    if (factionName.textContent !== facText) {
      factionName.textContent = facText;
    }
  });
}

function cleanupEndedListener() {
  if (endedAbort) {
    endedAbort.abort();
    endedAbort = null;
  }
}

// Avanzar de track en modo facción
function playFactionTrack(faction, shuffledTracks, trackIndex, offset = 0, dispName = null) {
  if (currentFaction !== faction || !shuffledTracks[trackIndex]) return;
  const playRequestId = ++lastPlayRequestId;

  // Actualiza estado actual (sin recomputar total Duration cada vez)
  currentPlaylist.faction  = faction;
  currentPlaylist.tracks   = shuffledTracks;
  currentPlaylist.index    = trackIndex;

  playTrack(shuffledTracks[trackIndex], offset, faction, playRequestId, dispName);

  cleanupEndedListener();
  endedAbort = new AbortController();
  const onTrackEnded = makeTrackEndedHandler(faction, shuffledTracks, trackIndex, playRequestId, dispName);
  audioPlayer.addEventListener('ended', onTrackEnded, { once: true, signal: endedAbort.signal });

  const remainingTime = (currentPlaylist.durations[trackIndex] || shuffledTracks[trackIndex].duration || 0) - offset;
  if (remainingTime < 0.05 || !isFinite(remainingTime)) {
    audioPlayer.dispatchEvent(new Event('ended'));
  }
}

// Core de la radio sincronizada por reloj global (O(log n))
function startRadio(info, label, dispName = null) {
  const { tracks, durations, prefix, total } = info;
  if (!tracks.length || total <= 0) return;

  const t0 = getT0(total);
  const { idx, offset } = computeIndexAndOffsetByPrefix(prefix, durations, t0);

  // Sin loops lineales aquí
  currentPlaylist.totalDuration = total;
  playFactionTrack(label, tracks, idx, offset, dispName);
}

// Construye/obtiene playlist info cacheada para una etiqueta (facción o NoFactions)
function getOrBuildInfoForLabel(label, trackSelectorFn, seed) {
  const cacheKey = `${label}:${seed}`;
  let info = factionCache[cacheKey];
  if (!info) {
    purgeOldFactionCache(); // conservar liviano

    const rng = mulberry32(((hashCode(label) ^ seed) >>> 0));

    // Selección + barajado con una sola pasada
    const base = trackSelectorFn(catalog);
    const tracks = shuffleArray(base, rng);

    // Materializa duraciones una única vez
    const n = tracks.length;
    const durations = new Float32Array(n);
    for (let i = 0; i < n; i++) durations[i] = Math.max(0, tracks[i].duration || 0);

    const { prefix, total } = buildPrefixSums(durations);

    info = factionCache[cacheKey] = { tracks, durations, prefix, total };
  }
  return info;
}

// Inicia radio sincronizada para una facción (shuffle determinista diario UTC)
function startFactionRadio(faction) {
  const dispName = faction === "NoFactions" ? null : (names[faction] || faction);
  const seed = cachedPeriodSeed; // sin Date() extra

  const info = getOrBuildInfoForLabel(
    faction,
    (all) => {
      // Una pasada: filtra y evita .filter() doble
      const out = [];
      for (let i = 0; i < all.length; i++) {
        const t = all[i];
        if ((t.duration > 0) && t.factions && t.factions.includes(faction)) out.push(t);
      }
      return out;
    },
    seed
  );

  // Cachea arrays en currentPlaylist (para drift)
  currentPlaylist.durations    = info.durations;
  currentPlaylist.prefix       = info.prefix;
  currentPlaylist.totalDuration= info.total;

  startRadio(info, faction, dispName);
}

// Modo "No Factions" con semilla determinista diaria UTC
function playNoFactions() {
  if (currentFaction === "NoFactions") return;

  audioPlayer.pause();
  currentFaction = "NoFactions";

  const seed = cachedPeriodSeed;

  const info = getOrBuildInfoForLabel(
    "NoFactions",
    (all) => {
      const out = [];
      for (let i = 0; i < all.length; i++) {
        const t = all[i];
        if (t.file && !bannedNoFactions.has(t.id) && (t.duration > 0)) out.push(t);
      }
      return out;
    },
    seed
  );

  if (!info.tracks.length) {
    trackName.textContent  = "No tracks available";
    factionName.textContent = "No Factions";
    currentPlaylist = { faction: "NoFactions", tracks: [], durations: [], prefix: [], index: 0, totalDuration: 0 };
    return;
  }

  currentPlaylist.durations    = info.durations;
  currentPlaylist.prefix       = info.prefix;
  currentPlaylist.totalDuration= info.total;

  startRadio(info, "NoFactions");
}

// Limpieza simple del caché para conservar solo la semilla vigente
function purgeOldFactionCache() {
  const suffix = `:${cachedPeriodSeed}`;
  for (const k in factionCache) {
    if (!k.endsWith(suffix)) delete factionCache[k];
  }
}

// Listener once:true para fin de track
function makeTrackEndedHandler(faction, tracks, index, requestId, dispName = null) {
  return function () {
    if (currentFaction !== faction || requestId !== lastPlayRequestId) return;
    const nextIndex = (index + 1) % tracks.length;
    playFactionTrack(faction, tracks, nextIndex, 0, dispName);
  };
}

// Shuffle determinista usando un RNG inyectado (Fisher-Yates)
function shuffleArray(array, rng) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

const HASH_NO_FACTIONS = hashCode("NoFactions");

// ---------- UI: tiempo y media keys ----------
let lastRenderSec = -1;
audioPlayer.ontimeupdate = () => {
  const sec = (audioPlayer.currentTime | 0);
  if (sec === lastRenderSec) return;
  lastRenderSec = sec;
  const min = (sec / 60) | 0;
  const s2  = (sec % 60 + 100).toString().slice(1);
  const txt = `${min}:${s2}`;
  if (timeDisplay.textContent !== txt) timeDisplay.textContent = txt;
  updateSyncDebug(); // coalesced
};

// Forzar RESYNC al reanudar
document.addEventListener('keydown', function (e) {
  if (e.code === 'MediaPlayPause' || e.keyCode === 179) {
    if (audioPlayer.paused) {
      forceResync(); // recalcula según reloj global y retoma exacto
    } else {
      audioPlayer.pause();
    }
    e.preventDefault();
  }
}, { passive: false });

// ---------- Badges / Debug UI ----------
let syncDebugEl = null;
let lastDebugText = '';
function ensureSyncDebugEl() {
  if (syncDebugEl) return syncDebugEl;
  syncDebugEl = document.createElement('div');
  syncDebugEl.id = 'syncDebug';
  syncDebugEl.style.cssText = `
    position: absolute; right: 8px; bottom: 8px;
    font: 500 12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    padding: 6px 8px; border-radius: 8px;
    background: rgba(0,0,0,.55); color: #fff;
    pointer-events: none; z-index: 9999;
  `;
  (volumeSliderContainer || document.body).appendChild(syncDebugEl);
  return syncDebugEl;
}
function formatMMSS(sec) {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const s = sec | 0;
  const m = (s / 60) | 0;
  const r = (s % 60 + 100).toString().slice(1);
  return `${m}:${r}`;
}
function updateSyncDebug() {
  const el = ensureSyncDebugEl();
  const periodLabel = (PERIOD_SEED === 'day' ? 'Daily' : PERIOD_SEED === 'hour' ? 'Hourly' : 'Weekly') + (USE_UTC_FOR_SEED ? ' UTC' : ' Local');
  const td = currentPlaylist.totalDuration || 0;
  const t0 = td > 0 ? getT0(td) : 0;
  const text = `Shuffle: ${periodLabel} | t0=${formatMMSS(t0)}`;
  if (text !== lastDebugText) {
    lastDebugText = text;
    el.textContent = text;
  }
}

// ---------- Corrección de deriva (adaptativa con visibilidad) ----------
let correctTimer = null;
function scheduleCorrectLoop() {
  if (correctTimer) clearInterval(correctTimer);
  const interval = (document.visibilityState === 'visible') ? CORRECT_VISIBLE_MS : CORRECT_HIDDEN_MS;
  correctTimer = setInterval(() => {
    correctDriftIfNeeded();
    updateSyncDebug();
  }, interval);
}
document.addEventListener('visibilitychange', scheduleCorrectLoop, { passive: true });
scheduleCorrectLoop();

function computeIndexAndOffset(tracks, totalDuration) {
  // Usa las estructuras precomputadas para O(log n)
  if (!currentPlaylist.prefix.length || totalDuration <= 0) return { idx: 0, offset: 0 };
  const t0 = getT0(totalDuration);
  return computeIndexAndOffsetByPrefix(currentPlaylist.prefix, currentPlaylist.durations, t0);
}

function correctDriftIfNeeded() {
  if (!currentPlaylist.tracks.length) return;
  if (audioPlayer.paused) return;

  const expected = computeIndexAndOffset(currentPlaylist.tracks, currentPlaylist.totalDuration);
  const playingIdx = currentPlaylist.index;
  const isSameTrack = (expected.idx === playingIdx);
  const delta = isSameTrack ? Math.abs((audioPlayer.currentTime || 0) - expected.offset) : Infinity;

  if (!isSameTrack || delta > DRIFT_TOLERANCE_SEC) {
    playFactionTrack(
      currentPlaylist.faction,
      currentPlaylist.tracks,
      expected.idx,
      expected.offset,
      currentPlaylist.faction === "NoFactions" ? null : (names[currentPlaylist.faction] || currentPlaylist.faction)
    );
  }
}

// ---------- Forzar RESYNC público ----------
function forceResync() {
  if (!currentFaction) return;
  if (currentFaction === 'NoFactions') {
    playNoFactions();
  } else {
    startFactionRadio(currentFaction);
  }
  audioPlayer.play().catch(() => {});
}
window.forceResync = forceResync;

// ---------- IDs de tracks baneados (No Factions) ----------
const bannedNoFactions = new Set([
  "guia_emperor_1_allegro",
  "arcadia_captainharlock_instrumental",
  "arcadia_captainharlock",
  "arcadia_deathshadow"
]);

// ---------- Volumen: integración con volumecontrol.js ----------
function initVolumeControllerOnce() {
  if (typeof initVolumeControl !== 'function') return;       // módulo aún no cargado
  if (window.volumeController) return;                       // ya inicializado

  // Usa el bg preferente; si no existe, cae al contenedor principal
  const bgEl = volumeBarBg || volumeSliderContainer || null;
  if (!audioPlayer || !bgEl) return;

  // Asegura atributos de accesibilidad
  try {
    bgEl.setAttribute('role', 'slider');
    bgEl.setAttribute('aria-valuemin', '0');
    bgEl.setAttribute('aria-valuemax', '100');
    bgEl.setAttribute('tabindex', '0');
  } catch (_) {}

  const vc = initVolumeControl({
    audioEl: audioPlayer,
    bgEl,
    barEl: volumeBar || null,
    labelEl: volumeValue || null
  });

  // Sync ARIA en cada cambio del control
  const updateAria = () => {
    const v = vc.getVolume ? vc.getVolume() : audioPlayer.volume || 0;
    const p = Math.round(v * 100);
    bgEl.setAttribute('aria-valuenow', String(p));
  };

  // Eventos del propio control y del audio (por si alguien cambia volume por código)
  bgEl.addEventListener('vc:change', updateAria);
  audioPlayer.addEventListener('volumechange', updateAria);
  updateAria();

  // Exponer para debug
  window.volumeController = vc;
}

// Intenta inicializar al cargar el archivo (si el DOM ya tiene los nodos)
initVolumeControllerOnce();

// ---------- setCatalog ----------
window.setCatalog = function (data) {
  catalog = data;
  trackName.textContent   = "Choose your faction to start";
  factionName.textContent = "Choose your faction to start";

  // Inicialización segura del control de volumen (fallback si aún no estaba listo)
  if (typeof initVolumeControl === 'function' && window.volumeController == null) {
    initVolumeControllerOnce();
  }

  purgeOldFactionCache();
  updateSyncDebug();
};
