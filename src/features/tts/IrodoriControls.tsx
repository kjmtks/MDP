import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button, CircularProgress, MenuItem, TextField, ThemeProvider, createTheme,
} from '@mui/material';
import type { AppSettings } from '../settings/types';
import {
  IRODORI_VOICE_ID, deleteIrodoriVoice, designIrodoriVoice, irodoriHealth, isAbortError, listIrodoriVoices,
  saveIrodoriVoice, type IrodoriStatus,
} from './ttsService';
import { VoiceCalibrationDialog } from './VoiceCalibrationDialog';

type Tts = AppSettings['tts'];

// A voice designed from the caption, waiting to be auditioned and then locked in.
interface Sample { wav: Uint8Array; url: string }

// Irodori-TTS engine settings, shared by the rehearsal dialog and the narrated
// auto-play setup screen: server URL + Connect, the voice to speak with, and the
// Voice Design caption. Connecting reads /health (does the first synthesis still
// have to load the model?) and /v1/audio/voices (what the voices/ folder holds).
//
// A caption alone gives a different speaker on almost every line (see
// ttsService: "locking a designed voice"), so with no reference voice the panel
// offers: design one clip from the caption → audition it → register it on the
// server as a named voice → speak everything with that voice. Or the presenter's
// OWN voice: record a few sentences of the deck (VoiceCalibrationDialog), or
// register an existing recording.
export const IrodoriControls: React.FC<{
  tts: Tts;
  patchTts: (p: Partial<Tts>) => void;
  /** The auto-play setup screen is always dark, whatever the app theme. */
  dark?: boolean;
  /** The deck's slides (raw markdown) — what to read when recording a voice. */
  slideRaws?: string[];
}> = ({ tts, patchTts, dark, slideRaws }) => {
  // 'loading' from the start: the panel connects as soon as the engine is picked.
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [error, setError] = useState('');
  const [health, setHealth] = useState<IrodoriStatus | null>(null);
  const [voices, setVoices] = useState<string[]>([]);

  const server = useMemo(() => ({ url: tts.irodoriUrl, apiKey: tts.irodoriApiKey }), [tts.irodoriUrl, tts.irodoriApiKey]);

  // State is only set from the promise's callbacks, never synchronously.
  const load = useCallback((then?: () => void) => {
    void Promise.all([irodoriHealth(server), listIrodoriVoices(server)]).then(
      ([h, ids]) => { setHealth(h); setVoices(ids); setError(''); setStatus('ok'); then?.(); },
      (e: unknown) => {
        setHealth(null); setVoices([]); setStatus('error');
        setError(e instanceof Error ? e.message : String(e));
      },
    );
  }, [server]);
  const connect = () => { setStatus('loading'); setError(''); load(); };

  // Try once when the engine is picked; after that Connect re-checks on demand.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  // ---- design → audition → lock ----------------------------------------------
  const [sample, setSample] = useState<Sample | null>(null);
  const [designing, setDesigning] = useState(false);
  const [designError, setDesignError] = useState('');
  const [name, setName] = useState('narrator');
  const [saving, setSaving] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sampleRef = useRef<Sample | null>(null);
  // Closing the panel mid-design aborts the request, so the server stops as well.
  const designAbortRef = useRef<AbortController | null>(null);

  const play = (url: string) => {
    audioRef.current?.pause();
    const a = new Audio(url);
    audioRef.current = a;
    void a.play().catch(() => { /* autoplay blocked: the Play button still works */ });
  };
  const dropSample = () => {
    audioRef.current?.pause();
    if (sampleRef.current) URL.revokeObjectURL(sampleRef.current.url);
    sampleRef.current = null;
    setSample(null);
  };
  useEffect(() => () => {
    designAbortRef.current?.abort();
    audioRef.current?.pause();
    if (sampleRef.current) URL.revokeObjectURL(sampleRef.current.url);
  }, []);

  const design = () => {
    setDesigning(true); setDesignError(''); setConfirmReplace(false);
    const ac = new AbortController();
    designAbortRef.current = ac;
    designIrodoriVoice(tts, ac.signal).then((wav) => {
      dropSample();
      const s = { wav, url: URL.createObjectURL(new Blob([wav.slice()], { type: 'audio/wav' })) };
      sampleRef.current = s;
      setSample(s);
      play(s.url);
    }, (e: unknown) => { if (!isAbortError(e)) setDesignError(e instanceof Error ? e.message : String(e)); })
      .finally(() => setDesigning(false));
  };

  const nameOk = IRODORI_VOICE_ID.test(name) && name.toLowerCase() !== 'none';
  const lock = (replace: boolean) => {
    if (!sample || !nameOk) return;
    setSaving(true); setDesignError('');
    saveIrodoriVoice(server, name, sample.wav, replace).then((res) => {
      if (res === 'exists') { setConfirmReplace(true); return; }
      setConfirmReplace(false);
      dropSample();
      // Re-read the list so the new voice is offered, then speak with it.
      load(() => patchTts({ irodoriVoice: name }));
    }, (e: unknown) => setDesignError(e instanceof Error ? e.message : String(e)))
      .finally(() => setSaving(false));
  };

  // ---- own voice: record / file, and removing a voice ----------------------------
  const [calibrate, setCalibrate] = useState<'record' | 'file' | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const onRegistered = (id: string) => load(() => patchTts({ irodoriVoice: id }));
  const remove = (id: string) => {
    setRemoving(true); setRemoveError('');
    deleteIrodoriVoice(server, id).then(
      () => { setConfirmRemove(false); load(() => patchTts({ irodoriVoice: 'none' })); },
      (e: unknown) => setRemoveError(e instanceof Error ? e.message : String(e)),
    ).finally(() => setRemoving(false));
  };

  const voice = tts.irodoriVoice || 'none';
  // Keep a saved voice the server no longer offers visible, so its absence is
  // noticed instead of silently becoming another voice.
  const options = useMemo(() => {
    const list = voices.length ? voices : ['none'];
    return list.includes(voice) ? list : [...list, voice];
  }, [voices, voice]);
  const noRef = voice === 'none';
  const hasCaption = !!tts.irodoriCaption.trim();

  const muted = dark ? '#9aa0aa' : 'var(--app-text-muted)';
  const warn = '#f0a020';
  const btn = { textTransform: 'none', whiteSpace: 'nowrap' } as const;
  const body = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <TextField size="small" label="Server" value={tts.irodoriUrl} sx={{ flex: 1 }}
          onChange={(e) => patchTts({ irodoriUrl: e.target.value })} placeholder="http://127.0.0.1:8088" />
        <Button variant="outlined" size="small" onClick={connect} disabled={status === 'loading'} sx={{ ...btn, minWidth: 92 }}>
          {status === 'loading' ? <CircularProgress size={16} /> : 'Connect'}
        </Button>
      </div>

      {/* A shared server started with IRODORI_API_KEY answers 401 without it. Kept
          in the machine-local settings only; module scripts never see it. */}
      <TextField size="small" label="API key" type="password" value={tts.irodoriApiKey}
        onChange={(e) => patchTts({ irodoriApiKey: e.target.value.trim() })}
        placeholder="only if the server sets IRODORI_API_KEY"
        autoComplete="new-password" slotProps={{ htmlInput: { spellCheck: false } }} />

      <div style={{ fontSize: 12, color: status === 'error' ? '#f87171' : muted, marginTop: -4 }}>
        {status === 'error' && <>{error} Start the Irodori-TTS server, then Connect.</>}
        {status === 'ok' && health && (
          <>
            Connected{health.checkpoint ? <> · <code>{health.checkpoint}</code></> : null}
            {' · '}
            {health.loaded ? 'model loaded'
              : health.loading ? 'model loading…'
                : 'model not loaded yet — the first line waits for it to load'}
          </>
        )}
        {status === 'loading' && 'Connecting…'}
      </div>

      <TextField select size="small" label="Voice" value={voice}
        onChange={(e) => { patchTts({ irodoriVoice: String(e.target.value) }); setConfirmRemove(false); setRemoveError(''); }}>
        {options.map((id) => (
          <MenuItem key={id} value={id}>
            {id === 'none' ? 'none — no reference voice (Voice Design only)'
              : voices.length && !voices.includes(id) ? `${id} (not on this server)` : id}
          </MenuItem>
        ))}
      </TextField>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: -2 }}>
        <Button size="small" variant="outlined" sx={btn} disabled={status !== 'ok'} onClick={() => setCalibrate('record')}>
          🎙 Record my voice…
        </Button>
        <Button size="small" sx={btn} disabled={status !== 'ok'} onClick={() => setCalibrate('file')}>Use an audio file…</Button>
        <span style={{ flex: 1 }} />
        {!noRef && voices.includes(voice) && (confirmRemove ? (
          <>
            <span style={{ fontSize: 12, color: warn }}>Remove “{voice}” from the server? Anyone else using it loses it too.</span>
            <Button size="small" color="error" sx={btn} disabled={removing} onClick={() => remove(voice)}>
              {removing ? <CircularProgress size={14} /> : 'Remove'}
            </Button>
            <Button size="small" sx={btn} disabled={removing} onClick={() => setConfirmRemove(false)}>Keep</Button>
          </>
        ) : (
          <Button size="small" sx={{ ...btn, color: muted }} onClick={() => setConfirmRemove(true)}>Remove this voice…</Button>
        ))}
      </div>
      {removeError && <div style={{ fontSize: 12, color: '#f87171', marginTop: -4 }}>{removeError}</div>}
      {calibrate && (
        <VoiceCalibrationDialog mode={calibrate} tts={tts} slideRaws={slideRaws || []}
          onClose={() => setCalibrate(null)} onRegistered={onRegistered} />
      )}

      <TextField size="small" label="Voice Design (caption)" multiline minRows={2} maxRows={5}
        value={tts.irodoriCaption} onChange={(e) => patchTts({ irodoriCaption: e.target.value })}
        placeholder="例: 落ち着いた低めの男性の声。聞き取りやすい、丁寧な講義口調。" />

      {!noRef ? (
        <div style={{ fontSize: 12, color: muted, marginTop: -4 }}>
          The reference voice sets who speaks; the caption (optional) steers emotion and delivery.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: -2 }}>
          <div style={{ fontSize: 12, color: warn }}>
            {hasCaption
              ? 'Without a reference voice the speaker changes from line to line — the caption only says what KIND of voice. Make one voice from this description and lock it in:'
              : 'No reference voice and no caption: every line is spoken by a different random voice. Describe the voice above, then make it into a fixed voice here.'}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button variant="outlined" size="small" sx={btn} onClick={design}
              disabled={!hasCaption || status !== 'ok' || designing || saving}>
              {designing ? <><CircularProgress size={14} sx={{ mr: 1 }} />Designing…</>
                : sample ? 'Try another voice' : 'Create a voice from this description'}
            </Button>
            {sample && !designing && (
              <Button size="small" sx={btn} onClick={() => play(sample.url)}>▶ Play again</Button>
            )}
          </div>
          {sample && !designing && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <TextField size="small" label="Save as" value={name} sx={{ width: 170 }}
                onChange={(e) => { setName(e.target.value.trim()); setConfirmReplace(false); }}
                error={!nameOk} helperText={nameOk ? undefined : 'letters, digits, - and _'} />
              {confirmReplace ? (
                <>
                  <span style={{ fontSize: 12, color: warn }}>“{name}” already exists on the server.</span>
                  <Button variant="contained" size="small" sx={btn} onClick={() => lock(true)} disabled={saving}>Replace it</Button>
                  <Button size="small" sx={btn} onClick={() => setConfirmReplace(false)} disabled={saving}>Cancel</Button>
                </>
              ) : (
                <Button variant="contained" size="small" sx={btn} onClick={() => lock(false)} disabled={saving || !nameOk}>
                  {saving ? <CircularProgress size={14} /> : 'Use this voice'}
                </Button>
              )}
            </div>
          )}
          {designError && <div style={{ fontSize: 12, color: '#f87171' }}>{designError}</div>}
        </div>
      )}
    </div>
  );

  // Dark variant: the auto-play overlay is dark regardless of the app theme. It
  // sits at z-index 3000, so menus and dialogs opened from here must go above it.
  const darkTheme = useMemo(() => createTheme({
    palette: { mode: 'dark' },
    zIndex: { modal: 3100, snackbar: 3150, tooltip: 3200 },
  }), []);
  return dark ? <ThemeProvider theme={darkTheme}>{body}</ThemeProvider> : body;
};
