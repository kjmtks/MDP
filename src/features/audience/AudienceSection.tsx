import React, { useCallback, useEffect, useState } from 'react';
import { Box, Button, CircularProgress, Stack, TextField, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { apiClient } from '../../api/apiClient';
import { notify, reportError } from '../../components/error/errorReporter';
import { AUDIENCE_NAME_RE, audienceTemplate, type AudiencePersona } from './audience';

// "Audience (this folder)" in the Configure (.mdp) dialog: who the decks beneath this
// folder are for — one persona per file (`audience/<name>.md`): who they are, what
// they already know, where they stumble, how much they can hold, what has worked for
// them. Authors (people and AIs) write for them; an AI reviewer reads a deck as each
// of them would. Lists the cascade, creates one from a template, opens, removes.

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
const slug = (s: string) => s.trim().replace(/\.md$/i, '').replace(/[\s/\\]+/g, '-').replace(/[^\p{L}\p{N}_.-]/gu, '');

export const AudienceSection: React.FC<Props> = ({ configDir, chain, onOpenFile }) => {
  const [list, setList] = useState<AudiencePersona[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const chainKey = chain.join('\n');

  useEffect(() => {
    let cancelled = false;
    apiClient.getAudience(chainKey.split('\n'))
      .then((l) => { if (!cancelled) setList(l || []); })
      .catch((e) => { console.error('Failed to list the audience', e); if (!cancelled) setList([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [chainKey, epoch]);
  const reload = useCallback(() => setEpoch((e) => e + 1), []);
  const changed = () => window.dispatchEvent(new CustomEvent('mdp-refresh-tree'));

  const create = async () => {
    if (draft === null || busy) return;
    const name = slug(draft);
    if (!AUDIENCE_NAME_RE.test(name)) { reportError('Give the persona a name (letters, digits, - _ .).'); return; }
    if (list.some((p) => p.configDir === configDir && p.name.toLowerCase() === name.toLowerCase())) {
      reportError(`This folder already has a persona "${name}".`, { severity: 'warning' });
      return;
    }
    const path = `${configDir}/audience/${name}.md`;
    setBusy(true);
    try {
      await apiClient.saveFile(path, audienceTemplate(name));
      notify(`Created the persona "${name}" — describe them in the editor.`);
      setDraft(null);
      reload();
      changed();
      onOpenFile?.(path);
    } catch (e) {
      reportError('Could not create the persona — this .mdp may be read-only.', { detail: e });
    } finally { setBusy(false); }
  };

  const remove = async (p: AudiencePersona) => {
    if (busy) return;
    if (!window.confirm(`Delete the persona "${p.name}" (${p.path})?`)) return;
    setBusy(true);
    try {
      await apiClient.deleteFiles([p.path]);
      reload();
      changed();
    } catch (e) {
      reportError('Could not delete the persona — this .mdp may be read-only.', { detail: e });
    } finally { setBusy(false); }
  };

  return (
    <>
      <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--app-text-strong)', mt: 2, mb: 0.5 }}>Audience (this folder)</Typography>
      <Typography sx={{ ...hintSx, mb: 1 }}>
        Who the decks beneath this folder are for — the students of a course, the listeners of a talk. One persona per file,
        <code> audience/&lt;name&gt;.md</code>: who they are, what they already know, where they stumble, how much they can
        hold in mind, what has worked for them. AIs write for them (the slide spec carries them), and an AI reviewer reads a
        deck as each of them would (<code>primary: true</code> first). Unlike glossaries, the audience is not added up: the nearest
        folder that has personas defines it whole, and its parents&apos; no longer apply; a folder without any inherits its parent&apos;s.
        An AI can write one through MCP (<code>write_audience</code>).
      </Typography>

      {!loading && list.length > 0 && list[0].configDir !== configDir && (
        <Typography sx={{ ...hintSx, mb: 0.5, color: 'var(--app-text-muted)' }}>
          Inherited from <code>{list[0].configDir}</code> — a persona made here gives this folder its own audience (the inherited ones then stop applying).
        </Typography>
      )}
      <Box sx={{ border: '1px solid var(--app-border)', borderRadius: 1.5, overflow: 'hidden', bgcolor: 'var(--app-bg-elevated)' }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 1.5 }}><CircularProgress size={18} sx={{ color: 'var(--app-accent)' }} /></Box>
        ) : list.length === 0 ? (
          <Typography sx={{ px: 1.5, py: 1.25, color: 'var(--app-text-disabled)', fontSize: '0.8rem' }}>
            No persona yet — a reviewer then guesses who the students are.
          </Typography>
        ) : list.map((p) => {
          const mine = p.configDir === configDir;
          return (
            <Box key={p.path} className="mdp-audience-row" sx={{ px: 1.5, py: 0.75, borderBottom: '1px solid var(--app-border-subtle)' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                <span style={{ fontWeight: 600, color: 'var(--app-text-strong)', minWidth: 120 }}>{p.name}</span>
                {p.primary && <span style={{ fontSize: '0.68rem', padding: '0 6px', borderRadius: 8, border: '1px solid var(--app-accent)', color: 'var(--app-accent)' }}>primary</span>}
                <span style={{ flex: 1, fontSize: '0.72rem', color: 'var(--app-text-disabled)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {mine ? 'this folder' : `from ${p.configDir}`}
                </span>
                {onOpenFile && <Button size="small" onClick={() => onOpenFile(p.path)} sx={linkBtnSx}>Open</Button>}
                {mine && <Button size="small" onClick={() => remove(p)} disabled={busy} sx={linkBtnSx}>Remove</Button>}
              </Box>
              {p.description && <Typography sx={{ ...hintSx, mt: 0.25 }}>{p.description}</Typography>}
              {p.problem && <Typography sx={{ ...hintSx, mt: 0.25, color: 'var(--app-danger, #e57373)' }}>{p.problem}</Typography>}
            </Box>
          );
        })}
      </Box>

      {draft !== null ? (
        <Box sx={{ mt: 1, p: 1.25, border: '1px solid var(--app-border-strong)', borderRadius: 1.5, bgcolor: 'var(--app-bg-elevated)' }}>
          <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: 'center' }}>
            <TextField label="Persona name (学部2年, 同僚の研究者…)" size="small" value={draft} autoFocus
              onChange={(e) => setDraft(e.target.value)}
              helperText={draft && slug(draft) !== draft ? `saved as “${slug(draft)}.md”` : ' '}
              sx={{ ...fieldSx, flex: 1, '& .MuiFormHelperText-root': { color: 'var(--app-text-disabled)', m: 0 } }} />
          </Stack>
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="contained" onClick={create} disabled={busy || !slug(draft)}
              sx={{ textTransform: 'none', bgcolor: 'var(--app-accent)' }}>
              Create &amp; open
            </Button>
            <Button size="small" onClick={() => setDraft(null)} sx={{ textTransform: 'none', color: 'var(--app-text-muted)' }}>Cancel</Button>
          </Stack>
        </Box>
      ) : (
        <Button size="small" variant="outlined" disabled={busy} onClick={() => setDraft('')}
          startIcon={<AddIcon fontSize="small" />}
          sx={{ mt: 1, textTransform: 'none', color: 'var(--app-text-secondary)', borderColor: 'var(--app-border-strong)' }}>
          New persona…
        </Button>
      )}
    </>
  );
};
