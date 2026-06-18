import React, { useMemo, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Switch,
  MenuItem, Select, FormControlLabel, Typography, Box, Stack, InputAdornment, IconButton, Menu,
  Popover, Chip, Checkbox,
} from '@mui/material';
import PaletteIcon from '@mui/icons-material/Palette';
import ImageIcon from '@mui/icons-material/Image';
import SearchIcon from '@mui/icons-material/Search';
import BrokenImageIcon from '@mui/icons-material/BrokenImage';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import type { ModuleParam, ParamOption } from '../../../utils/moduleParser';
import type { ImageEntry } from '../../images/imageRegistry';

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
      <Box sx={{ width: 40, height: 40, flexShrink: 0, bgcolor: '#fff', borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
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

interface ItemCtx { imageEntries: ImageEntry[]; resolveThumb: (v: string) => string; }

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
    default:
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

  const handleSave = () => {
    const out: Record<string, string> = {};
    params.forEach((p) => {
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

  const itemCtx = { imageEntries, resolveThumb };
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
            {params.map((p) => {
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
