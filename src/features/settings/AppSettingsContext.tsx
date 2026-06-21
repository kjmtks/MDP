import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { apiClient } from '../../api/apiClient';
import { type AppSettings, DEFAULT_SETTINGS, SETTINGS_PATH, normalizeSettings } from './types';
import { appThemeVariant } from '../../styles/appThemes';

interface AppSettingsContextValue {
  settings: AppSettings;
  ready: boolean;
  appThemeVariant: 'dark' | 'light';
  update: (partial: Partial<AppSettings>) => void;
  /** Remove a shortcut override so the action falls back to its registry default. */
  resetShortcut: (actionId: string) => void;
}

const Ctx = createContext<AppSettingsContextValue | null>(null);

const hasWorkspace = () => {
  try { return !!localStorage.getItem('mdp_root_path'); } catch { return false; }
};

export const AppSettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  // Guards the write→`mdp-file-saved`→reload feedback loop on our own file.
  const isSavingRef = useRef(false);
  const saveTimer = useRef<number | null>(null);
  // Whether the current settings came from disk (vs in-memory defaults). When
  // false we still let the UI mutate settings; the first real edit persists.
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    if (!hasWorkspace()) {
      setSettings(DEFAULT_SETTINGS);
      loadedRef.current = false;
      setReady(true);
      return;
    }
    try {
      const text = await apiClient.readFileText(SETTINGS_PATH);
      setSettings(normalizeSettings(JSON.parse(text)));
      loadedRef.current = true;
    } catch {
      // Missing/malformed → defaults (a fresh workspace simply has no file yet).
      setSettings(DEFAULT_SETTINGS);
      loadedRef.current = false;
    }
    setReady(true);
  }, []);

  // Initial load + reload on workspace change.
  useEffect(() => {
    load();
    const onWorkspace = () => load();
    window.addEventListener('mdp-workspace-changed', onWorkspace);
    return () => window.removeEventListener('mdp-workspace-changed', onWorkspace);
  }, [load]);

  // Reload when the settings file is edited externally (hand-edit / other window).
  useEffect(() => {
    const onSaved = (e: Event) => {
      const path = (e as CustomEvent).detail?.path;
      if (path !== SETTINGS_PATH) return;
      if (isSavingRef.current) return; // our own write
      load();
    };
    window.addEventListener('mdp-file-saved', onSaved);
    return () => window.removeEventListener('mdp-file-saved', onSaved);
  }, [load]);

  // Apply: theme attribute + font-size custom props on <html>.
  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute('data-app-theme', settings.appTheme);
    el.style.setProperty('--app-font-size', `${settings.appFontSize}px`);
    el.style.setProperty('--app-editor-font-size', `${settings.editorFontSize}px`);
  }, [settings.appTheme, settings.appFontSize, settings.editorFontSize]);

  const persist = useCallback((next: AppSettings) => {
    if (!hasWorkspace()) return; // in-memory only until a workspace exists
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      isSavingRef.current = true;
      try {
        await apiClient.saveFile(SETTINGS_PATH, JSON.stringify(next, null, 2));
        loadedRef.current = true;
      } catch { /* ignore write errors */ }
      // Release the guard after the save-event has had a chance to fire.
      window.setTimeout(() => { isSavingRef.current = false; }, 0);
    }, 300);
  }, []);

  const update = useCallback((partial: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      persist(next);
      return next;
    });
  }, [persist]);

  const resetShortcut = useCallback((actionId: string) => {
    setSettings((prev) => {
      if (!(actionId in prev.shortcuts)) return prev;
      const shortcuts = { ...prev.shortcuts };
      delete shortcuts[actionId];
      const next = { ...prev, shortcuts };
      persist(next);
      return next;
    });
  }, [persist]);

  const value: AppSettingsContextValue = {
    settings,
    ready,
    appThemeVariant: appThemeVariant(settings.appTheme),
    update,
    resetShortcut,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export function useAppSettings(): AppSettingsContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppSettings must be used within AppSettingsProvider');
  return v;
}
