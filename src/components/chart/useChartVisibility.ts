import { useMemo } from 'react';
import type { Employee, ReportingRelationship } from '../../types/domain';
import { useSelectionStore } from '../../stores/selectionStore';
import { useVisibleGraph } from './useVisibleGraph';

// Who is on screen, and who the search matched. Two layers, in this order:
// expand/collapse (useVisibleGraph, walking the primary tree from the roots),
// then focus mode filtered on top of it.
export function useChartVisibility(employees: Employee[], primaryEdges: ReportingRelationship[]) {
  const searchQuery = useSelectionStore((s) => s.searchQuery);
  const expandedNodeIds = useSelectionStore((s) => s.expandedNodeIds);
  const focusedNodeIds = useSelectionStore((s) => s.focusedNodeIds);

  const matchedIds = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return new Set<string>();
    return new Set(
      employees
        .filter((e) => `${e.first_name} ${e.last_name}`.toLowerCase().includes(query))
        .map((e) => e.id),
    );
  }, [employees, searchQuery]);

  const { visibleEmployees, childrenOf, totalDescendantCountOf } = useVisibleGraph(
    employees,
    primaryEdges,
    expandedNodeIds,
  );

  // Focus mode ("isolate me + my team") is a filter layered on top of the
  // normal expand/collapse visibility above, not a replacement for it — it
  // only ever hides *already-visible* people, never force-reveals a
  // collapsed subtree. Walking `childrenOf` (the full tree) but only
  // recursing into ids already in `visibleEmployees` is what keeps that
  // true. Multiple people can be focused at once (a Set), in which case
  // everyone kept is the union of each focused person's own subtree.
  const finalVisibleEmployees = useMemo(() => {
    let result = visibleEmployees;

    if (focusedNodeIds.size > 0) {
      const visibleIds = new Set(result.map((e) => e.id));
      const keep = new Set<string>();
      const addWithVisibleDescendants = (id: string) => {
        if (keep.has(id)) return;
        keep.add(id);
        for (const childId of childrenOf.get(id) ?? []) {
          if (visibleIds.has(childId)) addWithVisibleDescendants(childId);
        }
      };
      for (const id of focusedNodeIds) {
        if (visibleIds.has(id)) addWithVisibleDescendants(id);
      }
      result = result.filter((e) => keep.has(e.id));
    }

    return result;
  }, [visibleEmployees, focusedNodeIds, childrenOf]);

  // Global count shown on every active focus badge ("+N masqués") — matches
  // the design spec, which counts everyone hidden across the whole chart by
  // focus mode, not just this one person's own hidden ancestors.
  const focusHiddenCount = employees.length - finalVisibleEmployees.length;

  return {
    matchedIds,
    childrenOf,
    totalDescendantCountOf,
    finalVisibleEmployees,
    focusHiddenCount,
    expandedNodeIds,
    focusedNodeIds,
  };
}
