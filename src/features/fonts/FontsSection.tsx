import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, CircularProgress, Stack, TextField, Typography } from '@mui/material';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import AddIcon from '@mui/icons-material/Add';
import { apiClient } from '../../api/apiClient';
import { reportError, notify } from '../../components/error/errorReporter';
import { syncOfficialCatalog } from '../catalog/syncService';
import { parseContent, contentPath, effectiveFonts } from '../workspace/mdpContent';
import type { FontCategory, FontInspection, FontRequirement, FontSource, MdpFontDefaults, RequirementsFile, WorkspaceFont } from './fontTypes';
import { mergeRequirements, removeRequirement, requirementStatuses, requirementsPath, sourceLabel, toEntry, upsertRequirement } from './fontRequirements';
import { isFontInstalledLocally } from './fontRuntime';
import { installRequiredFonts } from './useFontRequirementNotice';

// "Fonts (this folder)" in the Configure (.mdp) dialog: the workspace fonts decks
// beneath this folder render with, the folder's default fonts, adding / removing
// font packages, and the fonts the folder DECLARES as required
// (`fonts/requirements.json`: downloadable ones install with a click; the others
// are a statement of what viewers must install themselves). Default-font choices
// are part of the dialog's content (saved with its Save button); everything else
// writes immediately.

interface Props {
  configDir: string;          // the `.mdp` being configured
  chain: string[];            // its cascade chain (root→nearest, ending with configDir)
  ownerDir: string;           // folder owning this `.mdp` ('' = workspace root)
  value: MdpFontDefaults;     // this `.mdp`'s own content.json `fonts`
  onChange: (next: MdpFontDefaults) => void;
}

const MAX_FONT_BYTES = 50 * 1024 * 1024;
const CATEGORIES: FontCategory[] = ['sans-serif', 'serif', 'monospace', 'other'];
const FREE = new Set(['OFL-1.1', 'Apache-2.0', 'UFL-1.0']);
const ROLES: { key: keyof MdpFontDefaults; label: string }[] = [
  { key: 'body', label: 'Body text' },
  { key: 'heading', label: 'Headings' },
  { key: 'mono', label: 'Code' },
];

const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const selectStyle: React.CSSProperties = {
  flex: 1, minWidth: 0, padding: '4px 6px', borderRadius: 4, fontSize: '0.8rem',
  background: 'var(--app-bg-elevated)', color: 'var(--app-text)', border: '1px solid var(--app-border-subtle)',
};
const fieldSx = {
  '& .MuiInputBase-input': { color: 'var(--app-text)', fontSize: '0.85rem' },
  '& .MuiInputLabel-root': { color: 'var(--app-text-disabled)' },
  '& .MuiInputLabel-root.Mui-focused': { color: 'var(--app-accent)' },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--app-border-subtle)' },
};
const hintSx = { fontSize: '0.72rem', color: 'var(--app-text-disabled)' };

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Package folder name from a family name ("Noto Sans JP" → "noto-sans-jp").
const slugOf = (family: string) => family.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'font';
// A file name that is safe on every file system and in a URL.
const safeFileName = (name: string) => {
  const m = name.match(/^(.*?)(\.(woff2|woff|ttf|otf))$/i);
  const stem = (m ? m[1] : name).normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|-+$/g, '') || 'font';
  return `${stem}${m ? m[2].toLowerCase() : '.woff2'}`;
};

interface Pending {
  fileName: string;
  base64: string;
  size: number;
  info: FontInspection;
  family: string;
  category: FontCategory;
  confirmed: boolean;
}

// The "Declare a required font" form.
type SourceKind = '' | 'google' | 'urls' | 'zip';
interface Draft {
  family: string;
  category: FontCategory | '';
  kind: SourceKind;
  googleName: string;
  weights: string;
  urls: string;
  zip: string;
  zipFiles: string;
  license: string;
  homepage: string;
  note: string;
  fallback: string;
}
const EMPTY_DRAFT: Draft = {
  family: '', category: '', kind: '', googleName: '', weights: '', urls: '', zip: '', zipFiles: '',
  license: '', homepage: '', note: '', fallback: '',
};
const splitList = (s: string) => s.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);

function draftSource(d: Draft): FontSource | undefined {
  if (d.kind === 'google') {
    const weights = splitList(d.weights).map(Number).filter((w) => Number.isInteger(w) && w >= 1 && w <= 1000);
    const name = d.googleName.trim();
    if (!name && !weights.length) return 'google';
    return { google: name && name !== d.family.trim() ? name : true, ...(weights.length ? { weights } : {}) };
  }
  if (d.kind === 'urls') {
    const urls = splitList(d.urls.replace(/,/g, '\n'));
    return urls.length === 1 ? { url: urls[0] } : urls.length ? { urls } : undefined;
  }
  if (d.kind === 'zip') {
    const files = splitList(d.zipFiles);
    return d.zip.trim() ? { zip: d.zip.trim(), ...(files.length ? { files } : {}) } : undefined;
  }
  return undefined;
}

const STATE_LABEL: Record<string, { text: string; color: string }> = {
  packaged: { text: 'stored in .mdp', color: 'var(--app-success, #66bb6a)' },
  local: { text: 'installed on this computer only', color: 'var(--app-warning, #ffa726)' },
  missing: { text: 'missing here', color: 'var(--app-danger, #ef5350)' },
};

export const FontsSection: React.FC<Props> = ({ configDir, chain, ownerDir, value, onChange }) => {
  const [fonts, setFonts] = useState<WorkspaceFont[]>([]);
  const [reqFiles, setReqFiles] = useState<RequirementsFile[]>([]);
  const [inherited, setInherited] = useState<MdpFontDefaults>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'' | 'download' | 'add' | 'remove' | 'declare' | 'install'>('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const chainKey = chain.join('\n');

  const reload = useCallback(async () => {
    try {
      const [list, reqs] = await Promise.all([apiClient.getFonts(chain), apiClient.getFontRequirements(chain).catch(() => [])]);
      setFonts(list);
      setReqFiles(reqs);
    }
    catch (e) { console.error('Failed to list fonts', e); setFonts([]); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainKey]);

  useEffect(() => { void reload(); }, [reload]);

  // What the parent `.mdp`s choose — shown as the "Inherit" option.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const contents = [];
      for (const cdir of chain.slice(0, -1)) {
        try { contents.push(parseContent(await apiClient.readFileText(contentPath(cdir)))); } catch { contents.push({}); }
      }
      if (!cancelled) setInherited(effectiveFonts(contents));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainKey]);

  const own = useMemo(() => fonts.filter((f) => f.configDir === configDir), [fonts, configDir]);
  const families = useMemo(() => fonts.map((f) => f.family), [fonts]);
  const merged = useMemo(() => mergeRequirements(reqFiles), [reqFiles]);
  const required = useMemo(
    () => requirementStatuses(merged.fonts, fonts, (family) => isFontInstalledLocally(family)),
    [merged, fonts],
  );
  // Declared families without a package — offered as default fonts too.
  const declaredOnly = useMemo(() => required.filter((r) => r.state !== 'packaged'), [required]);

  const changed = () => window.dispatchEvent(new CustomEvent('mdp-fonts-changed'));

  // requirements.json of THIS `.mdp`, edited in place (other keys are kept).
  const editRequirements = async (edit: (text: string) => string) => {
    const path = requirementsPath(configDir);
    let text = '';
    try { text = await apiClient.readFileText(path); } catch { /* no file yet */ }
    let next: string;
    try { next = edit(text); }
    catch (e) { throw new Error(`${path} is not valid JSON — fix it in the editor first (${e instanceof Error ? e.message : e}).`); }
    await apiClient.saveFile(path, next);
  };

  const declare = async (installNow: boolean) => {
    if (!draft || busy) return;
    const family = draft.family.trim();
    if (!family) return;
    const source = draftSource(draft);
    if (draft.kind && !source) { reportError('Give the download address for this source (or choose "declare only").'); return; }
    const req: FontRequirement = {
      family,
      ...(draft.category ? { category: draft.category } : {}),
      ...(source ? { source } : {}),
      ...(draft.license.trim() ? { license: draft.license.trim() } : {}),
      ...(draft.homepage.trim() ? { homepage: draft.homepage.trim() } : {}),
      ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
      ...(splitList(draft.fallback).length ? { fallback: splitList(draft.fallback) } : {}),
      configDir,
    };
    setBusy(installNow ? 'install' : 'declare');
    try {
      await editRequirements((text) => upsertRequirement(text, toEntry(req)));
      setDraft(null);
      if (installNow && source) await installRequiredFonts([{ ...req, state: 'missing' }]);
      else changed();
      await reload();
    } catch (err) {
      reportError(err instanceof Error ? err.message : 'Could not save the declaration — this .mdp may be read-only.', { detail: err });
    } finally { setBusy(''); }
  };

  const undeclare = async (r: FontRequirement) => {
    if (busy) return;
    if (!window.confirm(`Remove the declaration of "${r.family}" from ${requirementsPath(configDir)}? (An installed package stays.)`)) return;
    setBusy('declare');
    try {
      await editRequirements((text) => removeRequirement(text, r.family));
      await reload();
      changed();
    } catch (err) {
      reportError(err instanceof Error ? err.message : 'Could not update the declarations.', { detail: err });
    } finally { setBusy(''); }
  };

  const install = async (r: FontRequirement) => {
    if (busy) return;
    setBusy('install');
    try {
      await installRequiredFonts([{ ...r, state: 'missing' }]);
      await reload();
    } finally { setBusy(''); }
  };

  const downloadOfficial = async () => {
    if (busy) return;
    setBusy('download');
    try {
      const { downloaded, failed } = await syncOfficialCatalog(ownerDir ? `${ownerDir}/` : '', ['fonts']);
      if (downloaded === 0) {
        reportError(failed
          ? 'The official fonts could not be downloaded — try again later.'
          : 'The official catalog does not offer fonts yet — update MDP, or add font files yourself.');
      } else {
        notify(`Official fonts downloaded into ${configDir}${failed ? ` (${failed} file(s) failed)` : ''}.`);
      }
      await reload();
    } catch {
      reportError('Download failed — check your internet connection.');
    } finally { setBusy(''); }
  };

  const pickFile = () => fileRef.current?.click();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_FONT_BYTES) { reportError(`"${file.name}" is larger than 50 MB.`); return; }
    setBusy('add');
    try {
      const base64 = arrayBufferToBase64(await file.arrayBuffer());
      const info = await apiClient.inspectFont(base64);
      if (!info || info.error) { reportError(`"${file.name}" is not a font file I can read.`, { detail: info?.error }); return; }
      const existing = fonts.find((f) => f.family.toLowerCase() === info.family.toLowerCase());
      setPending({
        fileName: file.name, base64, size: file.size, info,
        family: existing?.family || info.family,
        category: existing?.category || (/mono|code/i.test(info.family) ? 'monospace' : /serif|mincho|明朝/i.test(`${info.family} ${info.localFamily}`) ? 'serif' : 'sans-serif'),
        confirmed: FREE.has(info.licenseKind),
      });
    } catch (err) {
      reportError('Could not read the font file.', { detail: err });
    } finally { setBusy(''); }
  };

  const addPending = async () => {
    if (!pending || busy) return;
    const family = pending.family.trim();
    if (!family) return;
    setBusy('add');
    try {
      const info = pending.info;
      const face = {
        file: safeFileName(pending.fileName),
        weight: info.weightRange ? `${info.weightRange[0]} ${info.weightRange[1]}` : String(info.weight || 400),
        style: info.italic ? 'italic' : 'normal',
      };
      // A second file of a family already in THIS `.mdp` (e.g. its Bold) joins
      // that package; anything else becomes a new package folder.
      const same = own.find((f) => f.family.toLowerCase() === family.toLowerCase());
      let dir: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let meta: any;
      if (same && !same.inferred) {
        dir = same.dir;
        meta = JSON.parse(await apiClient.readFileText(`${dir}/font.json`));
        meta.faces = [...(Array.isArray(meta.faces) ? meta.faces : []).filter((f: { file?: string }) => f.file !== face.file), face];
      } else {
        const taken = new Set(own.map((f) => f.id));
        let id = slugOf(family);
        for (let n = 2; taken.has(id); n++) id = `${slugOf(family)}-${n}`;
        dir = `${configDir}/fonts/${id}`;
        meta = {
          family, category: pending.category, faces: [face],
          license: info.licenseKind || '',
          ...(info.license || info.licenseUrl || info.copyright ? { licenseFile: 'LICENSE.txt' } : {}),
          source: 'Added from a local file',
          ...(info.version ? { version: info.version } : {}),
        };
      }
      await apiClient.saveFile(`${dir}/${face.file}`, pending.base64, true);
      if (meta.licenseFile === 'LICENSE.txt' && !(same && !same.inferred)) {
        const text = [info.copyright, info.license, info.licenseUrl].filter(Boolean).join('\n\n');
        await apiClient.saveFile(`${dir}/LICENSE.txt`, `${text}\n`);
      }
      await apiClient.saveFile(`${dir}/font.json`, `${JSON.stringify(meta, null, 2)}\n`);
      notify(`Added ${family} to ${configDir}.`);
      setPending(null);
      await reload();
      changed();
    } catch (err) {
      reportError('Could not add the font — this .mdp may be read-only.', { detail: err });
    } finally { setBusy(''); }
  };

  const remove = async (f: WorkspaceFont) => {
    if (busy) return;
    if (!window.confirm(`Remove the font "${f.family}" (${f.dir})? Decks beneath this folder will fall back to other fonts.`)) return;
    setBusy('remove');
    try {
      await apiClient.deleteFiles([f.dir]);
      // A default that named the removed family would now point nowhere.
      const next = { ...value };
      for (const r of ROLES) if ((next[r.key] || '').toLowerCase() === f.family.toLowerCase()) delete next[r.key];
      onChange(next);
      await reload();
      changed();
    } catch (err) {
      reportError('Could not remove the font — this .mdp may be read-only.', { detail: err });
    } finally { setBusy(''); }
  };

  const setRole = (key: keyof MdpFontDefaults, v: string) => {
    const next = { ...value };
    if (v === '__inherit') delete next[key];
    else next[key] = v === '__theme' ? '' : v;
    onChange(next);
  };
  const roleValue = (key: keyof MdpFontDefaults) => {
    const v = value[key];
    if (v === undefined) return '__inherit';
    return v === '' ? '__theme' : v;
  };

  const embeddingNote = (info: FontInspection) => ({
    installable: 'The font allows embedding.',
    editable: 'The font allows editable embedding.',
    'preview-print': 'The font allows only preview & print embedding — check its licence before sharing decks.',
    restricted: 'The font FORBIDS embedding (Restricted License). It cannot be added.',
  }[info.embedding]);

  return (
    <>
      <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--app-text-strong)', mt: 2, mb: 0.5 }}>Fonts (this folder)</Typography>
      <Typography sx={{ ...hintSx, mb: 1 }}>
        Fonts stored in a <code>.mdp</code> render the SAME on every machine, offline — no dependence on what the viewer&apos;s OS
        has installed. Decks beneath this folder use the fonts of this <code>.mdp</code> and its parents (a nearer one wins on a
        family name). The official themes prefer Noto Sans JP / Noto Serif JP / JetBrains Mono when present. Only add fonts
        whose licence lets you share them (e.g. SIL Open Font License) — never copy fonts that came with your OS.
      </Typography>

      <Box sx={{ border: '1px solid var(--app-border)', borderRadius: 1.5, overflow: 'hidden', bgcolor: 'var(--app-bg-elevated)' }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 1.5 }}><CircularProgress size={18} sx={{ color: 'var(--app-accent)' }} /></Box>
        ) : fonts.length === 0 ? (
          <Typography sx={{ px: 1.5, py: 1.25, color: 'var(--app-text-disabled)', fontSize: '0.8rem' }}>
            No fonts in this folder&apos;s cascade — text uses the fonts of whichever computer shows the deck.
          </Typography>
        ) : fonts.map((f) => (
          <Box key={`${f.configDir}/${f.id}`} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5, py: 0.75, borderBottom: '1px solid var(--app-border-subtle)' }}>
            <span style={{ fontWeight: 600, color: 'var(--app-text-strong)', minWidth: 130, fontFamily: `"${f.family.replace(/"/g, '')}", sans-serif` }}>{f.family}</span>
            <span style={{ fontSize: '0.72rem', color: 'var(--app-text-disabled)', minWidth: 70 }}>{f.category}</span>
            <span style={{ fontSize: '0.72rem', color: 'var(--app-text-muted)', minWidth: 56 }}>{fmtSize(f.size)}</span>
            <span style={{ fontSize: '0.72rem', color: 'var(--app-text-muted)', minWidth: 56 }}>{f.license || (f.inferred ? 'no font.json' : '')}</span>
            <span style={{ flex: 1, fontSize: '0.72rem', color: 'var(--app-text-disabled)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {f.configDir === configDir ? 'this folder' : `from ${f.configDir}`}
              {f.problems?.length ? ` — ${f.problems.join('; ')}` : ''}
            </span>
            {f.configDir === configDir && (
              <Button size="small" onClick={() => remove(f)} disabled={!!busy}
                sx={{ textTransform: 'none', minWidth: 0, color: 'var(--app-text-muted)' }}>Remove</Button>
            )}
          </Box>
        ))}
      </Box>

      <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--app-text-strong)', mt: 1.75, mb: 0.25 }}>Required fonts</Typography>
      <Typography sx={{ ...hintSx, mb: 0.75 }}>
        Fonts the decks beneath this folder need, declared in <code>fonts/requirements.json</code>. A font with a download
        source (Google Fonts, a font file, a ZIP archive) is installed into the <code>.mdp</code> with one click — on this and
        every other computer. A font without one is not shared at all, but whoever opens the decks is told it is missing and
        where to get it.
      </Typography>
      {merged.errors.map((e) => (
        <Typography key={e.path} sx={{ ...hintSx, color: 'var(--app-danger, #e57373)', mb: 0.5 }}>{e.path}: {e.error}</Typography>
      ))}
      {required.length > 0 && (
        <Box sx={{ border: '1px solid var(--app-border)', borderRadius: 1.5, overflow: 'hidden', bgcolor: 'var(--app-bg-elevated)' }}>
          {required.map((r) => {
            const st = STATE_LABEL[r.state];
            const mine = r.configDir === configDir;
            return (
              <Box key={`${r.configDir}/${r.family}`} sx={{ px: 1.5, py: 0.75, borderBottom: '1px solid var(--app-border-subtle)' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                  <span style={{ fontWeight: 600, color: 'var(--app-text-strong)', minWidth: 130 }}>{r.family}</span>
                  <span style={{ fontSize: '0.72rem', color: st.color, minWidth: 90 }}>● {st.text}</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--app-text-muted)', minWidth: 80 }}>{sourceLabel(r.source) || 'declared only'}</span>
                  <span style={{ flex: 1, fontSize: '0.72rem', color: 'var(--app-text-disabled)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {mine ? 'this folder' : `from ${r.configDir}`}{r.license ? ` — ${r.license}` : ''}
                  </span>
                  {r.source && r.state !== 'packaged' && (
                    <Button size="small" onClick={() => install(r)} disabled={!!busy}
                      startIcon={busy === 'install' ? <CircularProgress size={12} sx={{ color: 'var(--app-accent)' }} /> : <CloudDownloadIcon sx={{ fontSize: 16 }} />}
                      sx={{ textTransform: 'none', minWidth: 0, color: 'var(--app-accent)' }}>Download</Button>
                  )}
                  {r.homepage && (
                    <Button size="small" component="a" href={r.homepage} target="_blank" rel="noopener noreferrer"
                      sx={{ textTransform: 'none', minWidth: 0, color: 'var(--app-text-muted)' }}>Homepage</Button>
                  )}
                  {mine && (
                    <Button size="small" onClick={() => undeclare(r)} disabled={!!busy}
                      sx={{ textTransform: 'none', minWidth: 0, color: 'var(--app-text-muted)' }}>Remove</Button>
                  )}
                </Box>
                {(r.note || r.fallback?.length) && (
                  <Typography sx={{ ...hintSx, mt: 0.25 }}>
                    {r.note}{r.note && r.fallback?.length ? ' — ' : ''}{r.fallback?.length ? `fallback: ${r.fallback.join(', ')}` : ''}
                  </Typography>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      {draft ? (
        <Box sx={{ mt: 1, p: 1.25, border: '1px solid var(--app-border-strong)', borderRadius: 1.5, bgcolor: 'var(--app-bg-elevated)' }}>
          <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
            <TextField label="Family name (as slides name it)" size="small" value={draft.family} autoFocus
              onChange={(e) => setDraft({ ...draft, family: e.target.value })} sx={{ ...fieldSx, flex: 2 }} />
            <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as FontCategory | '' })}
              style={{ ...selectStyle, flex: 1 }}>
              <option value="">category: automatic</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Stack>
          <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: 'center' }}>
            <span style={{ width: 90, fontSize: '0.8rem', color: 'var(--app-text-secondary)' }}>Get it from</span>
            <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as SourceKind })} style={selectStyle}>
              <option value="">Nowhere — declare only (the font is not shared)</option>
              <option value="google">Google Fonts</option>
              <option value="urls">Font file URL(s)</option>
              <option value="zip">A ZIP archive (e.g. a GitHub release)</option>
            </select>
          </Stack>
          {draft.kind === 'google' && (
            <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
              <TextField label="Name on Google Fonts (if different)" size="small" value={draft.googleName}
                onChange={(e) => setDraft({ ...draft, googleName: e.target.value })} sx={{ ...fieldSx, flex: 2 }} />
              <TextField label="Weights (optional, e.g. 400, 700)" size="small" value={draft.weights}
                onChange={(e) => setDraft({ ...draft, weights: e.target.value })} sx={{ ...fieldSx, flex: 1 }} />
            </Stack>
          )}
          {draft.kind === 'urls' && (
            <TextField label="https:// URL of each .woff2 / .woff / .ttf / .otf (one per line)" size="small" multiline minRows={2}
              value={draft.urls} onChange={(e) => setDraft({ ...draft, urls: e.target.value })} sx={{ ...fieldSx, width: '100%', mb: 1 }} />
          )}
          {draft.kind === 'zip' && (
            <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
              <TextField label="https:// URL of the ZIP" size="small" value={draft.zip}
                onChange={(e) => setDraft({ ...draft, zip: e.target.value })} sx={{ ...fieldSx, flex: 2 }} />
              <TextField label="Files to take (optional, e.g. *-Regular.ttf)" size="small" value={draft.zipFiles}
                onChange={(e) => setDraft({ ...draft, zipFiles: e.target.value })} sx={{ ...fieldSx, flex: 1 }} />
            </Stack>
          )}
          <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
            <TextField label="Licence (e.g. OFL-1.1)" size="small" value={draft.license}
              onChange={(e) => setDraft({ ...draft, license: e.target.value })} sx={{ ...fieldSx, flex: 1 }} />
            <TextField label="Homepage / where to buy" size="small" value={draft.homepage}
              onChange={(e) => setDraft({ ...draft, homepage: e.target.value })} sx={{ ...fieldSx, flex: 2 }} />
          </Stack>
          <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
            <TextField label="Note for viewers (optional)" size="small" value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })} sx={{ ...fieldSx, flex: 1 }} />
            <TextField label="Fallbacks, e.g. Noto Sans JP" size="small" value={draft.fallback}
              onChange={(e) => setDraft({ ...draft, fallback: e.target.value })} sx={{ ...fieldSx, flex: 1 }} />
          </Stack>
          <Typography sx={{ ...hintSx, mb: 1 }}>
            Downloads are only offered for fonts you may share (open licences such as the SIL Open Font License). For a font
            that came with your OS or that you bought, choose <em>declare only</em>: the decks then say they need it, and
            the fallback fonts stand in where it is missing.
          </Typography>
          <Stack direction="row" spacing={1}>
            {draft.kind && (
              <Button size="small" variant="contained" onClick={() => declare(true)} disabled={!!busy || !draft.family.trim()}
                sx={{ textTransform: 'none', bgcolor: 'var(--app-accent)' }}>
                {busy === 'install' ? 'Downloading…' : 'Declare & download'}
              </Button>
            )}
            <Button size="small" variant={draft.kind ? 'outlined' : 'contained'} onClick={() => declare(false)} disabled={!!busy || !draft.family.trim()}
              sx={{ textTransform: 'none', ...(draft.kind ? { color: 'var(--app-text-secondary)', borderColor: 'var(--app-border-strong)' } : { bgcolor: 'var(--app-accent)' }) }}>
              Declare
            </Button>
            <Button size="small" onClick={() => setDraft(null)} sx={{ textTransform: 'none', color: 'var(--app-text-muted)' }}>Cancel</Button>
          </Stack>
        </Box>
      ) : (
        <Button size="small" variant="outlined" onClick={() => setDraft({ ...EMPTY_DRAFT })} disabled={!!busy}
          startIcon={<AddIcon fontSize="small" />}
          sx={{ mt: 1, textTransform: 'none', color: 'var(--app-text-secondary)', borderColor: 'var(--app-border-strong)' }}>
          Declare a required font…
        </Button>
      )}

      <Typography sx={{ ...hintSx, mt: 1.25, mb: 0.5 }}>
        Default fonts for decks beneath this folder. <em>Inherit</em> takes the parent <code>.mdp</code>&apos;s choice;
        <em> Theme&apos;s own font</em> lets the deck&apos;s theme decide.
      </Typography>
      <Stack spacing={0.75}>
        {ROLES.map((r) => {
          const inh = inherited[r.key];
          const inhLabel = inh === undefined ? 'theme' : inh === '' ? 'theme' : inh;
          const current = value[r.key];
          const missing = current && !families.some((f) => f.toLowerCase() === current.toLowerCase())
            && !declaredOnly.some((d) => d.family.toLowerCase() === current.toLowerCase());
          return (
            <Box key={r.key} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <span style={{ width: 90, fontSize: '0.8rem', color: 'var(--app-text-secondary)' }}>{r.label}</span>
              <select value={roleValue(r.key)} onChange={(e) => setRole(r.key, e.target.value)} style={selectStyle}>
                <option value="__inherit">Inherit ({inhLabel})</option>
                <option value="__theme">Theme&apos;s own font</option>
                {missing && <option value={current}>{current} (not installed)</option>}
                {fonts.map((f) => <option key={f.family} value={f.family}>{f.family} — {f.category}</option>)}
                {declaredOnly.map((d) => (
                  <option key={`req:${d.family}`} value={d.family}>
                    {d.family} — required, {d.state === 'local' ? 'installed on this computer only' : 'missing here'}
                  </option>
                ))}
              </select>
            </Box>
          );
        })}
      </Stack>

      {pending && (
        <Box sx={{ mt: 1.25, p: 1.25, border: '1px solid var(--app-border-strong)', borderRadius: 1.5, bgcolor: 'var(--app-bg-elevated)' }}>
          <Typography sx={{ fontSize: '0.8rem', color: 'var(--app-text-strong)', mb: 0.5 }}>
            {pending.fileName} — {pending.info.family}{pending.info.localFamily ? ` (${pending.info.localFamily})` : ''},{' '}
            {pending.info.weightRange ? `weights ${pending.info.weightRange[0]}–${pending.info.weightRange[1]}` : `weight ${pending.info.weight}`}
            {pending.info.italic ? ', italic' : ''}, {pending.info.format}, {fmtSize(pending.size)}
          </Typography>
          <Typography sx={{ ...hintSx, mb: 0.5 }}>
            Licence: {pending.info.licenseKind || 'not recognised'}
            {pending.info.license ? ` — ${pending.info.license.slice(0, 220)}${pending.info.license.length > 220 ? '…' : ''}` : ''}
            {pending.info.licenseUrl ? ` (${pending.info.licenseUrl})` : ''}
          </Typography>
          <Typography sx={{ ...hintSx, mb: 1, color: pending.info.embedding === 'restricted' ? 'var(--app-danger, #e57373)' : hintSx.color }}>
            {embeddingNote(pending.info)}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
            <TextField label="Family name used by slides" size="small" value={pending.family}
              onChange={(e) => setPending({ ...pending, family: e.target.value })} sx={{ ...fieldSx, flex: 2 }} />
            <select value={pending.category} onChange={(e) => setPending({ ...pending, category: e.target.value as FontCategory })}
              style={{ ...selectStyle, flex: 1 }}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Stack>
          {!FREE.has(pending.info.licenseKind) && pending.info.embedding !== 'restricted' && (
            <Box component="label" sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', ...hintSx, mb: 1, cursor: 'pointer' }}>
              <input type="checkbox" checked={pending.confirmed} onChange={(e) => setPending({ ...pending, confirmed: e.target.checked })} />
              <span>I have the right to store this font in the folder and share it together with the decks (it is not a font that came with my OS).</span>
            </Box>
          )}
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="contained" onClick={addPending}
              disabled={!!busy || !pending.family.trim() || !pending.confirmed || pending.info.embedding === 'restricted'}
              sx={{ textTransform: 'none', bgcolor: 'var(--app-accent)' }}>
              {own.some((f) => f.family.toLowerCase() === pending.family.trim().toLowerCase() && !f.inferred) ? 'Add as another face' : 'Add font'}
            </Button>
            <Button size="small" onClick={() => setPending(null)} sx={{ textTransform: 'none', color: 'var(--app-text-muted)' }}>Cancel</Button>
          </Stack>
        </Box>
      )}

      <Stack direction="row" spacing={1} sx={{ mt: 1.25, flexWrap: 'wrap', gap: 1 }}>
        <Button size="small" variant="outlined" onClick={downloadOfficial} disabled={!!busy}
          startIcon={busy === 'download' ? <CircularProgress size={14} sx={{ color: 'var(--app-accent)' }} /> : <CloudDownloadIcon fontSize="small" />}
          sx={{ textTransform: 'none', color: 'var(--app-text-secondary)', borderColor: 'var(--app-border-strong)' }}>
          Get official fonts (≈10 MB)
        </Button>
        <Button size="small" variant="outlined" onClick={pickFile} disabled={!!busy}
          startIcon={busy === 'add' ? <CircularProgress size={14} sx={{ color: 'var(--app-accent)' }} /> : <AddIcon fontSize="small" />}
          sx={{ textTransform: 'none', color: 'var(--app-text-secondary)', borderColor: 'var(--app-border-strong)' }}>
          Add font file…
        </Button>
        <input ref={fileRef} type="file" accept=".woff2,.woff,.ttf,.otf" hidden onChange={onFile} />
      </Stack>
      <Typography sx={{ ...hintSx, mt: 0.75 }}>
        Official fonts: Noto Sans JP, Noto Serif JP, JetBrains Mono (SIL Open Font License; internet required for the download,
        then everything works offline). A font file is stored as-is under <code>{configDir}/fonts/</code>.
      </Typography>
    </>
  );
};
