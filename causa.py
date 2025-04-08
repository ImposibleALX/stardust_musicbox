import os
import re
import json

# Ruta base de tu música
base_path = "assets\music"  # <--- AJUSTA ESTO

# Donde guardar los archivos generados
output_txt = "music_catalog_raw.txt"
output_json = "music_catalog.json"

def slugify(name):
    name = os.path.splitext(name)[0]  # Remove extension
    name = re.sub(r'[^\w\s-]', '', name)  # Remove punctuation
    name = re.sub(r'\s+', '_', name)  # Spaces to _
    return name.lower()

catalog = []
raw_list = []

for root, dirs, files in os.walk(base_path):
    for file in files:
        if file.endswith(('.mp3', '.flac')):  # Soporta .flac también
            faction = os.path.basename(root)
            slug = slugify(file)
            
            # Guardar nombre original
            raw_list.append(f"{faction}/{file}")
            
            # Renombrar el archivo físicamente
            old_path = os.path.join(root, file)
            new_filename = f"{slug}{os.path.splitext(file)[1]}"  # Conservar extensión original
            new_path = os.path.join(root, new_filename)
            
            # Renombrar archivo
            os.rename(old_path, new_path)
            
            # Añadir a la lista del catálogo
            catalog.append({
                "id": f"{faction.lower()}_{slug}",
                "file": new_filename,
                "faction": faction,
                "titles": {
                    "en": os.path.splitext(file)[0],  # Título en inglés (nombre original)
                    "es": "",
                    "jp": ""
                }
            })

# Guardar nombres originales
with open(output_txt, "w", encoding="utf-8") as f:
    for line in raw_list:
        f.write(line + "\n")

# Guardar JSON
with open(output_json, "w", encoding="utf-8") as f:
    json.dump(catalog, f, indent=2, ensure_ascii=False)

print("✅ Archivos renombrados y generados: music_catalog_raw.txt y music_catalog.json")
