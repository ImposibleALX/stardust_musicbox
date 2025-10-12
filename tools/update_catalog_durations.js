const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Ruta base de la música y del catálogo
const projectRoot = path.resolve(__dirname, '..');
const musicBasePath = path.join(projectRoot, 'public/assets/music');
const catalogPath = path.join(projectRoot, 'public/assets/catalogs/music_catalog.json');
const outputPath = path.join(projectRoot, 'public/assets/catalogs/music_catalog_with_duration.json');

// Leer el catálogo original
let catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));

// Crear un mapa de duraciones
let durationMap = {};

// Función que obtiene duración precisa con ffprobe
function getDuration(filePath) {
  try {
    const output = execSync(`ffprobe -v error -select_streams a:0 -show_entries stream=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`);
    return parseFloat(output.toString().trim());
  } catch (e) {
    console.warn(`⚠️ Error obteniendo duración de ${filePath}`);
    return null;
  }
}

// Buscar todos los archivos .mp3 y .flac en carpetas
function scanFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanFiles(fullPath);
    } else if (entry.isFile() && /\.(mp3|flac)$/i.test(entry.name)) {
      const relPath = path.relative(musicBasePath, fullPath);
      const duration = getDuration(fullPath);
      if (duration) {
        durationMap[entry.name] = duration;
      }
    }
  }
}

// Escanea archivos
scanFiles(musicBasePath);

// Listas para reportar archivos no detectados y duraciones vacías
let notFoundFiles = [];
let emptyDurationEntries = [];

// Agrega duración al catálogo si hay coincidencia, sobrescribiendo siempre
catalog = catalog.map(entry => {
  if (!entry.file || entry.file === "") {
    notFoundFiles.push(entry);
    return entry;
  }
  if (entry.duration === "" || entry.duration === undefined || entry.duration === null) {
    emptyDurationEntries.push(entry.file);
    console.warn(`⚠️ Duración vacía encontrada para: ${entry.file}`);
  }
  const duration = durationMap[entry.file];
  if (duration) {
    // Sobrescribe siempre el duration si se encuentra
    return { ...entry, duration };
  } else {
    notFoundFiles.push(entry.file);
  }
  return entry;
});

// Reporte de archivos no detectados
if (notFoundFiles.length > 0) {
  console.warn("⚠️ Archivos no detectados o sin duración:");
  notFoundFiles.forEach(f => console.warn(`  - ${typeof f === "string" ? f : JSON.stringify(f)}`));
}

// Reporte de entradas con duration vacío
if (emptyDurationEntries.length > 0) {
  console.warn("⚠️ Entradas con duration vacío:");
  emptyDurationEntries.forEach(f => console.warn(`  - ${f}`));
}

// Guarda el nuevo catálogo
fs.writeFileSync(outputPath, JSON.stringify(catalog, null, 2));
console.log(`✅ Catálogo actualizado guardado como ${outputPath}`);