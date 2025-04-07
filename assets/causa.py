import os

# Lista de facciones
factions = [
    "UNCF",
    "Gatlantis",
    "Gamilas",
    "Dezariam",
    "Bolar_Federation",
    "SUS",
    "Dinguil"
]

# Ruta base (puedes cambiarla)
base_path = "music"

# Crear estructura
for faction in factions:
    path = os.path.join(base_path, faction)
    os.makedirs(path, exist_ok=True)
    print(f"Carpeta creada: {path}")
