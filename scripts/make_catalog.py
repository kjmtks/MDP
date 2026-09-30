import os
import json

# Generates official-assets/catalog.json. Run from the repo root:
#   python scripts/make_catalog.py
# Category folders are plain (non-hidden) names; the app re-homes each category
# under the workspace's `.mdp/` directory on sync (see catalogLocalDir).

BASE = 'official-assets'

BINARY_EXT = ('.woff2', '.woff', '.ttf', '.otf')


def asset_hash(path):
    """Content fingerprint the app can recompute on a LOCAL copy to tell whether
    that copy is still current. The app only ever checked for MISSING files, so a
    module that was merely OUT OF DATE sat there silently forever.

    FNV-1a/32 over the UTF-8 bytes, with CRLF normalised to LF and any BOM
    stripped, so a file hashes identically whether it came from a Windows
    checkout, from GitHub raw, or from the app's own writer. Not cryptographic:
    it only has to differ when the official file differs. Binary assets (fonts)
    are hashed as raw bytes — normalising line endings would be meaningless.
    """
    with open(path, 'rb') as f:
        data = f.read()
    if not path.lower().endswith(BINARY_EXT):
        if data.startswith(b'\xef\xbb\xbf'):
            data = data[3:]
        data = data.replace(b'\r\n', b'\n')
    h = 0x811c9dc5
    for b in data:
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return '%08x' % h


def generate_catalog():
    # `fonts` keeps one folder per family (font.json + font files + licence); the
    # app checks the binary font files by SIZE (listed below) rather than reading
    # them back to hash on every workspace load.
    target_dirs = ['effects', 'fonts', 'modules', 'snippets', 'taxonomy', 'templates', 'themes']
    catalog = {}

    for target in target_dirs:
        catalog[target] = []
        target_path = os.path.join(BASE, target)
        if not os.path.exists(target_path):
            continue

        for root, dirs, files in os.walk(target_path):
            dirs.sort()
            files.sort()
            for file in files:
                if file.endswith('.keep'):
                    continue
                full = os.path.join(root, file)
                # Path relative to BASE, POSIX separators (used as URL segments).
                rel_path = os.path.relpath(full, BASE)
                rel_path = rel_path.replace(os.sep, '/').replace('\\', '/')
                item = {"path": rel_path, "hash": asset_hash(full)}
                if file.lower().endswith(BINARY_EXT):
                    item["size"] = os.path.getsize(full)
                catalog[target].append(item)

    with open(os.path.join(BASE, 'catalog.json'), 'w', encoding='utf-8') as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)

if __name__ == '__main__':
    generate_catalog()
