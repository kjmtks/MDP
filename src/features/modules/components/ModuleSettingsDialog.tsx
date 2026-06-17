import React, { useMemo, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Switch,
  MenuItem, Select, FormControlLabel, Typography, Box, Stack, InputAdornment, IconButton, Menu,
} from '@mui/material';
import PaletteIcon from '@mui/icons-material/Palette';
import ImageIcon from '@mui/icons-material/Image';
import type { ModuleParam } from '../../../utils/moduleParser';

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

const ColorField: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => {
  const [menuEl, setMenuEl] = useState<HTMLElement | null>(null);
  return (
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
  );
};

const ImageField: React.FC<{ value: string; aliases: string[]; onChange: (v: string) => void }> = ({ value, aliases, onChange }) => {
  const [menuEl, setMenuEl] = useState<HTMLElement | null>(null);
  return (
    <>
      <TextField
        size="small" fullWidth value={value} placeholder="https://… , relative/path.png, or @alias"
        onChange={(e) => onChange(e.target.value)} variant="outlined" sx={fieldSx}
        slotProps={{ input: {
          endAdornment: aliases.length ? (
            <InputAdornment position="end">
              <IconButton size="small" title="Pick from image library" onClick={(e) => setMenuEl(e.currentTarget)} sx={{ color: 'var(--app-text-muted)' }}>
                <ImageIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
          ) : undefined,
        } }}
      />
      <Menu anchorEl={menuEl} open={!!menuEl} onClose={() => setMenuEl(null)}>
        {aliases.map((a) => (
          <MenuItem key={a} onClick={() => { onChange(`@${a}`); setMenuEl(null); }}>@{a}</MenuItem>
        ))}
      </Menu>
    </>
  );
};

export interface ModuleSettingsDialogProps {
  open: boolean;
  moduleName: string;
  params: ModuleParam[];
  initialValues: Record<string, string>;
  imageAliases: string[];
  onClose: () => void;
  onSave: (values: Record<string, string>) => void;
}

export const ModuleSettingsDialog: React.FC<ModuleSettingsDialogProps> = ({
  open, moduleName, params, initialValues, imageAliases, onClose, onSave,
}) => {
  // Seed each control from the current directive value, falling back to default.
  const seed = useMemo(() => {
    const v: Record<string, string> = {};
    params.forEach((p) => { v[p.name] = initialValues[p.name] ?? p.default ?? ''; });
    return v;
  }, [params, initialValues]);
  const [values, setValues] = useState<Record<string, string>>(seed);
  // Re-seed whenever a different directive is opened.
  const seedKey = `${moduleName}|${JSON.stringify(initialValues)}`;
  const lastSeed = React.useRef(seedKey);
  if (lastSeed.current !== seedKey) { lastSeed.current = seedKey; setValues(seed); }

  const set = (name: string, v: string) => setValues((prev) => ({ ...prev, [name]: v }));

  const handleSave = () => {
    // Emit only values that differ from the param default (keeps directives
    // clean); required params are always emitted.
    const out: Record<string, string> = {};
    params.forEach((p) => {
      const v = (values[p.name] ?? '').trim();
      const def = (p.default ?? '').trim();
      if (p.required ? v !== '' : (v !== '' && v !== def)) out[p.name] = v;
    });
    onSave(out);
  };

  const renderControl = (p: ModuleParam) => {
    const val = values[p.name] ?? '';
    switch (p.type) {
      case 'boolean':
        return (
          <FormControlLabel
            control={<Switch checked={val === 'true' || val === '1'} onChange={(e) => set(p.name, e.target.checked ? 'true' : 'false')} />}
            label={<Typography sx={{ color: 'var(--app-text-secondary)', fontSize: '0.85rem' }}>{val === 'true' || val === '1' ? 'On' : 'Off'}</Typography>}
          />
        );
      case 'number':
        return (
          <TextField
            size="small" type="number" fullWidth value={val} variant="outlined" sx={fieldSx}
            onChange={(e) => set(p.name, e.target.value)}
            slotProps={{ htmlInput: { min: p.min, max: p.max, step: p.step ?? (p.integer ? 1 : 'any') } }}
          />
        );
      case 'select':
        return (
          <Select
            size="small" fullWidth value={val} onChange={(e) => set(p.name, String(e.target.value))}
            sx={{ color: 'var(--app-text-secondary)', fontSize: '0.85rem', '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--app-border-subtle)' } }}
          >
            {(p.options || []).map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
          </Select>
        );
      case 'color':
        return <ColorField value={val} onChange={(v) => set(p.name, v)} />;
      case 'image':
        return <ImageField value={val} aliases={imageAliases} onChange={(v) => set(p.name, v)} />;
      default:
        return (
          <TextField size="small" fullWidth value={val} variant="outlined" sx={fieldSx}
            onChange={(e) => set(p.name, e.target.value)} />
        );
    }
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
            {params.map((p) => (
              <Box key={p.name}>
                <Typography sx={{ color: 'var(--app-text-secondary)', fontSize: '0.82rem', fontWeight: 600, mb: 0.4 }}>
                  {labelOf(p)}
                  {p.required && <Box component="span" sx={{ color: 'var(--app-danger)', ml: 0.4 }}>*</Box>}
                  <Box component="span" sx={{ color: 'var(--app-text-disabled)', fontWeight: 400, ml: 0.6, fontSize: '0.72rem' }}>{p.name}</Box>
                </Typography>
                {renderControl(p)}
                {p.description && (
                  <Typography sx={{ color: 'var(--app-text-disabled)', fontSize: '0.72rem', mt: 0.4 }}>{p.description}</Typography>
                )}
              </Box>
            ))}
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
