import os
import json
import re

root_dir = 'assets/music'
output_file = 'assets/data/music_catalog.json'

def slugify(text):
    text = os.path.splitext(text)[0]  # Remove extension
    text = re.sub(r'[^\w\s-]', '', text)  # Remove special characters
    text = text.lower().replace(' ', '_')  # Replace spaces with underscores
    return text

def make_titles(original_name):
    return {
        "en": original_name,
        "es": "",
        "jp": ""
    }

music_data = []

for faction in os.listdir(root_dir):
    faction_path = os.path.join(root_dir, faction)
    if os.path.isdir(faction_path):
        for filename in os.listdir(faction_path):
            if filename.lower().endswith(('.mp3', '.flac', '.wav', '.ogg')):
                original_name = os.path.splitext(filename)[0]
                extension = os.path.splitext(filename)[1]
                slug_name = slugify(original_name) + extension.lower()

                old_path = os.path.join(faction_path, filename)
                new_path = os.path.join(faction_path, slug_name)

                # Renombrar archivo si es necesario
                if old_path != new_path:
                    os.rename(old_path, new_path)
                    print(f"Renombrado: {filename} -> {slug_name}")

                track = {
                    "id": slugify(f"{faction}_{original_name}"),
                    "file": slug_name,
                    "faction": faction,
                    "titles": make_titles(original_name)
                }
                music_data.append(track)

# Crear carpeta si no existe
os.makedirs(os.path.dirname(output_file), exist_ok=True)

# Guardar JSON
with open(output_file, 'w', encoding='utf-8') as f:
    json.dump(music_data, f, ensure_ascii=False, indent=2)

print(f"\n✅ Catálogo generado: {output_file} con {len(music_data)} pistas.")
