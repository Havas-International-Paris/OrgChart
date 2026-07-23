import { themeQuartz } from 'ag-grid-community';
import type { GridDensity } from '../stores/uiPreferencesStore';

// *VerticalPaddingScale (not rowHeight/headerHeight directly) is the
// documented way to shrink row/header height in AG Grid's v36 Theming API —
// it keeps height auto-adjusting to fontSize instead of hardcoding a pixel
// value that would drift out of sync with it.
const compactTheme = themeQuartz.withParams({
  spacing: 4,
  fontSize: 12,
  rowVerticalPaddingScale: 0.6,
  headerVerticalPaddingScale: 0.6,
  cellHorizontalPaddingScale: 0.75,
});

export function getGridTheme(density: GridDensity) {
  return density === 'compact' ? compactTheme : themeQuartz;
}

// Column widths don't respond to the theme params above — only row/header
// padding does — so compact mode needs its own explicit scale applied per
// colDef, on top of (not instead of) getting the base pixel value right.
export function scaleColumnWidth(px: number, density: GridDensity) {
  return density === 'compact' ? Math.round(px * 0.75) : px;
}
