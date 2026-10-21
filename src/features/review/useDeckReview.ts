import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '../../api/apiClient';
import type { FocusBox } from '../focus/focusTargets';
import {
  applyDecision, checkFlow, emptyReview, flowPathFor, listItems, newComment, newId, parseFlow, parseReview, reviewPathFor,
  serializeReview, slideFacts, snapshotDirFor,
  type Flow, type FlowCheck, type LocatedItem, type ReviewAspect, type ReviewDecision, type ReviewFile, type ReviewKind, type ReviewSeverity,
  type ReviewStatus, type SlideChange, type SlideFact,
} from './reviewModel';

/** Bridge relay → the open deck's review was written by an MCP tool. */
export const REVIEW_CHANGED_EVENT = 'mdp-review-changed';
/** Show this item in the Review panel (a pin on the preview was clicked). */
export const REVIEW_FOCUS_EVENT = 'mdp-review-focus';
/** Show this item on the preview (its card in the Review panel was clicked): the
 *  preview goes to its slide and flashes what it points at, even with the pins off. */
export const REVIEW_SHOW_EVENT = 'mdp-review-show';

/** What the Review panel does to the deck (EditorPage): its text now — the editor's,
 *  null when the previewed deck is not the open tab —, a slide put back as it was in
 *  a snapshot (one undoable editor change), a file opened. */
export interface ReviewEdit {
  deckText: () => string | null;
  putBack: (c: SlideChange) => void;
  openFile: (path: string) => void;
}

/** A change the person makes to an item in the Review panel. */
export interface ReviewPatch { status?: ReviewStatus; reply?: string; rule?: boolean; decision?: ReviewDecision | null }

export interface CommentInput {
  text: string; target?: string; quote?: string; box?: FocusBox;
  aspect?: ReviewAspect; severity?: ReviewSeverity; kind?: ReviewKind; rule?: boolean;
}

export interface DeckReview {
  deckPath: string;
  file: ReviewFile;
  facts: SlideFact[];
  /** Every item located on the deck as it is now (the panel filters). */
  items: LocatedItem[];
  flow: { text: string; parsed: Flow; check: FlowCheck } | null;
  /** The folder's audience and slide skills — what an AI review reads (the panel's
   *  "AI review" box checks them). */
  audience: { name: string; primary?: boolean; configDir: string }[];
  skills: string[];
  addComment: (index: number, c: CommentInput) => Promise<void>;
  update: (id: string, patch: ReviewPatch) => Promise<void>;
  remove: (id: string) => Promise<void>;
  takeSnapshot: (label: string, text: string) => Promise<void>;
  readSnapshot: (id: string) => Promise<string>;
  reload: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Slide = any;
interface Loaded { deck: string; file: ReviewFile; flowText: string | null; audience: DeckReview['audience']; skills: string[] }
const NO_DIRS: string[] = [];
const NO_PERSONAS: DeckReview['audience'] = [];

/** The review of the previewed deck: its findings (`<deck>.review.json`), snapshots
 *  and flow (`<deck>.flow.md`) — read again when an MCP tool writes them
 *  (REVIEW_CHANGED_EVENT), when the window gets the focus back, and after every
 *  change made here (a read-modify-write, so an AI's findings written meanwhile
 *  are kept). */
export function useDeckReview(deckPath: string | null, slides: Slide[], scopeDirs: string[] = NO_DIRS): DeckReview | undefined {
  // What was read, and for which deck (another deck's review is never shown).
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const pathRef = useRef(deckPath);
  useEffect(() => { pathRef.current = deckPath; }, [deckPath]);
  const scopeRef = useRef(scopeDirs);
  useEffect(() => { scopeRef.current = scopeDirs; }, [scopeDirs]);

  const load = useCallback(async () => {
    const deck = pathRef.current;
    if (!deck) return;
    const dirs = scopeRef.current;
    const [rev, flow, personas, skillList] = await Promise.all([
      apiClient.readFileText(reviewPathFor(deck)).then((t: string) => parseReview(t, deck), () => emptyReview(deck)),
      apiClient.readFileText(flowPathFor(deck)).then((t: string) => String(t), () => null),
      apiClient.getAudience(dirs).catch(() => []),
      apiClient.getSkills(dirs).catch(() => []),
    ]);
    if (pathRef.current !== deck) return;   // the deck changed meanwhile
    setLoaded({
      deck, file: rev, flowText: flow,
      audience: personas.map((x) => ({ name: x.name, ...(x.primary ? { primary: true } : {}), configDir: x.configDir })),
      skills: skillList.map((x) => x.name),
    });
  }, []);
  const current = loaded && loaded.deck === deckPath ? loaded : null;
  const file = current?.file || null;
  const flowText = current ? current.flowText : null;

  useEffect(() => { void load(); }, [deckPath, scopeDirs, load]);
  useEffect(() => {
    const onChanged = (e: Event) => {
      const p = (e as CustomEvent<{ path?: string }>).detail?.path;
      if (!p || p === pathRef.current) void load();
    };
    const onFocus = () => { void load(); };
    window.addEventListener(REVIEW_CHANGED_EVENT, onChanged);
    window.addEventListener('focus', onFocus);
    return () => { window.removeEventListener(REVIEW_CHANGED_EVENT, onChanged); window.removeEventListener('focus', onFocus); };
  }, [load]);

  const facts = useMemo(() => slideFacts(['', ...slides.map((s: Slide) => String(s?.raw || ''))]), [slides]);

  // Read the stored file again, change it, write it back.
  const mutate = useCallback(async (fn: (f: ReviewFile) => void) => {
    const deck = pathRef.current;
    if (!deck) return;
    let fresh: ReviewFile;
    try { fresh = parseReview(await apiClient.readFileText(reviewPathFor(deck)), deck); }
    catch { fresh = emptyReview(deck); }
    fn(fresh);
    await apiClient.saveFile(reviewPathFor(deck), serializeReview(fresh));
    if (pathRef.current === deck) setLoaded((l) => (l && l.deck === deck ? { ...l, file: fresh } : { deck, file: fresh, flowText: null, audience: [], skills: [] }));
  }, []);

  const addComment = useCallback(async (index: number, c: CommentInput) => {
    const fact = facts[index];
    if (!fact) throw new Error('No such slide.');
    const item = newComment(fact, c);
    await mutate((f) => { f.items.push(item); });
  }, [facts, mutate]);

  const update = useCallback(async (id: string, patch: ReviewPatch) => {
    await mutate((f) => {
      const it = f.items.find((x) => x.id === id);
      if (!it) return;
      const now = new Date().toISOString();
      if (patch.status) it.status = patch.status;
      if (patch.reply && patch.reply.trim()) it.thread.push({ by: 'human', text: patch.reply.trim(), at: now });
      if (patch.rule !== undefined) { if (patch.rule) it.rule = true; else delete it.rule; }
      if (patch.decision !== undefined) applyDecision(it, patch.decision, now);
      it.updatedAt = now;
    });
  }, [mutate]);

  const remove = useCallback(async (id: string) => {
    await mutate((f) => { f.items = f.items.filter((x) => x.id !== id); });
  }, [mutate]);

  // A snapshot taken here (the person's own checkpoint): the deck's text as it is.
  const takeSnapshot = useCallback(async (label: string, text: string) => {
    const deck = pathRef.current;
    if (!deck) return;
    const id = newId('s');
    const rel = `${snapshotDirFor(deck)}/${id}.txt`;
    await apiClient.saveFile(rel, text);
    const slidesCount = Math.max(0, facts.length);
    await mutate((f) => {
      f.snapshots.push({ id, label: label.trim().slice(0, 120), at: new Date().toISOString(), path: rel, slides: slidesCount, by: 'human' });
      if (f.snapshots.length > 20) f.snapshots.splice(0, f.snapshots.length - 20);
    });
  }, [facts.length, mutate]);

  const readSnapshot = useCallback(async (id: string) => {
    const snap = file?.snapshots.find((s) => s.id === id);
    if (!snap) throw new Error('No such snapshot.');
    const t = String(await apiClient.readFileText(snap.path));
    return t.charCodeAt(0) === 0xFEFF ? t.slice(1) : t;
  }, [file]);

  const items = useMemo(() => (file ? listItems(file, facts, 'all') : []), [file, facts]);
  const flow = useMemo(() => {
    if (flowText == null) return null;
    const parsed = parseFlow(flowText);
    return { text: flowText, parsed, check: checkFlow(parsed, facts) };
  }, [flowText, facts]);

  const audience = current ? current.audience : NO_PERSONAS;
  const skills = current ? current.skills : NO_DIRS;
  return useMemo(() => (deckPath && file ? {
    deckPath, file, facts, items, flow, audience, skills, addComment, update, remove, takeSnapshot, readSnapshot, reload: () => { void load(); },
  } : undefined), [deckPath, file, facts, items, flow, audience, skills, addComment, update, remove, takeSnapshot, readSnapshot, load]);
}
