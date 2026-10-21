import React, { useCallback, useState } from 'react';
import { ListItemIcon, Menu, MenuItem } from '@mui/material';
import LinkIcon from '@mui/icons-material/Link';
import ImageIcon from '@mui/icons-material/Image';
import RateReviewOutlinedIcon from '@mui/icons-material/RateReviewOutlined';
import { notify, reportError } from '../../components/error/errorReporter';
import type { FocusBox } from '../focus/focusTargets';
import { pickAt, pickedBoxes, slideReference, type SlidePick } from './slideReference';

/** What the preview needs to copy a slide's reference and picture. */
export interface SlideCopySource {
  /** The deck, as the MCP tools take it (workspace-relative). */
  deckPath: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  slides: any[];
  /** The slide as a PNG, the boxes (slide px) framed in red. */
  image: (index: number, boxes: FocusBox[]) => Promise<Blob>;
}

/** The preview's right-click (view mode — the edit-layout mode has its own menus):
 *  "Copy reference" puts one line naming the deck, the slide, the place under the
 *  pointer and the words selected on the clipboard, "Copy image" the slide's picture
 *  with that place framed — to paste into the AI's chat with a comment. "Add
 *  comment…" (`onComment`) keeps the comment beside the deck, for the AI to read. */
export function useSlideCopyMenu(source: SlideCopySource | undefined, enabled: boolean, onComment?: (pick: SlidePick) => void) {
  const [at, setAt] = useState<{ x: number; y: number; pick: SlidePick } | null>(null);
  // On the box around the slide; the rendered slide inside it is the root.
  const onContextMenu = useCallback((e: React.MouseEvent<HTMLElement>, index: number) => {
    if (!enabled || !source) return;
    const root = e.currentTarget.querySelector<HTMLElement>('.slide-content-wrapper');
    if (!root) return;
    e.preventDefault();
    setAt({ x: e.clientX, y: e.clientY, pick: pickAt(root, e.clientX, e.clientY, index) });
  }, [enabled, source]);

  const reference = (pick: SlidePick) => (source ? slideReference(source.deckPath, source.slides[pick.index] || {}, pick) : '');
  const copyReference = async (pick: SlidePick) => {
    const text = reference(pick);
    try {
      await navigator.clipboard.writeText(text);
      notify(`Copied: ${text}`, { severity: 'info' });
    } catch (err) {
      reportError('The reference could not be copied.', { detail: err, severity: 'warning' });
    }
  };
  const copyImage = async (pick: SlidePick) => {
    if (!source) return;
    // The picture is made while the clipboard waits for it (a promise in the item —
    // asked for within the click, as Safari needs); a browser that wants the image
    // itself gets it once it is made.
    const png = source.image(pick.index, pickedBoxes(pick));
    try {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      } catch {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': await png })]);
      }
      notify(`Copied the picture: ${reference({ ...pick, quote: '' })}`, { severity: 'info' });
    } catch (err) {
      reportError('The picture could not be copied.', { detail: err, severity: 'warning' });
    }
  };

  const pick = at?.pick;
  const what = pick ? (pick.quote ? `「${pick.quote.length > 24 ? `${pick.quote.slice(0, 23)}…` : pick.quote}」` : pick.place ? pick.place.target : 'the slide') : '';
  const menu = (
    <Menu
      open={!!at} onClose={() => setAt(null)}
      anchorReference="anchorPosition" anchorPosition={at ? { top: at.y, left: at.x } : undefined}
      // No exit transition: a fading backdrop would take the next click on the slide.
      transitionDuration={{ enter: 120, exit: 0 }}
      className="mdp-slide-copy-menu"
    >
      <MenuItem dense disabled sx={{ fontSize: 12, opacity: '0.8 !important', minHeight: 0 }}>{what}</MenuItem>
      {onComment && (
        <MenuItem dense onClick={() => { const p = at?.pick; setAt(null); if (p) onComment(p); }}>
          <ListItemIcon><RateReviewOutlinedIcon fontSize="small" /></ListItemIcon>Add comment…
        </MenuItem>
      )}
      <MenuItem dense onClick={() => { const p = at?.pick; setAt(null); if (p) void copyReference(p); }}>
        <ListItemIcon><LinkIcon fontSize="small" /></ListItemIcon>Copy reference
      </MenuItem>
      <MenuItem dense onClick={() => { const p = at?.pick; setAt(null); if (p) void copyImage(p); }}>
        <ListItemIcon><ImageIcon fontSize="small" /></ListItemIcon>Copy image
      </MenuItem>
    </Menu>
  );
  return { onContextMenu, menu };
}
