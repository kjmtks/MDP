import React from 'react';
import { Box, Autocomplete, Chip, TextField, Typography } from '@mui/material';
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined';

interface TagEditorProps {
  tags: string[];
  suggestedTags: string[];
  canEdit: boolean;
  onChange: (tags: string[]) => void;
}

// Compact chip/autocomplete editor for the CURRENT deck's `@tags`. Editable only
// when the deck is the active editor tab (canEdit); otherwise shown read-only with
// a hint. Mirrors the ImagesPanel tag Autocomplete. Writes back via onChange →
// upsertTags on the meta page.
export const TagEditor: React.FC<TagEditorProps> = ({ tags, suggestedTags, canEdit, onChange }) => {
  return (
    <Box sx={{ px: 0.75, py: 0.75, borderBottom: '1px solid var(--app-border)', flexShrink: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
        <LocalOfferOutlinedIcon fontSize="small" sx={{ color: 'var(--app-text-disabled)' }} />
        <Typography sx={{ color: 'var(--app-text-disabled)', fontSize: '0.7rem' }}>Tags</Typography>
      </Box>
      {canEdit ? (
        <Autocomplete
          multiple
          freeSolo
          size="small"
          options={suggestedTags}
          value={tags}
          onChange={(_e, v) => onChange((v as string[]).map((t) => t.trim()).filter(Boolean))}
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
              placeholder="Add tag + Enter"
              variant="outlined"
              sx={{ '& .MuiInputBase-input': { color: 'var(--app-text-secondary)', fontSize: '0.8rem' } }}
            />
          )}
        />
      ) : tags.length > 0 ? (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {tags.map((t) => (
            <Chip key={t} label={t} size="small" sx={{ height: 20, fontSize: '0.68rem', color: 'var(--app-accent)', bgcolor: 'var(--app-accent-soft)' }} />
          ))}
        </Box>
      ) : (
        <Typography sx={{ color: 'var(--app-text-disabled)', fontSize: '0.68rem', fontStyle: 'italic' }}>
          Open this deck to edit its tags.
        </Typography>
      )}
    </Box>
  );
};
