import os
import json

def generate_catalog():
    target_dirs = ['.effects', '.modules', '.snippets', '.templates', '.themes']
    catalog = {}
    
    for target in target_dirs:
        target_wo_dot = target.replace('/^./', '')
        catalog[target_wo_dot] = []

        if not os.path.exists(target):
            continue

        for root, dirs, files in os.walk(target):
            files.sort()
            for file in files:
                if file.endswith('.keep'):
                    continue
                
                rel_path = os.path.relpath(os.path.join(root, file), '.')
                # Always emit POSIX-style separators: catalog paths become URL
                # segments (GitHub raw) and are split on '/' by the app, so a
                # Windows backslash would break both the fetch and the destination.
                rel_path = rel_path.replace(os.sep, '/').replace('\\', '/')
                
                data = {}
                data["path"] = rel_path
                catalog[target_wo_dot].append(data)
    
    output_filename = 'catalog.json'
    with open(output_filename, 'w', encoding='utf-8') as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)
    
if __name__ == '__main__':
    generate_catalog()
