// —— Al principio de main.js ——
const ids = ['volumeBarBg', 'volumeBar', 'volumeValue', 'audioPlayer', 'trackName', 'factionName', 'timeDisplay', 'volumeSliderContainer'];
const [volumeBarBg, volumeBar, volumeValue, audioPlayer, trackName, factionName, timeDisplay, volumeSliderContainer] = ids.map(id => document.getElementById(id));

const factionCache   = {};

function handleCanPlay() {
  if (audioPlayer._playRequestId === lastPlayRequestId) {
    audioPlayer.play().catch(err => console.error(err));
  }
}
audioPlayer.addEventListener('canplay', handleCanPlay);

let catalog = [];
let currentFaction = '';
const START_DATE_MS = Date.UTC(2025, 0, 1);
const perfOrigin    = performance.timeOrigin || (Date.now() - performance.now());
const baseEpoch     = START_DATE_MS - perfOrigin;

const startMs = performance.now();
function getElapsedSeconds() {
    return (performance.now() - startMs) / 1000;
}

function getAdjustedTime(totalDuration) {
    if (!isFinite(totalDuration) || totalDuration <= 0) return 0;
    let t = getElapsedSeconds() % totalDuration;
    return t < 0 ? 0 : t;
}

const factionDisplayNames = {
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
};

const names = factionDisplayNames; // Cache para lookups frecuentes

// Helper hashCode optimizado (sin recalcular bits innecesarios)
function hashCode(str) {
    let hash = 0;
    for (let i = 0, len = str.length; i < len; i++) {
        hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return hash;
}

// mulberry32 optimizado, usando el seed directamente
function mulberry32(a) {
    return () => {
        let t = (a += 0x6d2b89f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

let lastPlayRequestId = 0;

// Reproducir música de una facción seleccionada
function playFaction(faction) {
    if (currentFaction === faction) return;
    audioPlayer.pause();
    currentFaction = faction;
    startFactionRadio(faction);
}

// Minimiza las búsquedas de propiedades en playTrack()
let lastSrc = ''; // Cache para la última ruta cargada
function playTrack(track, offset = 0, faction, playRequestId, dispName = names[faction] || faction) {
    const filePath = `../assets/music/${track.folder}/${track.file}`;
    if (lastSrc !== filePath) {
        lastSrc = audioPlayer.src = filePath; 
        audioPlayer.load();
    }
    audioPlayer._playRequestId = playRequestId;
    audioPlayer.currentTime = offset;

    // Las líneas de volumen que causaban el error han sido eliminadas.
    // La UI se actualiza correctamente dentro de requestAnimationFrame.
    requestAnimationFrame(() => {
        trackName.textContent = track.titles?.en?.trim() || "Unknown Title";
        factionName.textContent = faction === "NoFactions"
            ? `Factions: ${(track.factions || []).map(f => names[f] || f).join(", ") || "Unknown"}`
            : `Faction: ${dispName}`;
    });
}

// Avanza de track en modo facción
function playFactionTrack(faction, shuffledTracks, trackIndex, offset = 0, dispName = null) {
    if (currentFaction !== faction || !shuffledTracks[trackIndex]) return; // Guard clause temprano
    const playRequestId = ++lastPlayRequestId;
    playTrack(shuffledTracks[trackIndex], offset, faction, playRequestId, dispName);

    const onTrackEnded = makeTrackEndedHandler(faction, shuffledTracks, trackIndex, playRequestId, dispName);
    audioPlayer.addEventListener('ended', onTrackEnded, { once: true });

    const remainingTime = (shuffledTracks[trackIndex].duration || 0) - offset;
    if (remainingTime < 0.05 || !isFinite(remainingTime)) {
        audioPlayer.dispatchEvent(new Event('ended')); // Evita el uso de setTimeout
    }
}

// Pre-filtra tracks válidos y calcula la duración total
function startRadio(tracks, totalDuration, label, dispName = null) {
    const validTracks = tracks.filter(t => t.duration > 0); // Filtra tracks válidos
    if (!validTracks.length || totalDuration <= 0) return;

    const t0 = getElapsedSeconds() % totalDuration;
    let accumulated = 0, idx = 0, offset = 0;

    for (const [i, { duration }] of validTracks.entries()) {
        if (accumulated + duration > t0) {
            idx = i;
            offset = Math.min(Math.max(t0 - accumulated, 0), duration - 0.01);
            break;
        }
        accumulated += duration;
    }
    playFactionTrack(label, validTracks, idx, offset, dispName);
}

// Inicia la radio sincronizada para una facción
function startFactionRadio(faction) {
    const dispName = faction === "NoFactions"
        ? null
        : (names[faction] || faction);
    let info = factionCache[faction];
    if (!info) {
        // Usamos las funciones globales, es más limpio y eficiente.
        const hash = hashCode(faction);
        const rng = mulberry32(hash + 0x6d2b89f5);

        const tracks = [];
        let totalDuration = 0;

        for (const t of catalog) {
            if (t.factions?.includes(faction) && t.duration > 0) {
                tracks.push(t);
                totalDuration += t.duration;
            }
        }

        const shuffled = shuffleArray(tracks, rng);
        info = factionCache[faction] = { rng, tracks: shuffled, totalDuration };
    }
    const { tracks, totalDuration } = info;
    startRadio(tracks, totalDuration, faction, dispName);
}

// Modo "No Factions"
function playNoFactions() {
    if (currentFaction === "NoFactions") return;

    audioPlayer.pause();
    currentFaction = "NoFactions";

    const availableTracks = catalog.filter(
        track => track.file && !bannedNoFactions.has(track.id)
    );
    const validTracks = availableTracks.filter(t => t.duration > 0);
    if (!validTracks.length) {
        trackName.textContent = "No tracks available";
        factionName.textContent = "No Factions";
        return;
    }

    const rng = mulberry32(HASH_NO_FACTIONS);
    if (!factionCache["NoFactions"]) {
        const shuffledTracks = shuffleArray(validTracks, rng);
        const totalDuration = shuffledTracks.reduce((sum, track) => sum + track.duration, 0);
        factionCache["NoFactions"] = { tracks: shuffledTracks, totalDuration };
    }
    const { tracks, totalDuration } = factionCache["NoFactions"];
    startRadio(tracks, totalDuration, "NoFactions");
    
    // El bloque redundante ha sido eliminado.
}

// Usa { once: true } en todos los listeners que se ejecutan una vez
function makeTrackEndedHandler(faction, tracks, index, requestId, dispName = null) {
    return function () {
        if (currentFaction !== faction || requestId !== lastPlayRequestId) {
            return;
        }
        const nextIndex = (index + 1) % tracks.length;
        playFactionTrack(faction, tracks, nextIndex, 0, dispName);
    };
}

// Barajar un array de forma determinista
function shuffleArray(array, rng) {
    const shuffled = array.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

const HASH_NO_FACTIONS = hashCode("NoFactions");

// Actualizar tiempo en la interfaz
let lastRenderSec = -1;
audioPlayer.ontimeupdate = () => {
  const sec = Math.floor(audioPlayer.currentTime);
  if (sec === lastRenderSec) return;
  lastRenderSec = sec;
  const min = Math.trunc(sec / 60);
  const secStr = (sec % 60 + 100).toString().slice(1);
  timeDisplay.textContent = `${min}:${secStr}`;
};

// Soporte para botón de pausa/reproducción del teclado multimedia
document.addEventListener('keydown', function (e) {
    if (e.code === 'MediaPlayPause' || e.keyCode === 179) {
        if (audioPlayer.paused) {
            if (currentFaction) {
                startFactionRadio(currentFaction);
            }
        } else {
            audioPlayer.pause();
        }
        e.preventDefault();
    }
});

// IDs de tracks baneados para el modo No Factions
const bannedNoFactions = new Set([
    "guia_emperor_1_allegro",
    "arcadia_captainharlock_instrumental",
    "arcadia_captainharlock",
    "arcadia_deathshadow"
]);

// Recibe el catálogo de tracks
window.setCatalog = function(data) {
    catalog = data;
    trackName.textContent = "Choose your faction to start";
    factionName.textContent = "Choose your faction to start";

    // AÑADIDO: Inicializa el control de volumen para esta vista
    if (typeof initVolumeControl === 'function' && window.volumeController == null) {
      // Guardamos la instancia por si se necesita en el futuro
      window.volumeController = initVolumeControl({
        audioEl: audioPlayer,
        bgEl: volumeBarBg,
        barEl: volumeBar,
        labelEl: volumeValue
      });
    }
};