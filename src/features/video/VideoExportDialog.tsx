import React, { useState } from 'react';
import {
  Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Radio, RadioGroup,
  TextField,
} from '@mui/material';
import { isElectron } from '../../api/apiClient';
import { engineLabel, type TtsEngine } from '../tts/ttsService';
import { exactModeSupported, videoBaseOf, type VideoOptions } from './videoTypes';
import { shareThisTab } from './webShow';

// The choices, remembered per computer (a convenience — the defaults are fine).
const KEY = 'mdp.videoExport.options';
const DEFAULTS: VideoOptions = { mode: 'exact', height: 1080, subtitles: true, vtt: false, includeHidden: false, fade: true };
function loadOptions(): VideoOptions {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<VideoOptions>;
    return {
      mode: o.mode === 'fast' ? 'fast' : 'exact',
      height: o.height === 720 || o.height === 2160 ? o.height : 1080,
      subtitles: typeof o.subtitles === 'boolean' ? o.subtitles : DEFAULTS.subtitles,
      vtt: typeof o.vtt === 'boolean' ? o.vtt : DEFAULTS.vtt,
      includeHidden: typeof o.includeHidden === 'boolean' ? o.includeHidden : DEFAULTS.includeHidden,
      fade: typeof o.fade === 'boolean' ? o.fade : DEFAULTS.fade,
    };
  } catch { return DEFAULTS; }
}

const minutes = (sec: number) => (sec < 90 ? `${Math.max(1, Math.round(sec))} s` : `${Math.round(sec / 60)} min`);

// Queue the open deck for a narrated video export and save it next to the deck —
// either the real auto-play, recorded while it plays (exact, the default: in a
// hidden window of the desktop app, or in this tab of the web build), or still
// pictures joined by cross-fades (fast).
export const VideoExportDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  deckPath: string;
  slideSize: { width: number; height: number };
  engine: TtsEngine;
  /** The show's rough length (talk-time estimate) — what an exact export takes. */
  estimatedSeconds?: number;
  /** Switch the narrator from Web Speech (which gives no audio data). */
  onUseEngine: (engine: 'voicevox' | 'openai') => void;
  /** `tabStream`: the web exact mode's share of this tab. */
  onQueue: (options: VideoOptions, tabStream?: MediaStream) => void;
}> = ({ open, onClose, deckPath, slideSize, engine, estimatedSeconds, onUseEngine, onQueue }) => {
  const [o, setO] = useState<VideoOptions>(loadOptions);
  const [problem, setProblem] = useState('');
  const set = (p: Partial<VideoOptions>) => setO((cur) => {
    const next = { ...cur, ...p };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* not remembered */ }
    return next;
  });
  const name = (videoBaseOf(deckPath).split('/').pop() || 'deck');
  const canNarrate = engine === 'voicevox' || engine === 'openai';
  const muted = { fontSize: 13, color: 'var(--app-text-muted)' } as const;
  const web = !isElectron();
  const exactOk = exactModeSupported();
  const mode = exactOk ? o.mode : 'fast';
  const inThisTab = web && mode === 'exact';

  // The web exact mode records this tab: the browser asks to share it, and only on
  // a click — so it is asked right here.
  const queue = () => {
    setProblem('');
    if (!inThisTab) { onQueue({ ...o, mode }); return; }
    shareThisTab(slideSize, o.height).then(
      (stream) => {
        // Found out now, not after the whole narration has been synthesized.
        if (!stream.getAudioTracks().length) {
          stream.getTracks().forEach((t) => t.stop());
          setProblem('The tab was shared without its sound, so the narration would be missing. Share it again with “Also share tab audio” on.');
          return;
        }
        onQueue({ ...o, mode }, stream);
      },
      (e: unknown) => setProblem((e as { name?: string })?.name === 'NotAllowedError'
        ? 'The tab was not shared, so nothing can be recorded. Allow sharing this tab (with its audio) to record, or use Fast.'
        : `This tab could not be shared: ${e instanceof Error ? e.message : String(e)}`),
    );
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Export narrated video</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <div style={{ fontSize: 14, lineHeight: 1.6 }}>
          Makes a video of the narrated auto-play: each slide’s <code>@script</code> is read aloud and the slides
          follow along. {web
            ? <>Jobs run one after another: Fast in the background — keep working — and Exact in this tab.</>
            : <>Jobs run one after another in the background, in a window of their own — keep working, or queue another deck.</>}
        </div>
        <RadioGroup value={mode} onChange={(e) => set({ mode: e.target.value === 'fast' ? 'fast' : 'exact' })} sx={{ gap: 0.5 }}>
          <FormControlLabel value="exact" disabled={!exactOk} control={<Radio size="small" />} sx={{ alignItems: 'flex-start', '& .MuiRadio-root': { pt: 0.25 } }}
            label={(
              <div>
                <b>Exact</b> — records the real auto-play
                <div style={muted}>
                  Module scripts, slide transitions and build effects exactly as they run. Takes as long as the show
                  {estimatedSeconds ? <> (about {minutes(estimatedSeconds)})</> : null}, once the narration is synthesized.
                  {web && (exactOk
                    ? <> The show plays in this tab while it records: your browser asks to share this tab — allow it with
                      its audio — and the editor is back when it ends. A larger window gives a sharper picture.</>
                    : <> Needs Chrome or Edge: this browser cannot record a tab with its sound.</>)}
                </div>
              </div>
            )} />
          <FormControlLabel value="fast" control={<Radio size="small" />} sx={{ alignItems: 'flex-start', '& .MuiRadio-root': { pt: 0.25 } }}
            label={(
              <div>
                <b>Fast</b> — still pictures
                <div style={muted}>
                  Each slide at each build step, joined by cross-fades; much quicker than real time. Module scripts
                  and transitions are not played.
                </div>
              </div>
            )} />
        </RadioGroup>
        {canNarrate ? (
          <div style={muted}>Narrator: <b>{engineLabel(engine)}</b>, with its current voice and speed (set them in the auto-play or rehearsal panel).</div>
        ) : (
          <div style={{ fontSize: 13, color: '#f0a020', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span>The narrator is Web Speech, which only plays aloud and gives no audio to put in a video. Use:</span>
            <span style={{ display: 'flex', gap: 8 }}>
              <Button size="small" variant="outlined" sx={{ textTransform: 'none' }} onClick={() => onUseEngine('openai')}>TTS server (OpenAI-compatible)</Button>
              <Button size="small" variant="outlined" sx={{ textTransform: 'none' }} onClick={() => onUseEngine('voicevox')}>VOICEVOX</Button>
            </span>
          </div>
        )}
        <TextField select size="small" label="Resolution" value={o.height} sx={{ width: 200, mt: 1 }}
          onChange={(e) => set({ height: Number(e.target.value) as VideoOptions['height'] })}>
          <MenuItem value={720}>720p (HD)</MenuItem>
          <MenuItem value={1080}>1080p (Full HD)</MenuItem>
          <MenuItem value={2160}>2160p (4K)</MenuItem>
        </TextField>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <FormControlLabel control={<Checkbox size="small" checked={o.subtitles} onChange={(e) => set({ subtitles: e.target.checked })} />}
            label="Subtitles in the picture (as in the auto-play)" />
          <FormControlLabel control={<Checkbox size="small" checked={o.vtt} onChange={(e) => set({ vtt: e.target.checked })} />}
            label={<>Also save the subtitles as a file (<code>{name}.vtt</code>)</>} />
          {mode === 'fast' && (
            <FormControlLabel control={<Checkbox size="small" checked={o.fade} onChange={(e) => set({ fade: e.target.checked })} />}
              label="Cross-fade between slides and build steps (a slide with @transition none cuts)" />
          )}
          <FormControlLabel control={<Checkbox size="small" checked={o.includeHidden} onChange={(e) => set({ includeHidden: e.target.checked })} />}
            label="Include hidden slides" />
        </div>
        <div style={muted}>
          Saved beside the deck as <code>{name}.mp4</code> (replacing an earlier one); it opens in the preview from the file tree.
        </div>
        {problem && <div style={{ fontSize: 13, color: '#f0a020' }}>{problem}</div>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>Cancel</Button>
        <Button variant="contained" disabled={!canNarrate} onClick={queue} sx={{ textTransform: 'none' }}>
          {inThisTab ? 'Share this tab and record' : 'Add to queue'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
