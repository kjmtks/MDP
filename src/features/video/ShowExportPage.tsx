import { useCallback, useEffect, useMemo, useState } from 'react';
import { AutoPlayView, type AutoPlayExportEvent, type AutoPlayExportMode } from '../autoplay/AutoPlayView';
import { clearAllModules, registerParsedModule } from '../modules/moduleManager';
import { clearAllEffects, registerParsedEffect } from '../effects/effectManager';
import { applyFontCss } from '../fonts/fontRuntime';
import { showExportChannel, type ShowExportDeck, type ShowExportMessage } from './videoTypes';

// The hidden window of an "exact" video export (`#/show-export?job=…`, opened by the
// main process at the slide's size): the REAL narrated auto-play of a deck, which the
// page that queued the job records as a tab (showRecorder.ts). The deck arrives over
// a BroadcastChannel of the job's own — never the presentation's sync channel, so
// the modules here (the owners of this show) can neither reach nor be reached by
// the editor's. The main process mutes this window: the recording still hears it.
export default function ShowExportPage() {
  const [job] = useState(() => new URLSearchParams(window.location.hash.split('?')[1] || '').get('job') || '');
  // Opened once for the page's life — the window is the job, and is destroyed with it.
  const [channel] = useState(() => (job ? new BroadcastChannel(showExportChannel(job)) : null));
  const [deck, setDeck] = useState<ShowExportDeck | null>(null);
  const [go, setGo] = useState(false);

  useEffect(() => {
    document.title = 'MDP — Video export';
    if (!channel) return undefined;
    const onMessage = (ev: MessageEvent<ShowExportMessage>) => {
      const m = ev.data;
      if (m.type === 'deck') {
        clearAllModules();
        m.deck.modules.forEach(registerParsedModule);
        clearAllEffects();
        m.deck.effects.forEach(registerParsedEffect);
        applyFontCss(document, m.deck.fontCss || '');
        if (m.deck.themeCssUrl) {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = m.deck.themeCssUrl;
          document.head.appendChild(link);
        }
        setDeck(m.deck);
      } else if (m.type === 'go') {
        setGo(true);
      }
    };
    channel.addEventListener('message', onMessage);
    channel.postMessage({ type: 'ready' } satisfies ShowExportMessage);
    return () => channel.removeEventListener('message', onMessage);
  }, [channel]);

  const onEvent = useCallback((event: AutoPlayExportEvent) => {
    channel?.postMessage({ type: 'event', event } satisfies ShowExportMessage);
  }, [channel]);
  const exportMode = useMemo<AutoPlayExportMode | undefined>(
    () => (deck ? { tts: deck.tts, cpm: deck.cpm, captions: deck.captions, go, onEvent } : undefined),
    [deck, go, onEvent],
  );

  if (!deck || !exportMode) return <div style={{ position: 'fixed', inset: 0, background: '#000' }} />;
  return (
    <AutoPlayView open onClose={() => { /* the recorder closes this window */ }}
      slides={deck.slides} slideSize={deck.slideSize} basePath={deck.basePath}
      globalTransition={deck.globalMotion} exportMode={exportMode} />
  );
}
