import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, MenuItem, TextField, Tooltip } from '@mui/material';
import VolumeUpOutlinedIcon from '@mui/icons-material/VolumeUpOutlined';
import RecordVoiceOverOutlinedIcon from '@mui/icons-material/RecordVoiceOverOutlined';
import { apiClient } from '../../api/apiClient';
import { notify, reportError } from '../../components/error/errorReporter';
import type { GlossaryFile } from './glossary';
import { ADD_TO_GLOSSARY_EVENT, type GlossaryPick } from './glossaryPick';
import { speakPlain } from './glossarySpeak';

// The editor's "Add to glossary…" (editor.addToGlossary): a term picked in the script —
// the selection, the ruby at the caret — written into a glossary of the deck's folder
// chain (or a new one in its nearest .mdp), so every deck there reads it so; a ruby it
// came from can go from the script (the glossary reads it now). The default glossary:
// the one that already has the term, else the nearest.

const NEW = '\u0000new';
const BAD = /[[\]|\n]/;
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}_.-]{0,63}$/u;
const slug = (s: string) => s.trim().replace(/\.md$/i, '').replace(/[\s/\\]+/g, '-').replace(/[^\p{L}\p{N}_.-]/gu, '');
const folderName = (cdir: string) => slug(cdir.replace(/\/?\.mdp$/, '').split('/').pop() || '') || 'terms';

export const AddToGlossaryDialog: React.FC<{ chain: string[]; onReplace: (from: number, to: number, expect: string, text: string) => boolean }> = ({ chain, onReplace }) => {
  const [pick, setPick] = useState<GlossaryPick | null>(null);
  const [files, setFiles] = useState<GlossaryFile[]>([]);
  const [target, setTarget] = useState('');
  const [newName, setNewName] = useState('');
  const [term, setTerm] = useState('');
  const [reading, setReading] = useState('');
  const [note, setNote] = useState('');
  const [dropRuby, setDropRuby] = useState(true);
  const [busy, setBusy] = useState(false);
  const chainRef = useRef(chain);
  useEffect(() => { chainRef.current = chain; }, [chain]);
  const nearest = chain.length ? chain[chain.length - 1] : '.mdp';

  useEffect(() => {
    const onPick = (e: Event) => {
      const d = (e as CustomEvent<GlossaryPick>).detail;
      if (d && d.formula) {
        reportError('A glossary does not read inside a formula — keep its reading in the script as a ruby.', { severity: 'warning' });
        return;
      }
      const dirs = chainRef.current;
      setPick(d || { term: '', reading: '', ruby: null, formula: false });
      setTerm(d?.term || '');
      setReading(d?.reading || '');
      setNote('');
      setDropRuby(!!d?.ruby);
      setNewName(folderName(dirs.length ? dirs[dirs.length - 1] : '.mdp'));
      setFiles([]);
      setTarget(NEW);
      apiClient.getGlossaries(dirs).then((list) => {
        const all = list || [];
        setFiles(all);
        const has = [...all].reverse().find((f) => f.terms.some((t) => t.term === (d?.term || '')));
        setTarget(has ? has.path : all.length ? all[all.length - 1].path : NEW);
      }, () => { setFiles([]); setTarget(NEW); });
    };
    window.addEventListener(ADD_TO_GLOSSARY_EVENT, onPick);
    return () => window.removeEventListener(ADD_TO_GLOSSARY_EVENT, onPick);
  }, []);

  const chosen = files.find((f) => f.path === target) || null;
  const now = chosen?.terms.find((t) => t.term === term.trim()) || null;
  // a glossary nearer than the chosen one that reads the term otherwise wins
  const overriding = useMemo(() => {
    const i = files.findIndex((f) => f.path === target);
    const later = target === NEW ? [] : files.slice(i + 1);
    return later.find((f) => f.terms.some((t) => t.term === term.trim() && t.reading !== reading.trim())) || null;
  }, [files, target, term, reading]);
  const problem = !term.trim() ? 'a term' : !reading.trim() ? 'its reading' : BAD.test(term) || BAD.test(reading) ? 'no [ ] or | in a term or a reading' : target === NEW && !NAME_RE.test(slug(newName)) ? 'a name for the new glossary' : '';

  const close = () => { if (!busy) setPick(null); };
  const add = async () => {
    if (!pick || busy || problem) return;
    const path = target === NEW ? `${nearest}/glossary/${slug(newName)}.md` : target;
    setBusy(true);
    try {
      const r = await apiClient.glossaryEdit({ path, set: [{ term: term.trim(), reading: reading.trim(), ...(note.trim() ? { note: note.trim() } : {}) }], create: target === NEW });
      let dropped = false;
      if (pick.ruby && dropRuby) dropped = onReplace(pick.ruby.from, pick.ruby.to, pick.ruby.text, pick.term);
      notify(`「${term.trim()}」 → 「${reading.trim()}」 ${r.updated ? 'changed in' : 'added to'} the glossary "${r.glossary.name}"${dropped ? ', the ruby removed from the script' : pick.ruby && dropRuby ? ' (the script changed meanwhile: the ruby was left)' : ''}.`);
      window.dispatchEvent(new CustomEvent('mdp-glossary-changed'));
      window.dispatchEvent(new CustomEvent('mdp-refresh-tree'));
      setPick(null);
    } catch (e) {
      reportError('Could not add the term to the glossary.', { detail: e });
    } finally { setBusy(false); }
  };
  const lang = chosen?.lang || '';

  return (
    <Dialog open={!!pick} onClose={close} maxWidth="sm" fullWidth className="mdp-add-glossary">
      <DialogTitle sx={{ pb: 1 }}>Add to glossary</DialogTitle>
      <DialogContent>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 4 }}>
          <TextField size="small" label="Term (as written in the script)" value={term} onChange={(e) => setTerm(e.target.value)} autoFocus={!pick?.term} sx={{ flex: 1 }} inputProps={{ 'aria-label': 'term' }} />
          <Tooltip title="Listen: the term as the narrator reads it written (no glossary)">
            <span><IconButton disabled={!term.trim()} onClick={() => speakPlain(term, lang)} className="mdp-glossary-say-term"><RecordVoiceOverOutlinedIcon fontSize="small" /></IconButton></span>
          </Tooltip>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12 }}>
          <TextField size="small" label="Reading (what the narrator says)" value={reading} onChange={(e) => setReading(e.target.value)} autoFocus={!!pick?.term && !pick?.reading}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }} sx={{ flex: 1 }} inputProps={{ 'aria-label': 'reading' }}
            helperText={now ? `This glossary reads it 「${now.reading}」 now — this changes it` : ' '} />
          <Tooltip title="Listen: the reading">
            <span><IconButton disabled={!reading.trim()} onClick={() => speakPlain(reading, lang)} className="mdp-glossary-say-reading"><VolumeUpOutlinedIcon fontSize="small" /></IconButton></span>
          </Tooltip>
        </div>
        <TextField size="small" label="Note (optional, for people)" value={note} onChange={(e) => setNote(e.target.value)} fullWidth sx={{ mt: 1 }} />
        <TextField size="small" select label="Glossary" value={target} onChange={(e) => setTarget(e.target.value)} fullWidth sx={{ mt: 2 }} inputProps={{ 'aria-label': 'glossary' }}>
          {files.map((f) => (
            <MenuItem key={f.path} value={f.path}>
              {f.name} — {f.configDir === nearest ? 'this folder' : `from ${f.configDir}`} · {f.terms.length} term{f.terms.length === 1 ? '' : 's'}
            </MenuItem>
          ))}
          <MenuItem value={NEW}>New glossary in {nearest}…</MenuItem>
        </TextField>
        {target === NEW && (
          <TextField size="small" label="Name of the new glossary (a field: 統計, machine-learning…)" value={newName} onChange={(e) => setNewName(e.target.value)} fullWidth sx={{ mt: 1 }}
            helperText={newName && slug(newName) !== newName ? `saved as “${slug(newName)}.md”` : `${nearest}/glossary/${slug(newName) || '…'}.md`} />
        )}
        {overriding && (
          <div style={{ fontSize: 12, color: 'var(--app-warning, #d4a017)', marginTop: 6 }}>
            The nearer glossary &quot;{overriding.name}&quot; reads it otherwise, and wins in this folder.
          </div>
        )}
        {pick?.ruby && (
          <FormControlLabel sx={{ mt: 1 }} control={<Checkbox size="small" checked={dropRuby} onChange={(e) => setDropRuby(e.target.checked)} />}
            label={<span style={{ fontSize: 13 }}>Remove this ruby from the script — the glossary reads it now (<code>{pick.ruby.text}</code> → <code>{pick.term}</code>)</span>} />
        )}
        <div style={{ fontSize: 12, color: 'var(--app-text-muted)', marginTop: 8 }}>
          Every deck under the glossary&apos;s folder reads the term so in the narration (auto-play, videos, rehearsal); captions and slides keep it as written. A ruby written in a script still wins.
        </div>
      </DialogContent>
      <DialogActions>
        {problem && <span style={{ fontSize: 12, color: 'var(--app-text-muted)', marginRight: 'auto', paddingLeft: 16 }}>Needs {problem}.</span>}
        <Button onClick={close} disabled={busy} sx={{ textTransform: 'none' }}>Cancel</Button>
        <Button variant="contained" onClick={() => void add()} disabled={busy || !!problem} className="mdp-add-glossary-ok" sx={{ textTransform: 'none' }}>Add</Button>
      </DialogActions>
    </Dialog>
  );
};
