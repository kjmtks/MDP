// App-level (chrome) settings, persisted PER-WORKSPACE in `.mdp/settings.json`.
// These are distinct from slide themes (`@theme`, .mdp/themes) — they style the
// editor app itself (header, panels, menus, editor font, shortcuts).
import {
  DEFAULT_SSH_BASTION, PRESET_NAME, type SpeechConnection, type SpeechProfile, type SshBastion, type VoicePreset,
} from '../tts/ttsService';

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
    engine: 'webspeech' | 'voicevox' | 'openai';
    rate: number;
    pitch: number;
    webspeechVoiceURI: string;
    voicevoxUrl: string;
    voicevoxSpeaker: number;
    // An OpenAI-compatible TTS server (Irodori-TTS-Server, OpenAI, Kokoro-FastAPI…):
    // its URL, its API key ('' when it has none), the model ('' = the one the
    // server lists), the voice id to speak with (Irodori: a reference clip in its
    // voices/ folder, or 'none'), and an optional description of the voice /
    // delivery (Irodori's Voice Design caption, OpenAI's `instructions`). The key
    // lives only here, in the machine-local app settings — never in a workspace
    // `.mdp`, and it is withheld from module scripts (see moduleTtsApi.ts).
    // Stored before 1.4.30 as irodori* keys with engine 'irodori' — still read,
    // and still written (legacyTtsKeys) for an older install sharing the file.
    openaiUrl: string;
    openaiApiKey: string;
    openaiModel: string;
    openaiVoice: string;
    openaiInstructions: string;
    // The server's own options beyond OpenAI's request (Chatterbox's language and
    // accent, Irodori's tuning — see tts/speechOptions.ts), as {field: value}; only
    // those the server is known to take are sent.
    openaiExtra: Record<string, unknown>;
    // What was chosen on each server — voice, model, description, options — by its URL
    // (speechProfileKey). Servers have their own voices and models (Irodori's
    // 'my-voice' does not exist on Chatterbox, which in turn takes other models),
    // so switching servers brings back that server's own choices instead of
    // carrying another's over. The three fields above are the CURRENT server's —
    // what every request uses.
    openaiProfiles: Record<string, SpeechProfile>;
    // Optional SSH jump host to reach that server through (desktop app), with an
    // on/off switch; its password / key passphrase are NOT here — the main process
    // keeps them encrypted (app/sshTunnel.cjs).
    openaiSsh: SshBastion;
    // Saved connections — a URL, its API key and the bastion to go through — to
    // switch between by name (the campus server, the one at home, OpenAI…). Picking
    // one copies it into the three fields above; each server then brings back its
    // own voice, model and description (openaiProfiles). Bastion secrets stay with
    // the main process, one per bastion, as for the current connection.
    openaiConnections: SpeechConnection[];
    // Named speakers decks call by name (`mainvoice: @lecturer` on @speakcard): an
    // engine with its voice, prompt and options, optionally on a saved connection.
    // This computer's — a deck naming one that is missing here speaks by language.
    voicePresets: VoicePreset[];
    // Narrated auto-play: synthesize the WHOLE show's audio BEFORE starting it
    // (progress bar), instead of synthesizing each segment as it plays. Slow
    // machines stutter on real-time synthesis; pre-generating trades a wait up
    // front for gap-free playback. VOICEVOX / TTS server only — Web Speech cannot be
    // pre-synthesized (the browser gives no audio data, only live playback).
    pregenerate: boolean;
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
  tts: {
    engine: 'webspeech', rate: 1, pitch: 1, webspeechVoiceURI: '',
    voicevoxUrl: 'http://127.0.0.1:50021', voicevoxSpeaker: 1,
    openaiUrl: 'http://127.0.0.1:8088', openaiApiKey: '', openaiModel: '', openaiVoice: '', openaiInstructions: '',
    openaiExtra: {},
    openaiProfiles: {},
    openaiSsh: DEFAULT_SSH_BASTION,
    openaiConnections: [],
    voicePresets: [],
    pregenerate: false,
  },
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
      const t = (r.tts && typeof r.tts === 'object') ? r.tts as Omit<Partial<AppSettings['tts']>, 'engine'> & LegacyTts : {};
      const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
      return {
        engine: t.engine === 'voicevox' ? 'voicevox' : t.engine === 'openai' || t.engine === 'irodori' ? 'openai' : 'webspeech',
        rate: typeof t.rate === 'number' && t.rate > 0 ? t.rate : d.rate,
        pitch: typeof t.pitch === 'number' && t.pitch >= 0 ? t.pitch : d.pitch,
        webspeechVoiceURI: typeof t.webspeechVoiceURI === 'string' ? t.webspeechVoiceURI : d.webspeechVoiceURI,
        voicevoxUrl: typeof t.voicevoxUrl === 'string' && t.voicevoxUrl ? t.voicevoxUrl : d.voicevoxUrl,
        voicevoxSpeaker: typeof t.voicevoxSpeaker === 'number' ? t.voicevoxSpeaker : d.voicevoxSpeaker,
        openaiUrl: str(t.openaiUrl) || str(t.irodoriUrl) || d.openaiUrl,
        openaiApiKey: str(t.openaiApiKey) ?? str(t.irodoriApiKey) ?? d.openaiApiKey,
        openaiModel: str(t.openaiModel) ?? d.openaiModel,
        openaiVoice: str(t.openaiVoice) ?? str(t.irodoriVoice) ?? d.openaiVoice,
        openaiInstructions: str(t.openaiInstructions) ?? str(t.irodoriCaption) ?? d.openaiInstructions,
        openaiExtra: optionsOf(t.openaiExtra),
        openaiProfiles: (() => {
          const raw = t.openaiProfiles;
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
          const out: Record<string, SpeechProfile> = {};
          // (The newest few dozen are plenty: one per server ever connected to.)
          for (const [key, v] of Object.entries(raw as Record<string, unknown>).slice(-40)) {
            if (!key || !v || typeof v !== 'object') continue;
            const p = v as Partial<SpeechProfile>;
            out[key] = {
              voice: str(p.voice) ?? '', model: str(p.model) ?? '', instructions: str(p.instructions) ?? '',
              ...(p.extra !== undefined ? { extra: optionsOf(p.extra) } : {}),
            };
          }
          return out;
        })(),
        openaiSsh: sshOf(t.openaiSsh ?? t.irodoriSsh),
        openaiConnections: (() => {
          const raw = t.openaiConnections;
          if (!Array.isArray(raw)) return [];
          const byName = new Map<string, SpeechConnection>();
          for (const v of raw as unknown[]) {
            if (!v || typeof v !== 'object') continue;
            const c = v as Partial<SpeechConnection>;
            const name = (str(c.name) ?? '').trim().slice(0, 60);
            if (!name || typeof c.url !== 'string') continue;
            byName.delete(name);   // a name appears once (the last one wins)
            byName.set(name, { name, url: c.url, apiKey: str(c.apiKey) ?? '', ssh: sshOf(c.ssh) });
          }
          return [...byName.values()].slice(-30);
        })(),
        voicePresets: (() => {
          const raw = t.voicePresets;
          if (!Array.isArray(raw)) return [];
          const byName = new Map<string, VoicePreset>();
          for (const v of raw as unknown[]) {
            if (!v || typeof v !== 'object') continue;
            const p = v as Partial<VoicePreset> & Record<string, unknown>;
            const name = (str(p.name) ?? '').trim();
            const engine = p.engine === 'voicevox' || p.engine === 'openai' ? p.engine : p.engine === 'webspeech' ? 'webspeech' : null;
            if (!PRESET_NAME.test(name) || !engine) continue;
            const shape = p.voicevox && typeof p.voicevox === 'object' ? p.voicevox as Record<string, unknown> : null;
            const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
            byName.delete(name.toLowerCase());
            byName.set(name.toLowerCase(), {
              name, engine, voice: str(p.voice) ?? '',
              ...(str(p.prompt) ? { prompt: str(p.prompt) } : {}),
              ...(p.extra !== undefined ? { extra: optionsOf(p.extra) } : {}),
              ...(shape ? { voicevox: { pitch: n(shape.pitch), intonation: n(shape.intonation), volume: n(shape.volume) } } : {}),
              ...(str(p.connection) ? { connection: str(p.connection) } : {}),
            });
          }
          return [...byName.values()].slice(-50);
        })(),
        pregenerate: typeof t.pregenerate === 'boolean' ? t.pregenerate : d.pregenerate,
      };
    })(),
    readingCharsPerMin: typeof r.readingCharsPerMin === 'number' && r.readingCharsPerMin > 0 ? r.readingCharsPerMin : 320,
    readingCalibrationText: typeof r.readingCalibrationText === 'string' && r.readingCalibrationText.trim() ? r.readingCalibrationText : DEFAULT_SETTINGS.readingCalibrationText,
  };
}

// A server's options as stored: a plain object of plain values (nested objects for
// dotted fields), at most a few dozen.
function optionsOf(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 60)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(k) || k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = optionsOf(v);
    else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  return out;
}

// A bastion as stored (the current one, or a saved connection's).
function sshOf(raw: unknown): SshBastion {
  const s = (raw && typeof raw === 'object') ? raw as Partial<SshBastion> : {};
  const port = Number(s.port);
  return {
    enabled: s.enabled === true,
    host: typeof s.host === 'string' ? s.host : '',
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 22,
    user: typeof s.user === 'string' ? s.user : '',
    auth: s.auth === 'password' ? 'password' : 'key',
    keyPath: typeof s.keyPath === 'string' ? s.keyPath : DEFAULT_SSH_BASTION.keyPath,
  };
}

// The TTS server's settings as stored before 1.4.30 (engine 'irodori').
interface LegacyTts {
  engine?: string;
  irodoriUrl?: unknown; irodoriApiKey?: unknown; irodoriVoice?: unknown; irodoriCaption?: unknown; irodoriSsh?: unknown;
}

/** The TTS server's settings under their pre-1.4.30 names, written alongside the
 *  new ones: an older MDP on this computer shares the settings file and knows only
 *  these (with engine 'irodori'), so its narrator keeps working. Remove once no
 *  install older than 1.4.30 is in use. */
export function legacyTtsKeys(tts: AppSettings['tts']): LegacyTts {
  return {
    ...(tts.engine === 'openai' ? { engine: 'irodori' } : {}),
    irodoriUrl: tts.openaiUrl,
    irodoriApiKey: tts.openaiApiKey,
    irodoriVoice: tts.openaiVoice || 'none',
    irodoriCaption: tts.openaiInstructions,
    irodoriSsh: tts.openaiSsh,
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
