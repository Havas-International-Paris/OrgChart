import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface ContextMenuItem {
  label: string;
  danger?: boolean;
  onSelect: () => void;
}

export type ContextMenuEntry = ContextMenuItem | { separator: true };

interface ContextMenuProps {
  x: number;
  y: number;
  header?: string;
  entries: ContextMenuEntry[];
  onClose: () => void;
}

// Generic right-click menu, positioned at raw client coordinates — shared by
// NodeContextMenu.tsx (employee cards) and OrgChartView.tsx's own inline use
// for links (backlog item 34's card menu, extracted into this the same day a
// second, simpler menu — one item, no header — was needed for edges, rather
// than duplicating the positioning/outside-click/escape machinery twice).
//
// Rendered as a sibling of <ReactFlow>, not inside a node or edge, so
// `position: fixed` at the click's own client coordinates is unaffected by
// the chart's pan/zoom transform — the same reason the existing modals/
// detail panel already render at that level.
export function ContextMenu({ x, y, header, entries, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Clamped position, applied after the menu has a real size to measure —
  // starts at the raw click point so there's no visible jump on the frame it
  // actually renders off-screen (rare, only near the viewport's own
  // right/bottom edge).
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const clampedX = Math.min(x, window.innerWidth - rect.width - 8);
    const clampedY = Math.min(y, window.innerHeight - rect.height - 8);
    setPos({ x: Math.max(8, clampedX), y: Math.max(8, clampedY) });
  }, [x, y]);

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    // Capture phase, deliberately — plenty of chart controls (CollapseBadge,
    // PhotoAvatar, the edge hit-test path, the assignment gauges…) call
    // e.stopPropagation() in their own handlers to keep clicks from
    // bubbling up to onNodeClick/onPaneClick. A bubble-phase listener here
    // would never fire for a click on any of them, since stopPropagation
    // halts the native event before it reaches `document` on the way up —
    // the menu would only ever close on a click that happened to land
    // somewhere with no stopPropagation at all (blank canvas). Capture
    // fires top-down, before the click reaches its target and before any
    // such call, so it can't be blocked this way.
    document.addEventListener('mousedown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      data-export-hide
      style={{ position: 'fixed', left: pos.x, top: pos.y }}
      className="z-20 w-56 rounded-md border border-slate-200 bg-white py-1 shadow-lg"
    >
      {header && (
        <div className="truncate px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          {header}
        </div>
      )}
      {entries.map((entry, i) =>
        'separator' in entry ? (
          <div key={`separator-${i}`} className="my-1 border-t border-slate-100" />
        ) : (
          <button
            key={entry.label}
            type="button"
            onClick={() => {
              entry.onSelect();
              onClose();
            }}
            className={`block w-full px-3 py-1.5 text-left text-xs ${
              entry.danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            {entry.label}
          </button>
        ),
      )}
    </div>
  );
}
