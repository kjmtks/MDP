import React, { useEffect, useMemo, useRef, useState } from 'react';
import { IconButton, Tooltip, Slider } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import SkipPreviousIcon from '@mui/icons-material/SkipPrevious';
import ReplayIcon from '@mui/icons-material/Replay';
import SubtitlesIcon from '@mui/icons-material/Subtitles';
import SubtitlesOffIcon from '@mui/icons-material/SubtitlesOff';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import CloseIcon from '@mui/icons-material/Close';
import { SlideView } from '../slide/components/SlideView';
import { useAppSettings } from '../settings/AppSettingsContext';
import { synthesize, type Clip, type Utterance } from '../tts/ttsService';
import { scriptSegments, captionChunks, slideDwellMs } from './autoplay';

// One playable step of the narration: which slide + build step to show, and the
// text to speak (null = a silent dwell, e.g. a script-less slide or a trailing
// build reveal).
interface PlayItem { slideIdx: number; buildStep: number; text: string | null; dwellMs: number }

export interface AutoPlaySlide {
  html: string; raw: string; className?: string; header?: string; footer?: string; stepCount: number;
}

// A standalone, full-screen NARRATED auto-slideshow: reads each slide's @script
// aloud (TTS) and auto-advances. On slides with in-slide builds, `[[step]]` markers
// in the @script split the narration so each segment is read, then the build steps
// once, keeping the words in sync with the reveals.
export const AutoPlayView: React.FC<{
  open: boolean;
  onClose: () => void;
  slides: AutoPlaySlide[];
  slideSize: { width: number; height: number };
  basePath?: string;
}> = ({ open, onClose, slides, slideSize, basePath }) => {
  const { settings, update } = useAppSettings();
  const cpm = settings.readingCharsPerMin || 320;      // human reading speed → only the script-less dwell
  // The synthesized-voice speed is its OWN setting (settings.tts.rate), independent of
  // the human reading speed — a synthetic narrator can run faster/slower than a person.
  const ttsCfg = useMemo(() => ({ ...settings.tts }), [settings.tts]);
  const patchTts = (p: Partial<typeof settings.tts>) => update({ tts: { ...settings.tts, ...p } });

  // Flatten the deck into narration steps: one per @script segment (split at
  // `[[step]]`), plus dwell items for script-less slides / trailing build reveals.
  const playlist = useMemo<PlayItem[]>(() => {
    const out: PlayItem[] = [];
    slides.forEach((s, si) => {
      const segs = scriptSegments(s.raw);
      const steps = s.stepCount || 0;
      if (segs.length === 0) {
        // No script → dwell proportional to the slide's actual content (not the
        // talk-time estimate, which is longer). Reveal all builds up front.
        out.push({ slideIdx: si, buildStep: steps, text: null, dwellMs: slideDwellMs(s.html, cpm) });
        return;
      }
      // One narration item PER CAPTION CHUNK — and the SAME chunk is what we
      // synthesize AND display. So the on-screen caption is exactly the audio being
      // spoken (zero drift), with no proportional-timing approximation. Long sentences
      // are split at commas/clauses (captionChunks) into their own synth+caption units.
      // All chunks of a segment share its build step; builds advance only at the
      // segment ([[step]]) boundary.
      segs.forEach((seg, k) => {
        const bs = Math.min(k, steps);
        for (const chunk of captionChunks(seg)) out.push({ slideIdx: si, buildStep: bs, text: chunk, dwellMs: 90 });
      });
      if (steps > segs.length - 1) out.push({ slideIdx: si, buildStep: steps, text: null, dwellMs: 500 });
    });
    return out;
  }, [slides, cpm]);
  const firstItemOfSlide = (si: number) => { const i = playlist.findIndex((it) => it.slideIdx === si); return i < 0 ? 0 : i; };

  const [slideIdx, setSlideIdx] = useState(0);
  const [buildStep, setBuildStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState('');
  const [scale, setScale] = useState(1);
  const [caption, setCaption] = useState('');       // the segment currently being spoken
  const [showCaptions, setShowCaptions] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const tokenRef = useRef(0);       // bumped to cancel the running loop
  const itemIdxRef = useRef(0);     // current playlist index (for resume)
  const utterRef = useRef<Utterance | null>(null);
  const sleepCtl = useRef<{ id: number; resolve: () => void } | null>(null);

  // Fit the fixed-size slide into the viewport (minus the control bar).
  useEffect(() => {
    if (!open) return;
    const fit = () => {
      const s = Math.min(window.innerWidth / slideSize.width, (window.innerHeight - 76) / slideSize.height);
      setScale(s > 0 && Number.isFinite(s) ? s : 1);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [open, slideSize.width, slideSize.height]);

  const stopAll = () => {
    tokenRef.current++;
    utterRef.current?.stop(); utterRef.current = null;
    if (sleepCtl.current) { window.clearTimeout(sleepCtl.current.id); const r = sleepCtl.current.resolve; sleepCtl.current = null; r(); }
  };

  // Fullscreen (on the player root, so it fills the display while playing).
  useEffect(() => {
    const onFs = () => setIsFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) { void document.exitFullscreen().catch(() => {}); }
    else if (rootRef.current) { void rootRef.current.requestFullscreen().catch(() => {}); }
  };
  // Leaving the player should also leave fullscreen.
  const closeAll = () => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); stopAll(); onClose(); };

  // Reset when (re)opened.
  useEffect(() => {
    if (open) { setSlideIdx(0); setBuildStep(0); setFinished(false); setError(''); setCaption(''); itemIdxRef.current = 0; }
    else { stopAll(); setPlaying(false); }
  }, [open]);
  useEffect(() => () => stopAll(), []);

  // Wait `ms`, but resolve early if stopAll() is called (so Pause/Next interrupt a dwell).
  const sleep = (ms: number) => new Promise<void>((res) => {
    const id = window.setTimeout(() => { sleepCtl.current = null; res(); }, ms);
    sleepCtl.current = { id, resolve: res };
  });

  // Kick off synthesis for one item (empty text → an instant no-op clip).
  const synthClip = (item: PlayItem): Promise<Clip> => synthesize(item?.text || '', ttsCfg);
  const disposeQuietly = async (p: Promise<Clip> | null) => { if (p) { try { (await p).dispose(); } catch { /* ignore */ } } };

  const run = async (fromItem: number) => {
    const my = ++tokenRef.current;
    setPlaying(true); setFinished(false); setError('');
    // Prefetch the first item's audio; thereafter each iteration hands its
    // prefetched-next clip to the following one, so VOICEVOX synthesis of the NEXT
    // segment overlaps playback of the current one (no silent gap between segments).
    let curClip: Promise<Clip> | null = playlist[fromItem] ? synthClip(playlist[fromItem]) : null;
    for (let i = fromItem; i < playlist.length; i++) {
      if (tokenRef.current !== my) { await disposeQuietly(curClip); return; }
      itemIdxRef.current = i;
      const item = playlist[i];
      setSlideIdx(item.slideIdx); setBuildStep(item.buildStep); setCaption('');
      const nextClip = (i + 1 < playlist.length) ? synthClip(playlist[i + 1]) : null;
      if (item.text) {
        let clip: Clip;
        try { clip = await (curClip ?? synthClip(item)); }
        catch (e) {
          setError(e instanceof Error ? e.message : 'Speech failed.');
          setPlaying(false); tokenRef.current++;
          await disposeQuietly(nextClip); return;
        }
        if (tokenRef.current !== my) { clip.dispose(); await disposeQuietly(nextClip); return; }
        setCaption(item.text);            // caption == the exact text now being spoken
        const u = clip.play(); utterRef.current = u;
        await u.done;
        if (tokenRef.current !== my) { await disposeQuietly(nextClip); return; }
        await sleep(item.dwellMs);
      } else {
        await sleep(item.dwellMs);
        if (tokenRef.current !== my) { await disposeQuietly(nextClip); return; }
      }
      curClip = nextClip;
    }
    if (tokenRef.current === my) { setPlaying(false); setFinished(true); }
  };

  const play = () => { if (finished) { itemIdxRef.current = 0; setSlideIdx(0); run(0); } else run(itemIdxRef.current); };
  const pause = () => { stopAll(); setPlaying(false); };
  const restart = () => { stopAll(); setFinished(false); setSlideIdx(0); setBuildStep(0); itemIdxRef.current = 0; run(0); };
  const jump = (delta: number) => {
    const ni = Math.max(0, Math.min(slides.length - 1, slideIdx + delta));
    const wasPlaying = playing;
    stopAll();
    const it = firstItemOfSlide(ni);
    itemIdxRef.current = it;
    setSlideIdx(ni); setBuildStep(0); setFinished(false);
    if (wasPlaying) run(it); else setPlaying(false);
  };

  if (!open) return null;
  const slide = slides[slideIdx];

  return (
    <div ref={rootRef} style={{ position: 'fixed', inset: 0, zIndex: 3000, background: '#000', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}>
        {slide && (
          <div style={{ width: slideSize.width, height: slideSize.height, transform: `scale(${scale})`, transformOrigin: 'center' }}>
            <SlideView
              html={slide.html}
              raw={slide.raw}
              slideSize={slideSize}
              basePath={basePath}
              buildStep={buildStep}
              presenting
              isActive
              slideIndex={slideIdx}
              header={slide.header}
              footer={slide.footer}
              className={slide.className}
              pageNumber={slideIdx + 1}
            />
          </div>
        )}
        {showCaptions && caption && (
          <div style={{
            position: 'absolute', left: '50%', bottom: 'clamp(16px, 4vh, 48px)', transform: 'translateX(-50%)',
            maxWidth: 'min(90%, 1100px)', padding: '8px 18px', borderRadius: 10,
            background: 'rgba(0,0,0,.72)', color: '#fff', textAlign: 'center',
            fontSize: 'clamp(16px, 2.4vw, 30px)', lineHeight: 1.35, fontWeight: 600,
            textShadow: '0 1px 3px rgba(0,0,0,.6)', pointerEvents: 'none', whiteSpace: 'pre-wrap',
          }}>{caption}</div>
        )}
      </div>

      <div style={{ height: 60, display: 'flex', alignItems: 'center', gap: 6, padding: '0 14px', background: 'rgba(20,20,22,.92)', color: '#eee' }}>
        <Tooltip title="Previous slide"><span><IconButton size="small" onClick={() => jump(-1)} sx={{ color: '#ddd' }} disabled={slideIdx <= 0}><SkipPreviousIcon /></IconButton></span></Tooltip>
        {playing
          ? <Tooltip title="Pause"><IconButton onClick={pause} sx={{ color: '#fff' }}><PauseIcon /></IconButton></Tooltip>
          : <Tooltip title={finished ? 'Play from start' : 'Play'}><IconButton onClick={play} sx={{ color: '#fff' }}><PlayArrowIcon /></IconButton></Tooltip>}
        <Tooltip title="Next slide"><span><IconButton size="small" onClick={() => jump(1)} sx={{ color: '#ddd' }} disabled={slideIdx >= slides.length - 1}><SkipNextIcon /></IconButton></span></Tooltip>
        <Tooltip title="Restart"><IconButton size="small" onClick={restart} sx={{ color: '#ddd' }}><ReplayIcon /></IconButton></Tooltip>
        <Tooltip title={showCaptions ? 'Hide subtitles' : 'Show subtitles'}><IconButton size="small" onClick={() => setShowCaptions((v) => !v)} sx={{ color: showCaptions ? '#fff' : '#889' }}>{showCaptions ? <SubtitlesIcon /> : <SubtitlesOffIcon />}</IconButton></Tooltip>

        <div style={{ fontVariantNumeric: 'tabular-nums', marginLeft: 8, fontSize: 14 }}>
          {slideIdx + 1} / {slides.length}
        </div>
        <div style={{ fontSize: 12, color: '#9aa', marginLeft: 12 }}>
          {settings.tts.engine === 'voicevox' ? 'VOICEVOX' : 'Web Speech'}
          {error ? <span style={{ color: '#f87171', marginLeft: 10 }}>{error}</span> : null}
          {finished && !error ? <span style={{ color: '#86efac', marginLeft: 10 }}>Finished</span> : null}
        </div>

        <div style={{ flex: 1 }} />

        {/* Voice playback speed (independent of the talk-time reading speed). */}
        <Tooltip title="Voice speed">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 150 }}>
            <span style={{ fontSize: 12, color: '#9aa' }}>Speed</span>
            <Slider size="small" min={0.5} max={2} step={0.1} value={settings.tts.rate}
              onChange={(_, v) => patchTts({ rate: v as number })} sx={{ width: 90, color: '#8ab4f8' }} />
            <span style={{ fontSize: 12, width: 30 }}>{settings.tts.rate.toFixed(1)}×</span>
          </div>
        </Tooltip>

        <Tooltip title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}><IconButton size="small" onClick={toggleFullscreen} sx={{ color: '#ddd' }}>{isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}</IconButton></Tooltip>
        <Tooltip title="Close"><IconButton onClick={closeAll} sx={{ color: '#ddd' }}><CloseIcon /></IconButton></Tooltip>
      </div>
    </div>
  );
};
