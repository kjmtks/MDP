import os
import json

# Generates official-assets/catalog.json. Run from the repo root:
#   python scripts/make_catalog.py
# Category folders are plain (non-hidden) names; the app re-homes each category
# under the workspace's `.mdp/` directory on sync (see catalogLocalDir).

BASE = 'official-assets'

def generate_catalog():
    target_dirs = ['effects', 'modules', 'snippets', 'templates', 'themes']
    catalog = {}

    for target in target_dirs:
        catalog[target] = []
        target_path = os.path.join(BASE, target)
        if not os.path.exists(target_path):
            continue

        for root, dirs, files in os.walk(target_path):
            files.sort()
            for file in files:
                if file.endswith('.keep'):
                    continue
                # Path relative to BASE, POSIX separators (used as URL segments).
                rel_path = os.path.relpath(os.path.join(root, file), BASE)
                rel_path = rel_path.replace(os.sep, '/').replace('\\', '/')
                catalog[target].append({"path": rel_path})

    with open(os.path.join(BASE, 'catalog.json'), 'w', encoding='utf-8') as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)

if __name__ == '__main__':
    generate_catalog()
