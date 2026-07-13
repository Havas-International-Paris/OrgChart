import { useCallback, useEffect, useRef, useState } from 'react';
import type { CellEditingStartedEvent, CellFocusedEvent, GridApi, IRowNode } from 'ag-grid-community';

// Shared by all 3 left-panel grids to stop rows from jumping away under the
// user's cursor while they're being edited under an active column sort.
//
// Two distinct mechanisms, both settling once the user leaves the row
// (focuses another row, or clicks outside the grid entirely):
// - A freshly created row is pinned to the very top via AG Grid's native
//   `pinnedTopRowData`, which (unlike a sort comparator) also works when no
//   column sort is active at all.
// - A row being edited in place keeps sorting against its pre-edit snapshot
//   instead of the live in-progress value, so it doesn't move until settled.
//
// "Left the row" is detected via a document-level mousedown listener that
// checks DOM containment (see below), not via onBlur/relatedTarget. AG Grid
// editors like agSelectCellEditor mount their popup asynchronously and can
// blur-then-refocus in a way that leaves relatedTarget null for a tick, which
// made an onBlur-based check fire false positives the moment a dropdown
// editor opened. A real click's target is unambiguous, so checking against
// it avoids that whole class of timing issue.
type ActiveRow<T> = { id: string; mode: 'new' } | { id: string; mode: 'edit'; snapshot: T };

export function useRowStabilizer<T extends { id: string }>() {
  const gridApiRef = useRef<GridApi<T> | null>(null);
  // AG Grid renders popup editors (e.g. agSelectCellEditor's dropdown) via a
  // "popup parent" element, which defaults to somewhere outside this
  // container in the DOM. Pointed at our own container instead, so popups
  // count as "inside the grid" for the mousedown check below.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeRowRef = useRef<ActiveRow<T> | null>(null);
  const [pinnedTopId, setPinnedTopIdState] = useState<string | null>(null);

  const setPinnedTopId = useCallback((id: string | null) => {
    setPinnedTopIdState(id);
  }, []);

  const pinNewRow = useCallback(
    (id: string) => {
      activeRowRef.current = { id, mode: 'new' };
      setPinnedTopId(id);
    },
    [setPinnedTopId],
  );

  const settle = useCallback(() => {
    const wasPinnedTop = activeRowRef.current?.mode === 'new';
    activeRowRef.current = null;
    if (wasPinnedTop) setPinnedTopId(null);
    gridApiRef.current?.refreshClientSideRowModel('sort');
  }, [setPinnedTopId]);

  const handleCellEditingStarted = useCallback((event: CellEditingStartedEvent<T>) => {
    const id = event.data?.id;
    if (!id || event.node.rowPinned) return;
    if (activeRowRef.current?.id === id) return;
    activeRowRef.current = { id, mode: 'edit', snapshot: { ...event.data } as T };
  }, []);

  const resolveFocusedRowId = useCallback((event: CellFocusedEvent<T>): string | null | undefined => {
    if (event.rowIndex == null) return undefined;
    const node: IRowNode<T> | undefined =
      event.rowPinned === 'top'
        ? event.api.getPinnedTopRow(event.rowIndex)
        : event.rowPinned === 'bottom'
          ? event.api.getPinnedBottomRow(event.rowIndex)
          : event.api.getDisplayedRowAtIndex(event.rowIndex);
    return node?.data?.id;
  }, []);

  const handleCellFocused = useCallback(
    (event: CellFocusedEvent<T>) => {
      const activeId = activeRowRef.current?.id;
      if (!activeId) return;
      const focusedId = resolveFocusedRowId(event);
      // Only settle on a definitive "this is a different row" answer. A
      // null/undefined resolution is inconclusive (e.g. transient state
      // during virtualization) rather than proof the user left the row.
      if (focusedId != null && focusedId !== activeId) settle();
    },
    [resolveFocusedRowId, settle],
  );

  // Click-based "left the row" detection, covering both moving to a
  // different row and clicking completely outside the grid (search box,
  // "+ Ajouter" button, another tab, the chart pane, ...). A click inside an
  // AG Grid popup (e.g. the select editor's option list) counts as staying,
  // since popupParent scopes those popups inside our own container. Modals
  // opened from a cell (ManagerEditorModal, AssignmentEditorModal) are
  // marked with `data-row-stabilizer-ignore` and checked first since they're
  // rendered as plain siblings of the container, not inside it — otherwise
  // every click inside them (a checkbox, "Enregistrer", ...) would look like
  // leaving the grid entirely and settle the row out from under the modal.
  useEffect(() => {
    const handleDocumentMouseDown = (event: MouseEvent) => {
      const active = activeRowRef.current;
      if (!active) return;
      const target = event.target as Node | null;
      const el = target instanceof Element ? target : target?.parentElement ?? null;
      if (el?.closest('[data-row-stabilizer-ignore]')) return;
      const container = containerRef.current;
      if (!container || !target || !container.contains(target)) {
        settle();
        return;
      }
      if (el?.closest('.ag-popup')) return;
      // Resolve the row from the click target upward, rather than looking the
      // active row's element up and checking containment. animateRows can
      // leave a stale/transitioning duplicate row node in the DOM matching
      // the same row-id; querying from the container down could grab that
      // stale one and wrongly conclude the click landed outside it.
      const rowEl = el?.closest('[row-id]');
      if (rowEl && rowEl.getAttribute('row-id') === active.id) return;
      settle();
    };
    document.addEventListener('mousedown', handleDocumentMouseDown, true);
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown, true);
  }, [settle]);

  const comparatorFor = useCallback(
    (field: keyof T) =>
      (valueA: unknown, valueB: unknown, nodeA: IRowNode<T>, nodeB: IRowNode<T>) => {
        const pin = activeRowRef.current;
        const snapshot = pin?.mode === 'edit' ? pin.snapshot : null;
        const effA = snapshot && nodeA.data?.id === pin?.id ? snapshot[field] : valueA;
        const effB = snapshot && nodeB.data?.id === pin?.id ? snapshot[field] : valueB;
        if (effA == null && effB == null) return 0;
        if (effA == null) return -1;
        if (effB == null) return 1;
        if (effA === effB) return 0;
        return effA > effB ? 1 : -1;
      },
    [],
  );

  return {
    gridApiRef,
    containerRef,
    pinnedTopId,
    pinNewRow,
    comparatorFor,
    handleCellEditingStarted,
    handleCellFocused,
  };
}
