import { useLayoutEffect, useRef, useState } from 'react';
import { Tooltip } from './Tooltip';

// Tooltip has no overflow-awareness of its own — this measures scrollWidth
// vs clientWidth in a layout effect (mount + whenever `text` changes, not
// on every hover) so `enabled` is already correct before any hover starts.
// Measuring lazily on hover instead would race Tooltip's own onMouseEnter
// on the very first hover (both fire off the same event, before the
// resulting state update re-renders), so don't "optimize" this back to a
// hover-time measurement.
export function TruncatedLabel({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    setTruncated(!!el && el.scrollWidth > el.clientWidth);
  }, [text]);

  return (
    <Tooltip content={text} enabled={truncated}>
      <span ref={ref} className={className}>
        {text}
      </span>
    </Tooltip>
  );
}
