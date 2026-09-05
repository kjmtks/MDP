import os
import json

# Generates official-assets/catalog.json. Run from the repo root:
#   python scripts/make_catalog.py
# Category folders are plain (non-hidden) names; the app re-homes each category
# under the workspace's `.mdp/` directory on sync (see catalogLocalDir).

BASE = 'official-assets'

def asset_hash(path):
    """Content fingerprint the app can recompute on a LOCAL copy to tell whether
    that copy is still current. The app only ever checked for MISSING files, so a
    module that was merely OUT OF DATE sat there silently forever.

    FNV-1a/32 over the UTF-8 bytes, with CRLF normalised to LF and any BOM
    stripped, so a file hashes identically whether it came from a Windows
    checkout, from GitHub raw, or from the app's own writer. Not cryptographic:
    it only has to differ when the official file differs.
    """
    with open(path, 'rb') as f:
        data = f.read()
    if data.startswith(b'\xef\xbb\xbf'):
        data = data[3:]
    data = data.replace(b'\r\n', b'\n')
    h = 0x811c9dc5
    for b in data:
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return '%08x' % h


def generate_catalog():
    target_dirs = ['effects', 'modules', 'snippets', 'taxonomy', 'templates', 'themes']
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
                catalog[target].append({"path": rel_path, "hash": asset_hash(os.path.join(root, file))})

    with open(os.path.join(BASE, 'catalog.json'), 'w', encoding='utf-8') as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)

if __name__ == '__main__':
    generate_catalog()
