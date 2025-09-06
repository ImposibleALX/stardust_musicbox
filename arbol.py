import os
import json

def get_directory_tree(path):
    tree = {"name": os.path.basename(path), "type": "directory", "children": []}

    try:
        for entry in os.scandir(path):
            if entry.is_dir(follow_symlinks=False):
                tree["children"].append(get_directory_tree(entry.path))
            else:
                tree["children"].append({
                    "name": entry.name,
                    "type": "file",
                    "size": os.path.getsize(entry.path)
                })
    except PermissionError:
        tree["children"].append({
            "name": "[Permission Denied]",
            "type": "error"
        })

    return tree

if __name__ == "__main__":
    root_dir = input("Ruta del directorio raíz: ").strip()
    if not os.path.isdir(root_dir):
        print("La ruta especificada no es un directorio válido.")
    else:
        tree_structure = get_directory_tree(root_dir)

        # Guardar en un archivo JSON
        output_file = "directory_tree.json"
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(tree_structure, f, indent=4, ensure_ascii=False)

        print(f"Árbol de directorios guardado en '{output_file}'")
