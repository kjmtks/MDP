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

  // Lazily fetch the children of a deferred tree node (an SSH `.mdplink` or a
  // remote subdirectory). Returns the subtree's nodes (and an optional error).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getSubTree: async (relPath: string): Promise<{ nodes: any[]; error?: string }> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) return await (window as any).electronAPI.getSubTree(relPath);
    const res = await fetch(`/api/subtree?path=${encodeURIComponent(relPath)}`);
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

  // Electron only — reveal a workspace folder in the OS file manager
  // (Explorer / Finder / …). `folderPath` is relative to the workspace root.
  openInFileManager: async (folderPath: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) return await (window as any).electronAPI.openInFileManager(folderPath);
    return { success: false };
  },

  setBaseDir: async (dirPath: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) return await (window as any).electronAPI.setBaseDir(dirPath);
    return { success: false };
  },

  // Read a `.mdplink` file's raw JSON config (for the link-settings dialog).
  getLinkConfig: async (relPath: string): Promise<string> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) return await (window as any).electronAPI.getLinkConfig(relPath);
    const res = await fetch(`/api/linkConfig?path=${encodeURIComponent(relPath)}`);
    return res.ok ? await res.text() : '';
  },
  setLinkConfig: async (relPath: string, content: string): Promise<void> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) { await (window as any).electronAPI.setLinkConfig({ path: relPath, content }); return; }
    await fetch('/api/linkConfig', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: relPath, content }) });
  },
  // MCP integration (Electron only): start/stop the local control bridge that the
  // stdio MCP proxy (Claude Desktop) forwards tool calls to, and read its status
  // for the Settings page's config snippet.
  setMcpEnabled: async (enabled: boolean): Promise<void> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) await (window as any).electronAPI.setMcpEnabled(enabled);
  },
  getMcpInfo: async (): Promise<{ running: boolean; port: number; serverPath: string; exePath: string; isPackaged: boolean } | null> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) return await (window as any).electronAPI.getMcpInfo();
    return null;
  },
  // Read a host's MCP config file (Claude Desktop / Cursor) for display + register.
  mcpGetHostConfig: async (host: string): Promise<{ supported: boolean; path?: string; exists?: boolean; text?: string; hasEntry?: boolean; invalid?: boolean; subset?: boolean }> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) return await (window as any).electronAPI.mcpGetHostConfig(host);
    return { supported: false };
  },
  // Register (overwrite) the `mdp` entry in that host's config, preserving others.
  mcpRegisterHost: async (host: string): Promise<{ success: boolean; path?: string; error?: string; backup?: string }> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) return await (window as any).electronAPI.mcpRegisterHost(host);
    return { success: false, error: 'Not available on the web build.' };
  },

  // Machine-local toggle: connect SSH links through their `proxyJump` bastion, or
  // directly. Environment-specific, so it's NOT stored in the .mdplink file.
  getSshBypassJump: async (): Promise<boolean> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) return await (window as any).electronAPI.getSshBypassJump();
    try { const res = await fetch('/api/sshBypassJump'); if (res.ok) return !!(await res.json()).bypassJump; } catch { /* ignore */ }
    return false;
  },
  setSshBypassJump: async (value: boolean): Promise<void> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) { await (window as any).electronAPI.setSshBypassJump(value); return; }
    await fetch('/api/sshBypassJump', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bypassJump: value }) });
  },

  // Offline cache for remote (`.mdplink` SSH) files.
  getCacheInfo: async (): Promise<{ enabled: boolean; maxBytes: number; usedBytes: number; count: number }> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) return await (window as any).electronAPI.getCacheInfo();
    const res = await fetch('/api/cacheInfo'); return res.json();
  },
  setCacheConfig: async (cfg: { enabled?: boolean; maxBytes?: number }): Promise<{ enabled: boolean; maxBytes: number; usedBytes: number; count: number }> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) return await (window as any).electronAPI.setCacheConfig(cfg);
    const res = await fetch('/api/cacheConfig', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) }); return res.json();
  },
  clearCache: async (): Promise<{ enabled: boolean; maxBytes: number; usedBytes: number; count: number }> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) return await (window as any).electronAPI.clearCache();
    const res = await fetch('/api/clearCache', { method: 'POST' }); return res.json();
  },
  // Cache a deck + the remote assets it references for offline use.
  prefetchDeck: async (relPath: string): Promise<{ ok: number; fail: number; total: number; error?: string }> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) return await (window as any).electronAPI.prefetchDeck(relPath);
    const res = await fetch('/api/prefetchDeck', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: relPath }) }); return res.json();
  },

  // Machine-local app settings (theme / font / shortcuts / author profile) — kept
  // PER INSTALL, not in the workspace, so they work even when the workspace root is
  // read-only (e.g. a NAS homes share). Electron → userData file; web → localStorage.
  getAppSettings: async (): Promise<unknown | null> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) return await (window as any).electronAPI.getAppSettings();
    try { const s = localStorage.getItem('mdp_app_settings'); return s ? JSON.parse(s) : null; } catch { return null; }
  },
  setAppSettings: async (obj: unknown): Promise<void> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) { await (window as any).electronAPI.setAppSettings(obj); return; }
    try { localStorage.setItem('mdp_app_settings', JSON.stringify(obj)); } catch { /* ignore */ }
  },

  // Native file/folder picker (Electron only); returns the chosen absolute path or
  // null. Set `directory: true` to pick a folder.
  pickFile: async (options?: { title?: string; directory?: boolean; filters?: { name: string; extensions: string[] }[] }): Promise<string | null> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) return await (window as any).electronAPI.pickFile(options || {});
    return null;
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

  // `dirs` = a `.mdp` config-dir chain (root→nearest); snippet files merge across
  // it, nearest winning by file name. Omitted → workspace root `.mdp` only.
  getSnipets: async (dirs?: string[]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) return await (window as any).electronAPI.getSnipets(dirs);
    try {
      const qs = dirs && dirs.length ? `?dirs=${encodeURIComponent(dirs.join(','))}` : '';
      const res = await fetch(`/api/snippets${qs}`);
      if (res.ok) return await res.json();
    } catch (e) { console.error(e); }
    return [];
  },

  // `dirs` = the TARGET FOLDER's `.mdp` chain (where the new file will live).
  getTemplates: async (dirs?: string[]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) return await (window as any).electronAPI.getTemplates(dirs);
    try {
      const qs = dirs && dirs.length ? `?dirs=${encodeURIComponent(dirs.join(','))}` : '';
      const res = await fetch(`/api/templates${qs}`);
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

  // `dirs` = the active deck's `.mdp` config-dir chain (root→nearest). Themes from
  // each are merged (nearest wins by name). Omitted → workspace root `.mdp` only.
  getThemes: async (dirs?: string[]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (isElectron()) return await (window as any).electronAPI.getThemes(dirs);
    try {
      const qs = dirs && dirs.length ? `?dirs=${encodeURIComponent(dirs.join(','))}` : '';
      const res = await fetch(`/api/themes${qs}`);
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

