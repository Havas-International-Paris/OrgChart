export interface TrendSparklinePoint {
  key: string;
  value: number | null;
}

interface TrendSparklineProps {
  points: TrendSparklinePoint[];
  // Index (into `points`) from which values are projected/planned rather
  // than observed actual — the segment leading into that point, and every
  // segment after it, renders dashed with a hollow marker instead of a
  // filled one, so the reader can tell "measured" from "estimated" at a
  // glance without a legend.
  projectedFromIndex?: number;
  width?: number;
  height?: number;
}

// Hand-rolled inline SVG — no charting library in this repo (see CLAUDE.md).
// Null values (a month with no data) are skipped when drawing segments
// rather than treated as zero, so a gap in the data reads as a gap in the
// line, not a dip to the bottom.
export function TrendSparkline({ points, projectedFromIndex, width = 96, height = 28 }: TrendSparklineProps) {
  const padding = 3;
  const values = points.map((p) => p.value).filter((v): v is number => v != null);

  if (values.length === 0) {
    return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" />;
  }

  const min = Math.min(0, ...values);
  const max = Math.max(...values, min + 1);
  const stepX = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;
  const toXY = (index: number, value: number) => ({
    x: padding + index * stepX,
    y: padding + (1 - (value - min) / (max - min)) * (height - padding * 2),
  });

  const plotted = points.map((p, index) => (p.value == null ? null : { index, ...toXY(index, p.value) }));
  const known = plotted.filter((p): p is { index: number; x: number; y: number } => p !== null);
  const last = known[known.length - 1];

  const segments: { x1: number; y1: number; x2: number; y2: number; projected: boolean }[] = [];
  for (let i = 0; i < known.length - 1; i += 1) {
    const from = known[i];
    const to = known[i + 1];
    segments.push({
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      projected: projectedFromIndex != null && to.index >= projectedFromIndex,
    });
  }

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {segments.map((s, i) => (
        <line
          key={i}
          x1={s.x1}
          y1={s.y1}
          x2={s.x2}
          y2={s.y2}
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeDasharray={s.projected ? '3 2' : undefined}
          opacity={0.7}
        />
      ))}
      {known.map((p) => {
        const isProjected = projectedFromIndex != null && p.index >= projectedFromIndex;
        return (
          <circle
            key={p.index}
            cx={p.x}
            cy={p.y}
            r={p === last ? 2.2 : 1.4}
            fill={isProjected ? 'transparent' : 'currentColor'}
            stroke="currentColor"
            strokeWidth={isProjected ? 1.2 : 0}
            opacity={p === last ? 1 : 0.6}
          />
        );
      })}
    </svg>
  );
}
