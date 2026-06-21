import React from 'react';
import { Box, TextField, InputAdornment, Chip, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import type { IndexStatus } from '../deckIndexStore';

interface SearchBoxProps {
  query: string;
  onQueryChange: (q: string) => void;
  suggestedTags: string[];
  activeTags: string[];
  onToggleTag: (tag: string) => void;
  status: IndexStatus;
  placeholder?: string;
}

// Search field + clickable tag chips. Active (selected) tags render filled; the
// rest are suggestions from the deck index. Mirrors the SnippetsPanel field style.
export const SearchBox: React.FC<SearchBoxProps> = ({
  query, onQueryChange, suggestedTags, activeTags, onToggleTag, status, placeholder,
}) => {
  const isActive = (t: string) => activeTags.includes(t);
  // Active tags first, then the remaining suggestions.
  const ordered = [...activeTags, ...suggestedTags.filter((t) => !isActive(t))];

  return (
    <Box sx={{ p: 0.75, borderBottom: '1px solid var(--app-border)', flexShrink: 0 }}>
      <TextField
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder={placeholder || 'Search slides…'}
        size="small"
        fullWidth
        variant="outlined"
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" sx={{ color: 'var(--app-text-disabled)' }} />
              </InputAdornment>
            ),
            sx: {
              color: 'var(--app-text-secondary)', fontSize: '0.8rem', bgcolor: 'var(--app-bg-editor)',
              '& fieldset': { borderColor: 'var(--app-border-subtle)' },
              '&:hover fieldset': { borderColor: 'var(--app-border-strong)' },
            },
          },
        }}
      />
      {ordered.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.75, maxHeight: 88, overflowY: 'auto' }}>
          {ordered.map((tag) => {
            const on = isActive(tag);
            return (
              <Chip
                key={tag}
                label={tag}
                size="small"
                onClick={() => onToggleTag(tag)}
                variant={on ? 'filled' : 'outlined'}
                sx={{
                  height: 20, fontSize: '0.68rem', cursor: 'pointer',
                  color: on ? 'var(--app-accent-contrast)' : 'var(--app-accent)',
                  bgcolor: on ? 'var(--app-accent)' : 'transparent',
                  borderColor: 'var(--app-accent)',
                  '&:hover': { bgcolor: on ? 'var(--app-accent)' : 'var(--app-accent-soft)' },
                }}
              />
            );
          })}
        </Box>
      )}
      {status === 'indexing' && (
        <Typography sx={{ color: 'var(--app-text-disabled)', fontSize: '0.66rem', mt: 0.5 }}>Indexing…</Typography>
      )}
    </Box>
  );
};
