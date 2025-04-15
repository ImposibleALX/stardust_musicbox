// Variables globales
let catalog = [];
let currentLang = 'en'; // Idioma por defecto
let currentFaction = ''; // Facción actualmente activa

// Cargar el catálogo de música desde el archivo JSON
fetch('assets/data/music_catalog.json')
    .then(response => response.json())
    .then(data => {
        catalog = data;
    })
    .catch(error => console.error("Error al cargar el catálogo de música:", error));

// Obtener elementos de la interfaz
const audioPlayer = document.getElementById("audioPlayer");
const trackName = document.getElementById("trackName");
const factionName = document.getElementById("factionName");
const timeDisplay = document.getElementById("timeDisplay");

// Reproducir música de una facción seleccionada
function playFaction(faction) {
    currentFaction = faction; // Guardar la facción activa
    playRandomTrackFromFaction(faction);
}

// Reproducir una pista aleatoria de una facción específica
function playRandomTrackFromFaction(faction) {
    const factionTracks = catalog.filter(track => track.faction === faction);
    if (factionTracks.length > 0) {
        const selected = factionTracks[Math.floor(Math.random() * factionTracks.length)];
        const filePath = `assets/music/${faction}/${selected.file}`;
        const title = selected.titles[currentLang] || selected.titles['en'];

        audioPlayer.src = filePath;
        audioPlayer.play();

        trackName.textContent = title;
        factionName.textContent = `Faction: ${faction}`;
    } else {
        alert("No tracks available for this faction.");
    }
}

// Actualizar la visualización del tiempo de la canción
audioPlayer.ontimeupdate = function () {
    let minutes = Math.floor(audioPlayer.currentTime / 60);
    let seconds = Math.floor(audioPlayer.currentTime % 60);
    if (seconds < 10) seconds = '0' + seconds;
    timeDisplay.textContent = `${minutes}:${seconds}`;
};

// Cuando termina una canción, reproducir otra de la misma facción
audioPlayer.onended = function () {
    if (currentFaction) {
        playRandomTrackFromFaction(currentFaction);
    }
};

// Cambiar el idioma
function setLang(lang) {
    currentLang = lang;
}
