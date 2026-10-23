import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Button, CircularProgress, Stack, TextField, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { apiClient } from '../../api/apiClient';
import { notify, reportError } from '../../components/error/errorReporter';
import type { GlossaryFile } from './glossary';
import { GlossaryTermsEditor } from './GlossaryTermsEditor';

// "Glossaries (this folder)" in the Configure (.mdp) dialog: how the narrator reads a
// field's terms (`glossary/<name>.md`, a table of 用語 | 読み) — every deck beneath
// this folder reads them so, without a ruby in its script. Lists the cascade,
// creates one from a template, edits its terms in a table (GlossaryTermsEditor; a
// parent's read-only), opens one in the editor, removes one. Everything writes
// immediately (glossaries are files, not dialog content).

interface Props {
  configDir: string;                 // the `.mdp` being configured
  chain: string[];                   // its cascade chain (root→nearest, ending with configDir)
  onOpenFile?: (path: string) => void;
}

const fieldSx = {
  '& .MuiInputBase-input': { color: 'var(--app-text)', fontSize: '0.85rem' },
  '& .MuiInputLabel-root': { color: 'var(--app-text-disabled)' },
  '& .MuiInputLabel-root.Mui-focused': { color: 'var(--app-accent)' },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--app-border-subtle)' },
};
const hintSx = { fontSize: '0.72rem', color: 'var(--app-text-disabled)' };
const linkBtnSx = { textTransform: 'none' as const, minWidth: 0, color: 'var(--app-text-muted)' };

const GLOSSARY_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N}_.-]{0,63}$/u;
const slug = (s: string) => s.trim().replace(/\.md$/i, '').replace(/[\s/\\]+/g, '-').replace(/[^\p{L}\p{N}_.-]/gu, '');

/** A new glossary: frontmatter, how to write it, an empty table. */
const glossaryTemplate = (name: string): string => [
  '---',
  `description: ${name} の用語の読み`,
  'lang: ja',
  '---',
  '',
  `# ${name}`,
  '',
  '読み上げで用語をどう読むかの表です．ここにある用語は，台本にルビ（`[[SHAP|シャップ]]`）を書かなくても',
  'この読みで読まれます（台本に書いたルビが優先）．このフォルダの下のデッキすべてに効きます．',
  '',
  '```',
  '| SHAP | シャップ | 説明手法 |',
  '| Shapley値 | シャプレーち | |',
  '```',
  '',
  '| 用語 | 読み | メモ |',
  '|---|---|---|',
  '',
].join('\n');

export const GlossarySection: React.FC<Props> = ({ configDir, chain, onOpenFile }) => {
  const [files, setFiles] = useState<GlossaryFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const chainKey = chain.join('\n');

  useEffect(() => {
    let cancelled = false;
    apiClient.getGlossaries(chainKey.split('\n'))
      .then((list) => { if (!cancelled) setFiles(list || []); })
      .catch((e) => { console.error('Failed to list glossaries', e); if (!cancelled) setFiles([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [chainKey, epoch]);
  const reload = useCallback(() => setEpoch((e) => e + 1), []);
  const changed = () => {
    window.dispatchEvent(new CustomEvent('mdp-refresh-tree'));
    window.dispatchEvent(new CustomEvent('mdp-glossary-changed'));
  };

  // The same term read differently by two glossaries of one language (the nearer wins).
  const conflicts = useMemo(() => {
    const seen = new Map<string, { reading: string; from: string }>();
    const out: string[] = [];
    for (const f of files) for (const t of f.terms) {
      const key = `${(f.lang || '').toLowerCase().split(/[-_]/)[0]}\u0000${t.term}`;
      const prev = seen.get(key);
      if (prev && prev.reading !== t.reading) out.push(`${t.term}: ${prev.from} 「${prev.reading}」 → ${f.name} 「${t.reading}」`);
      seen.set(key, { reading: t.reading, from: f.name });
    }
    return out;
  }, [files]);

  const create = async () => {
    if (draft === null || busy) return;
    const name = slug(draft);
    if (!GLOSSARY_NAME_RE.test(name)) { reportError('Give the glossary a name (letters, digits, - _ .).'); return; }
    if (files.some((f) => f.configDir === configDir && f.name.toLowerCase() === name.toLowerCase())) {
      reportError(`This folder already has a glossary "${name}".`, { severity: 'warning' });
      return;
    }
    const path = `${configDir}/glossary/${name}.md`;
    setBusy(true);
    try {
      await apiClient.saveFile(path, glossaryTemplate(name));
      notify(`Created the glossary "${name}" — add its terms below.`);
      setDraft(null);
      reload();
      changed();
      setEditing(path);
    } catch (e) {
      reportError('Could not create the glossary — this .mdp may be read-only.', { detail: e });
    } finally { setBusy(false); }
  };

  const remove = async (f: GlossaryFile) => {
    if (busy) return;
    if (!window.confirm(`Delete the glossary "${f.name}" (${f.path})? Its ${f.terms.length} term(s) will be read as written again.`)) return;
    setBusy(true);
    try {
      await apiClient.deleteFiles([f.path]);
      reload();
      changed();
    } catch (e) {
      reportError('Could not delete the glossary — this .mdp may be read-only.', { detail: e });
    } finally { setBusy(false); }
  };

  return (
    <>
      <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--app-text-strong)', mt: 2, mb: 0.5 }}>Glossaries (this folder)</Typography>
      <Typography sx={{ ...hintSx, mb: 1 }}>
        How the narrator reads your field&apos;s terms (<em>SHAP → シャップ</em>) — one file per field,
        <code> glossary/&lt;name&gt;.md</code>, a table of <code>用語 | 読み</code>. Every deck beneath this folder reads them so in
        the auto-play, the videos and the rehearsal, with no ruby in its script (a ruby written there still wins). Glossaries
        cascade like the other <code>.mdp</code> assets: a nearer folder&apos;s glossary of the same name replaces a parent&apos;s,
        and on a term the nearer one wins. Edit the terms here (<em>Edit terms</em>), or while writing a script: select a word
        and use the editor&apos;s <em>Add to glossary…</em> (Ctrl+Alt+Y). An AI can add terms through MCP (<code>patch_glossary</code>).
      </Typography>

      <Box sx={{ border: '1px solid var(--app-border)', borderRadius: 1.5, overflow: 'hidden', bgcolor: 'var(--app-bg-elevated)' }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 1.5 }}><CircularProgress size={18} sx={{ color: 'var(--app-accent)' }} /></Box>
        ) : files.length === 0 ? (
          <Typography sx={{ px: 1.5, py: 1.25, color: 'var(--app-text-disabled)', fontSize: '0.8rem' }}>
            No glossaries yet — every reading comes from the TTS engine or a ruby in the script.
          </Typography>
        ) : files.map((f) => {
          const mine = f.configDir === configDir;
          return (
            <Box key={f.path} sx={{ px: 1.5, py: 0.75, borderBottom: '1px solid var(--app-border-subtle)' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                <span style={{ fontWeight: 600, color: 'var(--app-text-strong)', minWidth: 120 }}>{f.name}</span>
                <span style={{ flex: 1, fontSize: '0.72rem', color: 'var(--app-text-disabled)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {mine ? 'this folder' : `from ${f.configDir}`} — {f.terms.length} term{f.terms.length === 1 ? '' : 's'}
                  {f.lang ? ` · for ${f.lang} lines${f.langInferred ? ' (from its readings)' : ''}` : ' · every language'}
                </span>
                <Button size="small" onClick={() => setEditing((x) => (x === f.path ? null : f.path))} sx={linkBtnSx} className="mdp-glossary-edit">
                  {editing === f.path ? 'Close' : mine ? 'Edit terms' : 'View terms'}
                </Button>
                {onOpenFile && <Button size="small" onClick={() => onOpenFile(f.path)} sx={linkBtnSx}>Open</Button>}
                {mine && <Button size="small" onClick={() => remove(f)} disabled={busy} sx={linkBtnSx}>Remove</Button>}
              </Box>
              {(f.description || f.problems.length > 0) && (
                <Typography sx={{ ...hintSx, mt: 0.25 }}>
                  {f.description}
                  {f.problems.length > 0 && (
                    <span style={{ color: 'var(--app-danger, #e57373)' }}>{f.description ? ' — ' : ''}{f.problems.slice(0, 3).join('; ')}{f.problems.length > 3 ? ` (+${f.problems.length - 3})` : ''}</span>
                  )}
                </Typography>
              )}
              {editing === f.path && <GlossaryTermsEditor key={`${f.path}:${epoch}`} file={f} editable={mine} onSaved={() => reload()} />}
            </Box>
          );
        })}
      </Box>
      {conflicts.length > 0 && (
        <Typography sx={{ ...hintSx, mt: 0.5, color: 'var(--app-warning, #d4a017)' }}>
          Read differently by two glossaries (the later one wins): {conflicts.slice(0, 4).join(' · ')}{conflicts.length > 4 ? ` (+${conflicts.length - 4})` : ''}
        </Typography>
      )}

      {draft !== null ? (
        <Box sx={{ mt: 1, p: 1.25, border: '1px solid var(--app-border-strong)', borderRadius: 1.5, bgcolor: 'var(--app-bg-elevated)' }}>
          <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: 'center' }}>
            <TextField label="Glossary name (a field: machine-learning, 統計…)" size="small" value={draft} autoFocus
              onChange={(e) => setDraft(e.target.value)}
              helperText={draft && slug(draft) !== draft ? `saved as “${slug(draft)}.md”` : ' '}
              sx={{ ...fieldSx, flex: 1, '& .MuiFormHelperText-root': { color: 'var(--app-text-disabled)', m: 0 } }} />
          </Stack>
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="contained" onClick={create} disabled={busy || !slug(draft)}
              sx={{ textTransform: 'none', bgcolor: 'var(--app-accent)' }}>
              Create
            </Button>
            <Button size="small" onClick={() => setDraft(null)} sx={{ textTransform: 'none', color: 'var(--app-text-muted)' }}>Cancel</Button>
          </Stack>
        </Box>
      ) : (
        <Button size="small" variant="outlined" disabled={busy} onClick={() => setDraft('')}
          startIcon={<AddIcon fontSize="small" />}
          sx={{ mt: 1, textTransform: 'none', color: 'var(--app-text-secondary)', borderColor: 'var(--app-border-strong)' }}>
          New glossary…
        </Button>
      )}
    </>
  );
};
