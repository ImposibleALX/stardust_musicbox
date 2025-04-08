import os
import json

# Carpeta principal donde están las subcarpetas de música
music_directory = 'assets/music'

# Diccionario para almacenar todos los tracks
music_catalog = []

# Función para recorrer las carpetas y archivos
def create_music_catalog():
    for faction_folder in os.listdir(music_directory):
        faction_path = os.path.join(music_directory, faction_folder)
        if os.path.isdir(faction_path):
            # Recorrer los archivos dentro de la subcarpeta de cada facción
            for track in os.listdir(faction_path):
                if track.endswith('.mp3') or track.endswith('.flac'):
                    # Extraer nombre del archivo y asignar un título por defecto
                    track_name = track
                    # Crear un objeto de metadatos para el track
                    track_metadata = {
                        "id": track_name.replace('.', '_'),  # Usamos un id basado en el nombre del archivo
                        "file": track_name,
                        "faction": faction_folder,
                        "titles": {
                            "en": track_name.replace('_', ' ').replace('.mp3', '').replace('.flac', ''),
                            "es": track_name.replace('_', ' ').replace('.mp3', '').replace('.flac', ''),
                            "jp": track_name.replace('_', ' ').replace('.mp3', '').replace('.flac', '')
                        }
                    }
                    # Añadir la pista al catálogo
                    music_catalog.append(track_metadata)

# Crear el catálogo de música
create_music_catalog()

# Guardar el JSON en un archivo
with open('assets/data/music_catalog.json', 'w', encoding='utf-8') as json_file:
    json.dump(music_catalog, json_file, ensure_ascii=False, indent=4)

print("El archivo music_catalog.json ha sido creado exitosamente.")
