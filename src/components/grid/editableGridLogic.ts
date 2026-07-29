import type { GridDensity } from '../../stores/uiPreferencesStore';

// Pure logic behind the left panel's inline editing — extracted so the two
// trickiest decisions (what Tab does next, and when a freshly-added row becomes
// a real database row) are unit-testable without mounting a grid. This is what
// replaced AG Grid's built-in cell-to-cell navigation, whose default behaviour is
// exactly what caused backlog item 31's symptom (c): Tab silently entering edit
// mode on an unrelated select column.
//
// Everything here is generic over the row type: the same helpers back the
// employees grid and the three catalog grids (Postes, Business Units,
// Clients/Missions), which differ only in their field list.

export type FieldKind = 'text' | 'select';

// Tab moves to the next editable field of the SAME row and stops at the end —
// it deliberately never wraps to the next row's first field. Per-user decision
// (2026-07-27): explicit request, consistent with "no spreadsheet-style keyboard
// navigation" from the item 31 interview.
export function nextField<F extends string>(fields: readonly F[], current: F): F | null {
  const index = fields.indexOf(current);
  if (index === -1) return null;
  return fields[index + 1] ?? null;
}

// null/empty sorts first — the single sort rule for all four grids.
export function compareValues(a: string | null, b: string | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (a === b) return 0;
  return a > b ? 1 : -1;
}

// The stand-in for a row currently being edited, used ONLY for sort-order
// comparison — never for display. Freezing the whole row (not just the field
// being typed into) matches the old AG Grid comparator's behaviour: editing
// Poste must not let the row jump because Nom's snapshot went stale, since both
// still reflect the same pre-edit moment.
export function effectiveForSort<Row extends { id: string }>(
  row: Row,
  frozen: { id: string; snapshot: Row } | null,
): Row {
  return frozen && frozen.id === row.id ? frozen.snapshot : row;
}

// A row created by "+ Ajouter" stays a local-only draft (never written to
// Supabase) until at least one of its identifying fields has real content —
// this is the fix for backlog item 31's symptom (b): the AG Grid version
// inserted a real, permanently blank row immediately, before the user had typed
// anything, and clicking away left a ghost row with no indication anything
// needed cleaning up. Whitespace alone never counts.
export function hasContentIn<Row>(row: Row, fields: readonly (keyof Row)[]): boolean {
  return fields.some((field) => String(row[field] ?? '').trim() !== '');
}

export function mergeDraftField<Row, F extends keyof Row>(draft: Row, field: F, value: Row[F]): Row {
  return { ...draft, [field]: value } as Row;
}

// The density toggle (uiPreferencesStore.ts) used to drive AG Grid's Theming
// API through lib/gridTheme.ts; owning the markup, it is just two class names.
export function densityClasses(density: GridDensity) {
  const compact = density === 'compact';
  return {
    rowPad: compact ? 'py-1' : 'py-2',
    cellText: compact ? 'text-xs' : 'text-sm',
    avatarSize: compact ? 24 : 28,
  };
}
