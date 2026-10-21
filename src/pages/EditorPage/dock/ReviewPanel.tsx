import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, IconButton, MenuItem, Tab, Tabs, TextField, Tooltip } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import ReplayIcon from '@mui/icons-material/Replay';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ReplyIcon from '@mui/icons-material/Reply';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import CameraAltOutlinedIcon from '@mui/icons-material/CameraAltOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { usePreview } from './DockContext';
import { splitMarkdownToBlocks } from '../../../features/slide/parser/slideParser';
import { countItems, deckChanges, flowPathFor, lineDiff, loopCommand, questionOf, readinessChecks, stepOfSlides, type ClaudeReviewKit, type LocatedItem, type ReadinessFix, type ReviewDecision, type SlideChange, type SlideFact } from '../../../features/review/reviewModel';
import { apiClient } from '../../../api/apiClient';
import { REVIEW_FOCUS_EVENT, REVIEW_SHOW_EVENT } from '../../../features/review/useDeckReview';
import { REVIEW_COLORS, itemColor, slideLabel } from '../../../features/review/reviewPlace';
import { RichText } from '../../../features/review/RichText';

const TAB_KEY = 'mdp.review.tab';
const blocksOf = (text: string) => splitMarkdownToBlocks(text).map((b) => b.rawContent);
const muted: React.CSSProperties = { color: 'var(--app-text-muted)', fontSize: 12 };
// The person's judgment of an AI's finding (reviewModel applyDecision): the reviser and
// the next reviewer follow it.
const DECISION_BUTTONS: [ReviewDecision, string, string][] = [
  ['fix', 'Fix', 'Fix it: the reviser does it first, right after your own comments'],
  ['later', 'Later', 'Not now: it stays open, and the reviser leaves it alone'],
  ['skip', "Won't fix", 'Will not fix: it is closed, and the reviewer does not raise this kind again — say why'],
];
const DECISION_LABEL: Record<ReviewDecision, string> = { fix: 'you: fix', later: 'later', skip: "won't fix" };
const ASPECT: Record<string, string> = { clarity: 'clarity', uptake: 'uptake', accuracy: 'accuracy', effect: 'effect', flow: 'flow', style: 'style', other: 'other' };

/** The Review panel: the previewed deck's findings (the person's comments, an AI
 *  reviewer's, the AI's questions) by slide; what changed since a snapshot, with a
 *  slide put back; the lecture's flow (its understanding design) with the step of
 *  the slide on the preview. */
export const ReviewPanel: React.FC = () => {
  const p = usePreview();
  const r = p.review;
  const [tab, setTab] = useState<'findings' | 'changes' | 'flow'>(() => {
    try { const t = localStorage.getItem(TAB_KEY); return t === 'changes' || t === 'flow' ? t : 'findings'; } catch { return 'findings'; }
  });
  const pickTab = (t: typeof tab) => { setTab(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* ignore */ } };
  // A pin clicked on the preview: its item, shown.
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => {
    const onFocus = (e: Event) => { const id = (e as CustomEvent<{ id: string }>).detail?.id; if (id) { setFocusId(id); setTab('findings'); } };
    window.addEventListener(REVIEW_FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(REVIEW_FOCUS_EVENT, onFocus);
  }, []);

  if (!r) {
    return <div style={{ padding: 14, ...muted }}>Open a deck to see its review: comments, findings, what changed, its flow.</div>;
  }
  const open = r.items.filter((x) => x.status === 'open').length;
  return (
    <div className="mdp-review-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', color: 'var(--app-text)', background: 'var(--app-bg-panel)' }}>
      <Tabs value={tab} onChange={(_, v) => pickTab(v)} variant="fullWidth" sx={{ minHeight: 34, borderBottom: '1px solid var(--app-border)', '& .MuiTab-root': { minHeight: 34, minWidth: 0, px: 1, py: 0.5, textTransform: 'none', fontSize: 13, whiteSpace: 'nowrap' } }}>
        <Tab value="findings" label={`Findings${open ? ` (${open})` : ''}`} />
        <Tab value="changes" label="Changes" />
        <Tab value="flow" label={r.flow ? 'Flow' : 'Flow —'} />
      </Tabs>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {tab === 'findings' && <FindingsTab focusId={focusId} />}
        {tab === 'changes' && <ChangesTab />}
        {tab === 'flow' && <FlowTab />}
      </div>
    </div>
  );
};

// ---- an AI review: what it needs, the command for Claude Code ---------------------------------

const AI_BOX_KEY = 'mdp.review.aiBox';
const FIX_LABEL: Record<ReadinessFix, string> = { loop: 'the loop does it', 'loop + you': 'the loop drafts it, you confirm', you: 'you', optional: 'optional' };

/** Is the deck ready for an AI review (the reviewer / reviser subagents in Claude Code)?
 *  The same checks as the MCP tool review_readiness, the command to paste, and the
 *  Claude Code kit installed from here (desktop). Open when something waits for the
 *  person, unless they closed it. */
const AiReviewBox: React.FC = () => {
  const p = usePreview();
  const r = p.review!;
  const [kit, setKit] = useState<ClaudeReviewKit | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const [pref, setPref] = useState<boolean | null>(() => { try { const v = localStorage.getItem(AI_BOX_KEY); return v === '1' ? true : v === '0' ? false : null; } catch { return null; } });
  useEffect(() => {
    let live = true;
    const get = () => { apiClient.claudeReviewKit('status').then((k) => { if (live) setKit(k); }, () => {}); };
    get();
    window.addEventListener('focus', get);
    return () => { live = false; window.removeEventListener('focus', get); };
  }, []);
  const last = r.file.snapshots[r.file.snapshots.length - 1];
  const { checks, canStart } = useMemo(() => readinessChecks({
    personas: r.audience, skills: r.skills, flow: r.flow ? r.flow.check : null, facts: r.facts, lastSnapshot: last ? { label: last.label, at: last.at } : null, kit,
  }), [r.audience, r.skills, r.flow, r.facts, last, kit]);
  const todo = checks.filter((c) => !c.ok && c.fix !== 'optional');
  const open = pref ?? todo.length > 0;
  const command = loopCommand(r.deckPath);
  const toggle = () => { const v = !open; setPref(v); try { localStorage.setItem(AI_BOX_KEY, v ? '1' : '0'); } catch { /* not remembered */ } };
  const copy = async () => {
    try { await navigator.clipboard.writeText(command); setSaid('Copied — paste it into Claude Code'); }
    catch { setSaid(command); }
    window.setTimeout(() => setSaid(''), 4000);
  };
  const install = async () => {
    setBusy(true);
    try {
      const k = await apiClient.claudeReviewKit('install');
      setKit(k);
      setSaid(k && k.backedUp && k.backedUp.length ? `Installed (your previous copy kept in ${k.home}/${k.backedUp[0].split(/[\\/]/).slice(0, 3).join('/')})` : 'Installed');
    } catch (e) { setSaid(`Could not install: ${(e as Error)?.message || e}`); }
    setBusy(false);
  };
  return (
    <div className="mdp-ai-review" style={{ border: '1px solid var(--app-border)', borderRadius: 6, padding: '5px 8px', marginBottom: 8, background: 'var(--app-bg-elevated)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button type="button" onClick={toggle} className="mdp-ai-review-toggle" style={{ all: 'unset', cursor: 'pointer', fontSize: 12.5, fontWeight: 700 }}>
          {open ? '▾' : '▸'} AI review
        </button>
        <span className="mdp-ai-review-state" style={{ fontSize: 11, padding: '0 6px', borderRadius: 8, color: '#fff', background: !canStart ? '#e53935' : todo.length ? '#fb8c00' : '#43a047' }}>
          {!canStart ? 'needs you' : todo.length ? `${todo.length} left — the loop does ${todo.length > 1 ? 'them' : 'it'}` : 'ready'}
        </span>
        <div style={{ flex: 1 }} />
        <Tooltip title={`Copy "${command}" — paste it into Claude Code (a session with the MDP tools): a reviewer reads the deck as the students would, a reviser fixes, a few rounds, then a report`}>
          <Button size="small" onClick={() => void copy()} className="mdp-ai-review-copy" sx={{ textTransform: 'none', minWidth: 0, py: 0 }}>Copy command</Button>
        </Tooltip>
      </div>
      {said && <div style={{ fontSize: 11.5, marginTop: 3, color: 'var(--app-text-secondary)', wordBreak: 'break-all' }}>{said}</div>}
      {open && (
        <div style={{ marginTop: 4 }}>
          {checks.map((c) => (
            <div key={c.item} className="mdp-ai-review-check" data-ok={c.ok ? '1' : '0'} style={{ display: 'flex', gap: 6, fontSize: 12, margin: '2px 0', alignItems: 'baseline' }}>
              <span style={{ width: 12, flexShrink: 0, color: c.ok ? '#43a047' : c.fix === 'optional' ? 'var(--app-text-muted)' : c.fix === 'you' ? '#e53935' : '#fb8c00' }}>{c.ok ? '✓' : c.fix === 'optional' ? '–' : '✗'}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <b>{c.item}</b> <span style={{ color: 'var(--app-text-secondary)' }}>{c.note}</span>
                {!c.ok && c.fix && <span style={{ ...muted, fontSize: 11 }}> ({FIX_LABEL[c.fix]})</span>}
              </span>
              {c.item === 'Claude Code kit' && !c.ok && (
                <Button size="small" variant="outlined" disabled={busy} onClick={() => void install()} className="mdp-ai-review-install" sx={{ textTransform: 'none', minWidth: 0, py: 0, flexShrink: 0 }}>Install</Button>
              )}
            </div>
          ))}
          <div style={{ ...muted, fontSize: 11, marginTop: 3 }}>
            Paste the command into Claude Code. The loop takes a snapshot, makes what is missing (asking you to confirm a persona), has the reviewer read the deck as its students and the reviser fix it, and reports; its findings and changes show up here.
          </div>
        </div>
      )}
    </div>
  );
};

// ---- findings ------------------------------------------------------------------------------

const FindingsTab: React.FC<{ focusId: string | null }> = ({ focusId }) => {
  const p = usePreview();
  const r = p.review!;
  const [all, setAll] = useState(false);
  const shown = useMemo(() => r.items.filter((x) => all || x.status === 'open'), [r.items, all]);
  const bySlide = useMemo(() => {
    const m = new Map<number, LocatedItem[]>();
    for (const it of shown) { const k = it.slide || 0; m.set(k, [...(m.get(k) || []), it]); }
    return [...m.entries()];
  }, [shown]);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusId) return;
    const el = rootRef.current?.querySelector(`[data-review-id="${focusId}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [focusId, shown]);
  const counts = countItems(r.file);
  return (
    <div ref={rootRef} style={{ padding: '8px 10px' }}>
      <AiReviewBox />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={muted}>{counts.open} open{counts.major ? ` · ${counts.major} major` : ''}{counts.questions ? ` · ${counts.questions} question${counts.questions > 1 ? 's' : ''}` : ''}{counts.toDecide ? ` · ${counts.toDecide} to decide` : ''}{counts.later ? ` · ${counts.later} later` : ''}</span>
        <div style={{ flex: 1 }} />
        <Button size="small" onClick={() => setAll((v) => !v)} sx={{ textTransform: 'none', minWidth: 0 }}>{all ? 'Open only' : 'Show all'}</Button>
      </div>
      <div className="mdp-review-legend" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px 10px', marginBottom: 8, ...muted, fontSize: 11 }}>
        {Object.values(REVIEW_COLORS).map((c) => (
          <span key={c.short} title={c.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'help' }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: c.color, display: 'inline-block' }} />{c.short}
          </span>
        ))}
        <span>· click a card: its place on the slide</span>
      </div>
      {!shown.length && <div style={{ ...muted, padding: '10px 2px' }}>{r.items.length ? 'Nothing open.' : 'No findings yet. Right-click a slide in the preview → "Add comment…", or let an AI reviewer add findings (add_review).'}</div>}
      {bySlide.map(([slide, list]) => {
        const fact = slide ? r.facts[slide - 1] : undefined;
        return (
          <div key={slide} style={{ marginBottom: 10 }}>
            <button
              type="button" className="mdp-review-slide" onClick={() => slide && p.gotoSlide?.(slide - 1)}
              style={{ all: 'unset', cursor: slide ? 'pointer' : 'default', display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--app-text-secondary)', margin: '4px 0' }}
              title={slide ? 'Show this slide' : undefined}
            >
              {slideLabel(slide || null, fact)}{fact?.heading ? ` — ${fact.heading}` : ''}
            </button>
            {list.map((it) => <FindingCard key={it.id} it={it} n={r.items.filter((x) => x.status === 'open' && x.slide === it.slide).findIndex((x) => x.id === it.id) + 1} focused={it.id === focusId} />)}
          </div>
        );
      })}
    </div>
  );
};

const FindingCard: React.FC<{ it: LocatedItem; n: number; focused: boolean }> = ({ it, n, focused }) => {
  const p = usePreview();
  const r = p.review!;
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState('');
  const [hint, setHint] = useState('Reply…');
  const color = itemColor(it);
  const done = it.status !== 'open';
  // an AI's finding: the person judges it (fix / later / won't fix)
  const judged = it.kind === 'finding' && it.by !== 'human';
  const decide = (d: ReviewDecision) => {
    const next = it.decision === d ? null : d;
    void r.update(it.id, { decision: next });
    if (next === 'later' || next === 'skip') { setHint(next === 'skip' ? 'Why not? (the reviewer will not raise this kind again)' : 'Why not now? (optional)'); setReplying(true); }
  };
  const sendReply = () => { if (reply.trim()) { void r.update(it.id, { reply }); setReply(''); setReplying(false); } };
  // a click on the card (not on its buttons, a link or the reply box, nor the end of a
  // text selection): the preview goes to its slide and flashes what it points at
  const showOnSlide = (e: React.MouseEvent) => {
    if (!it.slide || (e.target as HTMLElement).closest('button, a, input, textarea, [role="button"]')) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    p.gotoSlide?.(it.slide - 1);
    window.dispatchEvent(new CustomEvent(REVIEW_SHOW_EVENT, { detail: { id: it.id } }));
  };
  return (
    <div
      data-review-id={it.id}
      onClick={showOnSlide}
      style={{
        border: `1px solid ${focused ? color : 'var(--app-border)'}`, borderLeft: `4px solid ${color}`, borderRadius: 6, padding: '6px 8px', marginBottom: 6,
        background: focused ? 'var(--app-accent-soft)' : 'var(--app-bg-elevated)', opacity: done ? 0.6 : it.decision === 'later' ? 0.75 : 1, cursor: it.slide ? 'pointer' : 'default',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--app-text-muted)' }}>
        {!done && n > 0 && <span style={{ background: color, color: '#fff', borderRadius: 10, padding: '0 6px', fontWeight: 700 }}>{n}</span>}
        <span>{it.kind === 'question' ? 'question' : it.by === 'human' ? 'you' : it.by}</span>
        <span>· {ASPECT[it.aspect]}</span>
        {it.severity !== 'minor' && <span>· {it.severity}</span>}
        {it.round ? <span>· round {it.round}</span> : null}
        {it.moved && <span title="Its slide was found again by a guess (the slide changed)">· ?</span>}
        {it.decision && <span className="mdp-review-decision-label" style={{ fontWeight: 700 }}>· {DECISION_LABEL[it.decision]}</span>}
        {done && it.decision !== 'skip' && <span style={{ fontWeight: 700 }}>· {it.status}</span>}
        <div style={{ flex: 1 }} />
        <Tooltip title={it.rule ? 'A rule to keep (the AI records it in the skill)' : 'Keep as a rule'}>
          <IconButton size="small" onClick={() => void r.update(it.id, { rule: !it.rule })} sx={{ p: 0.25, color: it.rule ? '#f9a825' : 'inherit' }}>
            {it.rule ? <StarIcon sx={{ fontSize: 16 }} /> : <StarBorderIcon sx={{ fontSize: 16 }} />}
          </IconButton>
        </Tooltip>
        <Tooltip title="Reply"><IconButton size="small" onClick={() => setReplying((v) => !v)} sx={{ p: 0.25 }}><ReplyIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
        {done
          ? <Tooltip title="Open again"><IconButton size="small" onClick={() => void r.update(it.id, { status: 'open' })} sx={{ p: 0.25 }}><ReplayIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
          : <Tooltip title="Done"><IconButton size="small" onClick={() => void r.update(it.id, { status: it.kind === 'question' ? 'answered' : 'resolved' })} sx={{ p: 0.25 }}><CheckIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>}
        <Tooltip title="Delete"><IconButton size="small" onClick={() => void r.remove(it.id)} sx={{ p: 0.25 }}><DeleteOutlineIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
      </div>
      {(it.at.target || it.at.quote) && (
        <div style={{ fontSize: 11.5, color: 'var(--app-text-secondary)', marginTop: 2, wordBreak: 'break-all' }}>
          {it.at.target ? it.at.target : ''}{it.at.quote ? <> 「<RichText text={it.at.quote} />」</> : ''}
        </div>
      )}
      <div style={{ fontSize: 13, marginTop: 3 }}><RichText block text={it.text} /></div>
      {it.suggestion && (
        <div style={{ display: 'flex', gap: 4, fontSize: 12.5, marginTop: 3, color: 'var(--app-text-secondary)' }}>
          <span>→</span><RichText block text={it.suggestion} />
        </div>
      )}
      {judged && (!done || it.decision === 'skip') && (
        <div className="mdp-review-decision" style={{ display: 'flex', gap: 4, marginTop: 5, alignItems: 'center' }}>
          <span style={{ ...muted, fontSize: 11 }}>Your call:</span>
          {DECISION_BUTTONS.map(([d, label, tip]) => (
            <Tooltip key={d} title={tip}>
              <Button
                size="small" variant={it.decision === d ? 'contained' : 'outlined'} onClick={() => decide(d)}
                className={`mdp-review-decide mdp-review-decide-${d}`} aria-pressed={it.decision === d}
                sx={{ textTransform: 'none', minWidth: 0, py: 0, px: 0.75, fontSize: 11.5, lineHeight: 1.6 }}
              >{label}</Button>
            </Tooltip>
          ))}
        </div>
      )}
      {it.thread.map((t, i) => (
        <div key={i} style={{ display: 'flex', gap: 4, fontSize: 12.5, marginTop: 4, paddingLeft: 8, borderLeft: '2px solid var(--app-border-strong)' }}>
          <span style={{ fontWeight: 700, flexShrink: 0 }}>{t.by === 'human' ? 'you' : t.by}:</span><RichText block text={t.text} />
        </div>
      ))}
      {replying && (
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <TextField
            size="small" fullWidth multiline autoFocus placeholder={hint} value={reply} onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendReply(); } }}
          />
          <Button size="small" variant="contained" onClick={sendReply} disabled={!reply.trim()}>Send</Button>
        </div>
      )}
    </div>
  );
};

// ---- changes -------------------------------------------------------------------------------

const ChangesTab: React.FC = () => {
  const p = usePreview();
  const r = p.review!;
  const snaps = useMemo(() => [...r.file.snapshots].reverse(), [r.file.snapshots]);
  const [sel, setSel] = useState<string>('');
  const [base, setBase] = useState<{ id: string; text: string } | null>(null);
  const [err, setErr] = useState('');
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const want = sel || snaps[0]?.id || '';
  useEffect(() => {
    if (!want) return undefined;
    let alive = true;
    r.readSnapshot(want).then((text) => { if (alive) { setBase({ id: want, text }); setErr(''); } }, (e) => { if (alive) setErr(String(e?.message || e)); });
    return () => { alive = false; };
  }, [want, r]);
  const now = p.reviewEdit?.deckText() ?? null;
  const changes: SlideChange[] = useMemo(() => (base && base.id === want && now != null ? deckChanges(blocksOf(base.text), blocksOf(now)) : []), [base, want, now]);
  const snapshotNow = () => {
    const text = p.reviewEdit?.deckText();
    if (text == null) return;
    void r.takeSnapshot(label || `by hand ${new Date().toLocaleString()}`, text).then(() => { setLabel(''); setSel(''); });
  };
  const rowKey = (c: SlideChange) => `${c.status}:${c.slide ?? ''}:${c.oldSlide ?? ''}`;
  return (
    <div style={{ padding: '8px 10px' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
        <TextField size="small" placeholder="Snapshot label" value={label} onChange={(e) => setLabel(e.target.value)} sx={{ flex: 1, '& input': { fontSize: 12.5, py: 0.6 } }} />
        <Tooltip title={now == null ? 'Open the deck in the editor first' : 'Keep the deck as it is now, to compare with later'}>
          <span><Button size="small" startIcon={<CameraAltOutlinedIcon />} onClick={snapshotNow} disabled={now == null} sx={{ textTransform: 'none' }}>Snapshot</Button></span>
        </Tooltip>
      </div>
      {!snaps.length && <div style={{ ...muted, padding: '6px 2px' }}>No snapshot yet. Take one before an AI revises the deck (it does so itself in a review loop: snapshot_deck) — then the changes show here.</div>}
      {!!snaps.length && (
        <TextField select size="small" fullWidth label="Since" value={want} onChange={(e) => setSel(e.target.value)} sx={{ mb: 1, '& .MuiSelect-select': { fontSize: 12.5, py: 0.8 } }}>
          {snaps.map((s) => <MenuItem key={s.id} value={s.id} sx={{ fontSize: 12.5 }}>{s.label || s.id} · {new Date(s.at).toLocaleString()}{s.by ? ` · ${s.by}` : ''}</MenuItem>)}
        </TextField>
      )}
      {err && <div style={{ color: 'var(--app-danger)', fontSize: 12 }}>{err}</div>}
      {!!snaps.length && now == null && <div style={muted}>Open the deck in the editor to compare and put slides back.</div>}
      {!!snaps.length && now != null && base && !changes.length && <div style={muted}>No change since this snapshot.</div>}
      {changes.map((c) => {
        const k = rowKey(c);
        const fact: SlideFact | undefined = c.slide ? r.facts[c.slide - 1] : undefined;
        const tag = c.status === 'changed' ? '#fb8c00' : c.status === 'added' ? '#43a047' : '#e53935';
        return (
          <div key={k} className="mdp-review-change" style={{ border: '1px solid var(--app-border)', borderLeft: `4px solid ${tag}`, borderRadius: 6, padding: '5px 8px', marginBottom: 6, background: 'var(--app-bg-elevated)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button type="button" onClick={() => setOpenRow((v) => (v === k ? null : k))} style={{ all: 'unset', cursor: 'pointer', flex: 1, fontSize: 12.5 }}>
                <b>{c.status}</b> · {c.status === 'removed' ? `was slide ${c.oldSlide}` : slideLabel(c.slide ?? null, fact)}{c.heading ? ` — ${c.heading}` : ''}
              </button>
              {c.slide && <Button size="small" onClick={() => p.gotoSlide?.(c.slide! - 1)} sx={{ textTransform: 'none', minWidth: 0, fontSize: 12 }}>Show</Button>}
              <Tooltip title={c.status === 'added' ? 'Take this slide out (undo with Ctrl+Z)' : 'Put the snapshot\'s version back (undo with Ctrl+Z)'}>
                <Button size="small" onClick={() => p.reviewEdit?.putBack(c)} sx={{ textTransform: 'none', minWidth: 0, fontSize: 12 }}>{c.status === 'added' ? 'Remove' : 'Put back'}</Button>
              </Tooltip>
            </div>
            {openRow === k && (
              <pre style={{ margin: '6px 0 0', fontSize: 11.5, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 320, overflow: 'auto' }}>
                {lineDiff(c.before, c.after).map((d, i) => (
                  <div key={i} style={{ background: d.op === '-' ? 'rgba(229,57,53,.14)' : d.op === '+' ? 'rgba(67,160,71,.16)' : 'transparent', color: d.op === ' ' ? 'var(--app-text-muted)' : 'var(--app-text)' }}>
                    {d.op === ' ' ? '  ' : `${d.op} `}{d.line}
                  </div>
                ))}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
};

// ---- flow ------------------------------------------------------------------------------------

const FIELD_ORDER = ['学生の問い', '問い', '仕掛け', '腹落ち', 'つなぎ', '時間'];

const FlowTab: React.FC = () => {
  const p = usePreview();
  const r = p.review!;
  const flow = r.flow;
  const stepOf = useMemo(() => (flow ? stepOfSlides(flow.parsed, r.facts) : []), [flow, r.facts]);
  if (!flow) {
    return (
      <div style={{ padding: 12, ...muted, lineHeight: 1.6 }}>
        No flow yet for this deck. The flow is the lecture's understanding design — per step the slides, the student's question at that point, the device that answers it, the sentence that should land, the link to the next step — kept beside the deck as <code>{flowPathFor(r.deckPath).split('/').pop()}</code>. Ask the AI to write it (get_flow gives the template, write_flow writes it) before it writes the slides; checking 1–2 pages is quicker than 40 slides.
      </div>
    );
  }
  const current = stepOf[p.currentSlideIndex] || 0;
  const ck = flow.check;
  const problems = [
    ck.missing.length ? `#${ck.missing.join(', #')}: no slide has it` : '',
    ck.noQuestion.length ? `step ${ck.noQuestion.join(', ')}: no student's question (a flat step?)` : '',
    ck.noSlides.length ? `step ${ck.noSlides.join(', ')}: names no slide` : '',
    ck.unnamed.length ? `${ck.unnamed.length} slide(s) with an @id no step names` : '',
    ck.noId.length ? `${ck.noId.length} slide(s) without an @id` : '',
  ].filter(Boolean);
  const idSlide = (id: string) => r.facts.find((f) => f.id === id);
  return (
    <div style={{ padding: '8px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <div style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>{flow.parsed.title || 'Flow'}</div>
        <Tooltip title="Open the flow file in the editor">
          <IconButton size="small" onClick={() => p.reviewEdit?.openFile(flowPathFor(r.deckPath))}><OpenInNewIcon sx={{ fontSize: 16 }} /></IconButton>
        </Tooltip>
      </div>
      {problems.map((t) => <div key={t} style={{ fontSize: 12, color: 'var(--app-warning)', marginBottom: 2 }}>⚠ {t}</div>)}
      {flow.parsed.steps.map((s) => {
        const here = s.n === current;
        const rank = (k: string) => { const i = FIELD_ORDER.indexOf(k); return i < 0 ? 99 : i; };
        const fields = Object.entries(s.fields).sort((a, b) => rank(a[0]) - rank(b[0]));
        return (
          <div key={s.n} className={`mdp-flow-step${here ? ' mdp-flow-here' : ''}`} style={{ border: `1px solid ${here ? 'var(--app-accent)' : 'var(--app-border)'}`, borderRadius: 6, padding: '6px 8px', margin: '6px 0', background: here ? 'var(--app-accent-soft)' : 'var(--app-bg-elevated)' }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{s.n}. <RichText text={s.title} /></div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', margin: '3px 0' }}>
              {s.ids.map((id) => {
                const f = idSlide(id);
                return (
                  <button key={id} type="button" disabled={!f} onClick={() => f && p.gotoSlide?.(f.slide - 1)}
                    style={{ all: 'unset', cursor: f ? 'pointer' : 'default', fontSize: 11.5, padding: '0 6px', borderRadius: 8, border: '1px solid var(--app-border-strong)', color: f ? 'var(--app-text)' : 'var(--app-danger)' }}
                    title={f ? `${slideLabel(f.slide, f)} — ${f.heading}` : 'No slide has this @id'}>
                    #{id}{f?.page ? ` p.${f.page}` : ''}
                  </button>
                );
              })}
            </div>
            {!questionOf(s) && <div style={{ fontSize: 12, color: 'var(--app-warning)' }}>no student's question</div>}
            {fields.map(([k, v]) => (
              <div key={k} style={{ fontSize: 12.5, marginTop: 2 }}><span style={{ color: 'var(--app-text-muted)' }}>{k}:</span> <RichText text={v} /></div>
            ))}
          </div>
        );
      })}
    </div>
  );
};
