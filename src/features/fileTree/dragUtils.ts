import type React from 'react';

// A drag the file tree should handle: an internal file move (`application/json`)
// or OS files dragged in (`Files`). Anything else — notably Dockview tab drags,
// which carry only an (empty) `text/plain` and keep their payload in an in-memory
// singleton — must pass through so Dockview can dock the tab.
export const isFileTreeDrag = (e: React.DragEvent): boolean => {
  const t = e.dataTransfer?.types;
  return !!t && Array.from(t).some((x) => x === 'Files' || x === 'application/json');
};
