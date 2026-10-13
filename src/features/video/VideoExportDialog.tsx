import React, { useEffect, useMemo, useState } from 'react';
import {
  Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Radio, RadioGroup,
  Tab, Tabs, TextField, ThemeProvider, createTheme,
} from '@mui/material';
import { isElectron } from '../../api/apiClient';
import { useAppSettings } from '../settings/AppSettingsContext';
import { synthesizesAudio } from '../tts/ttsService';
import { NarratorControls } from '../tts/NarratorControls';
import { TimeEstimatesPanel, type DeckTimingInfo } from '../rehearsal/TimeEstimatesPanel';
import { exactModeSupported, narratorLabel, videoBaseOf, type VideoOptions } from './videoTypes';
import { besideDeckPossible, pickVideoFile } from './videoFiles';
import { shareThisTab } from './webShow';

// The folder a video was last saved to (desktop) — where the save dialog opens next.
const FOLDER_KEY = 'mdp.videoExport.folder';
const lastFolder = (): string | undefined => { try { return localStorage.getItem(FOLDER_KEY) || undefined; } catch { return undefined; } };

// The choices, remembered per computer (a convenience — the defaults are fine).
const KEY = 'mdp.videoExport.options';
const DEFAULTS: VideoOptions = { mode: 'exact', height: 1080, subtitles: true, vtt: false, includeHidden: false, fade: true, updateTimes: false };
// The tab last looked at, too.
type DialogTab = 'video' | 'narrator' | 'timing';
const TAB_KEY = 'mdp.videoExport.tab';
const readTab = (): DialogTab => {
  try { const v = localStorage.getItem(TAB_KEY); return v === 'narrator' || v === 'timing' ? v : 'video'; } catch { return 'video'; }
};
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
      updateTimes: typeof o.updateTimes === 'boolean' ? o.updateTimes : DEFAULTS.updateTimes,
    };
  } catch { return DEFAULTS; }
}

const minutes = (sec: number) => (sec < 90 ? `${Math.max(1, Math.round(sec))} s` : `${Math.round(sec / 60)} min`);

// Queue the open deck for a narrated video export and save it next to the deck —
// either the real auto-play, recorded while it plays (exact, the default: in a
// hidden window of the desktop app, or in this tab of the web build), or still
// pictures joined by cross-fades (fast). The narrator (engine, voice, speed) is
// chosen here with the same controls as the rehearsal panel — the same settings as
// the auto-play's setup screen; the queued job keeps a copy. With "Update the time
// estimates" (Timing tab) what each slide's narration took becomes its estimate.
// The choices sit in three tabs; what is missing to queue is said under them.
export const VideoExportDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  deckPath: string;
  slideSize: { width: number; height: number };
  /** The deck's slides (raw markdown) — what to read when recording a voice. */
  slideRaws?: string[];
  /** The show's rough length (talk-time estimate) — what an exact export takes. */
  estimatedSeconds?: number;
  /** The deck's time estimates now (the Timing tab). */
  timing?: DeckTimingInfo | null;
  /** Forget the deck's measured times. */
  onForgetTimes?: () => void | Promise<void>;
  /** `tabStream`: the web exact mode's share of this tab. `output`: the .mp4 picked
   *  in the save dialog (desktop) — omitted: beside the deck. */
  onQueue: (options: VideoOptions, tabStream?: MediaStream, output?: string) => void;
}> = ({ open, onClose, deckPath, slideSize, slideRaws, estimatedSeconds, timing, onForgetTimes, onQueue }) => {
  const { settings, updateTts, appThemeVariant } = useAppSettings();
  const muiTheme = useMemo(() => createTheme({ palette: { mode: appThemeVariant } }), [appThemeVariant]);
  const [o, setO] = useState<VideoOptions>(loadOptions);
  const [problem, setProblem] = useState('');
  const [tab, setTab] = useState<DialogTab>(readTab);
  const pickTab = (t: DialogTab) => { setTab(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* not remembered */ } };
  // Where it goes (desktop): beside the deck, unless the user picks a file — which a
  // deck behind an SSH link needs (nothing can be written there).
  const [dest, setDest] = useState<string | null>(null);
  const [beside, setBeside] = useState<{ deck: string; ok: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    void besideDeckPossible(deckPath).then((ok) => { if (live) setBeside({ deck: deckPath, ok }); });
    return () => { live = false; };
  }, [deckPath]);
  const besideOk = !beside || beside.deck !== deckPath || beside.ok;
  const choose = async () => {
    const picked = await pickVideoFile(videoBaseOf(deckPath).split('/').pop() || 'video', lastFolder());
    if (!picked) return;
    setDest(picked);
    try { localStorage.setItem(FOLDER_KEY, picked.replace(/[\\/][^\\/]*$/, '')); } catch { /* not remembered */ }
  };
  const set = (p: Partial<VideoOptions>) => setO((cur) => {
    const next = { ...cur, ...p };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* not remembered */ }
    return next;
  });
  const name = (videoBaseOf(deckPath).split('/').pop() || 'deck');
  const canNarrate = synthesizesAudio(settings.tts.engine);
  const muted = { fontSize: 13, color: 'var(--app-text-muted)' } as const;
  const web = !isElectron();
  const exactOk = exactModeSupported();
  const mode = exactOk ? o.mode : 'fast';
  const inThisTab = web && mode === 'exact';

  // The web exact mode records this tab: the browser asks to share it, and only on
  // a click — so it is asked right here.
  const queue = () => {
    setProblem('');
    if (!inThisTab) { onQueue({ ...o, mode }, undefined, dest || undefined); return; }
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
    <ThemeProvider theme={muiTheme}>
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth
      PaperProps={{ sx: { bgcolor: 'var(--app-bg-panel)', color: 'var(--app-text)' } }}>
      <DialogTitle sx={{ pb: 1 }}>Export narrated video</DialogTitle>
      {/* What it makes and the tabs stay in place; a long tab scrolls below them. */}
      <div style={{ padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 14, lineHeight: 1.6 }}>
          Makes a video of the narrated auto-play: each slide’s <code>@script</code> is read aloud and the slides
          follow along. {web
            ? <>Jobs run one after another: Fast in the background — keep working — and Exact in this tab.</>
            : <>Jobs run one after another in the background, in a window of their own — keep working, or queue another deck.</>}
        </div>
        <Tabs value={tab} onChange={(_, v: DialogTab) => pickTab(v)} aria-label="Video export settings"
          sx={{ minHeight: 36, borderBottom: 1, borderColor: 'divider', '& .MuiTab-root': { textTransform: 'none', minHeight: 36, py: 0.5, fontWeight: 600 } }}>
          <Tab value="video" label="Video" id="mdp-video-tab-video" aria-controls="mdp-video-tabpanel" />
          <Tab value="narrator" label="Narrator" id="mdp-video-tab-narrator" aria-controls="mdp-video-tabpanel" />
          <Tab value="timing" id="mdp-video-tab-timing" aria-controls="mdp-video-tabpanel"
            label={(
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                Timing
                {o.updateTimes && <span title="Updates the time estimates" style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--app-accent, #3b82f6)' }} />}
              </span>
            )} />
        </Tabs>
      </div>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 2 }}>
        <div id="mdp-video-tabpanel" role="tabpanel" aria-labelledby={`mdp-video-tab-${tab}`}
          style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 230 }}>
        {tab === 'video' && (
          <>
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
            <TextField select size="small" label="Resolution" value={o.height} sx={{ width: 200, mt: 0.5 }}
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
            {web ? (
              <div style={muted}>
                Saved beside the deck as <code>{name}.mp4</code> (replacing an earlier one); it opens in the preview from the file tree.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Save to</span>
                  {dest
                    ? <code style={{ fontSize: 12.5, wordBreak: 'break-all' }}>{dest}</code>
                    : besideOk
                      ? <span style={muted}>beside the deck, as <code>{name}.mp4</code></span>
                      : <span style={{ fontSize: 13, color: '#f0a020' }}>— not chosen yet</span>}
                  <Button size="small" variant={!dest && !besideOk ? 'contained' : 'outlined'} sx={{ textTransform: 'none' }} onClick={() => void choose()}>
                    {!dest && !besideOk ? 'Choose…' : 'Change…'}
                  </Button>
                  {dest && besideOk && (
                    <Button size="small" sx={{ textTransform: 'none' }} onClick={() => setDest(null)}>Beside the deck</Button>
                  )}
                </div>
                <div style={muted}>
                  {!besideOk && !dest
                    ? <>This deck is in a folder reached through an SSH link, where a video cannot be written. Choose where to save it on this computer.</>
                    : dest
                      ? <>An earlier file of that name is replaced{o.vtt ? <>; the subtitles go beside it</> : null}. When it is done, the queue opens it in your video player or shows it in its folder.</>
                      : <>An earlier one is replaced; it opens in the preview from the file tree.</>}
                </div>
              </div>
            )}
          </>
        )}
        {tab === 'narrator' && (
          // The narrator: the auto-play's settings (saved for both); the job keeps a copy.
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <NarratorControls open={open} tts={settings.tts} patchTts={updateTts} slideRaws={slideRaws}
              unavailable={{ webspeech: 'Web Speech only plays aloud and gives no audio to put in a video. Choose VOICEVOX or a TTS server.' }} />
            <div style={muted}>
              The same narrator settings as the auto-play, saved for both. A queued video keeps the narrator it was queued with.
            </div>
          </div>
        )}
        {tab === 'timing' && (
          <TimeEstimatesPanel what="video" update={!!o.updateTimes} onUpdate={(v) => set({ updateTimes: v })}
            rate={settings.tts.rate} info={timing} onForget={onForgetTimes} fastMode={mode === 'fast'} />
        )}
        </div>
        {/* What the job will be, and what is missing to queue it — whichever tab is open. */}
        <div style={{ ...muted, fontSize: 12, overflowWrap: 'anywhere' }}>
          {mode === 'exact' ? 'Exact' : 'Fast'} · {o.height}p · {narratorLabel(settings.tts)}
          {o.updateTimes ? ' · updates the time estimates' : ''}
        </div>
        {!canNarrate && tab !== 'narrator' && (
          <div style={{ fontSize: 13, color: '#f0a020' }}>
            Web Speech gives no audio for a video — choose VOICEVOX or a TTS server in the Narrator tab.
          </div>
        )}
        {!web && !besideOk && !dest && tab !== 'video' && (
          <div style={{ fontSize: 13, color: '#f0a020' }}>Choose where to save the video in the Video tab.</div>
        )}
        {problem && <div style={{ fontSize: 13, color: '#f0a020' }}>{problem}</div>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>Cancel</Button>
        <Button variant="contained" disabled={!canNarrate || (!web && !besideOk && !dest)} onClick={queue} sx={{ textTransform: 'none' }}>
          {inThisTab ? 'Share this tab and record' : 'Add to queue'}
        </Button>
      </DialogActions>
    </Dialog>
    </ThemeProvider>
  );
};
