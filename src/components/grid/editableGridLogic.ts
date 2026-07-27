import type { Employee } from '../../types/domain';

// Pure logic behind EmployeeGrid's own inline editing — extracted so the two
// trickiest decisions (what Tab does next, and when a freshly-added row becomes
// a real database row) are unit-testable without mounting the grid. This is what
// replaced AG Grid's built-in cell-to-cell navigation, whose default behaviour is
// exactly what caused backlog item 31's symptom (c): Tab silently entering edit
// mode on an unrelated select column.

export const EDITABLE_FIELDS = ['first_name', 'last_name', 'job_title', 'role_desc', 'department'] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export const FIELD_KIND: Record<EditableField, 'text' | 'select'> = {
  first_name: 'text',
  last_name: 'text',
  job_title: 'select',
  role_desc: 'text',
  department: 'select',
};

// Tab moves to the next editable field of the SAME row and stops at the end —
// it deliberately never wraps to the next row's first field. Per-user decision
// (2026-07-27): explicit request, consistent with "no spreadsheet-style keyboard
// navigation" from the item 31 interview.
export function nextEditableField(current: EditableField): EditableField | null {
  const index = EDITABLE_FIELDS.indexOf(current);
  return EDITABLE_FIELDS[index + 1] ?? null;
}

// null/empty sorts first, matching the comparator useRowStabilizer.ts used for
// the other 3 (still-AG-Grid) grids, so switching sort direction/columns doesn't
// change which end of the list blanks land on between the two grid systems.
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
export function effectiveForSort(employee: Employee, frozen: { id: string; snapshot: Employee } | null): Employee {
  return frozen && frozen.id === employee.id ? frozen.snapshot : employee;
}

// A row created by "+ Ajouter" is a local-only draft (never written to Supabase)
// until it has a first or last name — this is the fix for backlog item 31's
// symptom (b): today, clicking "+ Ajouter" inserts a real, permanently blank
// employee immediately, before the user has typed anything, and clicking away
// leaves a ghost row with no indication anything needs cleaning up.
export function draftHasContent(draft: Pick<Employee, 'first_name' | 'last_name'>): boolean {
  return draft.first_name.trim() !== '' || draft.last_name.trim() !== '';
}

export function mergeDraftField(
  draft: Employee,
  field: EditableField,
  value: string | null,
): Employee {
  return { ...draft, [field]: value };
}
