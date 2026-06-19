import { isElectron } from '../../../api/apiClient';
import React, { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react';
import { DrawingOverlay, type Stroke } from '../../drawing/components/DrawingOverlay';
import { ManipulationLayer, type ManipRuntime } from './ManipulationLayer';
import { getCachedSvg, getFallback, getSvgNode, loadSvg, registerDataUri } from '../inlineSvg';
import { executeModuleScripts } from '../../modules/moduleManager';
import { applyBuildStep, applyBuildStepInstant } from '../../effects/buildRuntime';
import './SlideViewer.css';
import './SlideBaseDesign.css';

interface SlideViewProps {
  html: string;
  raw?: string;
  basePath?: string;
  pageNumber?: number | null;
  isActive?: boolean;
  isEnabledPointerEvents?: boolean;
  slideSize: { width: number; height: number };
  style?: React.CSSProperties;
  className?: string;
  header?: string;
  footer?: string;
  drawings?: Stroke[];
  onAddStroke?: (stroke: Stroke) => void;
  onUpdateStrokes?: (indices: number[], dx: number, dy: number) => void;
  isInteracting?: boolean;
  toolType?: 'pen' | 'eraser' | 'select';
  color?: string;
  lineWidth?: number;
  penOnly?: boolean;
  // When set (slideshow only), drives in-slide build reveals for this step.
  buildStep?: number;
  // Called when a build with `auto` finishes — advances to the next step.
  onStepAutoAdvance?: () => void;
  // True in the fullscreen slideshow (passed to module scripts as ctx.presenting).
  presenting?: boolean;
  // This slide's index (for deterministic cross-surface module sync ids).
  slideIndex?: number;
  // 'owner' runs interactive-module logic; 'mirror' only displays synced state.
  moduleRole?: 'owner' | 'mirror';
  // STATIC surfaces (thumbnails, overview grid, print) set this false so they
  // never run module scripts. Otherwise every thumbnail would run the timer/clock
  // — N owners decrementing one shared timer = N× speed, plus wasted intervals.
  runScripts?: boolean;
  // When provided (editor preview only), enables on-preview module manipulation.
  manipulate?: ManipRuntime;
}

export const SlideView: React.FC<SlideViewProps> = memo(({
  html,
  raw,
  basePath = '',
  pageNumber,
  isActive = true,
  isEnabledPointerEvents = true,
  slideSize,
  style,
  className = '',
  header,
  footer,
  drawings = [],
  onAddStroke,
  onUpdateStrokes,
  isInteracting = false,
  toolType,
  color,
  lineWidth,
  penOnly,
  buildStep,
  onStepAutoAdvance,
  presenting,
  slideIndex,
  moduleRole,
  runScripts = true,
  manipulate
}) => {
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  // Header/footer DOM as state too, so the ManipulationLayer can manipulate their
  // modules (in addition to the refs used for running their scripts).
  const [headerEl, setHeaderEl] = useState<HTMLDivElement | null>(null);
  const [footerEl, setFooterEl] = useState<HTMLDivElement | null>(null);
  const [svgVersion, setSvgVersion] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mountedRoots = useRef<any[]>([]);
  const prevBuildStepRef = useRef<number | null>(null);
  const buildContentRef = useRef<string>('');
  const autoTimerRef = useRef<number | null>(null);
  const onAutoRef = useRef(onStepAutoAdvance);
  onAutoRef.current = onStepAutoAdvance;
  const buildStepRef = useRef(buildStep);
  buildStepRef.current = buildStep;
  // Latest values read by the stable ref callback / module runner.
  const presentingRef = useRef(presenting);
  presentingRef.current = presenting;
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  const runScriptsRef = useRef(runScripts);
  runScriptsRef.current = runScripts;
  const slideIndexRef = useRef(slideIndex);
  slideIndexRef.current = slideIndex;
  const moduleRoleRef = useRef(moduleRole);
  moduleRoleRef.current = moduleRole;
  const containerNodeRef = useRef<HTMLDivElement | null>(null);
  const moduleTeardownRef = useRef<(() => void) | undefined>(undefined);
  // Header / footer are separate sibling nodes (not inside .slide-content), so
  // their module scripts (timer/clock ticking, click handlers) must be run
  // against those nodes too — otherwise modules placed in @header/@footer never
  // initialise.
  const headerNodeRef = useRef<HTMLDivElement | null>(null);
  const footerNodeRef = useRef<HTMLDivElement | null>(null);
  const headerTeardownRef = useRef<(() => void) | undefined>(undefined);
  const footerTeardownRef = useRef<(() => void) | undefined>(undefined);

  // Run (or re-run) module scripts against a chrome node (header/footer).
  const runChromeScripts = useCallback((node: HTMLElement | null, teardownRef: React.MutableRefObject<(() => void) | undefined>) => {
    teardownRef.current?.();
    teardownRef.current = undefined;
    if (!node || !isActiveRef.current || !runScriptsRef.current) return;
    teardownRef.current = executeModuleScripts(node, {
      presenting: presentingRef.current,
      slideIndex: slideIndexRef.current,
      role: moduleRoleRef.current,
    });
  }, []);
  const setHeaderNode = useCallback((node: HTMLDivElement | null) => {
    headerNodeRef.current = node;
    setHeaderEl(node);
    if (!node) { headerTeardownRef.current?.(); headerTeardownRef.current = undefined; }
  }, []);
  const setFooterNode = useCallback((node: HTMLDivElement | null) => {
    footerNodeRef.current = node;
    setFooterEl(node);
    if (!node) { footerTeardownRef.current?.(); footerTeardownRef.current = undefined; }
  }, []);

  // Run (or re-run) the module scripts against the current content node, tearing
  // down the previous run first. Driven off the actual DOM node (not state) so it
  // works reliably even when the slide mounts mid-transition.
  const runModuleScripts = useCallback(() => {
    // Header/footer live in separate sibling nodes — run them via this SAME
    // reliable trigger (rAF / effects / observer) so they initialise everywhere
    // the content does (incl. the fullscreen slideshow), not a fragile side path.
    runChromeScripts(headerNodeRef.current, headerTeardownRef);
    runChromeScripts(footerNodeRef.current, footerTeardownRef);
    moduleTeardownRef.current?.();
    moduleTeardownRef.current = undefined;
    const node = containerNodeRef.current;
    if (!node || !isActiveRef.current || !runScriptsRef.current) return;
    moduleTeardownRef.current = executeModuleScripts(node, {
      presenting: presentingRef.current,
      slideIndex: slideIndexRef.current,
      role: moduleRoleRef.current,
    });
  }, [runChromeScripts]);

  // Stable ref callback for the content node. Besides exposing it as state (for
  // chart effects), it: (1) snaps in-slide builds to the current step
  // SYNCHRONOUSLY on attach (before paint) so backward nav doesn't flash; and
  // (2) runs module scripts on the real node (after paint) — reliable during
  // transitions where the containerEl state update could otherwise be missed.
  const setContent = useCallback((node: HTMLDivElement | null) => {
    setContainerEl(node);
    containerNodeRef.current = node;
    if (node) {
      if (buildStepRef.current !== undefined) applyBuildStepInstant(node, buildStepRef.current);
      requestAnimationFrame(() => { if (containerNodeRef.current === node) runModuleScripts(); });
    } else {
      moduleTeardownRef.current?.();
      moduleTeardownRef.current = undefined;
    }
  }, [runModuleScripts]);

  const processedHtml = useMemo(() => {
    if (!html) return '';
    let currentHtml = html;
    currentHtml = currentHtml.replace(/([，．、。]) +(<[a-zA-Z0-9-]+[^>]*class="[^"]*(?:katex|math)[^"]*"[^>]*>|<math[^>]*>|<mjx-container[^>]*>)/gi, '$1$2');

    const resolvePath = (src: string) => {
      if (src.startsWith('http') || src.startsWith('data:') || src.startsWith('blob:') || src.startsWith('/files/') || src.startsWith('mdp-file://')) return src;

      const [pathPart, queryPart] = src.split('?');
      let targetPath = '';

      if (pathPart.startsWith('/')) {
        targetPath = pathPart.substring(1);
      } else {
        targetPath = basePath ? `${basePath}/${pathPart}` : pathPart;
      }

      try { targetPath = decodeURIComponent(targetPath); } catch { /* ignore */ }

      const cleanUrl = targetPath.split('/').map(encodeURIComponent).join('/');
      const prefix = isElectron() ? 'mdp-file://' : '/files/';
      return `${prefix}${cleanUrl}${queryPart ? '?' + queryPart : ''}`;
    };

    // Workspace-relative path (decoded) for a src, used to read the SVG via the
    // file API for inlining. Strips any already-applied URL prefix.
    const toWorkspacePath = (src: string): string => {
      let s = src.split('?')[0];
      if (s.startsWith('mdp-file://')) s = s.slice('mdp-file://'.length);
      else if (s.startsWith('/files/')) s = s.slice('/files/'.length);
      else if (s.startsWith('/')) s = s.slice(1);
      else s = basePath ? `${basePath}/${s}` : s;
      try { s = decodeURIComponent(s); } catch { /* ignore */ }
      return s;
    };

    if (raw) {
      const dataUris: string[] = [];
      const regex = /!\[.*?\]\((data:image\/[^)]+)\)/g;
      let m;
      while ((m = regex.exec(raw)) !== null) {
        // SVG data-URIs are kept as-is (inlined later) and never blobbed, so they
        // must NOT take part in this order-based restoration — including them
        // would shift the alignment and feed the wrong data-URI to raster images.
        if (!/^data:image\/svg/i.test(m[1])) dataUris.push(m[1]);
      }

      if (dataUris.length > 0) {
        let i = 0;
        currentHtml = currentHtml.replace(/<img\s+([^>]*?)src=["']([^"']*)["']([^>]*?)>/gi, (match, before, src, after) => {
          if (src === '' || src === '#' || (src.startsWith('data:') && !/^data:image\/svg/i.test(src))) {
            const dataUri = dataUris[i] || src;
            i++;
            return `<img ${before}src="${dataUri}"${after}>`;
          }
          return match;
        });
      }
    }

    currentHtml = currentHtml.replace(/<img\s+([^>]*?)src=["']([^"']+)["']([^>]*?)>/gi, (_, before, src, after) => {
      if (src.includes('blob:')) {
        const blobMatch = src.match(/(blob:[^"'?&]+)/i);
        if (blobMatch) return `<img ${before}src="${blobMatch[1]}"${after}>`;
      }
      const resolvedSrc = resolvePath(src);
      const isSvg = resolvedSrc.toLowerCase().split('?')[0].endsWith('.svg') || /^data:image\/svg/i.test(src);
      if (isSvg) {
        // drawio/SVG → a placeholder carrying a cache KEY; a layout effect injects
        // the inline SVG into it (NOT into this html string — that keeps the SVG's
        // internal url(#id) refs out of the style-url rewriting below). data-URIs
        // register synchronously so they inject before paint (no blank gap);
        // workspace files load async then re-inject. http/blob keep <object>.
        if (/^data:image\/svg/i.test(src)) {
          const key = registerDataUri(src);
          return `<span class="mdp-drawio-svg" data-svg-key="${key}"></span>`;
        }
        if (/^(https?:|blob:)/i.test(src)) {
          return `<object type="image/svg+xml" data="${resolvedSrc}" style="max-width:100%;pointer-events:none;"></object>`;
        }
        const esc = toWorkspacePath(src).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
        return `<span class="mdp-drawio-svg" data-svg-key="${esc}" data-svg-load="${esc}"></span>`;
      }
      return `<img ${before}src="${resolvedSrc}"${after}>`;
    });

    currentHtml = currentHtml.replace(/<link\s+([^>]*?)href=["']([^"']+)["']([^>]*?)>/gi, (_, before, href, after) => {
      return `<link ${before}href="${resolvePath(href)}"${after}>`;
    });

    currentHtml = currentHtml.replace(/style=["']([^"']+)["']/gi, (match, styleContent) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newStyle = styleContent.replace(/url\((['"]?)([^'"()]+)\1\)/gi, (urlMatch: any, quote: any, url: string) => {
        if (url.startsWith('data:') || url.startsWith('http') || url.startsWith('blob:')) return urlMatch;
        return `url(${quote}${resolvePath(url)}${quote})`;
      });
      return match.replace(styleContent, newStyle);
    });

    currentHtml = currentHtml.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (match, styleContent) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newStyle = styleContent.replace(/url\((['"]?)([^'"()]+)\1\)/gi, (urlMatch: any, quote: any, url: string) => {
        if (url.startsWith('data:') || url.startsWith('http') || url.startsWith('blob:')) return urlMatch;
        return `url(${quote}${resolvePath(url)}${quote})`;
      });
      return match.replace(styleContent, newStyle);
    });

    return currentHtml;
  }, [html, raw, basePath]);

  // Inject inline SVG into `.mdp-drawio-svg` placeholders BEFORE paint, so the
  // per-commit innerHTML replace never shows the white flash an <object> reload
  // would. Cached (incl. all data-URIs) inject immediately; uncached workspace
  // files are fetched then re-injected. On a processing failure the placeholder
  // gets the original <object> (never empty). Idempotent: a placeholder that
  // already holds its SVG (`data-svg-done` AND a child node) is skipped, so this
  // can safely be called from any path (render, toggle, DOM mutation) — it only
  // (re)fills EMPTY placeholders. The `firstChild` check matters because a
  // content re-render can drop the injected child while a stale attribute lingers
  // on a reused span.
  const injectInlineSvgs = useCallback(() => {
    const node = containerNodeRef.current;
    if (!node) return;
    const pending = new Set<string>();
    node.querySelectorAll<HTMLElement>('.mdp-drawio-svg[data-svg-key]').forEach((ph) => {
      if (ph.getAttribute('data-svg-done') === '1' && ph.firstChild) return;
      const key = ph.getAttribute('data-svg-key') || '';
      const svg = getCachedSvg(key);
      if (svg !== undefined) {
        if (svg) {
          // Inject a clone of the pre-parsed node (fast) rather than re-parsing
          // the SVG string on every re-render.
          const frag = getSvgNode(key);
          if (frag) { ph.textContent = ''; ph.appendChild(frag); }
          else ph.innerHTML = svg;
        } else {
          const fb = getFallback(key);
          if (fb) ph.innerHTML = `<object type="image/svg+xml" data="${fb}" style="max-width:100%;pointer-events:none;"></object>`;
        }
        ph.setAttribute('data-svg-done', '1');
      } else {
        const loadPath = ph.getAttribute('data-svg-load');
        if (loadPath) pending.add(loadPath);
      }
    });
    if (pending.size) {
      Promise.all([...pending].map((p) => loadSvg(p))).then(() => setSvgVersion((v) => v + 1));
    }
  }, []);

  // Re-inject before paint whenever the content, this surface's edit-layout mode,
  // or an async SVG load changes. `manipulate?.enabled` is included because
  // toggling edit-layout can re-create the content DOM (clearing injected SVGs)
  // on a path that doesn't change `processedHtml`.
  useLayoutEffect(() => {
    injectInlineSvgs();
  }, [processedHtml, containerEl, svgVersion, manipulate?.enabled, injectInlineSvgs]);

  useEffect(() => {
    if (!containerEl) return;

    mountedRoots.current.forEach(root => {
      try { root.unmount(); } catch { /* ignore */ }
    });
    mountedRoots.current = [];

    const chartContainers = containerEl.querySelectorAll('.chartjs-render:not([data-processed="true"])');
    if (chartContainers.length > 0) {
      import('chart.js/auto').then(({ default: Chart }) => {
        chartContainers.forEach(container => {
          if ((container as HTMLElement).offsetParent === null && !isActive) return;
          container.setAttribute('data-processed', 'true');
          const canvas = container.querySelector('canvas');
          const base64 = container.getAttribute('data-chart');
          if (canvas && base64) {
            try {
              const binString = atob(base64);
              const bytes = new Uint8Array(binString.length);
              for (let i = 0; i < binString.length; i++) {
                bytes[i] = binString.charCodeAt(i);
              }
              const jsonStr = new TextDecoder().decode(bytes);
              const config = JSON.parse(jsonStr);
              if (!config.options) config.options = {};
              config.options.maintainAspectRatio = false;
              config.options.responsive = true;

              new Chart(canvas, config);
            } catch (e) {
              console.error("ChartJS render error:", e);
              container.innerHTML = `<div style="color:red">Chart Render Error</div>`;
            }
          }
        });
      }).catch(err => {
        console.warn("Chart.js not found.", err);
      });
    }
    return () => {
      mountedRoots.current.forEach(root => {
        try { root.unmount(); } catch { /* ignore */ }
      });
      mountedRoots.current = [];
    };
  }, [processedHtml, containerEl, isActive]);

  // Re-run module scripts whenever the slide's top-level content DOM is replaced
  // (React re-sets innerHTML — e.g. a transition re-render), so interactive
  // modules (timers etc.) re-init on the new DOM instead of becoming detached.
  // Watch only direct children (childList, not subtree) so a module's own deep
  // updates (e.g. timer textContent) don't retrigger it. The initial mount is
  // handled by setContent's run, which happens before the observer is attached.
  useEffect(() => {
    if (!containerEl) return;
    const observer = new MutationObserver(() => {
      observer.disconnect();
      runModuleScripts();
      // The content DOM was replaced (e.g. a re-render or transition) — its
      // injected inline SVGs are gone with it, so re-fill the placeholders.
      injectInlineSvgs();
      // A content mutation can replace build wrappers, dropping their
      // `mdp-build-shown` class; re-snap builds to the current step so a revealed
      // build doesn't vanish. (Module re-init alone does not restore build state.)
      const node = containerNodeRef.current;
      if (node && buildStepRef.current !== undefined) applyBuildStepInstant(node, buildStepRef.current);
      observer.observe(containerEl, { childList: true });
    });
    observer.observe(containerEl, { childList: true });
    return () => observer.disconnect();
  }, [containerEl, runModuleScripts, injectInlineSvgs]);

  // Re-run module scripts when this surface's ownership role flips on an already
  // mounted slide (e.g. the editor preview goes owner→mirror when the fullscreen
  // slideshow starts). This tears down the previous role's logic (stopping a
  // duplicate owner interval) and re-inits in the new role. Skips the initial
  // mount, which setContent already handles.
  const didMountRoleRef = useRef(false);
  useEffect(() => {
    if (!didMountRoleRef.current) { didMountRoleRef.current = true; return; }
    if (!containerNodeRef.current) return;
    runModuleScripts();
  }, [moduleRole, runModuleScripts]);

  // Safety net: reliably (re)run content module scripts after the rendered HTML or
  // active state settles. Effects always fire after commit — unlike the rAF in
  // setContent, which can be skipped during a fast re-render or a fullscreen
  // transition (slideshow), leaving interactive modules (timer/clock) un-init'd
  // ("stuck at the initial value"). runModuleScripts tears down first, so this is
  // idempotent.
  // Includes header/footer (runModuleScripts now runs them) and `presenting`, so
  // they re-init when their HTML changes AND the timer autostart re-evaluates when
  // a slide starts presenting (entering the fullscreen slideshow).
  useEffect(() => {
    if (isActive) runModuleScripts();
  }, [processedHtml, header, footer, isActive, presenting, moduleRole, runModuleScripts]);

  // Tear down module scripts (clear timers etc.) when the slide unmounts.
  useEffect(() => () => {
    moduleTeardownRef.current?.();
    headerTeardownRef.current?.();
    footerTeardownRef.current?.();
  }, []);

  // In-slide builds (slideshow only). Single before-paint effect: on content
  // (re)mount snap builds to the current step; on a step change animate. If the
  // entered build requests `auto`, schedule an automatic advance.
  useLayoutEffect(() => {
    if (autoTimerRef.current) { window.clearTimeout(autoTimerRef.current); autoTimerRef.current = null; }
    if (!containerEl || buildStep === undefined) return;
    const remounted = buildContentRef.current !== processedHtml;
    buildContentRef.current = processedHtml;
    const prev = prevBuildStepRef.current;
    let autoMs: number | null = null;
    if (remounted || prev === null) {
      // Fresh content / first run → snap, no animation, no auto-advance.
      applyBuildStepInstant(containerEl, buildStep);
    } else if (buildStep === prev + 1) {
      // A single forward step → animate the entering build(s); may auto-advance.
      autoMs = applyBuildStep(containerEl, buildStep, prev).autoAdvanceMs;
    } else if (buildStep !== prev) {
      // Backward / multi-step jump (e.g. returning to a slide) → snap, no auto.
      applyBuildStepInstant(containerEl, buildStep);
    }
    prevBuildStepRef.current = buildStep;
    if (autoMs != null) {
      autoTimerRef.current = window.setTimeout(() => { onAutoRef.current?.(); }, autoMs);
    }
  }, [containerEl, processedHtml, buildStep]);

  // Cancel a pending auto-advance as soon as this frame stops being the current
  // (interactive) one — e.g. it became the outgoing frame of a transition. This
  // prevents a stale timer from firing later (after the frame is reused) and
  // jumping the presentation forward.
  useEffect(() => {
    if (!onStepAutoAdvance && autoTimerRef.current) {
      window.clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
  }, [onStepAutoAdvance]);

  useEffect(() => () => { if (autoTimerRef.current) window.clearTimeout(autoTimerRef.current); }, []);

  return (
    <div
      className={`slide-content-wrapper markdown-body ${className} ${manipulate?.enabled ? 'mdp-manip-editing' : ''}`}
      style={{
        width: `${slideSize.width}px`, height: `${slideSize.height}px`,
        display: isActive ? 'block' : 'none', position: 'relative',
        backgroundColor: 'white', boxSizing: 'border-box', overflow: 'hidden',
        pointerEvents: isEnabledPointerEvents ? 'auto' : 'none',
        userSelect: isEnabledPointerEvents ? 'auto' : 'none',
        ...style,
        ...({
          '--slide-width': `${slideSize.width}px`, '--slide-height': `${slideSize.height}px`,
          '--slide-aspect-ratio': `${slideSize.width}/${slideSize.height}`,
        } as React.CSSProperties)
      }}
    >
      {header && <div ref={setHeaderNode} className="slide-header" dangerouslySetInnerHTML={{ __html: header }} />}

      <div
        ref={setContent} className={`slide-content ${className} ${buildStep !== undefined ? 'mdp-build-active' : ''}`}
        dangerouslySetInnerHTML={{ __html: processedHtml }}
        style={{ width: '100%', height: '100%' }}
      />

      {((drawings && drawings.length > 0) || isInteracting) && (
        <DrawingOverlay
          width={slideSize.width} height={slideSize.height} data={drawings || []}
          isInteracting={isInteracting} onAddStroke={onAddStroke} onUpdateStrokes={onUpdateStrokes}
          toolType={toolType} color={color} lineWidth={lineWidth} penOnly={penOnly}
        />
      )}

      {manipulate && (
        <ManipulationLayer container={containerEl} headerContainer={headerEl} footerContainer={footerEl} runtime={manipulate} />
      )}

      {footer && <div ref={setFooterNode} className="slide-footer" dangerouslySetInnerHTML={{ __html: footer }} />}
      {pageNumber && <div className="slide-page-number">{pageNumber}</div>}
    </div>
  );
});