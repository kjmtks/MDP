// App-level (chrome) settings, persisted PER-WORKSPACE in `.mdp/settings.json`.
// These are distinct from slide themes (`@theme`, .mdp/themes) — they style the
// editor app itself (header, panels, menus, editor font, shortcuts).

export interface AppSettings {
  version: 1;                            // schema version, for forward migration
  appTheme: string;                      // AppThemeDef.id (e.g. 'dark' | 'light')
  appFontSize: number;                   // app UI base font size, px
  editorFontSize: number;                // CodeMirror editor font size, px
  editorCaretWidth: number;              // text cursor (caret) thickness, px
  editorLineHeight: number;              // editor line height (unitless multiplier)
  // Sparse keybinding OVERRIDES: actionId -> list of key combos. Unspecified
  // actions fall back to the registry defaults, so "reset" = delete the key.
  shortcuts: Record<string, string[]>;
  // Author profile: defaults pre-filled into a new slide's cover meta
  // (@presenter / @affiliation / @contact). Empty fields leave the template's
  // own placeholder untouched.
  authorName: string;
  authorAffiliation: string;
  authorEmail: string;
  // Default filename suggested when exporting a PDF: the deck's file name, or its
  // `@title` (falls back to the file name when the deck has no title).
  pdfNameSource: 'filename' | 'title';
  // MCP integration (Electron): run the local control bridge so an MCP host
  // (e.g. Claude Desktop) can read/author decks through app/mcp-server.cjs.
  mcpEnabled: boolean;
  // When an MCP host creates a workspace ASSET (module/effect/theme) via write_asset:
  // 'confirm' pops a review dialog first (modules can carry a <script> that runs in
  // the app); 'auto' writes it without asking.
  mcpAssetWrite: 'confirm' | 'auto';
  // Per-host override of the MCP host CONFIG FILE path (keyed by host id, e.g.
  // 'claude-desktop'). When set, MDP reads/registers into THIS file instead of the
  // platform-default guess — so a user whose Claude Desktop config lives elsewhere
  // can just pick it. Absent/empty for a host → use the default guessed path.
  mcpHostConfigPaths: Record<string, string>;
  // Rehearsal read-aloud (TTS) preferences — the selected engine and its options.
  // Persisted so the rehearsal dialog remembers the user's voice/engine choice.
  tts: {
    engine: 'webspeech' | 'voicevox';
    rate: number;
    pitch: number;
    webspeechVoiceURI: string;
    voicevoxUrl: string;
    voicevoxSpeaker: number;
  };
  // Reading speed (characters/minute) for the talk-time estimate of read-aloud
  // `@script` slides. Per-person; calibratable in Settings. ~320 for Japanese.
  readingCharsPerMin: number;
  // The passage read aloud during reading-speed calibration — editable so it can
  // match the user's language / typical content.
  readingCalibrationText: string;
  // NOTE: module enable/disable is NO LONGER an app setting — it is per-folder,
  // stored in each `.mdp/content.json` and cascaded (see mdpContent / Configure
  // (.mdp) dialog), so it can differ per deck and live on a read-only NAS owner's
  // `.mdp`.
}

export const SETTINGS_PATH = '.mdp/settings.json';

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  appTheme: 'dark',
  appFontSize: 14,
  editorFontSize: 16,
  editorCaretWidth: 2,                    // thicker than CodeMirror's ~1.2px default for visibility
  editorLineHeight: 1.6,
  shortcuts: {},
  authorName: '',
  authorAffiliation: '',
  authorEmail: '',
  pdfNameSource: 'filename',
  mcpEnabled: false,
  mcpAssetWrite: 'confirm',
  mcpHostConfigPaths: {},
  tts: { engine: 'webspeech', rate: 1, pitch: 1, webspeechVoiceURI: '', voicevoxUrl: 'http://127.0.0.1:50021', voicevoxSpeaker: 1 },
  readingCharsPerMin: 320,
  readingCalibrationText:
    'それでは発表を始めます。本日は、私たちの研究の背景と目的、提案手法、実験結果、そして今後の課題について順にご説明します。' +
    'まず背景として、従来手法にはいくつかの課題がありました。我々はこれを解決するために新しいアプローチを提案します。' +
    'Thank you for your attention. Please feel free to ask questions at the end of the talk.',
};

// Merge a parsed (possibly partial / older) settings object over the defaults.
export function normalizeSettings(raw: unknown): AppSettings {
  const r = (raw && typeof raw === 'object') ? raw as Partial<AppSettings> : {};
  return {
    version: 1,
    appTheme: typeof r.appTheme === 'string' ? r.appTheme : DEFAULT_SETTINGS.appTheme,
    appFontSize: typeof r.appFontSize === 'number' ? r.appFontSize : DEFAULT_SETTINGS.appFontSize,
    editorFontSize: typeof r.editorFontSize === 'number' ? r.editorFontSize : DEFAULT_SETTINGS.editorFontSize,
    editorCaretWidth: typeof r.editorCaretWidth === 'number' ? r.editorCaretWidth : DEFAULT_SETTINGS.editorCaretWidth,
    editorLineHeight: typeof r.editorLineHeight === 'number' ? r.editorLineHeight : DEFAULT_SETTINGS.editorLineHeight,
    shortcuts: (r.shortcuts && typeof r.shortcuts === 'object') ? r.shortcuts as Record<string, string[]> : {},
    authorName: typeof r.authorName === 'string' ? r.authorName : '',
    authorAffiliation: typeof r.authorAffiliation === 'string' ? r.authorAffiliation : '',
    authorEmail: typeof r.authorEmail === 'string' ? r.authorEmail : '',
    pdfNameSource: r.pdfNameSource === 'title' ? 'title' : 'filename',
    mcpEnabled: r.mcpEnabled === true,
    mcpAssetWrite: r.mcpAssetWrite === 'auto' ? 'auto' : 'confirm',
    mcpHostConfigPaths: (r.mcpHostConfigPaths && typeof r.mcpHostConfigPaths === 'object' && !Array.isArray(r.mcpHostConfigPaths))
      ? Object.fromEntries(Object.entries(r.mcpHostConfigPaths as Record<string, unknown>).filter(([, v]) => typeof v === 'string' && v)) as Record<string, string>
      : {},
    tts: (() => {
      const d = DEFAULT_SETTINGS.tts;
      const t = (r.tts && typeof r.tts === 'object') ? r.tts as Partial<AppSettings['tts']> : {};
      return {
        engine: t.engine === 'voicevox' ? 'voicevox' : 'webspeech',
        rate: typeof t.rate === 'number' && t.rate > 0 ? t.rate : d.rate,
        pitch: typeof t.pitch === 'number' && t.pitch >= 0 ? t.pitch : d.pitch,
        webspeechVoiceURI: typeof t.webspeechVoiceURI === 'string' ? t.webspeechVoiceURI : d.webspeechVoiceURI,
        voicevoxUrl: typeof t.voicevoxUrl === 'string' && t.voicevoxUrl ? t.voicevoxUrl : d.voicevoxUrl,
        voicevoxSpeaker: typeof t.voicevoxSpeaker === 'number' ? t.voicevoxSpeaker : d.voicevoxSpeaker,
      };
    })(),
    readingCharsPerMin: typeof r.readingCharsPerMin === 'number' && r.readingCharsPerMin > 0 ? r.readingCharsPerMin : 320,
    readingCalibrationText: typeof r.readingCalibrationText === 'string' && r.readingCalibrationText.trim() ? r.readingCalibrationText : DEFAULT_SETTINGS.readingCalibrationText,
  };
}

// Fill a new slide's cover meta directives (@presenter / @affiliation / @contact)
// with the configured author profile. Only non-empty profile fields replace the
// directive value; directives absent from the template are left as-is (we never
// inject new lines — the template decides which meta it carries). The directive
// is single-line, so the value capture stops at the closing `-->`.
export function applyAuthorProfile(
  content: string,
  profile: { authorName?: string; authorAffiliation?: string; authorEmail?: string },
): string {
  const fill = (text: string, directive: string, value: string | undefined): string => {
    const v = (value ?? '').trim();
    if (!v) return text;
    const re = new RegExp('(<!--\\s*@' + directive + '\\s+)(.*?)(\\s*-->)', 'g');
    return text.replace(re, (_m, pre: string, _old: string, post: string) => pre + v + post);
  };
  let out = content;
  out = fill(out, 'presenter', profile.authorName);
  out = fill(out, 'affiliation', profile.authorAffiliation);
  out = fill(out, 'contact', profile.authorEmail);
  return out;
}
