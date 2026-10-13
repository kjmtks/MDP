import React, { useCallback, useEffect, useState } from 'react';
import {
  IconButton, MenuItem, Select, Slider, TextField, ToggleButton, ToggleButtonGroup, Tooltip,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import type { AppSettings } from '../settings/types';
import {
  listWebSpeechVoices, loadWebSpeechVoices, webSpeechAvailable, listVoicevoxSpeakers,
  type TtsEngine, type VoicevoxStyle,
} from './ttsService';
import { SpeechServerControls } from './SpeechServerControls';

type Tts = AppSettings['tts'];

const ENGINES: ReadonlyArray<readonly [TtsEngine, string]> = [
  ['webspeech', 'Web Speech'],
  ['voicevox', 'VOICEVOX'],
  ['openai', 'TTS server'],
];

// The narrator — its engine, voice / speaker (for a TTS server: the whole server
// panel) and voice speed — as MUI controls in the app theme: the same choices as the
// auto-play's setup screen. Shared by the rehearsal panel and the video export
// dialog. Every change goes to the app settings (`patchTts` = updateTts), as on the
// auto-play's setup screen; a queued video takes a copy when it is queued.
export const NarratorControls: React.FC<{
  open: boolean;
  tts: Tts;
  patchTts: (p: Partial<Tts>) => void;
  /** The deck's slides (raw markdown) — what to read when recording a voice. */
  slideRaws?: string[];
  /** Engines that cannot be used here, and why (their button is disabled). */
  unavailable?: Partial<Record<TtsEngine, string>>;
  /** More controls on the first row, after the voice speed (the rehearsal's reading speed). */
  extra?: React.ReactNode;
  /** A line under the first row. */
  note?: React.ReactNode;
  /** A failure the host reports (a rehearsal's speech error), under the voice controls. */
  error?: string;
}> = ({ open, tts, patchTts, slideRaws, unavailable, extra, note, error }) => {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [vvSpeakers, setVvSpeakers] = useState<VoicevoxStyle[]>([]);
  const [vvError, setVvError] = useState('');

  // Web Speech voices populate asynchronously.
  useEffect(() => {
    if (!open || !webSpeechAvailable()) return;
    loadWebSpeechVoices().then(setVoices).catch(() => setVoices(listWebSpeechVoices()));
  }, [open]);

  // The running VOICEVOX engine's speakers (needs the local engine).
  const refreshVoicevox = useCallback(() => {
    setVvError('');
    listVoicevoxSpeakers(tts.voicevoxUrl)
      .then((s) => {
        setVvSpeakers(s);
        // Keep the saved speaker if this engine offers it, else take the first.
        if (!s.find((x) => x.id === tts.voicevoxSpeaker) && s.length) patchTts({ voicevoxSpeaker: s[0].id });
      })
      .catch((e) => { setVvSpeakers([]); setVvError(e instanceof Error ? e.message : 'Could not reach VOICEVOX. Is the engine running?'); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tts.voicevoxUrl, tts.voicevoxSpeaker]);
  useEffect(() => { if (open && tts.engine === 'voicevox') refreshVoicevox(); }, [open, tts.engine, refreshVoicevox]);

  const muted = { fontSize: 13, color: 'var(--app-text-muted)' } as const;
  const blocked = unavailable?.[tts.engine];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <ToggleButtonGroup exclusive size="small" value={tts.engine}
          onChange={(_, v) => { if (v && !unavailable?.[v as TtsEngine]) { setVvError(''); patchTts({ engine: v }); } }}>
          {ENGINES.map(([id, label]) => {
            const why = unavailable?.[id] || (id === 'webspeech' && !webSpeechAvailable() ? 'Web Speech is not available here.' : '');
            const button = (
              <ToggleButton key={id} value={id} disabled={!!why} sx={{ textTransform: 'none' }}>{label}</ToggleButton>
            );
            // A disabled button gets no pointer events — the tooltip needs a wrapper.
            return why ? <Tooltip key={id} title={why}><span>{button}</span></Tooltip> : button;
          })}
        </ToggleButtonGroup>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Tooltip title="How fast the synthesized voice speaks"><span style={muted}>Voice speed</span></Tooltip>
          <Slider size="small" min={0.5} max={2} step={0.1} value={tts.rate}
            onChange={(_, v) => patchTts({ rate: v as number })} sx={{ width: 100 }} />
          <span style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{tts.rate.toFixed(1)}×</span>
        </div>
        {extra}
      </div>
      {note && <div style={{ fontSize: 12, color: 'var(--app-text-muted)', marginTop: -2 }}>{note}</div>}

      {blocked ? (
        <div style={{ fontSize: 13, color: '#f0a020' }}>{blocked}</div>
      ) : tts.engine === 'openai' ? (
        <SpeechServerControls tts={tts} patchTts={patchTts} slideRaws={slideRaws} />
      ) : tts.engine === 'webspeech' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ ...muted, width: 46 }}>Voice</span>
          <Select size="small" value={voices.find((v) => v.voiceURI === tts.webspeechVoiceURI) ? tts.webspeechVoiceURI : ''}
            onChange={(e) => patchTts({ webspeechVoiceURI: String(e.target.value) })} displayEmpty sx={{ flex: 1, minWidth: 220 }}>
            <MenuItem value=""><em>System default</em></MenuItem>
            {voices.map((v) => <MenuItem key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang}){v.default ? ' — default' : ''}</MenuItem>)}
          </Select>
          {!webSpeechAvailable() && <span style={{ color: '#dc2626', fontSize: 13 }}>Web Speech unavailable here.</span>}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ ...muted, width: 46 }}>URL</span>
            <TextField size="small" value={tts.voicevoxUrl} onChange={(e) => patchTts({ voicevoxUrl: e.target.value })} sx={{ flex: 1 }} placeholder="http://127.0.0.1:50021" />
            <Tooltip title="Connect / refresh speakers"><span><IconButton size="small" onClick={refreshVoicevox}><RefreshIcon fontSize="small" /></IconButton></span></Tooltip>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ ...muted, width: 46 }}>Speaker</span>
            <Select size="small" value={vvSpeakers.find((s) => s.id === tts.voicevoxSpeaker) ? tts.voicevoxSpeaker : ''}
              onChange={(e) => patchTts({ voicevoxSpeaker: Number(e.target.value) })} displayEmpty sx={{ flex: 1, minWidth: 220 }}>
              {!vvSpeakers.length && <MenuItem value=""><em>Connect to load speakers…</em></MenuItem>}
              {vvSpeakers.map((s) => <MenuItem key={s.id} value={s.id}>{s.label}</MenuItem>)}
            </Select>
          </div>
          {vvError && <span style={{ color: '#dc2626', fontSize: 13 }}>{vvError} — start the VOICEVOX engine, then Refresh.</span>}
        </div>
      )}
      {error && <span style={{ color: '#dc2626', fontSize: 13 }}>{error}</span>}
    </div>
  );
};
