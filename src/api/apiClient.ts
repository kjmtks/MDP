declare const __APP_VERSION__: string;
// Baked in at build time (Vite `define`). Falls back gracefully if undefined.
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

export const isElectron = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return typeof window !== 'undefined' && !!(window as any).electronAPI;
};

export const apiClient = {
  saveFile: async (filename: string, content: string, isBase64: boolean = false) => {
    if (isElectron()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (window as any).electronAPI.saveFile({ filename, content, isBase64 });
    }
    const res = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, content, isBase64 })
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  createFile: async (path: string, type: 'file' | 'directory') => {
    if (isElectron()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (window as any).electronAPI.createFile({ path, type });
    }
    const res = await fetch('/api/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, type })
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  moveFile: async (sourcePaths: string[], targetPath: string) => {
    if (isElectron()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (window as any).electronAPI.moveFile({ sourcePaths, targetPath });
    }
    const res = await fetch('/api/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourcePaths, targetPath })
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  copyFiles: async (sourcePaths: string[], targetPath: string): Promise<{ success: boolean; paths?: string[] }> => {
    if (isElectron()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (window as any).electronAPI.copyFiles({ sourcePaths, targetPath });
    }
    const res = await fetch('/api/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourcePaths, targetPath })
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  renameFile: async (oldPath: string, newPath: string) => {
    if (isElectron()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (window as any).electronAPI.renameFile({ oldPath, newPath });
    }
    const res = await fetch('/api/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath, newPath })
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  deleteFiles: async (paths: string[]) => {
    if (isElectron()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (window as any).electronAPI.deleteFiles({ paths });
    }
    const res = await fetch('/api/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths })
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  readFileText: async (filePath: string) => {
    if (isElectron()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (window as any).electronAPI.readFileText(filePath);
    }
    const res = await fetch(`/files/${filePath.split('/').map(encodeURIComponent).join('/')}`);
    if (!res.ok) throw new Error(await res.text());
    return await res.text();
  },

  getFileTree: async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) return await (window as any).electronAPI.getFileTree();
    const res = await fetch('/api/files');
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  getFileAsDataUrl: async (filePath: string): Promise<string> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) return await (window as any).electronAPI.getFileAsDataUrl(filePath);
    const res = await fetch(`/files/${filePath.split('/').map(encodeURIComponent).join('/')}`);
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  },

  openFolder: async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) return await (window as any).electronAPI.openFolder();
    return null;
  },

  setBaseDir: async (dirPath: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) return await (window as any).electronAPI.setBaseDir(dirPath);
    return { success: false };
  },

  exportPdf: (filename?: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) (window as any).electronAPI.exportPdf(filename);
  },

  // Save base64 binary content. Electron shows a native "Save As" dialog; the web
  // build triggers a browser download. Returns true if the file was written/started.
  saveBinaryWithDialog: async (
    suggestedName: string,
    base64: string,
    filter: { name: string; ext: string; mime: string },
  ): Promise<boolean> => {
    if (isElectron()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (window as any).electronAPI.saveBinaryDialog({
        suggestedName, content: base64, filterName: filter.name, ext: filter.ext,
      });
      return !!(res && res.saved);
    }
    // Web: decode base64 → Blob → download (the browser provides the save UI).
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: filter.mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  },

  getSnipets: async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) return await (window as any).electronAPI.getSnipets();
    try {
      const res = await fetch('/api/snippets');
      if (res.ok) return await res.json();
    } catch (e) { console.error(e); }
    return [];
  },

  getTemplates: async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) return await (window as any).electronAPI.getTemplates();
    try {
      const res = await fetch('/api/templates');
      if (res.ok) return await res.json();
    } catch (e) { console.error(e); }
    return [];
  },

  getTemplateContent: async (templatePath: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) return await (window as any).electronAPI.getTemplateContent(templatePath);
    try {
      const res = await fetch(`/api/templateContent?path=${encodeURIComponent(templatePath)}`);
      if (res.ok) return await res.text();
    } catch (e) { console.error(e); }
    return "# New Slide\n\nContent...";
  },

  getThemes: async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) return await (window as any).electronAPI.getThemes();
    try {
      const res = await fetch('/api/themes');
      if (res.ok) return await res.json();
    } catch (e) { console.error(e); }
    return [];
  },

  getAppVersion: async (): Promise<string> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      try { return await (window as any).electronAPI.getAppVersion(); } catch { /* fall through */ }
    }
    // Web (or Electron fallback): the version is baked in at build time.
    return APP_VERSION;
  },

  getModules: async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) return await (window as any).electronAPI.getModules();
    try {
      const res = await fetch('/api/modules');
      if (res.ok) return await res.json();
    } catch (e) { console.error(e); }
    return [];
  },

  getModuleContent: async (modulePath: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) return await (window as any).electronAPI.getModuleContent(modulePath);
    try {
      const res = await fetch(`/api/moduleContent?path=${encodeURIComponent(modulePath)}`);
      if (res.ok) return await res.text();
    } catch (e) { console.error(e); }
    return "";
  },

  getEffects: async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) return await (window as any).electronAPI.getEffects();
    try {
      const res = await fetch('/api/effects');
      if (res.ok) return await res.json();
    } catch (e) { console.error(e); }
    return [];
  },

  getEffectContent: async (effectPath: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) return await (window as any).electronAPI.getEffectContent(effectPath);
    try {
      const res = await fetch(`/api/effectContent?path=${encodeURIComponent(effectPath)}`);
      if (res.ok) return await res.text();
    } catch (e) { console.error(e); }
    return "";
  },
};

