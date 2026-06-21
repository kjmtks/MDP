import React, { useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Autocomplete, Chip, TextField } from '@mui/material';

interface TagSettingsDialogProps {
  open: boolean;
  initialTags: string[];
  suggestedTags: string[];
  onClose: () => void;
  onSave: (tags: string[]) => void;
}

// Tag-editing dialog launched from the 🏷 button on the editor's `<!-- @tags … -->`
// directive (TagSettingsPlugin). Chips + autocomplete seeded from all known tags;
// Save writes back to the meta page via upsertTags. Mounted only while open (keyed
// by the caller) so `initialTags` seeds local state fresh on each open.
export const TagSettingsDialog: React.FC<TagSettingsDialogProps> = ({
  open, initialTags, suggestedTags, onClose, onSave,
}) => {
  const [tags, setTags] = useState<string[]>(initialTags);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      slotProps={{ paper: { sx: { bgcolor: 'var(--app-bg-panel)', color: 'var(--app-text-secondary)', backgroundImage: 'none' } } }}
    >
      <DialogTitle sx={{ fontSize: '0.95rem' }}>Deck tags</DialogTitle>
      <DialogContent>
        <Autocomplete
          multiple
          freeSolo
          size="small"
          options={suggestedTags}
          value={tags}
          onChange={(_e, v) => setTags((v as string[]).map((t) => t.trim()).filter(Boolean))}
          renderTags={(value, getTagProps) =>
            value.map((option, index) => (
              <Chip
                {...getTagProps({ index })}
                key={option}
                label={option}
                size="small"
                sx={{ color: 'var(--app-accent)', bgcolor: 'var(--app-accent-soft)' }}
              />
            ))
          }
          renderInput={(params) => (
            <TextField
              {...params}
              autoFocus
              placeholder="Add tag + Enter"
              variant="outlined"
              sx={{ mt: 1, '& .MuiInputBase-input': { color: 'var(--app-text-secondary)' } }}
            />
          )}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ color: 'var(--app-text-muted)' }}>Cancel</Button>
        <Button onClick={() => onSave(tags)} variant="contained">Save</Button>
      </DialogActions>
    </Dialog>
  );
};
