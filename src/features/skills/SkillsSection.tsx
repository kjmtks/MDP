import React, { useCallback, useEffect, useState } from 'react';
import { Box, Button, CircularProgress, Stack, TextField, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { apiClient } from '../../api/apiClient';
import { notify, reportError } from '../../components/error/errorReporter';
import type { SlideSkill } from './skillTypes';
import { SKILL_NAME_RE, setFrontmatterScalar, skillSlug, skillTemplate, type SkillTemplateKind } from './skillTemplates';

// "Slide skills (this folder)" in the Configure (.mdp) dialog: the author's guides
// an AI follows when it makes slides for decks beneath this folder through MCP
// (`skills/<name>/SKILL.md`, Agent Skills format). Lists the cascade, creates a
// skill from a template, opens one in the editor, toggles "always", removes one.
// Everything writes immediately (skills are files, not dialog content).

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
const selectStyle: React.CSSProperties = {
  flex: 1, minWidth: 0, padding: '4px 6px', borderRadius: 4, fontSize: '0.8rem',
  background: 'var(--app-bg-elevated)', color: 'var(--app-text)', border: '1px solid var(--app-border-subtle)',
};
const hintSx = { fontSize: '0.72rem', color: 'var(--app-text-disabled)' };
const linkBtnSx = { textTransform: 'none' as const, minWidth: 0, color: 'var(--app-text-muted)' };

interface Draft { name: string; kind: SkillTemplateKind; always: boolean }

export const SkillsSection: React.FC<Props> = ({ configDir, chain, onOpenFile }) => {
  const [skills, setSkills] = useState<SlideSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [epoch, setEpoch] = useState(0);
  const chainKey = chain.join('\n');

  useEffect(() => {
    let cancelled = false;
    apiClient.getSkills(chainKey.split('\n'))
      .then((list) => { if (!cancelled) setSkills(list); })
      .catch((e) => { console.error('Failed to list skills', e); if (!cancelled) setSkills([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [chainKey, epoch]);
  const reload = useCallback(() => setEpoch((e) => e + 1), []);

  const refreshTree = () => window.dispatchEvent(new CustomEvent('mdp-refresh-tree'));

  const create = async () => {
    if (!draft || busy) return;
    const name = skillSlug(draft.name);
    if (!SKILL_NAME_RE.test(name)) { reportError('Give the skill a name (letters, digits, - and _).'); return; }
    const path = `${configDir}/skills/${name}/SKILL.md`;
    if (skills.some((s) => s.configDir === configDir && s.name.toLowerCase() === name)) {
      reportError(`This folder already has a skill "${name}".`, { severity: 'warning' });
      return;
    }
    setBusy(true);
    try {
      await apiClient.saveFile(path, skillTemplate(name, draft.kind, draft.always));
      notify(`Created the skill "${name}" — edit it in the editor.`);
      setDraft(null);
      reload();
      refreshTree();
      onOpenFile?.(path);
    } catch (e) {
      reportError('Could not create the skill — this .mdp may be read-only.', { detail: e });
    } finally { setBusy(false); }
  };

  const setAlways = async (s: SlideSkill, always: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const text = await apiClient.readFileText(s.path);
      await apiClient.saveFile(s.path, setFrontmatterScalar(text, 'always', always));
      reload();
    } catch (e) {
      reportError('Could not update the skill.', { detail: e });
    } finally { setBusy(false); }
  };

  const remove = async (s: SlideSkill) => {
    if (busy) return;
    if (!window.confirm(`Delete the skill "${s.name}" (${s.dir})? AIs will no longer follow it for decks beneath this folder.`)) return;
    setBusy(true);
    try {
      await apiClient.deleteFiles([s.dir]);
      reload();
      refreshTree();
    } catch (e) {
      reportError('Could not delete the skill — this .mdp may be read-only.', { detail: e });
    } finally { setBusy(false); }
  };

  return (
    <>
      <Typography sx={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--app-text-strong)', mt: 2, mb: 0.5 }}>Slide skills (this folder)</Typography>
      <Typography sx={{ ...hintSx, mb: 1 }}>
        Your guides for making slides here — how to phrase titles, how dense a slide may be, how to show math and figures,
        which modules to use — kept as <code>skills/&lt;name&gt;/SKILL.md</code>. An AI authoring through MCP gets the list
        with the slide spec, reads the ones that fit before writing, and checks its deck against each skill&apos;s
        <em> Checklist</em>. <em>Always</em> puts a skill&apos;s whole text into the spec (for the main guide). Skills cascade
        like the other <code>.mdp</code> assets (a nearer skill of the same name replaces a parent&apos;s); the AI can also add
        rules you give it (<code>patch_skill</code>). Same format as Agent Skills, so a skill also works in Claude Code.
      </Typography>

      <Box sx={{ border: '1px solid var(--app-border)', borderRadius: 1.5, overflow: 'hidden', bgcolor: 'var(--app-bg-elevated)' }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 1.5 }}><CircularProgress size={18} sx={{ color: 'var(--app-accent)' }} /></Box>
        ) : skills.length === 0 ? (
          <Typography sx={{ px: 1.5, py: 1.25, color: 'var(--app-text-disabled)', fontSize: '0.8rem' }}>
            No skills yet — AIs follow only the generic slide spec here. Start from the expression guide below.
          </Typography>
        ) : skills.map((s) => {
          const mine = s.configDir === configDir;
          return (
            <Box key={s.path} sx={{ px: 1.5, py: 0.75, borderBottom: '1px solid var(--app-border-subtle)' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                <span style={{ fontWeight: 600, color: 'var(--app-text-strong)', minWidth: 120 }}>{s.name}</span>
                {mine ? (
                  <Box component="label" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ...hintSx, cursor: 'pointer', minWidth: 70 }}>
                    <input type="checkbox" checked={s.always} disabled={busy} onChange={(e) => setAlways(s, e.target.checked)} />
                    always
                  </Box>
                ) : (
                  <span style={{ ...hintSx, minWidth: 70 }}>{s.always ? 'always' : ''}</span>
                )}
                <span style={{ flex: 1, fontSize: '0.72rem', color: 'var(--app-text-disabled)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {mine ? 'this folder' : `from ${s.configDir}`}
                  {s.checklist.length ? ` — ${s.checklist.length} checklist item${s.checklist.length > 1 ? 's' : ''}` : ' — no checklist'}
                </span>
                {onOpenFile && <Button size="small" onClick={() => onOpenFile(s.path)} sx={linkBtnSx}>Open</Button>}
                {mine && <Button size="small" onClick={() => remove(s)} disabled={busy} sx={linkBtnSx}>Remove</Button>}
              </Box>
              <Typography sx={{ ...hintSx, mt: 0.25, color: s.problem || !s.description ? 'var(--app-danger, #e57373)' : hintSx.color }}>
                {s.problem || s.description || 'No description — the AI cannot tell when to read it. Add one to the frontmatter.'}
              </Typography>
            </Box>
          );
        })}
      </Box>

      {draft ? (
        <Box sx={{ mt: 1, p: 1.25, border: '1px solid var(--app-border-strong)', borderRadius: 1.5, bgcolor: 'var(--app-bg-elevated)' }}>
          <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: 'center' }}>
            <TextField label="Skill name (folder)" size="small" value={draft.name} autoFocus
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              helperText={draft.name && skillSlug(draft.name) !== draft.name ? `saved as “${skillSlug(draft.name)}”` : ' '}
              sx={{ ...fieldSx, flex: 1, '& .MuiFormHelperText-root': { color: 'var(--app-text-disabled)', m: 0 } }} />
            <select value={draft.kind} style={{ ...selectStyle, flex: 1, alignSelf: 'flex-start', marginTop: 4 }}
              onChange={(e) => {
                const kind = e.target.value as SkillTemplateKind;
                setDraft({ ...draft, kind, always: kind === 'starter' });
              }}>
              <option value="starter">Slide expression guide (日本語)</option>
              <option value="blank">Empty skill</option>
            </select>
          </Stack>
          <Box component="label" sx={{ display: 'flex', gap: 1, alignItems: 'center', ...hintSx, mb: 1, cursor: 'pointer' }}>
            <input type="checkbox" checked={draft.always} onChange={(e) => setDraft({ ...draft, always: e.target.checked })} />
            <span>Always include its whole text in the slide spec (for this folder&apos;s main guide; keep it short)</span>
          </Box>
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="contained" onClick={create} disabled={busy || !skillSlug(draft.name)}
              sx={{ textTransform: 'none', bgcolor: 'var(--app-accent)' }}>
              Create &amp; open
            </Button>
            <Button size="small" onClick={() => setDraft(null)} sx={{ textTransform: 'none', color: 'var(--app-text-muted)' }}>Cancel</Button>
          </Stack>
        </Box>
      ) : (
        <Button size="small" variant="outlined" disabled={busy}
          onClick={() => setDraft({ name: skills.some((s) => s.name === 'slide-expression') ? '' : 'slide-expression', kind: 'starter', always: true })}
          startIcon={<AddIcon fontSize="small" />}
          sx={{ mt: 1, textTransform: 'none', color: 'var(--app-text-secondary)', borderColor: 'var(--app-border-strong)' }}>
          New skill…
        </Button>
      )}
    </>
  );
};
