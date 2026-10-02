import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Switch,
  MenuItem, Select, FormControlLabel, Typography, Box, Stack, InputAdornment, IconButton, Menu,
  Popover, Chip, Checkbox, Autocomplete, CircularProgress,
} from '@mui/material';
import PaletteIcon from '@mui/icons-material/Palette';
import ImageIcon from '@mui/icons-material/Image';
import SearchIcon from '@mui/icons-material/Search';
import BrokenImageIcon from '@mui/icons-material/BrokenImage';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import RefreshIcon from '@mui/icons-material/Refresh';
import BookmarkAddOutlinedIcon from '@mui/icons-material/BookmarkAddOutlined';
import CloseIcon from '@mui/icons-material/Close';
import type { ModuleParam, ParamOption } from '../../../utils/moduleParser';
import type { ImageEntry } from '../../images/imageRegistry';
import { useAppSettings } from '../../settings/AppSettingsContext';
import { getModuleTtsApi, speakerOptions, type MdpTtsEngineInfo, type SpeakerSpec } from '../../tts/moduleTtsApi';
import { SpeechOptionsFields } from '../../tts/SpeechOptionsFields';
import { formatExtra, parseExtra, type SpeechServerDescription } from '../../tts/speechOptions';
import {
  PRESET_NAME, engineFromName, engineLabel, isSameConnection, type TtsEngine, type Utterance, type VoicePreset, type VoicevoxShape,
} from '../../tts/ttsService';

// Slide theme colour variables a `color` param can bind to (resolved on the
// slide, so they follow the active deck theme). Value stored as `var(--x)`.
const THEME_COLOR_VARS: { var: string; label: string }[] = [
  { var: '--accent-color', label: 'Accent' },
  { var: '--text-color', label: 'Text' },
  { var: '--bg-color', label: 'Background' },
  { var: '--muted-color', label: 'Muted' },
  { var: '--border-color', label: 'Border' },
  { var: '--panel-bg', label: 'Panel bg' },
  { var: '--panel-text', label: 'Panel text' },
  { var: '--panel-border', label: 'Panel border' },
  { var: '--info-color', label: 'Info' },
  { var: '--success-color', label: 'Success' },
  { var: '--warning-color', label: 'Warning' },
  { var: '--danger-color', label: 'Danger' },
];

const labelOf = (p: ModuleParam) => p.label || p.name;
const isHex = (v: string) => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v.trim());

const fieldSx = {
  '& .MuiInputBase-input': { color: 'var(--app-text-secondary)', fontSize: '0.85rem' },
  '& .MuiInputLabel-root': { color: 'var(--app-text-disabled)' },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--app-border-subtle)' },
  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--app-border-strong)' },
};

const ColorField: React.FC<{ value: string; options?: ParamOption[]; onChange: (v: string) => void }> = ({ value, options, onChange }) => {
  const [menuEl, setMenuEl] = useState<HTMLElement | null>(null);
  const sel = value.trim().toLowerCase();
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <input
          type="color"
          value={isHex(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          title="Pick a colour"
          style={{ width: 34, height: 34, padding: 0, border: '1px solid var(--app-border-strong)', borderRadius: 4, background: 'transparent', cursor: 'pointer' }}
        />
        <TextField
          size="small" fullWidth value={value} placeholder="#rrggbb, rgba(), transparent, var(--…)"
          onChange={(e) => onChange(e.target.value)} variant="outlined" sx={fieldSx}
        />
        <IconButton size="small" title="Theme variable / transparent" onClick={(e) => setMenuEl(e.currentTarget)} sx={{ color: 'var(--app-text-muted)' }}>
          <PaletteIcon fontSize="small" />
        </IconButton>
        <Menu anchorEl={menuEl} open={!!menuEl} onClose={() => setMenuEl(null)}>
          <MenuItem onClick={() => { onChange('transparent'); setMenuEl(null); }}>Transparent</MenuItem>
          {THEME_COLOR_VARS.map((c) => (
            <MenuItem key={c.var} onClick={() => { onChange(`var(${c.var})`); setMenuEl(null); }}>
              <Box sx={{ width: 12, height: 12, borderRadius: '50%', mr: 1, bgcolor: `var(${c.var})`, border: '1px solid var(--app-border)' }} />
              {c.label} <Typography component="span" sx={{ ml: 0.5, color: 'var(--app-text-disabled)', fontSize: '0.75rem' }}>{c.var}</Typography>
            </MenuItem>
          ))}
        </Menu>
      </Box>
      {options && options.length > 0 && (
        // Preset swatches declared on the <param options="#hex:Label,…">.
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6, mt: 0.75 }}>
          {options.map((o) => (
            <Box
              key={o.value} title={o.label} onClick={() => onChange(o.value)}
              sx={{
                width: 22, height: 22, borderRadius: '50%', bgcolor: o.value, cursor: 'pointer',
                border: sel === o.value.trim().toLowerCase() ? '2px solid var(--app-accent)' : '1px solid var(--app-border-strong)',
                boxShadow: '0 0 0 1px rgba(0,0,0,0.04)',
              }}
            />
          ))}
        </Box>
      )}
    </Box>
  );
};

const ImagePickRow: React.FC<{ entry: ImageEntry; src: string; onPick: () => void }> = ({ entry, src, onPick }) => {
  const [broken, setBroken] = useState(false);
  return (
    <Box onClick={onPick} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', px: 1, py: 0.75, cursor: 'pointer', '&:hover': { bgcolor: 'var(--app-bg-hover)' } }}>
      <Box className={broken ? undefined : 'mdp-transparency-checker mdp-transparency-checker--sm'}
        sx={{ width: 40, height: 40, flexShrink: 0, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {broken
          ? <BrokenImageIcon sx={{ color: 'var(--app-text-disabled)' }} />
          : <img src={src} alt={entry.alias} onError={() => setBroken(true)} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography sx={{ color: 'var(--app-text)', fontSize: '0.8rem', fontWeight: 700, wordBreak: 'break-all' }}>@{entry.alias}</Typography>
          <Box component="span" sx={{ fontSize: '0.58rem', px: 0.5, borderRadius: 0.5, bgcolor: 'var(--app-bg-elevated)', color: 'var(--app-text-disabled)', flexShrink: 0 }}>{entry.scope}</Box>
        </Box>
        {entry.description && <Typography sx={{ color: 'var(--app-text-disabled)', fontSize: '0.7rem', wordBreak: 'break-word' }}>{entry.description}</Typography>}
        {entry.tags && entry.tags.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.25, mt: 0.25 }}>
            {entry.tags.map((t) => <Chip key={t} label={t} size="small" sx={{ height: 16, fontSize: '0.6rem', color: 'var(--app-accent)', bgcolor: 'var(--app-accent-soft)' }} />)}
          </Box>
        )}
      </Box>
    </Box>
  );
};

const ImageField: React.FC<{ value: string; entries: ImageEntry[]; resolveThumb: (v: string) => string; onChange: (v: string) => void }> = ({ value, entries, resolveThumb, onChange }) => {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  // AND search across alias / description / tags (matches the Images panel).
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = entries.filter((e) => {
    if (!terms.length) return true;
    const hay = `${e.alias} ${e.description || ''} ${(e.tags || []).join(' ')}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
  const pick = (alias: string) => { onChange(`@${alias}`); setAnchor(null); setQuery(''); };
  return (
    <>
      <TextField
        size="small" fullWidth value={value} placeholder="https://… , relative/path.png, or @alias"
        onChange={(e) => onChange(e.target.value)} variant="outlined" sx={fieldSx}
        slotProps={{ input: {
          endAdornment: entries.length ? (
            <InputAdornment position="end">
              <IconButton size="small" title="Browse image library" onClick={(e) => setAnchor(e.currentTarget)} sx={{ color: 'var(--app-text-muted)' }}>
                <ImageIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
          ) : undefined,
        } }}
      />
      <Popover
        open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 360, maxWidth: '90vw', bgcolor: 'var(--app-bg-panel)', color: 'var(--app-text-secondary)', border: '1px solid var(--app-border-subtle)', backgroundImage: 'none' } } }}
      >
        <Box sx={{ p: 1, position: 'sticky', top: 0, zIndex: 1, bgcolor: 'var(--app-bg-panel)', borderBottom: '1px solid var(--app-border-subtle)' }}>
          <TextField
            autoFocus size="small" fullWidth value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name / description / tag…" variant="outlined" sx={fieldSx}
            slotProps={{ input: { startAdornment: (<InputAdornment position="start"><SearchIcon fontSize="small" sx={{ color: 'var(--app-text-disabled)' }} /></InputAdornment>) } }}
          />
        </Box>
        <Box sx={{ maxHeight: 320, overflowY: 'auto' }}>
          {filtered.length === 0 ? (
            <Typography sx={{ p: 2, color: 'var(--app-text-disabled)', fontSize: '0.8rem' }}>No matching images.</Typography>
          ) : filtered.map((e) => (
            <ImagePickRow key={`${e.scope}:${e.alias}`} entry={e} src={resolveThumb(e.value)} onPick={() => pick(e.alias)} />
          ))}
        </Box>
      </Popover>
    </>
  );
};

// --- voice picker (type="voice") ----------------------------------------------
interface VoiceOption { value: string; label: string; hint?: string; preset?: VoicePreset }

// Each engine's list is fetched once and shared by every voice field; a failed
// fetch is forgotten, so ↻ (or reopening the dialog) asks again.
const voiceLists = new Map<TtsEngine, Promise<VoiceOption[]>>();
const loadVoiceList = (engine: TtsEngine, fresh = false): Promise<VoiceOption[]> => {
  const cached = voiceLists.get(engine);
  if (cached && !fresh) return cached;
  const api = getModuleTtsApi();
  const p: Promise<VoiceOption[]> = engine === 'voicevox'
    ? api.voicevoxSpeakers().then((ss) => ss.map((s) => ({ value: String(s.id), label: s.label })))
    : engine === 'openai'
      ? api.serverVoices().then((ids) => ids.map((id) => ({ value: id, label: id })))
      : api.voices().then((vs) => vs.map((v) => ({ value: v.name, label: v.name, hint: v.lang })));
  voiceLists.set(engine, p);
  p.catch(() => { if (voiceLists.get(engine) === p) voiceLists.delete(engine); });
  return p;
};

const SAMPLE_TEXT = { ja: 'これは、この声の試し読みです。', en: 'This is a sample of this voice.' };

/** The speaker a voice param and its siblings describe (see ModuleParam.engineParam
 *  for the naming) — turned into speak() options by the same mapping as the modules. */
const speakerSpecOf = (p: ModuleParam, eff: (name: string) => string): SpeakerSpec => {
  const prefix = p.name.replace(/voice$/i, '');
  return {
    engine: p.engineParam ? eff(p.engineParam) : '',
    voice: eff(p.name),
    prompt: eff(`${prefix}prompt`),
    extra: eff(`${prefix}extra`),
    pitch: eff(`${prefix}pitch`), intonation: eff(`${prefix}intonation`), volume: eff(`${prefix}volume`),
    lang: p.langParam ? eff(p.langParam) : '',
    rate: eff('rate'),
    fallback: eff('fallback'),
    speaker: eff('speaker'),
  };
};

// Voice presets (settings' `voicePresets`): a deck names one as `@name`.
const presetNamed = (presets: VoicePreset[], voice: string): VoicePreset | undefined => {
  const v = voice.trim();
  return v.startsWith('@') ? presets.find((x) => x.name.toLowerCase() === v.slice(1).trim().toLowerCase()) : undefined;
};
const presetHint = (pr: VoicePreset): string =>
  [engineLabel(pr.engine), pr.voice, pr.connection ? `on ${pr.connection}` : ''].filter(Boolean).join(' · ');
// A preset name made from a voice's label ("ずんだもん（ノーマル）" → "ずんだもん-ノーマル").
const presetNameFrom = (s: string): string =>
  s.replace(/[^\p{L}\p{N}_.-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'voice';
const numberOrNone = (s: string | number | undefined): number | undefined => {
  const n = typeof s === 'number' ? s : typeof s === 'string' && s.trim() !== '' ? Number(s) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

const VoiceField: React.FC<{ p: ModuleParam; value: string; onChange: (v: string) => void; eff: (name: string) => string }> = ({ p, value, onChange, eff }) => {
  const { settings, updateTts } = useAppSettings();
  const presets = settings.tts.voicePresets;
  const named = engineFromName(p.engineParam ? eff(p.engineParam) : '');
  const engine: TtsEngine = named ?? 'webspeech';  // auto + a name = a Web Speech narrator
  const lang = (p.langParam ? eff(p.langParam) : '').trim().toLowerCase();
  const isPreset = value.trim().startsWith('@');
  const preset = presetNamed(presets, value);
  const [list, setList] = useState<VoiceOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [reload, setReload] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState('');
  const [saveName, setSaveName] = useState<string | null>(null);   // "Save as a preset" being typed
  const utter = useRef<Utterance | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setListError('');
    loadVoiceList(engine, reload > 0).then(
      (l) => { if (alive) { setList(l); setLoading(false); } },
      (e) => { if (alive) { setList([]); setLoading(false); setListError(String((e as Error)?.message || e)); } },
    );
    return () => { alive = false; };
  }, [engine, reload]);
  // Closing the dialog stops an audition.
  useEffect(() => () => { utter.current?.stop(); }, []);

  // The presets first (any engine — a preset brings its own), then the engine's
  // voices, Web Speech narrators of the line's language first.
  const presetOptions = useMemo<VoiceOption[]>(
    () => presets.map((pr) => ({ value: `@${pr.name}`, label: `@${pr.name}`, hint: presetHint(pr), preset: pr })), [presets]);
  const options = useMemo(() => {
    let voices = list;
    if (engine === 'webspeech' && lang) {
      const base = lang.split('-')[0];
      const rank = (o: VoiceOption) => {
        const l = (o.hint || '').toLowerCase().replace(/_/g, '-');
        return l.startsWith(lang) ? 0 : l.startsWith(base) ? 1 : 2;
      };
      voices = [...list].sort((a, b) => rank(a) - rank(b));
    }
    return [...presetOptions, ...voices];
  }, [list, engine, lang, presetOptions]);
  const current = preset ? presetOptions.find((o) => o.preset === preset) : list.find((o) => o.value === value.trim());

  // Save what this line says now — engine, voice, prompt, options, VOICEVOX shaping —
  // as a named preset, and call it by that name here. On the TTS server it remembers
  // the saved connection in use, so it keeps speaking there after a switch.
  const canSave = !isPreset && (!!named || !!value.trim());
  const saveOk = saveName !== null && PRESET_NAME.test(saveName.trim());
  const suggestName = (): string => {
    const v = value.trim();
    if (engine === 'voicevox') return presetNameFrom(current?.label || (v ? `voicevox-${v}` : 'voicevox'));
    return presetNameFrom(v || (engine === 'openai' ? 'server' : 'narrator'));
  };
  const savePreset = () => {
    if (!saveOk || saveName === null) return;
    const name = saveName.trim();
    const spec = speakerSpecOf(p, eff);
    const pr: VoicePreset = { name, engine, voice: value.trim() };
    if (engine === 'openai') {
      const prompt = (spec.prompt || '').trim();
      if (prompt) pr.prompt = prompt;
      const extra = parseExtra(typeof spec.extra === 'string' ? spec.extra : '');
      if (Object.keys(extra).length) pr.extra = extra;
      const conn = settings.tts.openaiConnections.find((c) => isSameConnection(c, settings.tts));
      if (conn) pr.connection = conn.name;
    } else if (engine === 'voicevox') {
      const shape: VoicevoxShape = {};
      const sp = numberOrNone(spec.pitch); if (sp !== undefined) shape.pitch = sp;
      const si = numberOrNone(spec.intonation); if (si !== undefined) shape.intonation = si;
      const sv = numberOrNone(spec.volume); if (sv !== undefined) shape.volume = sv;
      if (Object.keys(shape).length) pr.voicevox = shape;
    }
    updateTts({ voicePresets: [...presets.filter((x) => x.name.toLowerCase() !== name.toLowerCase()), pr] });
    onChange(`@${name}`);
    setSaveName(null);
  };
  const deletePreset = (pr: VoicePreset) => {
    updateTts({ voicePresets: presets.filter((x) => x !== pr) });
  };

  const tryVoice = () => {
    const api = getModuleTtsApi();
    if (playing) { utter.current?.stop(); utter.current = null; setPlaying(false); return; }
    const o = speakerOptions(speakerSpecOf(p, eff));
    setStatus('');
    o.onEngine = (info: MdpTtsEngineInfo) => {
      setStatus(info.message || (info.engine ? `Speaking with ${engineLabel(info.engine)}…` : ''));
    };
    const u = api.speak(/^ja/i.test(lang) ? SAMPLE_TEXT.ja : SAMPLE_TEXT.en, o);
    utter.current = u;
    setPlaying(true);
    u.done.finally(() => {
      if (utter.current !== u) return;
      utter.current = null;
      setPlaying(false);
      setStatus((s) => (s.startsWith('Speaking with') ? '' : s));
    });
  };

  const cfg = getModuleTtsApi().config();
  const placeholder = engine === 'voicevox' ? 'Style id (a number)'
    : engine === 'openai' ? 'Voice id — blank = the server’s default'
      : 'Narrator name (part is enough) — blank = by language';
  let help: React.ReactNode = null;
  let warn = false;
  if (isPreset) {
    if (preset) help = `Preset — ${presetHint(preset)}${preset.prompt ? ` · “${preset.prompt}”` : ''}${preset.extra ? ` · ${formatExtra(preset.extra)}` : ''}`;
    else { warn = true; help = `No preset “${value.trim()}” on this computer — the line is read by its language.`; }
  } else if (loading) help = 'Loading the voices…';
  else if (listError) {
    warn = true;
    help = engine === 'voicevox' ? `VOICEVOX did not answer (${cfg.voicevoxUrl}) — start it, or type a style id.`
      : engine === 'openai' ? `The TTS server’s voices could not be listed (${cfg.openaiUrl}): ${listError}. Type a voice id.`
        : listError;
  } else if (engine === 'voicevox' && value.trim()) {
    if (current) help = current.label;
    else { warn = true; help = 'Not one of this VOICEVOX’s styles.'; }
  } else if (engine === 'webspeech' && !list.length) {
    warn = true;
    help = 'No Web Speech narrators are installed on this computer.';
  } else if (!named) {
    help = 'Auto: a name picks that Web Speech narrator; blank = the app’s narrator for the language.';
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Autocomplete<VoiceOption, false, false, true>
          freeSolo size="small" fullWidth
          options={options}
          value={current ?? (value || null)}
          inputValue={value}
          onInputChange={(_, v, reason) => { if (reason === 'input' || reason === 'clear') onChange(v); }}
          onChange={(_, v) => onChange(typeof v === 'string' ? v : v ? v.value : '')}
          getOptionLabel={(o) => (typeof o === 'string' ? o : o.value)}
          isOptionEqualToValue={(a, b) => a.value === b.value}
          filterOptions={(opts, st) => {
            const q = st.inputValue.trim().toLowerCase();
            if (!q || opts.some((o) => o.value.toLowerCase() === q)) return opts;
            return opts.filter((o) => `${o.value} ${o.label} ${o.hint || ''}`.toLowerCase().includes(q));
          }}
          renderOption={(props, o) => {
            const { key, ...rest } = props as typeof props & { key: React.Key };
            return (
              <li key={key} {...rest}>
                <Typography component="span" sx={{ fontSize: '0.82rem', fontWeight: o.preset ? 600 : undefined }}>{o.label}</Typography>
                {engine === 'voicevox' && !o.preset && <Typography component="span" sx={{ ml: 0.75, fontSize: '0.72rem', color: 'text.disabled' }}>{o.value}</Typography>}
                {o.hint && <Typography component="span" sx={{ ml: 0.75, fontSize: '0.72rem', color: 'text.disabled', flex: o.preset ? 1 : undefined }}>{o.hint}</Typography>}
                {o.preset && (
                  <IconButton size="small" title="Delete this preset (a deck naming it is then read by its language)"
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onClick={(e) => { e.stopPropagation(); deletePreset(o.preset!); }}
                    sx={{ ml: 0.5, p: 0.25, color: 'text.disabled' }}>
                    <CloseIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                )}
              </li>
            );
          }}
          renderInput={(params) => <TextField {...params} placeholder={placeholder} variant="outlined" sx={fieldSx} />}
        />
        <IconButton size="small" title="Reload the list" onClick={() => setReload((n) => n + 1)} sx={{ color: 'var(--app-text-muted)' }}>
          {loading ? <CircularProgress size={16} /> : <RefreshIcon fontSize="small" />}
        </IconButton>
        <IconButton size="small" title={playing ? 'Stop' : 'Try this voice'} onClick={tryVoice} sx={{ color: 'var(--app-accent)' }}>
          {playing ? <StopIcon fontSize="small" /> : <PlayArrowIcon fontSize="small" />}
        </IconButton>
        <IconButton size="small" title="Save this speaker as a preset — decks can then name it as @name" disabled={!canSave}
          onClick={() => setSaveName(saveName === null ? suggestName() : null)} sx={{ color: 'var(--app-text-muted)' }}>
          <BookmarkAddOutlinedIcon fontSize="small" />
        </IconButton>
      </Box>
      {saveName !== null && (
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, mt: 1 }}>
          <TextField size="small" label="Preset name" value={saveName} autoFocus variant="outlined" sx={{ ...fieldSx, width: 220 }}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); savePreset(); } if (e.key === 'Escape') { e.stopPropagation(); setSaveName(null); } }}
            error={!saveOk}
            helperText={!saveOk ? 'Letters, digits, - _ . (no spaces)'
              : presets.some((x) => x.name.toLowerCase() === saveName.trim().toLowerCase()) ? 'Replaces the preset of that name' : `Then written as @${saveName.trim()}`} />
          <Button size="small" variant="contained" disabled={!saveOk} onClick={savePreset} sx={{ mt: 0.25 }}>Save</Button>
          <Button size="small" onClick={() => setSaveName(null)} sx={{ mt: 0.25, color: 'var(--app-text-muted)' }}>Cancel</Button>
        </Box>
      )}
      {help && (
        <Typography sx={{ color: warn ? 'var(--app-warning, #d97706)' : 'var(--app-text-disabled)', fontSize: '0.72rem', mt: 0.4 }}>{help}</Typography>
      )}
      {status && (
        <Typography sx={{ color: /could not/.test(status) ? 'var(--app-warning, #d97706)' : 'var(--app-text-disabled)', fontSize: '0.72rem', mt: 0.25 }}>{status}</Typography>
      )}
    </Box>
  );
};

// --- the TTS server's own options (type="speechoptions") ----------------------
// "k=v, k2=v2" in the directive, edited as the controls the server's description
// names. The server: the preset's saved connection when the voice is a preset with
// one, else the TTS server set in the app.
const SpeechExtraField: React.FC<{ p: ModuleParam; value: string; onChange: (v: string) => void; eff: (name: string) => string }> = ({ p, value, onChange, eff }) => {
  const { settings } = useAppSettings();
  const prefix = p.name.replace(/extra$/i, '');
  const preset = presetNamed(settings.tts.voicePresets, eff(`${prefix}voice`));
  const connection = preset?.engine === 'openai' ? preset.connection : undefined;
  const lang = p.langParam ? eff(p.langParam) : '';
  const where = connection || settings.tts.openaiUrl;
  const [found, setFound] = useState<{ where: string; desc: SpeechServerDescription | null; error?: string } | null>(null);
  useEffect(() => {
    let alive = true;
    getModuleTtsApi().serverOptions(connection).then(
      (desc) => { if (alive) setFound({ where, desc }); },
      (e) => { if (alive) setFound({ where, desc: null, error: String((e as Error)?.message || e) }); },
    );
    return () => { alive = false; };
  }, [connection, where]);
  const current = found && found.where === where ? found : null;
  const extra = useMemo(() => parseExtra(value), [value]);
  const note = !current ? 'Asking the TTS server what it takes…'
    : current.error ? `The TTS server could not be asked (${where}) — options can still be written as text: ${current.error}`
      : undefined;
  return (
    <Box>
      <SpeechOptionsFields description={current?.desc ?? null} value={extra} lang={lang}
        fieldSx={{ ...fieldSx, '& .MuiFormHelperText-root:not(.Mui-error)': { color: 'var(--app-text-disabled)' } }}
        note={note} onChange={(next) => onChange(formatExtra(next))} />
      {preset?.extra && (
        <Typography sx={{ color: 'var(--app-text-disabled)', fontSize: '0.72rem', mt: 0.4 }}>
          On top of the preset’s own: {formatExtra(preset.extra)}
        </Typography>
      )}
    </Box>
  );
};

// --- array helpers: a `[a, b, c]` literal <-> string items (commas / brackets
// inside an item are escaped as `\,` `\[` `\]`, matching the render-side split).
const parseArrayLiteral = (val: string): string[] => {
  const t = (val || '').trim();
  if (!t.startsWith('[') || !t.endsWith(']')) return t === '' ? [] : [t];
  const inner = t.slice(1, -1);
  if (inner.trim() === '') return [];
  return inner.split(/(?<!\\),/).map(s =>
    s.trim().replace(/^["']|["']$/g, '').replace(/\\([,[\]])/g, '$1'),
  );
};
const serializeArray = (items: string[]): string =>
  '[' + items.map(s => String(s).replace(/[,[\]]/g, m => '\\' + m)).join(', ') + ']';
const defaultItem = (p: ModuleParam): string => {
  switch (p.type) {
    case 'number': return p.min != null ? String(p.min) : '0';
    case 'boolean': return 'false';
    case 'select': return p.options?.[0]?.value ?? '';
    case 'color': return p.options?.[0]?.value ?? '#000000';
    default: return '';
  }
};

interface ItemCtx {
  imageEntries: ImageEntry[];
  resolveThumb: (v: string) => string;
  /** The value a param has right now (its default while unset) — for controls
   *  that depend on other params (a voice depends on its engine). */
  eff: (name: string) => string;
}

// Render the control for ONE value of the param's (item) type. Reused for plain
// params and — per item — by ArrayField.
const renderTypedControl = (p: ModuleParam, val: string, onChange: (v: string) => void, ctx: ItemCtx): React.ReactNode => {
  switch (p.type) {
    case 'boolean':
      return (
        <FormControlLabel
          control={<Switch checked={val === 'true' || val === '1'} onChange={(e) => onChange(e.target.checked ? 'true' : 'false')} />}
          label={<Typography sx={{ color: 'var(--app-text-secondary)', fontSize: '0.85rem' }}>{val === 'true' || val === '1' ? 'On' : 'Off'}</Typography>}
        />
      );
    case 'number':
      return (
        <TextField
          size="small" type="number" fullWidth value={val} variant="outlined" sx={fieldSx}
          onChange={(e) => onChange(e.target.value)}
          slotProps={{ htmlInput: { min: p.min, max: p.max, step: p.step ?? (p.integer ? 1 : 'any') } }}
        />
      );
    case 'select':
      return (
        <Select
          size="small" fullWidth value={val} onChange={(e) => onChange(String(e.target.value))}
          sx={{ color: 'var(--app-text-secondary)', fontSize: '0.85rem', '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--app-border-subtle)' } }}
        >
          {(p.options || []).map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
        </Select>
      );
    case 'color':
      return <ColorField value={val} options={p.options} onChange={onChange} />;
    case 'image':
      return <ImageField value={val} entries={ctx.imageEntries} resolveThumb={ctx.resolveThumb} onChange={onChange} />;
    case 'voice':
      return <VoiceField p={p} value={val} onChange={onChange} eff={ctx.eff} />;
    case 'speechoptions':
      return <SpeechExtraField p={p} value={val} onChange={onChange} eff={ctx.eff} />;
    default:
      if (p.multiline) {
        // Directive args live on one line: line breaks become spaces.
        return (
          <TextField size="small" fullWidth multiline minRows={2} maxRows={6} value={val} variant="outlined" sx={fieldSx}
            onChange={(e) => onChange(e.target.value.replace(/\s*[\r\n]+\s*/g, ' '))} />
        );
      }
      return <TextField size="small" fullWidth value={val} variant="outlined" sx={fieldSx} onChange={(e) => onChange(e.target.value)} />;
  }
};

const ArrayField: React.FC<{ p: ModuleParam; value: string; onChange: (v: string) => void; ctx: ItemCtx }> = ({ p, value, onChange, ctx }) => {
  const items = parseArrayLiteral(value);
  const commit = (next: string[]) => onChange(serializeArray(next));
  const swap = (i: number, j: number) => { const n = items.slice(); [n[i], n[j]] = [n[j], n[i]]; commit(n); };
  return (
    <Stack spacing={0.75} sx={{ border: '1px solid var(--app-border-subtle)', borderRadius: 1, p: 1 }}>
      {items.length === 0 && (
        <Typography sx={{ color: 'var(--app-text-disabled)', fontSize: '0.78rem', fontStyle: 'italic' }}>Empty list — add an item below.</Typography>
      )}
      {items.map((it, i) => (
        <Box key={i} sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
          <Typography sx={{ color: 'var(--app-text-disabled)', fontSize: '0.7rem', width: 16, textAlign: 'right', flexShrink: 0 }}>{i + 1}</Typography>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {renderTypedControl(p, it, (v) => { const n = items.slice(); n[i] = v; commit(n); }, ctx)}
          </Box>
          <IconButton size="small" title="Move up" disabled={i === 0} onClick={() => swap(i, i - 1)} sx={{ color: 'var(--app-text-muted)' }}><ArrowUpwardIcon fontSize="inherit" /></IconButton>
          <IconButton size="small" title="Move down" disabled={i === items.length - 1} onClick={() => swap(i, i + 1)} sx={{ color: 'var(--app-text-muted)' }}><ArrowDownwardIcon fontSize="inherit" /></IconButton>
          <IconButton size="small" title="Remove" onClick={() => { const n = items.slice(); n.splice(i, 1); commit(n); }} sx={{ color: 'var(--app-danger)' }}><DeleteOutlineIcon fontSize="inherit" /></IconButton>
        </Box>
      ))}
      <Button size="small" startIcon={<AddIcon />} onClick={() => commit([...items, defaultItem(p)])} sx={{ alignSelf: 'flex-start', textTransform: 'none', color: 'var(--app-accent)' }}>
        Add item
      </Button>
    </Stack>
  );
};

export interface ModuleSettingsDialogProps {
  open: boolean;
  moduleName: string;
  params: ModuleParam[];
  initialValues: Record<string, string>;
  imageEntries: ImageEntry[];
  resolveThumb: (value: string) => string;
  onClose: () => void;
  onSave: (values: Record<string, string>) => void;
}

export const ModuleSettingsDialog: React.FC<ModuleSettingsDialogProps> = ({
  open, moduleName, params, initialValues, imageEntries, resolveThumb, onClose, onSave,
}) => {
  const { settings } = useAppSettings();
  // Seed each control from the current directive value, falling back to default.
  const seed = useMemo(() => {
    const v: Record<string, string> = {};
    params.forEach((p) => { v[p.name] = initialValues[p.name] ?? p.default ?? ''; });
    return v;
  }, [params, initialValues]);
  // An optional param is "specified" iff it was present in the directive; required
  // params are always specified. Unspecified optionals are omitted on save so the
  // module falls back to its own default.
  const seedSpec = useMemo(() => {
    const s: Record<string, boolean> = {};
    params.forEach((p) => { s[p.name] = !!p.required || initialValues[p.name] !== undefined; });
    return s;
  }, [params, initialValues]);

  const [values, setValues] = useState<Record<string, string>>(seed);
  const [specified, setSpecified] = useState<Record<string, boolean>>(seedSpec);
  // Re-seed whenever a different directive is opened.
  const seedKey = `${moduleName}|${JSON.stringify(initialValues)}`;
  const lastSeed = React.useRef(seedKey);
  if (lastSeed.current !== seedKey) { lastSeed.current = seedKey; setValues(seed); setSpecified(seedSpec); }

  // Editing a control implies the param is specified.
  const set = (name: string, v: string) => {
    setValues((prev) => ({ ...prev, [name]: v }));
    setSpecified((prev) => (prev[name] ? prev : { ...prev, [name]: true }));
  };
  const setSpec = (name: string, on: boolean) => setSpecified((prev) => ({ ...prev, [name]: on }));

  // A param's value as the module will see it: the edited value when specified,
  // else its default.
  const eff = (name: string): string => {
    const q = params.find((x) => x.name === name);
    if (!q) return values[name] ?? '';
    return (q.required || specified[name]) ? (values[name] ?? '') : (q.default ?? '');
  };
  // `showif`: a control that does not apply to the current choice (e.g. a VOICEVOX
  // pitch while the engine is the TTS server) is hidden — and not saved. A voice
  // preset brings its own engine: while one is chosen, its engine is what counts.
  const effEngine = (name: string): string => {
    const voiceParam = params.find((q) => q.type === 'voice' && q.engineParam === name);
    const pr = voiceParam ? presetNamed(settings.tts.voicePresets, eff(voiceParam.name)) : undefined;
    return pr ? (pr.engine === 'openai' ? 'server' : pr.engine) : eff(name);
  };
  const isVisible = (p: ModuleParam): boolean =>
    !p.showIf || p.showIf.values.some((v) => v.toLowerCase() === effEngine(p.showIf!.param).trim().toLowerCase());

  const handleSave = () => {
    const out: Record<string, string> = {};
    params.forEach((p) => {
      if (!isVisible(p)) return;
      const spec = !!p.required || specified[p.name];
      if (!spec) return;                          // optional + "Unset" → omit
      const v = (values[p.name] ?? '').trim();
      const def = (p.default ?? '').trim();
      if (p.required) {
        // Omit when equal to default (re-seeds on reopen); an empty
        // required-without-default stays omitted so it surfaces as a render error.
        if (v !== '' && v !== def) out[p.name] = v;
      } else if (v !== '') {
        out[p.name] = v;                          // specified optional (round-trips)
      }
    });
    onSave(out);
  };

  const itemCtx: ItemCtx = { imageEntries, resolveThumb, eff };
  const renderControl = (p: ModuleParam) => {
    const val = values[p.name] ?? '';
    if (p.isArray) return <ArrayField p={p} value={val} onChange={(v) => set(p.name, v)} ctx={itemCtx} />;
    return renderTypedControl(p, val, (v) => set(p.name, v), itemCtx);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth
      slotProps={{ paper: { sx: { bgcolor: 'var(--app-bg-panel)', color: 'var(--app-text-secondary)', backgroundImage: 'none' } } }}>
      <DialogTitle sx={{ fontSize: '1rem' }}>
        <Box component="span" sx={{ color: 'var(--app-accent)' }}>⚙</Box> {moduleName} — settings
      </DialogTitle>
      <DialogContent dividers sx={{ borderColor: 'var(--app-border-subtle)' }}>
        {params.length === 0 ? (
          <Typography sx={{ color: 'var(--app-text-disabled)' }}>This module has no editable parameters.</Typography>
        ) : (
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            {params.filter(isVisible).map((p) => {
              const active = !!p.required || specified[p.name];
              const missingReq = p.required && p.default === undefined && (values[p.name] ?? '').trim() === '';
              return (
              <Box key={p.name}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.4, minHeight: 24 }}>
                  <Typography sx={{ color: 'var(--app-text-secondary)', fontSize: '0.82rem', fontWeight: 600 }}>
                    {labelOf(p)}
                    {p.required && <Box component="span" title="Required" sx={{ color: 'var(--app-danger)', ml: 0.4 }}>*</Box>}
                    <Box component="span" sx={{ color: 'var(--app-text-disabled)', fontWeight: 400, ml: 0.6, fontSize: '0.72rem' }}>{p.name}</Box>
                  </Typography>
                  <Box sx={{ flex: 1 }} />
                  {p.required ? (
                    <Box component="span" sx={{ color: 'var(--app-danger)', fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>required</Box>
                  ) : (
                    <FormControlLabel
                      sx={{ m: 0 }}
                      control={<Checkbox size="small" checked={!specified[p.name]} onChange={(e) => setSpec(p.name, !e.target.checked)} sx={{ p: 0.25, color: 'var(--app-text-muted)' }} />}
                      label={<Typography sx={{ color: 'var(--app-text-disabled)', fontSize: '0.7rem' }}>Unset</Typography>}
                    />
                  )}
                </Box>
                {active ? (
                  renderControl(p)
                ) : (
                  <Typography sx={{ color: 'var(--app-text-disabled)', fontSize: '0.78rem', fontStyle: 'italic' }}>
                    Not set — module uses its default{p.default !== undefined && p.default !== '' ? ` (${p.default})` : ''}.
                  </Typography>
                )}
                {missingReq && (
                  <Typography sx={{ color: 'var(--app-danger)', fontSize: '0.72rem', mt: 0.4 }}>This argument is required.</Typography>
                )}
                {p.description && (
                  <Typography sx={{ color: 'var(--app-text-disabled)', fontSize: '0.72rem', mt: 0.4 }}>{p.description}</Typography>
                )}
              </Box>
              );
            })}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ color: 'var(--app-text-muted)' }}>Cancel</Button>
        <Button onClick={handleSave} variant="contained">Apply</Button>
      </DialogActions>
    </Dialog>
  );
};
