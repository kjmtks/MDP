import React from 'react';
import { Box, TextField, InputAdornment, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import type { IndexStatus } from '../deckIndexStore';

interface SearchBoxProps {
  query: string;
  onQueryChange: (q: string) => void;
  status: IndexStatus;
  placeholder?: string;
}

// The slide search field. Mirrors the SnippetsPanel field style.
export const SearchBox: React.FC<SearchBoxProps> = ({ query, onQueryChange, status, placeholder }) => (
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
    {status === 'indexing' && (
      <Typography sx={{ color: 'var(--app-text-disabled)', fontSize: '0.66rem', mt: 0.5 }}>Indexing…</Typography>
    )}
  </Box>
);
