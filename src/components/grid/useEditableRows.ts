import { useCallback, useEffect, useRef, useState } from 'react';
import { hasContentIn, mergeDraftField, nextField, type FieldKind } from './editableGridLogic';

// The inline-editing state machine shared by all four left-panel grids, lifted
// out of EmployeeGrid once the three catalog grids moved off AG Grid too
// (backlog item 31). A grid supplies its field list and its two writes
// (create a row / update one field); everything about WHEN those fire —
// draft promotion, Tab, Escape, click-away, sort freezing — lives here, so
// there is exactly one implementation of the rules to reason about.

export interface EditableRowsOptions<Row extends { id: string }, Field extends Extract<keyof Row, string>> {
  fields: readonly Field[];
  fieldKind: Record<Field, FieldKind>;
  // Which fields must be non-blank before a draft is worth persisting.
  requiredFields: readonly Field[];
  // Promotes a local draft into a real, persisted row. Must return the created
  // row: callers keep using what this hands back, never a re-lookup by id.
  createRow: (draft: Row) => Promise<Row>;
  // `row` is the row as it was BEFORE the edit, so a caller that records undo
  // history can read the old value straight off it.
  updateField: (row: Row, field: Field, value: string | null) => Promise<void>;
}

type PendingAction<Field> = { kind: 'cancel' } | { kind: 'move'; next: Field } | { kind: 'close' };

export interface EditableRows<Row extends { id: string }, Field extends Extract<keyof Row, string>> {
  draft: Row | null;
  activeCell: { rowId: string; field: Field } | null;
  frozenRow: { id: string; snapshot: Row } | null;
  draftValue: string;
  setDraftValue: (value: string) => void;
  fieldKind: Record<Field, FieldKind>;
  inputRef: React.MutableRefObject<HTMLInputElement | HTMLSelectElement | null>;
  startDraft: (row: Row) => void;
  activateCell: (row: Row, field: Field) => void;
  handleKeyDown: (event: React.KeyboardEvent, field: Field) => void;
  handleBlur: (row: Row, field: Field, currentValue: string | null) => Promise<void>;
  handleSelectChange: (row: Row, field: Field, value: string) => void;
}

export function useEditableRows<Row extends { id: string }, Field extends Extract<keyof Row, string>>({
  fields,
  fieldKind,
  requiredFields,
  createRow,
  updateField,
}: EditableRowsOptions<Row, Field>): EditableRows<Row, Field> {
  // A row created by "+ Ajouter" that has not been written to Supabase yet —
  // see editableGridLogic.ts's hasContentIn for why. Always rendered pinned
  // above the sorted list by its grid, mirroring AG Grid's old
  // pinnedTopRowData but as a plain local value instead of a library feature.
  const [draft, setDraft] = useState<Row | null>(null);
  const [activeCell, setActiveCell] = useState<{ rowId: string; field: Field } | null>(null);
  // Captured the moment a row is FIRST activated for editing (any field), and
  // kept until the user leaves the row entirely — Tab-ing between fields of the
  // same row must not re-take the snapshot. This is what freezes the row's sort
  // position while it's being edited: see effectiveForSort.
  const [frozenRow, setFrozenRow] = useState<{ id: string; snapshot: Row } | null>(null);
  const [draftValue, setDraftValue] = useState('');
  // Deliberately only ONE place ever commits a field: handleBlur. Keydown
  // handlers never call commitField themselves — they record what should
  // happen once the blur arrives, then force it immediately via `.blur()`.
  // An earlier version had keydown handlers commit directly and set a
  // "suppress the next blur" flag to stop it from double-committing — that
  // broke the moment a blur DIDN'T reliably follow (Tab at the end of a row,
  // where nothing else takes focus): the flag stayed stuck true, so the very
  // next unrelated blur anywhere in the grid was silently swallowed. Found by
  // testing a fresh "+ Ajouter" draft live, right after an unrelated Tab-to-
  // end-of-row edit in the same session — clicking away from the still-blank
  // draft no longer discarded it. Forcing the blur ourselves removes the
  // "did a blur happen or not" question entirely.
  const pendingActionRef = useRef<PendingAction<Field>>({ kind: 'close' });
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);

  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.focus();
    if (inputRef.current instanceof HTMLInputElement) inputRef.current.select();
  }, [activeCell]);

  const hasContent = useCallback((row: Row) => hasContentIn(row, requiredFields), [requiredFields]);

  // Takes the row OBJECT, never just an id to look up — on purpose. Every
  // caller either already has a guaranteed-fresh row in hand (the one it's
  // rendering, or the one it just got back from createRow/updateField) or would
  // have to fetch one from its hook's array, which is a snapshot of whatever
  // that array was in the render that created THIS closure — after an `await`,
  // that snapshot can be one or more renders behind the row this call is
  // actually about. Taking the row directly removes that lookup entirely, so
  // there's nothing left to go stale.
  const activateCell = useCallback((row: Row, field: Field) => {
    setActiveCell({ rowId: row.id, field });
    setFrozenRow((prev) => (prev?.id === row.id ? prev : { id: row.id, snapshot: row }));
    setDraftValue((row[field] as string | null) ?? '');
  }, []);

  const deactivate = useCallback((discardBlankDraft = false) => {
    setActiveCell(null);
    setFrozenRow(null);
    if (discardBlankDraft) setDraft(null);
  }, []);

  const startDraft = useCallback(
    (row: Row) => {
      setDraft(row);
      activateCell(row, fields[0]);
    },
    [activateCell, fields],
  );

  // Takes and returns the row OBJECT, not an id — same reasoning as
  // activateCell above. The returned row is what the caller should treat as
  // current from this point on: unchanged for a plain edit, or the newly
  // created row once a still-local draft gets promoted.
  const commitField = useCallback(
    async (row: Row, field: Field, value: string | null): Promise<{ row: Row; isDraftStillBlank: boolean }> => {
      if (draft && row.id === draft.id) {
        const merged = mergeDraftField(draft, field, value as Row[Field]);
        if (!hasContent(merged)) {
          setDraft(merged);
          return { row: merged, isDraftStillBlank: true };
        }
        const created = await createRow(merged);
        setDraft(null);
        return { row: created, isDraftStillBlank: false };
      }
      if ((row[field] as string | null) !== value) {
        await updateField(row, field, value);
      }
      return { row: mergeDraftField(row, field, value as Row[Field]), isDraftStillBlank: false };
    },
    [draft, hasContent, createRow, updateField],
  );

  const isDraftBlank = useCallback(
    (row: Row) => Boolean(draft && row.id === draft.id && !hasContent(draft)),
    [draft, hasContent],
  );

  // Keydown only ever records intent + forces the blur that will act on it —
  // see pendingActionRef's own comment for why it never commits directly.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, field: Field) => {
      if (e.key === 'Escape') {
        pendingActionRef.current = { kind: 'cancel' };
        (e.target as HTMLElement).blur();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        pendingActionRef.current = { kind: 'close' };
        (e.target as HTMLElement).blur();
        return;
      }
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        const next = nextField(fields, field);
        pendingActionRef.current = next ? { kind: 'move', next } : { kind: 'close' };
        (e.target as HTMLElement).blur();
      }
    },
    [fields],
  );

  // The single place that ever commits a field or decides a draft's fate.
  // Every keydown path above and every plain click-away funnel through here.
  const handleBlur = useCallback(
    async (row: Row, field: Field, currentValue: string | null) => {
      const action = pendingActionRef.current;
      pendingActionRef.current = { kind: 'close' };

      if (action.kind === 'cancel') {
        deactivate(isDraftBlank(row));
        return;
      }

      let effectiveRow = row;
      let isDraftStillBlank = isDraftBlank(row);
      if (fieldKind[field] === 'text') {
        const result = await commitField(row, field, currentValue);
        effectiveRow = result.row;
        isDraftStillBlank = result.isDraftStillBlank;
      }
      if (action.kind === 'move') activateCell(effectiveRow, action.next);
      else deactivate(isDraftStillBlank);
    },
    [commitField, activateCell, deactivate, isDraftBlank, fieldKind],
  );

  // A select commits on its own onChange (there is no separate "typed but
  // uncommitted" state for a dropdown) but deliberately does NOT deactivate —
  // it stays open so Tab can still move on to the next field, matching every
  // other field's behaviour while filling a row.
  const handleSelectChange = useCallback(
    (row: Row, field: Field, value: string) => {
      void commitField(row, field, value || null);
    },
    [commitField],
  );

  return {
    draft,
    activeCell,
    frozenRow,
    draftValue,
    setDraftValue,
    fieldKind,
    inputRef,
    startDraft,
    activateCell,
    handleKeyDown,
    handleBlur,
    handleSelectChange,
  };
}
