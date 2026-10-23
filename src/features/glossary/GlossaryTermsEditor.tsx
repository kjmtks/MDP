import React, { useMemo, useState } from 'react';
import { Box, Button, IconButton, MenuItem, TextField, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import VolumeUpOutlinedIcon from '@mui/icons-material/VolumeUpOutlined';
import RecordVoiceOverOutlinedIcon from '@mui/icons-material/RecordVoiceOverOutlined';
import { apiClient } from '../../api/apiClient';
import { notify, reportError } from '../../components/error/errorReporter';
import type { GlossaryFile } from './glossary';
import { speakPlain } from './glossarySpeak';

// A glossary's terms as a table (the Configure dialog): edit a term, its reading and
// its note, add one, delete one, listen to the term as the narrator reads it written
// and to the reading; the description and the lines it is for. Save writes ONE edit
// (apiClient.glossaryEdit → app/glossary.cjs editGlossaryText): only the rows that
// changed, the rest of the file — the text around the table, other tables — kept.
// A parent folder's glossary is shown read-only.

interface Row { key: number; term: string; reading: string; note: string; orig: { term: string; reading: string; note: string } | null }

const BAD = /[[\]|\n]/;
const cellSx = {
  '& .MuiInputBase-input': { color: 'var(--app-text)', fontSize: '0.8rem', py: '3px', px: '6px' },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--app-border-subtle)' },
  '& .Mui-disabled': { WebkitTextFillColor: 'var(--app-text-secondary)' },
};
const fieldSx = {
  '& .MuiInputBase-input': { color: 'var(--app-text)', fontSize: '0.8rem' },
  '& .MuiInputLabel-root': { color: 'var(--app-text-disabled)', fontSize: '0.8rem' },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--app-border-subtle)' },
};
const LANGS: [string, string][] = [['', 'from its readings'], ['ja', 'ja — Japanese lines'], ['en', 'en — English lines'], ['any', 'every line']];

export const GlossaryTermsEditor: React.FC<{ file: GlossaryFile; editable: boolean; onSaved: (g: GlossaryFile) => void }> = ({ file, editable, onSaved }) => {
  const initial = useMemo(() => file.terms.map((t, i) => ({ key: i, term: t.term, reading: t.reading, note: t.note || '', orig: { term: t.term, reading: t.reading, note: t.note || '' } })), [file]);
  const [rows, setRows] = useState<Row[]>(initial);
  const [deleted, setDeleted] = useState<string[]>([]);
  const [desc, setDesc] = useState(file.description);
  const [lang, setLang] = useState(file.langInferred ? '' : file.lang === '' ? 'any' : file.lang);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [nextKey, setNextKey] = useState(file.terms.length);

  const problems = useMemo(() => {
    const seen = new Map<string, number>();
    for (const r of rows) if (r.term.trim()) seen.set(r.term.trim(), (seen.get(r.term.trim()) || 0) + 1);
    return new Map(rows.map((r) => {
      const t = r.term.trim();
      const p = !t && !r.reading.trim() ? '' : !t ? 'no term' : !r.reading.trim() ? 'no reading' : BAD.test(t) || BAD.test(r.reading) ? 'no [ ] or | in a term or a reading' : (seen.get(t) || 0) > 1 ? 'the same term twice' : '';
      return [r.key, p];
    }));
  }, [rows]);
  const langNow = lang === 'any' ? '' : lang;
  const langOrig = file.langInferred ? '' : file.lang;
  const changedRows = rows.filter((r) => r.term.trim() && r.reading.trim() && (!r.orig || r.orig.term !== r.term.trim() || r.orig.reading !== r.reading.trim() || r.orig.note !== r.note.trim()));
  const renamedAway = rows.filter((r) => r.orig && r.orig.term !== r.term.trim()).map((r) => r.orig!.term);
  const dirty = changedRows.length > 0 || deleted.length > 0 || desc !== file.description || langNow !== langOrig || (lang === '' && !file.langInferred) || rows.some((r) => !r.orig && (r.term || r.reading));
  const blocked = [...problems.values()].some(Boolean);
  const shown = rows.filter((r) => !filter.trim() || r.term.includes(filter.trim()) || r.reading.includes(filter.trim()) || r.note.includes(filter.trim()));

  const edit = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const add = () => { setRows((rs) => [...rs, { key: nextKey, term: '', reading: '', note: '', orig: null }]); setNextKey((k) => k + 1); setFilter(''); };
  const drop = (r: Row) => {
    setRows((rs) => rs.filter((x) => x.key !== r.key));
    if (r.orig) setDeleted((d) => [...d, r.orig!.term]);
  };
  const revert = () => { setRows(initial); setDeleted([]); setDesc(file.description); setLang(file.langInferred ? '' : file.lang === '' ? 'any' : file.lang); };
  const save = async () => {
    if (busy || blocked) return;
    const keep = new Set(rows.map((r) => r.term.trim()).filter(Boolean));
    const remove = [...new Set([...deleted, ...renamedAway])].filter((t) => !keep.has(t));
    setBusy(true);
    try {
      const res = await apiClient.glossaryEdit({
        path: file.path,
        set: changedRows.map((r) => ({ term: r.term.trim(), reading: r.reading.trim(), note: r.note.trim() })),
        remove,
        ...(desc !== file.description ? { description: desc.trim() } : {}),
        ...(langNow !== langOrig || (lang === '' && !file.langInferred) ? { lang: langNow } : {}),
      });
      notify(`Saved "${file.name}": ${res.added} added, ${res.updated} changed, ${res.removed} removed.`);
      window.dispatchEvent(new CustomEvent('mdp-glossary-changed'));
      window.dispatchEvent(new CustomEvent('mdp-refresh-tree'));
      onSaved(res.glossary);
    } catch (e) {
      reportError(`Could not save the glossary "${file.name}".`, { detail: e });
    } finally { setBusy(false); }
  };

  return (
    <Box className="mdp-glossary-editor" sx={{ mt: 0.75, p: 1, border: '1px solid var(--app-border-subtle)', borderRadius: 1, bgcolor: 'var(--app-bg-panel)' }}>
      <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
        <TextField size="small" label="Description" value={desc} disabled={!editable} onChange={(e) => setDesc(e.target.value)} sx={{ ...fieldSx, flex: 1 }} />
        <TextField size="small" select label="For" value={lang} disabled={!editable} onChange={(e) => setLang(e.target.value)} sx={{ ...fieldSx, width: 180 }}>
          {LANGS.map(([v, l]) => <MenuItem key={v} value={v} sx={{ fontSize: '0.8rem' }}>{l}</MenuItem>)}
        </TextField>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <TextField size="small" placeholder="Find a term…" value={filter} onChange={(e) => setFilter(e.target.value)} sx={{ ...cellSx, width: 200 }} />
        <span style={{ fontSize: '0.72rem', color: 'var(--app-text-disabled)' }}>{rows.length} term{rows.length === 1 ? '' : 's'}{filter.trim() ? ` · ${shown.length} shown` : ''}</span>
      </Box>
      <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', '& th': { fontSize: '0.72rem', fontWeight: 600, color: 'var(--app-text-muted)', textAlign: 'left', px: 0.5, py: 0.25 }, '& td': { px: 0.25, py: 0.25, verticalAlign: 'top' } }}>
        <thead><tr><th style={{ width: '30%' }}>用語 term</th><th style={{ width: '30%' }}>読み reading</th><th>メモ note</th><th style={{ width: 92 }} /></tr></thead>
        <tbody>
          {shown.map((r) => {
            const p = problems.get(r.key);
            return (
              <tr key={r.key} className="mdp-glossary-row" data-term={r.term}>
                <td><TextField size="small" fullWidth value={r.term} disabled={!editable} error={!!p && p !== 'no reading'} onChange={(e) => edit(r.key, { term: e.target.value })} inputProps={{ 'aria-label': 'term' }} sx={cellSx} /></td>
                <td><TextField size="small" fullWidth value={r.reading} disabled={!editable} error={!!p && p !== 'no term'} onChange={(e) => edit(r.key, { reading: e.target.value })} inputProps={{ 'aria-label': 'reading' }} sx={cellSx} /></td>
                <td>
                  <TextField size="small" fullWidth value={r.note} disabled={!editable} onChange={(e) => edit(r.key, { note: e.target.value })} inputProps={{ 'aria-label': 'note' }} sx={cellSx} />
                  {p && <div style={{ fontSize: '0.7rem', color: 'var(--app-danger, #e57373)' }}>{p}</div>}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <Tooltip title="Listen: the term as the narrator reads it written (no glossary)">
                    <span><IconButton size="small" disabled={!r.term.trim()} onClick={() => speakPlain(r.term, langNow || file.lang)} className="mdp-glossary-say-term"><RecordVoiceOverOutlinedIcon sx={{ fontSize: 16 }} /></IconButton></span>
                  </Tooltip>
                  <Tooltip title="Listen: the reading">
                    <span><IconButton size="small" disabled={!r.reading.trim()} onClick={() => speakPlain(r.reading, langNow || file.lang)} className="mdp-glossary-say-reading"><VolumeUpOutlinedIcon sx={{ fontSize: 16 }} /></IconButton></span>
                  </Tooltip>
                  {editable && <Tooltip title="Delete this term"><IconButton size="small" onClick={() => drop(r)} className="mdp-glossary-delete"><CloseIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </Box>
      {editable ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.75 }}>
          <Button size="small" startIcon={<AddIcon fontSize="small" />} onClick={add} className="mdp-glossary-add" sx={{ textTransform: 'none', color: 'var(--app-text-secondary)' }}>Add a term</Button>
          <Box sx={{ flex: 1 }} />
          {dirty && <Button size="small" onClick={revert} disabled={busy} sx={{ textTransform: 'none', color: 'var(--app-text-muted)' }}>Revert</Button>}
          <Button size="small" variant="contained" onClick={() => void save()} disabled={!dirty || busy || blocked} className="mdp-glossary-save" sx={{ textTransform: 'none', bgcolor: 'var(--app-accent)' }}>Save</Button>
        </Box>
      ) : (
        <div style={{ fontSize: '0.72rem', color: 'var(--app-text-disabled)', marginTop: 6 }}>
          From {file.configDir} — edit it in that folder&apos;s Configure (.mdp). A term in a glossary of this folder reads it otherwise here.
        </div>
      )}
    </Box>
  );
};
