import { isElectron } from '../../../api/apiClient';
import React, { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react';
import { DrawingOverlay, type Stroke } from '../../drawing/components/DrawingOverlay';
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
  moduleRole
}) => {
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
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
  const slideIndexRef = useRef(slideIndex);
  slideIndexRef.current = slideIndex;
  const moduleRoleRef = useRef(moduleRole);
  moduleRoleRef.current = moduleRole;
  const containerNodeRef = useRef<HTMLDivElement | null>(null);
  const moduleTeardownRef = useRef<(() => void) | undefined>(undefined);

  // Run (or re-run) the module scripts against the current content node, tearing
  // down the previous run first. Driven off the actual DOM node (not state) so it
  // works reliably even when the slide mounts mid-transition.
  const runModuleScripts = useCallback(() => {
    moduleTeardownRef.current?.();
    moduleTeardownRef.current = undefined;
    const node = containerNodeRef.current;
    if (!node || !isActiveRef.current) return;
    moduleTeardownRef.current = executeModuleScripts(node, {
      presenting: presentingRef.current,
      slideIndex: slideIndexRef.current,
      role: moduleRoleRef.current,
    });
  }, []);

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

    if (raw) {
      const dataUris: string[] = [];
      const regex = /!\[.*?\]\((data:image\/[^)]+)\)/g;
      let m;
      while ((m = regex.exec(raw)) !== null) {
        dataUris.push(m[1]);
      }

      if (dataUris.length > 0) {
        let i = 0;
        currentHtml = currentHtml.replace(/<img\s+([^>]*?)src=["']([^"']*)["']([^>]*?)>/gi, (match, before, src, after) => {
          if (src === '' || src === '#' || src.startsWith('data:')) {
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
      if (resolvedSrc.toLowerCase().includes('.svg')) {
        return `<object type="image/svg+xml" data="${resolvedSrc}" ${before} ${after} style="max-width: 100%; pointer-events: none;"></object>`;
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
      // A content mutation can replace build wrappers, dropping their
      // `mdp-build-shown` class; re-snap builds to the current step so a revealed
      // build doesn't vanish. (Module re-init alone does not restore build state.)
      const node = containerNodeRef.current;
      if (node && buildStepRef.current !== undefined) applyBuildStepInstant(node, buildStepRef.current);
      observer.observe(containerEl, { childList: true });
    });
    observer.observe(containerEl, { childList: true });
    return () => observer.disconnect();
  }, [containerEl, runModuleScripts]);

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

  // Tear down module scripts (clear timers etc.) when the slide unmounts.
  useEffect(() => () => { moduleTeardownRef.current?.(); }, []);

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
      className={`slide-content-wrapper markdown-body ${className}`}
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
      {header && <div className="slide-header" dangerouslySetInnerHTML={{ __html: header }} />}

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

      {footer && <div className="slide-footer" dangerouslySetInnerHTML={{ __html: footer }} />}
      {pageNumber && <div className="slide-page-number">{pageNumber}</div>}
    </div>
  );
});