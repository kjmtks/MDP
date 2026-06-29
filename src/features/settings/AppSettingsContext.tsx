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

export const AppSettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const saveTimer = useRef<number | null>(null);
  // Whether the current settings came from a real store (vs in-memory defaults).
  const loadedRef = useRef(false);

  // App settings are MACHINE-LOCAL (per install), not in the workspace — so they
  // work even when the workspace root is read-only (e.g. a NAS homes share). On
  // first run we seed from the legacy per-workspace `.mdp/settings.json` once.
  const load = useCallback(async () => {
    try {
      const stored = await apiClient.getAppSettings();
      if (stored) { setSettings(normalizeSettings(stored)); loadedRef.current = true; setReady(true); return; }
    } catch { /* fall through to migration */ }
    try {
      const text = await apiClient.readFileText(SETTINGS_PATH);
      const migrated = normalizeSettings(JSON.parse(text));
      setSettings(migrated);
      loadedRef.current = true;
      apiClient.setAppSettings(migrated).catch(() => {});
    } catch {
      setSettings(DEFAULT_SETTINGS);
      loadedRef.current = false;
    }
    setReady(true);
  }, []);

  // Initial load; also re-attempt the one-time migration when a workspace first
  // opens (load() returns early once a machine-local store exists, so this never
  // overwrites the global settings on later workspace switches).
  useEffect(() => {
    load();
    const onWorkspace = () => { if (!loadedRef.current) load(); };
    window.addEventListener('mdp-workspace-changed', onWorkspace);
    return () => window.removeEventListener('mdp-workspace-changed', onWorkspace);
  }, [load]);

  // Apply: theme attribute + font-size custom props on <html>.
  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute('data-app-theme', settings.appTheme);
    el.style.setProperty('--app-font-size', `${settings.appFontSize}px`);
    el.style.setProperty('--app-editor-font-size', `${settings.editorFontSize}px`);
    el.style.setProperty('--app-editor-caret-width', `${settings.editorCaretWidth}px`);
    el.style.setProperty('--app-editor-line-height', `${settings.editorLineHeight}`);
  }, [settings.appTheme, settings.appFontSize, settings.editorFontSize, settings.editorCaretWidth, settings.editorLineHeight]);

  const persist = useCallback((next: AppSettings) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      apiClient.setAppSettings(next).catch(() => { /* ignore write errors */ });
      loadedRef.current = true;
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
