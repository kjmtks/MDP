import React, { useState } from 'react';
import { MenuItem, TextField, type SxProps, type Theme } from '@mui/material';
import {
  flattenOptions, formatExtra, languageValue, nestOptions, optionLabel, parseExtra,
  type SpeechOptionSpec, type SpeechServerDescription,
} from './speechOptions';

// The TTS server's own options (speechOptions.ts) as controls: each option its
// description names — a choice list, a number, on/off, text — and, for anything
// else, one "k=v, k2=v2" box. Empty = the server's own default (nothing is sent).
// Shared by the speech-server panel (the narrator's options) and the module
// settings dialog (one line's options, `mainextra`).
//
// An option with role 'language' offers "automatic — the line's language"; one with
// role 'instructions' is not shown (the prompt field fills it). A value the server
// does not take (a strict description) is kept, but marked as not sent.

type Flat = Record<string, unknown>;

const help = (o: SpeechOptionSpec): string => {
  const range = typeof o.min === 'number' && typeof o.max === 'number' ? `${o.min}–${o.max}`
    : typeof o.min === 'number' ? `≥ ${o.min}` : typeof o.max === 'number' ? `≤ ${o.max}` : '';
  return [range, o.description || ''].filter(Boolean).join(' · ');
};
const defaultText = (o: SpeechOptionSpec): string =>
  (o.default === undefined || o.default === null || o.default === '' ? 'server default'
    : `server default (${o.type === 'boolean' ? (o.default ? 'on' : 'off') : String(o.default)})`);

// A text or number box that shows what is typed while it has the focus — the value
// it commits may be written differently ("0." → 0), which must not jump under the caret.
const DraftField: React.FC<{
  value: string; onCommit: (raw: string) => void; label: string; type?: 'number';
  placeholder?: string; helperText?: string; min?: number; max?: number; step?: number | 'any';
  sx?: SxProps<Theme>; disabled?: boolean; multiline?: boolean; error?: boolean;
}> = ({ value, onCommit, label, type, placeholder, helperText, min, max, step, sx, disabled, multiline, error }) => {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <TextField size="small" fullWidth label={label} type={type} value={draft ?? value} disabled={disabled}
      multiline={multiline} minRows={multiline ? 1 : undefined} maxRows={multiline ? 4 : undefined}
      placeholder={placeholder} helperText={helperText || undefined} error={error} sx={sx}
      onChange={(e) => { setDraft(e.target.value); onCommit(e.target.value); }}
      onBlur={() => setDraft(null)}
      slotProps={{ inputLabel: { shrink: true }, htmlInput: { min, max, step, spellCheck: false } }} />
  );
};

export const SpeechOptionsFields: React.FC<{
  /** What the server takes; null = not known (not connected yet). */
  description: SpeechServerDescription | null;
  /** The options set now (nested, as sent). */
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  /** The line's language (BCP-47), to show what "automatic" picks. */
  lang?: string;
  /** Colour of the notes. */
  muted?: string;
  fieldSx?: SxProps<Theme>;
  disabled?: boolean;
  /** Said instead of where the description came from (e.g. "asking the server…"). */
  note?: string;
}> = ({ description, value, onChange, lang, muted = 'var(--app-text-disabled)', fieldSx, disabled, note }) => {
  const flat: Flat = flattenOptions(value || {});
  const shown = (description?.options || []).filter((o) => o.role !== 'instructions');
  const shownKeys = new Set(shown.map((o) => o.key));
  const described = new Set((description?.options || []).map((o) => o.key));
  const others: Flat = Object.fromEntries(Object.entries(flat).filter(([k]) => !shownKeys.has(k)));
  const notTaken = description?.strict ? Object.keys(others).filter((k) => !described.has(k)) : [];

  const set = (key: string, v: unknown) => {
    const next = { ...flat };
    if (v === undefined || v === '') delete next[key];
    else next[key] = v;
    onChange(nestOptions(next));
  };
  const setOthers = (text: string) => {
    const kept = Object.fromEntries(Object.entries(flat).filter(([k]) => shownKeys.has(k)));
    onChange(nestOptions({ ...kept, ...flattenOptions(parseExtra(text)) }));
  };

  const control = (o: SpeechOptionSpec): React.ReactNode => {
    const v = flat[o.key];
    const label = optionLabel(o);
    if (o.type === 'select' || o.type === 'boolean') {
      const auto = o.role === 'language'
        ? (lang ? `automatic — ${String(languageValue(lang, o) ?? 'not spoken by this server')} (the line’s language)` : 'automatic — the line’s language')
        : defaultText(o);
      const choices = o.type === 'boolean'
        ? [{ value: 'true', label: 'on' }, { value: 'false', label: 'off' }]
        : (o.choices || []).map((c) => ({ value: String(c.value), label: c.label ? `${c.label} (${c.value})` : String(c.value) }));
      const cur = v === undefined ? '' : String(v);
      return (
        <TextField select size="small" fullWidth label={label} value={choices.some((c) => c.value === cur) ? cur : ''}
          disabled={disabled} sx={fieldSx} helperText={o.description || undefined}
          slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }}
          onChange={(e) => {
            const raw = String(e.target.value);
            if (!raw) { set(o.key, undefined); return; }
            if (o.type === 'boolean') { set(o.key, raw === 'true'); return; }
            const hit = (o.choices || []).find((c) => String(c.value) === raw);
            set(o.key, hit ? hit.value : raw);
          }}>
          <MenuItem value=""><em style={{ fontStyle: 'normal', opacity: 0.75 }}>{auto}</em></MenuItem>
          {choices.map((c) => <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>)}
        </TextField>
      );
    }
    if (o.type === 'number' || o.type === 'integer') {
      return (
        <DraftField label={label} type="number" value={v === undefined ? '' : String(v)} disabled={disabled} sx={fieldSx}
          min={o.min} max={o.max} step={o.step ?? (o.type === 'integer' ? 1 : 'any')}
          placeholder={defaultText(o)} helperText={help(o)}
          onCommit={(raw) => {
            if (!raw.trim()) { set(o.key, undefined); return; }
            const n = Number(raw);
            if (Number.isFinite(n)) set(o.key, o.type === 'integer' ? Math.round(n) : n);
          }} />
      );
    }
    return (
      <DraftField label={label} value={v === undefined ? '' : String(v)} disabled={disabled} sx={fieldSx}
        placeholder={defaultText(o)} helperText={help(o)} onCommit={(raw) => set(o.key, raw)} />
    );
  };

  const source = note ? note
    : !description ? 'Connect to see what this server takes.'
    : description.source === 'server' ? 'Described by the server itself.'
      : description.source === 'profile' ? `Described by MDP’s profile “${description.name || description.profileId}”.`
        : description.source === 'openapi' ? 'Read from the server’s API schema (OpenAPI).'
          : 'This server does not describe its options — any written here are sent as written.';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {shown.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10 }}>
          {shown.map((o) => (
            <div key={o.key} style={o.role === 'language' || o.type === 'string' ? { gridColumn: '1 / -1' } : undefined}>
              {control(o)}
            </div>
          ))}
        </div>
      )}
      <DraftField label={shown.length ? 'Other options' : 'Options'} value={formatExtra(others)} disabled={disabled} sx={fieldSx}
        placeholder="name=value, name2=value2" error={notTaken.length > 0}
        helperText={notTaken.length ? `Not sent — this server does not take ${notTaken.join(', ')}.` : undefined}
        onCommit={setOthers} />
      <div style={{ fontSize: 12, color: muted, marginTop: -4 }}>{source}</div>
    </div>
  );
};
