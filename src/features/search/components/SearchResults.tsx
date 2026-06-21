import React from 'react';
import { Box, Typography, List, ListItem, ListItemButton, Chip } from '@mui/material';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import type { SearchResult, Snippet } from '../searchEngine';

interface SearchResultsProps {
  results: SearchResult[];
  onOpen: (path: string, slideIndex?: number) => void;
  activeTags: string[];
  onToggleTag: (tag: string) => void;
}

// Render a snippet, wrapping highlighted ranges in <mark>. Highlights are
// non-overlapping and sorted (searchEngine guarantees this).
const renderSnippet = (snippet: Snippet): React.ReactNode[] => {
  const out: React.ReactNode[] = [];
  let last = 0;
  snippet.highlights.forEach((h, i) => {
    if (h.start > last) out.push(<span key={`t${i}`}>{snippet.text.slice(last, h.start)}</span>);
    out.push(
      <mark key={`m${i}`} style={{ background: 'var(--app-accent-soft)', color: 'inherit', padding: 0, borderRadius: 2 }}>
        {snippet.text.slice(h.start, h.end)}
      </mark>,
    );
    last = h.end;
  });
  if (last < snippet.text.length) out.push(<span key="end">{snippet.text.slice(last)}</span>);
  return out;
};

export const SearchResults: React.FC<SearchResultsProps> = ({ results, onOpen, activeTags, onToggleTag }) => {
  if (results.length === 0) {
    return (
      <Typography variant="body2" sx={{ color: 'var(--app-text-disabled)', textAlign: 'center', p: 2 }}>
        No matching slides.
      </Typography>
    );
  }

  return (
    <List sx={{ p: 0 }}>
      {results.map(({ entry, snippet, matchedSlideIndex }) => {
        const title = entry.titleDisplay;
        return (
          <ListItem key={entry.path} disablePadding>
            <ListItemButton
              onClick={() => onOpen(entry.path, matchedSlideIndex)}
              sx={{ display: 'block', py: 0.75, '&:hover': { bgcolor: 'var(--app-bg-hover)' } }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <DescriptionOutlinedIcon fontSize="small" sx={{ color: 'var(--app-accent)', flexShrink: 0 }} />
                {title.kind === 'html' ? (
                  <Box
                    sx={{ color: 'var(--app-text)', fontSize: '0.85rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    dangerouslySetInnerHTML={{ __html: title.html }}
                  />
                ) : (
                  <Typography sx={{ color: 'var(--app-text)', fontSize: '0.85rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {title.kind === 'empty' ? entry.name : entry.name}
                  </Typography>
                )}
              </Box>

              {entry.subtitleDisplay && (
                <Box
                  sx={{ color: 'var(--app-text-secondary)', fontSize: '0.72rem', mt: 0.25, ml: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  dangerouslySetInnerHTML={{ __html: entry.subtitleDisplay }}
                />
              )}

              <Typography sx={{ color: 'var(--app-text-disabled)', fontSize: '0.64rem', ml: 3 }}>
                {entry.path}{matchedSlideIndex != null ? ` · slide ${matchedSlideIndex + 1}` : ''}
              </Typography>

              {snippet && (
                <Typography
                  component="div"
                  sx={{ color: 'var(--app-text-secondary)', fontSize: '0.7rem', mt: 0.25, ml: 3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                >
                  {renderSnippet(snippet)}
                </Typography>
              )}

              {entry.tags.length > 0 && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.25, mt: 0.4, ml: 3 }}>
                  {entry.tags.map((t) => {
                    const on = activeTags.includes(t);
                    return (
                      <Chip
                        key={t}
                        label={t}
                        size="small"
                        onClick={(e) => { e.stopPropagation(); onToggleTag(t); }}
                        variant={on ? 'filled' : 'outlined'}
                        sx={{
                          height: 16, fontSize: '0.6rem', cursor: 'pointer',
                          color: on ? 'var(--app-accent-contrast)' : 'var(--app-accent)',
                          bgcolor: on ? 'var(--app-accent)' : 'var(--app-accent-soft)',
                          borderColor: 'transparent',
                        }}
                      />
                    );
                  })}
                </Box>
              )}
            </ListItemButton>
          </ListItem>
        );
      })}
    </List>
  );
};
