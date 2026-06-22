import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Slide hyperlink navigation + back/forward history (host-side).
//
// Link targets (raw `data-mdp-target` from the rendered `a.mdp-slide-link`):
//   #5            → page 5 of the current deck
//   #intro        → slide with `<!-- @id intro -->` in the current deck
//   deck.slide.md[#5|#intro]  → another deck (path relative to the current deck)
//
// History records ONLY link-jumps and back/forward moves (never linear arrow nav).
// Cross-deck jumps load async, so the target index is resolved by an effect once
// the new deck is the active tab and its slides (and `@id` map) are ready.

interface NavSlide { id?: string; pageNumber?: number | null }
interface Loc { deck: string | null; index: number }
interface Want { anchor?: string; page?: number; index?: number }
interface Pending { deck: string; want: Want }

interface UseSlideNavigationArgs {
  slides: NavSlide[];
  currentFileName: string | null;
  currentSlideIndex: number;
  setCurrentSlideIndex: (i: number) => void;
  setStep: (s: number) => void;
  /** Open another deck (and optionally jump to a 0-based slide). = handleOpenDeck */
  openDeck: (path: string, slideIndex?: number) => void;
}

/** Resolve a relative deck path against the current deck's folder. */
const resolveDeckPath = (currentFile: string | null, rel: string): string => {
  const dir = currentFile && currentFile.includes('/') ? currentFile.slice(0, currentFile.lastIndexOf('/')) : '';
  const parts = dir ? dir.split('/') : [];
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
};

interface ParsedTarget { deck?: string; page?: number; anchor?: string }

const parseTarget = (raw: string): ParsedTarget => {
  const t = (raw || '').trim();
  if (!t) return {};
  if (t.startsWith('#')) {
    const frag = t.slice(1);
    if (!frag) return {};
    return /^\d+$/.test(frag) ? { page: parseInt(frag, 10) } : { anchor: frag };
  }
  const hash = t.indexOf('#');
  const path = hash === -1 ? t : t.slice(0, hash);
  const frag = hash === -1 ? '' : t.slice(hash + 1);
  const out: ParsedTarget = { deck: path };
  if (frag) { if (/^\d+$/.test(frag)) out.page = parseInt(frag, 10); else out.anchor = frag; }
  return out;
};

export interface SlideNavigation {
  onSlideLink: (target: string) => void;
  historyBack: () => void;
  historyForward: () => void;
  canBack: boolean;
  canForward: boolean;
}

export const useSlideNavigation = ({
  slides, currentFileName, currentSlideIndex, setCurrentSlideIndex, setStep, openDeck,
}: UseSlideNavigationArgs): SlideNavigation => {
  const idToIndex = useMemo(() => {
    const m = new Map<string, number>();
    slides.forEach((s, i) => { if (s.id && !m.has(s.id)) m.set(s.id, i); });
    return m;
  }, [slides]);

  // Live snapshot for use inside callbacks/effects without re-creating them each
  // render (updated in an effect, not during render, per the rules of refs).
  const refs = useRef({ slides, currentFileName, currentSlideIndex, idToIndex });
  useEffect(() => { refs.current = { slides, currentFileName, currentSlideIndex, idToIndex }; });

  const clampIdx = useCallback((i: number) => {
    const n = refs.current.slides.length;
    return Math.min(Math.max(0, i), Math.max(0, n - 1));
  }, []);

  // Displayed page number → index (falls back to the raw 1-based position).
  const pageToIndex = useCallback((page: number): number => {
    const byPage = refs.current.slides.findIndex((s) => s.pageNumber === page);
    return byPage !== -1 ? byPage : clampIdx(page - 1);
  }, [clampIdx]);

  const jumpLocal = useCallback((index: number) => {
    setStep(0);
    setCurrentSlideIndex(clampIdx(index));
  }, [setStep, setCurrentSlideIndex, clampIdx]);

  // --- back/forward stacks ---
  const backRef = useRef<Loc[]>([]);
  const fwdRef = useRef<Loc[]>([]);
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);
  const syncCans = useCallback(() => {
    setCanBack(backRef.current.length > 0);
    setCanForward(fwdRef.current.length > 0);
  }, []);

  // --- pending cross-deck resolution (loadFile is async / already-open ignores initialPage) ---
  const pendingRef = useRef<Pending | null>(null);
  const setPending = useCallback((p: Pending) => {
    pendingRef.current = p;
    // Safety: never wedge navigation if the target/anchor never appears.
    setTimeout(() => { if (pendingRef.current === p) pendingRef.current = null; }, 2000);
  }, []);

  useEffect(() => {
    const p = pendingRef.current;
    if (!p || currentFileName !== p.deck || slides.length === 0) return;
    let idx: number | undefined;
    if (p.want.index != null) idx = p.want.index;
    else if (p.want.anchor) idx = idToIndex.get(p.want.anchor);
    else if (p.want.page != null) idx = pageToIndex(p.want.page);
    else idx = 0;
    if (p.want.anchor && idx === undefined) return; // anchors may still be parsing — wait a pass
    pendingRef.current = null;
    jumpLocal(idx ?? 0);
  }, [currentFileName, slides, idToIndex, pageToIndex, jumpLocal]);

  /** Navigate to a parsed target. Returns false if it can't be resolved (unknown
   *  same-deck anchor) so callers don't record a bogus history entry. */
  const goToTarget = useCallback((tg: ParsedTarget): boolean => {
    if (!tg.deck) {
      let idx: number | undefined;
      if (tg.anchor) idx = refs.current.idToIndex.get(tg.anchor);
      else if (tg.page != null) idx = pageToIndex(tg.page);
      else idx = 0;
      if (idx === undefined) return false;
      jumpLocal(idx);
      return true;
    }
    openDeck(tg.deck, tg.page != null && !tg.anchor ? Math.max(0, tg.page - 1) : 0);
    setPending({ deck: tg.deck, want: { anchor: tg.anchor, page: tg.page } });
    return true;
  }, [pageToIndex, jumpLocal, openDeck, setPending]);

  const applyLoc = useCallback((loc: Loc) => {
    if (!loc.deck || loc.deck === refs.current.currentFileName) {
      jumpLocal(loc.index);
    } else {
      openDeck(loc.deck, loc.index);
      setPending({ deck: loc.deck, want: { index: loc.index } });
    }
  }, [jumpLocal, openDeck, setPending]);

  const here = useCallback((): Loc => ({ deck: refs.current.currentFileName, index: refs.current.currentSlideIndex }), []);

  const onSlideLink = useCallback((rawTarget: string) => {
    const tg0 = parseTarget(rawTarget);
    const tg: ParsedTarget = tg0.deck
      ? { ...tg0, deck: resolveDeckPath(refs.current.currentFileName, tg0.deck) }
      : tg0;
    const from = here();
    if (goToTarget(tg)) {
      backRef.current.push(from);
      fwdRef.current = [];
      syncCans();
    }
  }, [goToTarget, here, syncCans]);

  const historyBack = useCallback(() => {
    const loc = backRef.current.pop();
    if (!loc) return;
    fwdRef.current.push(here());
    syncCans();
    applyLoc(loc);
  }, [applyLoc, here, syncCans]);

  const historyForward = useCallback(() => {
    const loc = fwdRef.current.pop();
    if (!loc) return;
    backRef.current.push(here());
    syncCans();
    applyLoc(loc);
  }, [applyLoc, here, syncCans]);

  return { onSlideLink, historyBack, historyForward, canBack, canForward };
};
