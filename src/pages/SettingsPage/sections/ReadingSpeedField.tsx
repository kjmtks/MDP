import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Button, TextField } from '@mui/material';
import { useAppSettings } from '../../../features/settings/AppSettingsContext';
import { DEFAULT_SETTINGS } from '../../../features/settings/types';
import { getOpenDeck, subscribeOpenDeck } from '../../../features/slide/openDeckRuntime';
import { deckCalibrationPassage, formatSlideNumbers } from '../../../features/slide/readingCalibration';

const countChars = (s: string) => s.replace(/\s+/g, '').length;
const linkBtn = { textTransform: 'none', minWidth: 0, color: 'var(--app-text-muted)', fontSize: '0.72rem' } as const;

// Field for the talk-time reading speed, with a read-aloud calibration. The
// passage is the OPEN DECK's own @script (from the slide being edited on) — the
// text the estimate is about; a deck without one falls back to a fixed passage,
// which is EDITABLE (language / content differ per user).
export const ReadingSpeedField: React.FC = () => {
  const { settings, update } = useAppSettings();
  const deck = useSyncExternalStore(subscribeOpenDeck, getOpenDeck);
  const fromDeck = useMemo(() => deckCalibrationPassage(deck.slides, deck.index), [deck.slides, deck.index]);
  const [preferFixed, setPreferFixed] = useState(false);
  const useDeck = !!fromDeck && !preferFixed;
  const passage = useDeck && fromDeck ? fromDeck.text : settings.readingCalibrationText;
  const passageChars = useDeck && fromDeck ? fromDeck.chars : countChars(passage);
  const [editing, setEditing] = useState(false);
  const [running, setRunning] = useState(false);
  // What is being read, frozen at Start: the deck may re-parse meanwhile.
  const [reading, setReading] = useState<{ text: string; chars: number } | null>(null);
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

  const start = () => {
    setReading({ text: passage, chars: passageChars });
    setEditing(false);
    startRef.current = Date.now(); setElapsedMs(0); setResult(null); setRunning(true);
  };
  const stop = () => {
    setRunning(false);
    const minutes = (Date.now() - startRef.current) / 60000;
    const chars = reading ? reading.chars : passageChars;
    if (minutes > 0.05) setResult(Math.round(chars / minutes)); // ignore accidental instant taps
  };

  const shown = running && reading ? reading : { text: passage, chars: passageChars };
  const deckName = (deck.fileName.split('/').pop() || '').replace(/\.slide\.md$|\.md$/i, '');
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
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--app-text-disabled)' }}>
            Calibrate — read this aloud at your presenting pace, then Stop ({shown.chars} chars):
          </span>
          {!running && (
            <span style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              {useDeck ? (
                <Button size="small" variant="text" onClick={() => setPreferFixed(true)} sx={linkBtn}>Use fixed text</Button>
              ) : (
                <>
                  {fromDeck && (
                    <Button size="small" variant="text" onClick={() => { setPreferFixed(false); setEditing(false); }} sx={linkBtn}>
                      Use the deck’s script
                    </Button>
                  )}
                  <Button size="small" variant="text" onClick={() => setEditing((v) => !v)} sx={linkBtn}>
                    {editing ? 'Done' : 'Edit text'}
                  </Button>
                  {settings.readingCalibrationText !== DEFAULT_SETTINGS.readingCalibrationText && (
                    <Button size="small" variant="text" onClick={() => update({ readingCalibrationText: DEFAULT_SETTINGS.readingCalibrationText })} sx={linkBtn}>
                      Reset
                    </Button>
                  )}
                </>
              )}
            </span>
          )}
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--app-text-muted)', marginBottom: 6 }}>
          {useDeck && fromDeck
            ? <>From the open deck’s <code>@script</code>{deckName ? <> — {deckName}</> : null}, slide {formatSlideNumbers(fromDeck.slides)} (counted as the talk-time estimate counts scripts).</>
            : fromDeck ? 'Fixed text (the open deck has a script — you can read that instead).'
              : deck.slides.length ? <>The open deck has no <code>@script</code> yet — reading the fixed text.</>
                : 'No deck is open — reading the fixed text.'}
        </div>
        {editing && !useDeck ? (
          <TextField
            multiline minRows={3} maxRows={10} fullWidth size="small" autoFocus
            value={settings.readingCalibrationText}
            onChange={(e) => update({ readingCalibrationText: e.target.value })}
            placeholder="Paste a passage in your language / typical style to read aloud…"
            sx={{ mb: 1, '& .MuiInputBase-input': { color: 'var(--app-text)', fontSize: '0.9rem', lineHeight: 1.7 }, '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--app-border-strong)' } }}
          />
        ) : (
          <div style={{ fontSize: '0.9rem', color: 'var(--app-text-secondary)', lineHeight: 1.7, marginBottom: 10, whiteSpace: 'pre-wrap', maxHeight: 260, overflowY: 'auto' }}>{shown.text}</div>
        )}
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
