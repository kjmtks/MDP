import React, { useEffect, useState } from 'react';
import type { FocusBox } from '../focus/focusTargets';
import type { LocatedItem } from './reviewModel';
import { anchorBox, itemColor, itemTooltip } from './reviewPlace';

interface Pin { id: string; label: string; x: number; y: number; box: FocusBox | null; color: string; tip: string }

/** The review items of the slide on the preview, as pins beside what they point at
 *  (in the slide's own px: this sits in the scaled slide box) — an open one numbered
 *  as in the Review panel, a closed one (shown only when its card was clicked) ✓. A
 *  click shows the item in the panel; hovering frames what it points at; `flashId`
 *  (its card was clicked) frames it and makes its pin pulse. */
export const ReviewPins: React.FC<{ items: LocatedItem[]; container: HTMLElement | null; onPick: (id: string) => void; flashId?: string | null }> = ({ items, container, onPick, flashId }) => {
  const [pins, setPins] = useState<Pin[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => {
    const root = container?.querySelector<HTMLElement>('.slide-content-wrapper');
    if (!root || !items.length) return undefined;
    const measure = () => {
      let loose = 0;
      let open = 0;
      setPins(items.map((it) => {
        const box = anchorBox(root, it);
        const at = box ? { x: Math.min(root.offsetWidth - 18, box.x + box.w + 4), y: Math.max(4, box.y - 14) } : { x: 8 + 34 * loose++, y: 8 };
        return { id: it.id, label: it.status === 'open' ? String(++open) : '✓', ...at, box, color: itemColor(it), tip: itemTooltip(it) };
      }));
    };
    // in the next frame, and again once the slide has settled (fonts, pictures, modules)
    const raf = requestAnimationFrame(measure);
    const t = window.setTimeout(measure, 450);
    const ro = new ResizeObserver(() => measure());
    ro.observe(root);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(t); ro.disconnect(); };
  }, [items, container]);
  // only these items' pins (a measurement of an earlier set is not shown)
  const live = pins.filter((p) => items.some((it) => it.id === p.id));
  if (!live.length) return null;
  const shown = live.find((p) => p.id === hover) || live.find((p) => p.id === flashId);
  return (
    <div className="mdp-review-pins" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 40 }}>
      {shown?.box && (
        <div className={`mdp-review-frame${shown.id === flashId && shown.id !== hover ? ' mdp-review-frame-flash' : ''}`} style={{ position: 'absolute', left: shown.box.x - 4, top: shown.box.y - 4, width: shown.box.w + 8, height: shown.box.h + 8, border: `3px dashed ${shown.color}`, borderRadius: 6 }} />
      )}
      {live.map((p) => (
        <button
          key={p.id} type="button" className={`mdp-review-pin mdp-interactive${p.id === flashId ? ' mdp-review-pin-flash' : ''}`} title={p.tip}
          onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover((h) => (h === p.id ? null : h))}
          onClick={(e) => { e.stopPropagation(); onPick(p.id); }}
          style={{
            position: 'absolute', left: p.x, top: p.y, width: 28, height: 28, borderRadius: '50%', border: '2px solid #fff',
            background: p.color, color: '#fff', font: '700 15px/24px system-ui, sans-serif', padding: 0, cursor: 'pointer',
            pointerEvents: 'auto', boxShadow: '0 1px 4px rgba(0,0,0,.35)',
          }}
        >{p.label}</button>
      ))}
    </div>
  );
};
