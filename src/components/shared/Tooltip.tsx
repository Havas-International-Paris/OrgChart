import { useEffect, useLayoutEffect, useRef, useState } from 'react';

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  // Set false to suppress the hover tooltip entirely (e.g. CommentFlag's
  // trigger while its own click-popover is open — the two must not fight
  // over the same hover state).
  enabled?: boolean;
}

// Generic hover tooltip — built to replace native `title` where a shorter,
// tunable trigger delay is wanted (native title's ~0.5-1.5s browser/OS
// delay can't be adjusted) and to cover a hover target native title was
// never wired to at all (a CascadeCell's raw value, see TimeEstimationGrid.tsx).
// Positioned via `position: fixed` + viewport-clamping, the same two-step
// "place then clamp via useLayoutEffect" approach as ContextMenu.tsx/
// CommentFlag.tsx's popovers — sidesteps clipping from the grid's own
// overflow-auto/truncate ancestors, which a plain `absolute` tooltip
// wouldn't. Deliberately no click/keyboard handling (pure hover, unlike
// CommentFlag's popover) — much simpler: no outside-click listener, no
// Escape, hides immediately on mouseleave.
export function Tooltip({ content, children, enabled = true }: TooltipProps) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const showTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  // Anchored to the CURSOR position at the moment the hover started, not
  // the trigger element's own bounding box — the trigger wrapper below is
  // `display: contents` (kept layout-neutral among flex/grid siblings), and
  // an element with no box of its own returns an all-zero
  // getBoundingClientRect(), which is what put every tooltip in the
  // viewport's top-left corner regardless of where the mouse actually was.
  function handleMouseEnter(e: React.MouseEvent) {
    if (!enabled || !content) return;
    const { clientX, clientY } = e;
    if (showTimeoutRef.current != null) clearTimeout(showTimeoutRef.current);
    showTimeoutRef.current = setTimeout(() => {
      setPos({ x: clientX + 12, y: clientY + 16 });
      setOpen(true);
    }, 400);
  }

  function handleMouseLeave() {
    if (showTimeoutRef.current != null) {
      clearTimeout(showTimeoutRef.current);
      showTimeoutRef.current = null;
    }
    setOpen(false);
  }

  useEffect(() => {
    if (!enabled) {
      setOpen(false);
      if (showTimeoutRef.current != null) clearTimeout(showTimeoutRef.current);
    }
  }, [enabled]);

  useEffect(() => () => {
    if (showTimeoutRef.current != null) clearTimeout(showTimeoutRef.current);
  }, []);

  // Clamps against the viewport once the tooltip has a real size to
  // measure — same two-step approach as ContextMenu.tsx/CommentFlag.tsx.
  useLayoutEffect(() => {
    if (!open) return;
    const tooltip = tooltipRef.current;
    if (!tooltip) return;
    const rect = tooltip.getBoundingClientRect();
    setPos((p) => ({
      x: Math.max(8, Math.min(p.x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(p.y, window.innerHeight - rect.height - 8)),
    }));
  }, [open]);

  if (!content) return <>{children}</>;

  return (
    <span onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} className="contents">
      {children}
      {open && (
        <div
          ref={tooltipRef}
          style={{ position: 'fixed', left: pos.x, top: pos.y }}
          className="z-40 max-w-xs rounded bg-slate-900 px-2 py-1 text-xs text-white shadow-lg"
        >
          {content}
        </div>
      )}
    </span>
  );
}
