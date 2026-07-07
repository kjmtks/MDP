import React, { useEffect, useRef, useState } from 'react';
import { Button, TextField } from '@mui/material';
import { useAppSettings } from '../../../features/settings/AppSettingsContext';

// A neutral calibration passage (mixed Japanese + English). Read it ALOUD at your
// natural presenting pace; the timer converts its non-whitespace length to
// characters/minute. Keep this stable so the char count below matches.
const PASSAGE =
  'それでは発表を始めます。本日は、私たちの研究の背景と目的、提案手法、実験結果、そして今後の課題について順にご説明します。' +
  'まず背景として、従来手法にはいくつかの課題がありました。我々はこれを解決するために新しいアプローチを提案します。' +
  'Thank you for your attention. Please feel free to ask questions at the end of the talk.';

const passageChars = PASSAGE.replace(/\s+/g, '').length;

// Field for the talk-time reading speed, with a read-aloud calibration.
export const ReadingSpeedField: React.FC = () => {
  const { settings, update } = useAppSettings();
  const [running, setRunning] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<number | null>(null);
  const startRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!running) return;
    const tick = () => { setElapsedMs(Date.now() - startRef.current); rafRef.current = requestAnimationFrame(tick); };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [running]);

  const start = () => { startRef.current = Date.now(); setElapsedMs(0); setResult(null); setRunning(true); };
  const stop = () => {
    setRunning(false);
    const minutes = (Date.now() - startRef.current) / 60000;
    if (minutes > 0.05) setResult(Math.round(passageChars / minutes)); // ignore accidental instant taps
  };

  const mm = Math.floor(elapsedMs / 60000);
  const ss = Math.floor((elapsedMs % 60000) / 1000);

  return (
    <div className="settings-field">
      <div className="settings-field-label">Reading speed (talk-time)</div>
      <div className="settings-field-hint">
        Characters per minute, used to estimate how long read-aloud <code>@script</code> slides take
        (and shown in the presenter countdown). Everyone reads at a different pace — calibrate yours below.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
        <TextField
          size="small" type="number" value={settings.readingCharsPerMin}
          onChange={(e) => update({ readingCharsPerMin: Math.max(60, Math.min(1500, Number(e.target.value) || 320)) })}
          sx={{ width: 120, '& .MuiInputBase-input': { color: 'var(--app-text)' }, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--app-border-strong)' } }}
        />
        <span style={{ color: 'var(--app-text-muted)', fontSize: '0.85rem' }}>chars / min</span>
      </div>

      <div style={{ marginTop: 12, padding: 12, border: '1px solid var(--app-border-subtle)', borderRadius: 6, background: 'var(--app-bg-elevated)' }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--app-text-disabled)', marginBottom: 6 }}>
          Calibrate — read this aloud at your presenting pace, then Stop ({passageChars} chars):
        </div>
        <div style={{ fontSize: '0.9rem', color: 'var(--app-text-secondary)', lineHeight: 1.7, marginBottom: 10 }}>{PASSAGE}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {!running ? (
            <Button size="small" variant="outlined" onClick={start} sx={{ textTransform: 'none', color: 'var(--app-text-secondary)', borderColor: 'var(--app-border-strong)' }}>
              {result != null ? 'Redo' : 'Start reading'}
            </Button>
          ) : (
            <Button size="small" variant="contained" onClick={stop} sx={{ textTransform: 'none', bgcolor: 'var(--app-accent)' }}>Stop</Button>
          )}
          <span style={{ fontFamily: 'monospace', fontSize: '1.2rem', color: running ? 'var(--app-accent)' : 'var(--app-text-muted)' }}>
            {mm}:{String(ss).padStart(2, '0')}
          </span>
          {result != null && !running && (
            <>
              <span style={{ color: 'var(--app-text-secondary)' }}>→ {result} chars/min</span>
              <Button size="small" variant="text" onClick={() => update({ readingCharsPerMin: result })} sx={{ textTransform: 'none', color: 'var(--app-accent)' }}>
                Use this
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
