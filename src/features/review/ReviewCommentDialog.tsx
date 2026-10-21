import React, { useState } from 'react';
import { Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, TextField } from '@mui/material';
import type { ReviewAspect, ReviewSeverity } from './reviewModel';

export interface CommentDraft { slideLabel: string; what: string }

const ASPECT_LABELS: [ReviewAspect, string][] = [
  ['clarity', 'Clarity — will the students understand it'],
  ['uptake', 'Uptake — not taken in yet, or forgotten by now'],
  ['accuracy', 'Accuracy'],
  ['effect', 'Effect — does it serve the lesson'],
  ['flow', 'Flow — the link from the slide before'],
  ['style', 'Style'],
  ['other', 'Other'],
];

/** A person's comment on what they pointed at: the words, what kind of problem, how
 *  bad, and whether it is a rule to keep (the AI then records it in the folder's
 *  skill and fixes every slide of the same kind). Ctrl+Enter adds it. */
export const ReviewCommentDialog: React.FC<{
  draft: CommentDraft | null;
  onCancel: () => void;
  onAdd: (c: { text: string; aspect: ReviewAspect; severity: ReviewSeverity; rule: boolean }) => void;
}> = ({ draft, onCancel, onAdd }) => {
  const [text, setText] = useState('');
  const [aspect, setAspect] = useState<ReviewAspect>('clarity');
  const [severity, setSeverity] = useState<ReviewSeverity>('minor');
  const [rule, setRule] = useState(false);
  const [shownFor, setShownFor] = useState<CommentDraft | null>(null);
  // A new draft starts empty (adjusted during render, not in an effect).
  if (draft !== shownFor) {
    setShownFor(draft);
    if (draft) { setText(''); setAspect('clarity'); setSeverity('minor'); setRule(false); }
  }
  const add = () => { if (text.trim()) onAdd({ text: text.trim(), aspect, severity, rule }); };
  return (
    <Dialog open={!!draft} onClose={onCancel} maxWidth="sm" fullWidth className="mdp-review-comment-dialog">
      <DialogTitle sx={{ pb: 0.5 }}>Comment on {draft?.slideLabel}</DialogTitle>
      <DialogContent>
        {draft?.what && <div style={{ fontSize: 12.5, color: 'var(--app-text-muted)', marginBottom: 8, wordBreak: 'break-all' }}>{draft.what}</div>}
        <TextField
          autoFocus multiline minRows={3} fullWidth placeholder="What is wrong for the students, and how it could be better…"
          value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); add(); } }}
        />
        <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField select size="small" label="Aspect" value={aspect} onChange={(e) => setAspect(e.target.value as ReviewAspect)} sx={{ minWidth: 240 }}>
            {ASPECT_LABELS.map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value as ReviewSeverity)} sx={{ minWidth: 120 }}>
            <MenuItem value="major">Major</MenuItem>
            <MenuItem value="minor">Minor</MenuItem>
            <MenuItem value="nit">Nit</MenuItem>
          </TextField>
          <FormControlLabel
            control={<Checkbox size="small" checked={rule} onChange={(e) => setRule(e.target.checked)} />}
            label={<span title="The AI records it in the folder's slide skill and fixes every slide of the same kind">Keep as a rule</span>}
          />
        </div>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="contained" onClick={add} disabled={!text.trim()}>Add</Button>
      </DialogActions>
    </Dialog>
  );
};
