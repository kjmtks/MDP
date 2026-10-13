import React, { useState } from 'react';
import { Checkbox, FormControlLabel } from '@mui/material';
import { formatTalkMinutes } from '../slide/talkTime';

/** The deck's time estimates as they stand — for the Timing tab. */
export interface DeckTimingInfo {
  /** The deck's estimate now (s), hidden slides excluded. */
  estimateSec: number;
  /** Shown slides with a script, and how many of them take a measured time. */
  scripted: number;
  measured: number;
  /** The newest measurement: when, and who spoke. */
  lastAt?: string;
  lastNarrator?: string;
}

const when = (iso?: string): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// "Update the time estimates" — the option of the narrated auto-play and of the
// narrated video, with what it does and where the deck stands. Measuring: the
// auto-play / the video export; keeping: rehearsalStore (narrated runs); using:
// talkTime (a measured script's time in place of the estimate from its length).
// `dark`: the auto-play's own setup screen; else the app theme (an MUI dialog).
export const TimeEstimatesPanel: React.FC<{
  dark?: boolean;
  what: 'narration' | 'video';
  update: boolean;
  onUpdate: (on: boolean) => void;
  /** The voice speed it would be measured at. */
  rate: number;
  info?: DeckTimingInfo | null;
  onForget?: () => void | Promise<void>;
  /** A fast video: nothing answers a module's events, so such slides are not measured. */
  fastMode?: boolean;
}> = ({ dark, what, update, onUpdate, rate, info, onForget, fastMode }) => {
  const [confirming, setConfirming] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const c = dark
    ? { text: '#e8e8ea', muted: '#9aa0aa', border: '#2c2f37', box: '#1b1d22', accent: '#8ab4f8', button: '#242730' }
    : { text: 'var(--app-text)', muted: 'var(--app-text-muted)', border: 'var(--app-border)', box: 'color-mix(in srgb, currentColor 5%, transparent)', accent: 'var(--app-accent, #3b82f6)', button: 'transparent' };
  const small: React.CSSProperties = { fontSize: 12.5, color: c.muted, lineHeight: 1.55 };
  const btn: React.CSSProperties = {
    padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12.5,
    border: `1px solid ${c.border}`, background: c.button, color: c.text,
  };
  const label = what === 'video' ? 'Update the time estimates from this video' : 'Update the time estimates from this narration';
  const forget = async () => {
    setForgetting(true);
    try { await onForget?.(); } finally { setForgetting(false); setConfirming(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, color: c.text }}>
      {dark ? (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none', fontWeight: 700 }}>
          <input type="checkbox" checked={update} onChange={(e) => onUpdate(e.target.checked)} />
          {label}
        </label>
      ) : (
        <FormControlLabel sx={{ ml: -0.5 }} control={<Checkbox size="small" checked={update} onChange={(e) => onUpdate(e.target.checked)} />}
          label={<b>{label}</b>} />
      )}
      <div style={small}>
        Each narrated slide then takes the time its narration actually took — the words, the pauses, and the
        activities its script waits for (<code>[[emit-wait]]</code>: a timer, a video) — at this voice speed
        ({rate.toFixed(1)}×). That time stands in for the estimate from the script’s length until the script is edited;
        a slide’s own <code>@time</code> still wins.
        {what === 'narration' ? ' A slide you skip, or whose module does not answer, is not measured.' : ''}
        {' '}Kept in the deck’s rehearsal history.
      </div>
      {fastMode && (
        <div style={{ ...small, color: dark ? '#f0c060' : '#b7791f' }}>
          Fast: a slide that waits for a module (<code>[[emit-wait]]</code>, <code>[[wait]]</code>) is not measured —
          nothing answers in a fast video. Exact measures every slide.
        </div>
      )}
      {info && (
        <div style={{ border: `1px solid ${c.border}`, background: c.box, borderRadius: 8, padding: '8px 10px', fontSize: 13 }}>
          <div>
            This deck now: <b>{formatTalkMinutes(Math.round((info.estimateSec / 60) * 10) / 10)}</b>
            {info.scripted > 0 && <> · {info.measured} of {info.scripted} slide{info.scripted === 1 ? '' : 's'} with a script measured</>}
          </div>
          {info.measured > 0 && info.lastAt && (
            <div style={{ ...small, marginTop: 2 }}>Last measured {when(info.lastAt)}{info.lastNarrator ? ` · ${info.lastNarrator}` : ''}</div>
          )}
          {info.measured > 0 && onForget && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              {confirming ? (
                <>
                  <span style={small}>Back to the estimates from the scripts’ length?</span>
                  <button type="button" style={{ ...btn, borderColor: '#dc2626', color: dark ? '#fca5a5' : '#dc2626' }} disabled={forgetting} onClick={() => void forget()}>
                    {forgetting ? 'Forgetting…' : 'Forget them'}
                  </button>
                  <button type="button" style={btn} disabled={forgetting} onClick={() => setConfirming(false)}>Keep</button>
                </>
              ) : (
                <button type="button" style={btn} onClick={() => setConfirming(true)}>Forget the measured times</button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
