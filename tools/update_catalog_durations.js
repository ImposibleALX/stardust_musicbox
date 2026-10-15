const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Ruta base de la música y del catálogo
const projectRoot = path.resolve(__dirname, '..');
const musicBasePath = path.join(projectRoot, 'assets/music');
const catalogPath = path.join(projectRoot, 'assets/catalogs/music_catalog.json');
const outputPath = path.join(projectRoot, 'assets/catalogs/music_catalog_with_duration.json');

// Leer el catálogo original
let catalog;
try {
  catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
} catch (error) {
  console.error(`❌ Fatal: Could not read or parse catalog file at ${catalogPath}`);
  console.error(error.message);
  process.exit(1);
}

// Crear un mapa de duraciones
let durationMap = {};

// Función que obtiene duración precisa con ffprobe
function getDuration(filePath) {
  try {
    const output = execSync(`ffprobe -v error -select_streams a:0 -show_entries stream=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`);
    return parseFloat(output.toString().trim());
  } catch (e) {
    console.warn(`[WARN] Error getting duration for: ${path.basename(filePath)}`);
    return null;
  }
}

// Scan all .mp3 and .flac files in folders
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

// Scan files
scanFiles(musicBasePath);

// Lists to report missing files and empty durations
let notFoundFiles = [];
let emptyDurationEntries = [];

// Add duration to catalog on match
catalog = catalog.map(entry => {
  if (!entry.file || entry.file === "") {
    notFoundFiles.push(`Entry with ID "${entry.id || 'Unknown'}" has no file property.`);
    return entry;
  }
  if (entry.duration === "" || entry.duration === undefined || entry.duration === null) {
    emptyDurationEntries.push(entry.file);
    console.warn(`[WARN] Empty duration found for: ${entry.file}`);
  }
  const duration = durationMap[entry.file];
  if (duration) {
    return { ...entry, duration };
  } else {
    notFoundFiles.push(entry.file);
  }
  return entry;
});

// Report missing files
if (notFoundFiles.length > 0) {
  console.warn("\n[WARN] Could not find a matching audio file or duration for these catalog entries:");
  notFoundFiles.forEach(f => console.warn(`  - ${typeof f === "string" ? f : JSON.stringify(f)}`));
}

// Report entries with empty duration
if (emptyDurationEntries.length > 0) {
  console.warn("\n[WARN] These entries had an empty 'duration' field in the original catalog:");
  emptyDurationEntries.forEach(f => console.warn(`  - ${f}`));
}

// Save updated catalog
fs.writeFileSync(outputPath, JSON.stringify(catalog, null, 2));
console.log(`[OK] Updated catalog saved as ${outputPath}`);
