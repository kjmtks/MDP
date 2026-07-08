import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, IconButton,
  Select, MenuItem, Slider, TextField, ToggleButton, ToggleButtonGroup, Tooltip,
  ThemeProvider, createTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useAppSettings } from '../settings/AppSettingsContext';
import { explicitSlideSeconds, slideSecondsFromRaw, formatClock } from '../slide/talkTime';
import {
  speak, listWebSpeechVoices, loadWebSpeechVoices, webSpeechAvailable,
  listVoicevoxSpeakers, type Utterance, type VoicevoxStyle,
} from '../tts/ttsService';

// Minimal shape we need from a parsed slide.
interface RehearsalSlide { raw: string; scriptHtml: string }

interface Step { index: number; title: string; script: string; budget: number }

const stripHtml = (html: string): string => {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
};

const firstHeading = (raw: string): string => {
  const noComments = raw.replace(/<!--[\s\S]*?-->/g, ' ');
  return ((noComments.match(/^\s*#{1,6}\s+(.+)$/m) || [])[1] || '').trim();
};

// A ▲ over / ▼ under / ● on-budget delta chip.
const Delta: React.FC<{ spoken: number; budget: number }> = ({ spoken, budget }) => {
  const d = spoken - budget;
  const over = d > budget * 0.1 + 1;
  const under = d < -(budget * 0.1 + 1);
  const color = over ? '#dc2626' : under ? '#2563eb' : '#16a34a';
  const sign = d >= 0 ? '+' : '−';
  return <span style={{ color, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{over ? '▲' : under ? '▼' : '●'} {sign}{formatClock(Math.abs(Math.round(d)))}</span>;
};

export const RehearsalDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  slides: RehearsalSlide[];
}> = ({ open, onClose, slides }) => {
  const { settings, update, appThemeVariant } = useAppSettings();
  const muiTheme = useMemo(() => createTheme({ palette: { mode: appThemeVariant } }), [appThemeVariant]);
  const tts = settings.tts;
  const cpm = settings.readingCharsPerMin || 320;
  // TWO independent speeds: the READING speed (chars/min) sets each slide's time
  // BUDGET (and the talk-time estimate); the VOICE speed (tts.rate ×) is how fast the
  // synthesized narrator actually speaks — a synthetic voice may differ from a person,
  // so it's adjusted separately.
  const ttsCfg = tts;

  // Build the rehearsal steps from slides that carry a read-aloud @script.
  const steps: Step[] = useMemo(() => slides.map((s, i) => {
    const script = stripHtml(s.scriptHtml);
    const budget = explicitSlideSeconds(s.raw) ?? slideSecondsFromRaw(s.raw, cpm);
    return { index: i, title: firstHeading(s.raw) || `Slide ${i + 1}`, script, budget };
  }).filter((st) => st.script), [slides, cpm]);

  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [vvSpeakers, setVvSpeakers] = useState<VoicevoxStyle[]>([]);
  const [vvError, setVvError] = useState<string>('');

  const [running, setRunning] = useState(false);
  const [cur, setCur] = useState(0);              // index into steps
  const [elapsed, setElapsed] = useState(0);      // current step elapsed (s)
  const [spent, setSpent] = useState<number[]>([]); // recorded seconds per step
  const [done, setDone] = useState(false);

  const utterRef = useRef<Utterance | null>(null);
  const startRef = useRef(0);
  const tickRef = useRef<number | null>(null);
  const cancelRef = useRef(false);

  const patchTts = (p: Partial<typeof tts>) => update({ tts: { ...tts, ...p } });

  // Load Web Speech voices when the dialog opens (they populate asynchronously).
  useEffect(() => {
    if (!open || !webSpeechAvailable()) return;
    loadWebSpeechVoices().then(setVoices).catch(() => setVoices(listWebSpeechVoices()));
  }, [open]);

  const refreshVoicevox = React.useCallback(() => {
    setVvError('');
    listVoicevoxSpeakers(tts.voicevoxUrl).then((s) => { setVvSpeakers(s); if (!s.find((x) => x.id === tts.voicevoxSpeaker) && s.length) patchTts({ voicevoxSpeaker: s[0].id }); })
      .catch((e) => { setVvSpeakers([]); setVvError(e instanceof Error ? e.message : 'Could not reach VOICEVOX. Is the engine running?'); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tts.voicevoxUrl, tts.voicevoxSpeaker]);

  useEffect(() => { if (open && tts.engine === 'voicevox') refreshVoicevox(); }, [open, tts.engine, refreshVoicevox]);

  const stopTick = () => { if (tickRef.current != null) { window.clearInterval(tickRef.current); tickRef.current = null; } };
  const stopSpeech = () => { utterRef.current?.stop(); utterRef.current = null; };

  // Clean up on close/unmount.
  useEffect(() => () => { cancelRef.current = true; stopTick(); stopSpeech(); }, []);
  useEffect(() => { if (!open) { cancelRef.current = true; stopTick(); stopSpeech(); setRunning(false); } }, [open]);

  const runFrom = async (startIdx: number, prior: number[]) => {
    cancelRef.current = false;
    setRunning(true); setDone(false);
    const acc = prior.slice();
    for (let i = startIdx; i < steps.length; i++) {
      if (cancelRef.current) break;
      setCur(i); setElapsed(0);
      startRef.current = performance.now();
      stopTick();
      tickRef.current = window.setInterval(() => setElapsed((performance.now() - startRef.current) / 1000), 100);
      const u = speak(steps[i].script, ttsCfg);
      utterRef.current = u;
      try { await u.done; } catch (e) {
        // Engine failed (e.g. VOICEVOX not running) — stop the whole run and report.
        stopTick(); setRunning(false);
        setVvError(e instanceof Error ? e.message : 'Speech failed.');
        return;
      }
      stopTick();
      const secs = (performance.now() - startRef.current) / 1000;
      acc[i] = secs;
      setSpent(acc.slice());
      if (cancelRef.current) break;
    }
    stopTick(); setRunning(false);
    if (!cancelRef.current) setDone(true);
  };

  const start = () => { setSpent([]); void runFrom(0, []); };
  const skip = () => { stopSpeech(); /* the awaited done resolves, loop advances */ };
  const stop = () => { cancelRef.current = true; stopSpeech(); stopTick(); setRunning(false); setDone(spent.length > 0); };

  const totalBudget = steps.reduce((a, s) => a + s.budget, 0);
  const totalSpent = spent.reduce((a, s) => a + (s || 0), 0);

  const engineControls = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <ToggleButtonGroup exclusive size="small" value={tts.engine} onChange={(_, v) => v && patchTts({ engine: v })}>
          <ToggleButton value="webspeech" sx={{ textTransform: 'none' }}>Web Speech</ToggleButton>
          <ToggleButton value="voicevox" sx={{ textTransform: 'none' }}>VOICEVOX</ToggleButton>
        </ToggleButtonGroup>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Tooltip title="Sets each slide's time BUDGET & the talk-time estimate (General)"><span style={{ fontSize: 13, color: 'var(--app-text-muted)' }}>Reading speed</span></Tooltip>
          <Slider size="small" min={150} max={600} step={10} value={cpm}
            onChange={(_, v) => update({ readingCharsPerMin: v as number })} sx={{ width: 110 }} />
          <span style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{cpm} c/min</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Tooltip title="How fast the synthesized voice speaks (independent of the reading-speed budget)"><span style={{ fontSize: 13, color: 'var(--app-text-muted)' }}>Voice speed</span></Tooltip>
          <Slider size="small" min={0.5} max={2} step={0.1} value={tts.rate}
            onChange={(_, v) => patchTts({ rate: v as number })} sx={{ width: 100 }} />
          <span style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{tts.rate.toFixed(1)}×</span>
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--app-text-muted)', marginTop: -2 }}>
        <b>Reading speed</b> sets the time budget / talk-time estimate (shared with General). <b>Voice speed</b> is how fast the TTS voice actually reads — adjust it separately from your target pace.
      </div>

      {tts.engine === 'webspeech' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--app-text-muted)', width: 46 }}>Voice</span>
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
            <span style={{ fontSize: 13, color: 'var(--app-text-muted)', width: 46 }}>URL</span>
            <TextField size="small" value={tts.voicevoxUrl} onChange={(e) => patchTts({ voicevoxUrl: e.target.value })} sx={{ flex: 1 }} placeholder="http://127.0.0.1:50021" />
            <Tooltip title="Connect / refresh speakers"><span><IconButton size="small" onClick={refreshVoicevox}><RefreshIcon fontSize="small" /></IconButton></span></Tooltip>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--app-text-muted)', width: 46 }}>Speaker</span>
            <Select size="small" value={vvSpeakers.find((s) => s.id === tts.voicevoxSpeaker) ? tts.voicevoxSpeaker : ''}
              onChange={(e) => patchTts({ voicevoxSpeaker: Number(e.target.value) })} displayEmpty sx={{ flex: 1, minWidth: 220 }}>
              {!vvSpeakers.length && <MenuItem value=""><em>Connect to load speakers…</em></MenuItem>}
              {vvSpeakers.map((s) => <MenuItem key={s.id} value={s.id}>{s.label}</MenuItem>)}
            </Select>
          </div>
          {vvError && <span style={{ color: '#dc2626', fontSize: 13 }}>{vvError} — start the VOICEVOX engine, then Refresh.</span>}
        </div>
      )}
    </div>
  );

  return (
    <ThemeProvider theme={muiTheme}>
    <Dialog open={open} onClose={running ? undefined : onClose} maxWidth="sm" fullWidth
      PaperProps={{ sx: { bgcolor: 'var(--app-bg-panel)', color: 'var(--app-text)' } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pr: 1 }}>
        Rehearsal
        <IconButton size="small" onClick={onClose} disabled={running}><CloseIcon fontSize="small" /></IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {engineControls}

        {steps.length === 0 ? (
          <div style={{ color: 'var(--app-text-muted)', fontSize: 14 }}>
            No slides have a read-aloud script yet. Add a <code>&lt;!-- @script: … --&gt;</code> to slides (or ask the AI to write one), then rehearse.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <div style={{ fontWeight: 700 }}>
                {running ? `Slide ${cur + 1}/${steps.length}: ${steps[cur]?.title || ''}` : done ? 'Summary' : `${steps.length} slides with a script`}
              </div>
              <div style={{ fontVariantNumeric: 'tabular-nums' }}>
                {running
                  ? <>{formatClock(Math.round(elapsed))} <span style={{ color: 'var(--app-text-muted)' }}>/ {formatClock(Math.round(steps[cur]?.budget || 0))}</span></>
                  : <span style={{ color: 'var(--app-text-muted)' }}>total budget {formatClock(Math.round(totalBudget))}</span>}
              </div>
            </div>

            {running && (
              <div style={{ height: 8, borderRadius: 4, background: 'color-mix(in srgb, currentColor 12%, transparent)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(100, (elapsed / Math.max(1, steps[cur]?.budget || 1)) * 100).toFixed(1)}%`, background: elapsed > (steps[cur]?.budget || 0) ? '#dc2626' : 'var(--accent-color, #3b82f6)', transition: 'width .1s linear' }} />
              </div>
            )}

            <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {steps.map((s, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '4px 8px', borderRadius: 6,
                  background: running && i === cur ? 'color-mix(in srgb, var(--accent-color) 14%, transparent)' : 'transparent', fontSize: 13 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i + 1}. {s.title}</span>
                  <span style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                    {spent[i] != null
                      ? <>{formatClock(Math.round(spent[i]))} <Delta spoken={spent[i]} budget={s.budget} /></>
                      : <span style={{ color: 'var(--app-text-muted)' }}>{formatClock(Math.round(s.budget))}</span>}
                  </span>
                </div>
              ))}
            </div>

            {done && (
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                Spoken total {formatClock(Math.round(totalSpent))} vs budget {formatClock(Math.round(totalBudget))} <Delta spoken={totalSpent} budget={totalBudget} />
              </div>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 2, py: 1.5 }}>
        {running ? (
          <>
            <Button onClick={skip} sx={{ textTransform: 'none' }}>Skip slide</Button>
            <Button onClick={stop} variant="contained" color="error" sx={{ textTransform: 'none' }}>Stop</Button>
          </>
        ) : (
          <>
            <Button onClick={onClose} sx={{ textTransform: 'none', color: 'var(--app-text-muted)' }}>Close</Button>
            <Button onClick={start} variant="contained" disabled={steps.length === 0}
              sx={{ textTransform: 'none', bgcolor: 'var(--app-accent)' }}>{done ? 'Rehearse again' : 'Start'}</Button>
          </>
        )}
      </DialogActions>
    </Dialog>
    </ThemeProvider>
  );
};
