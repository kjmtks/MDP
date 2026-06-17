import os
import json

# Generates catalog.json for the official asset bundle. Run from this folder:
#   python make_catalog.py
# Category folders are plain (non-hidden) names; the app re-homes each category
# under the workspace's `.mdp/` directory on sync (see catalogLocalDir).

def generate_catalog():
    target_dirs = ['effects', 'modules', 'snippets', 'templates', 'themes']
    catalog = {}

    for target in target_dirs:
        catalog[target] = []

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

                catalog[target].append({"path": rel_path})

    with open('catalog.json', 'w', encoding='utf-8') as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)

if __name__ == '__main__':
    generate_catalog()
