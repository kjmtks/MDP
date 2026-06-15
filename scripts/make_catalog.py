import os
import json

def generate_catalog():
    target_dirs = ['.effects', '.modules', '.snippets', '.templates', '.themes']
    catalog = {}
    
    for target in target_dirs:
        target_wo_dot = target.replace('/^./', '')
        catalog[target_wo_dot] = []

        if not os.path.exists(f"official-assets/{target}"):
            continue

        for root, dirs, files in os.walk(f"official-assets/{target}"):
            files.sort()
            for file in files:
                if file.endswith('.keep'):
                    continue
                
                rel_path = os.path.relpath(os.path.join(root, file), '.')
                rel_path = rel_path.replace('/\/', '/')
                
                data = {}
                data["path"] = rel_path
                catalog[target_wo_dot].append(data)
    
    output_filename = 'official-assets/catalog.json'
    with open(output_filename, 'w', encoding='utf-8') as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)
    
if __name__ == '__main__':
    generate_catalog()
