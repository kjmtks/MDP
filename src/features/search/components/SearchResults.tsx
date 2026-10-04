import React, { useState } from 'react';
import { Box, Typography, List, ListItem, ListItemButton, Button } from '@mui/material';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import type { DeckResult, Snippet } from '../searchEngine';

interface SearchResultsProps {
  results: DeckResult[];
  onOpen: (path: string, slideIndex?: number) => void;
}

// Matching slides listed per deck before "+N more".
const PER_DECK = 8;

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

const oneLine = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;

// Each deck (its title and path) with its matching slides beneath it: the slide's
// place in the deck, its heading and the text around the match. A click opens the
// deck at that slide (the deck row: at its first match).
export const SearchResults: React.FC<SearchResultsProps> = ({ results, onOpen }) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  if (results.length === 0) {
    return (
      <Typography variant="body2" sx={{ color: 'var(--app-text-disabled)', textAlign: 'center', p: 2 }}>
        No matching slides.
      </Typography>
    );
  }
  const slideCount = results.reduce((n, r) => n + r.hits.length, 0);

  return (
    <>
      <Typography sx={{ color: 'var(--app-text-disabled)', fontSize: '0.66rem', px: 1.25, pt: 0.75 }}>
        {slideCount} slide{slideCount === 1 ? '' : 's'} in {results.length} deck{results.length === 1 ? '' : 's'}
      </Typography>
      <List sx={{ p: 0 }}>
        {results.map(({ entry, hits }) => {
          const title = entry.titleDisplay;
          const open = expanded.has(entry.path);
          const shown = open ? hits : hits.slice(0, PER_DECK);
          return (
            <ListItem key={entry.path} disablePadding sx={{ display: 'block', borderBottom: '1px solid var(--app-border-subtle)' }}>
              <ListItemButton
                onClick={() => onOpen(entry.path, hits[0]?.slide.index ?? 0)}
                sx={{ display: 'block', py: 0.6, '&:hover': { bgcolor: 'var(--app-bg-hover)' } }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <DescriptionOutlinedIcon fontSize="small" sx={{ color: 'var(--app-accent)', flexShrink: 0 }} />
                  {title.kind === 'html' ? (
                    <Box sx={{ color: 'var(--app-text)', fontSize: '0.85rem', fontWeight: 600, ...oneLine }}
                      dangerouslySetInnerHTML={{ __html: title.html }} />
                  ) : (
                    <Typography sx={{ color: 'var(--app-text)', fontSize: '0.85rem', fontWeight: 600, ...oneLine }}>{entry.name}</Typography>
                  )}
                </Box>
                {entry.subtitleDisplay && (
                  <Box sx={{ color: 'var(--app-text-secondary)', fontSize: '0.72rem', mt: 0.25, ml: 3, ...oneLine }}
                    dangerouslySetInnerHTML={{ __html: entry.subtitleDisplay }} />
                )}
                <Typography sx={{ color: 'var(--app-text-disabled)', fontSize: '0.64rem', ml: 3, ...oneLine }}>{entry.path}</Typography>
              </ListItemButton>

              {shown.map((h) => (
                <ListItemButton
                  key={h.slide.index}
                  onClick={() => onOpen(entry.path, h.slide.index)}
                  sx={{ display: 'block', py: 0.4, pl: 3.5, '&:hover': { bgcolor: 'var(--app-bg-hover)' } }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, minWidth: 0 }}>
                    <Typography component="span" sx={{ color: 'var(--app-accent)', fontSize: '0.68rem', fontWeight: 700, flexShrink: 0, minWidth: 18, textAlign: 'right' }}>
                      {h.slide.index + 1}
                    </Typography>
                    <Typography component="span" sx={{ color: 'var(--app-text-secondary)', fontSize: '0.76rem', fontWeight: 600, ...oneLine }}>
                      {h.heading.text ? renderSnippet(h.heading) : <em style={{ fontWeight: 400, opacity: 0.7 }}>(no heading)</em>}
                    </Typography>
                    {h.slide.hidden && (
                      <Typography component="span" sx={{ color: 'var(--app-text-disabled)', fontSize: '0.6rem', flexShrink: 0 }}>hidden</Typography>
                    )}
                  </Box>
                  {h.snippet && (
                    <Typography component="div"
                      sx={{ color: 'var(--app-text-disabled)', fontSize: '0.7rem', mt: 0.15, ml: 3.25, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {renderSnippet(h.snippet)}
                    </Typography>
                  )}
                </ListItemButton>
              ))}
              {hits.length > shown.length && (
                <Button size="small" onClick={() => setExpanded((s) => new Set(s).add(entry.path))}
                  sx={{ ml: 4, mb: 0.5, textTransform: 'none', fontSize: '0.7rem', color: 'var(--app-accent)' }}>
                  +{hits.length - shown.length} more slides
                </Button>
              )}
            </ListItem>
          );
        })}
      </List>
    </>
  );
};
