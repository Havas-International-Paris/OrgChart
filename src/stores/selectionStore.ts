import { create } from 'zustand';

interface SelectionState {
  currentOrgChartId: string | null;
  selectedEmployeeId: string | null;
  searchQuery: string;
  expandedNodeIds: Set<string>;
  // Nodes with "focus mode" active — isolates each focused person + their
  // already-visible subtree, hiding everyone else (ancestors and unrelated
  // branches alike). A Set, not a single id, so focusing one person while a
  // sibling team is separately focused elsewhere in the tree still works.
  focusedNodeIds: Set<string>;
  assignmentsEmployeeId: string | null;
  setCurrentOrgChartId: (id: string) => void;
  setSelectedEmployee: (id: string | null) => void;
  setSearchQuery: (query: string) => void;
  toggleExpanded: (id: string) => void;
  setExpandedNodeIds: (ids: Set<string>) => void;
  toggleFocused: (id: string) => void;
  expandAncestors: (id: string, getPrimaryManagerId: (employeeId: string) => string | null) => void;
  setAssignmentsEmployeeId: (id: string | null) => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  currentOrgChartId: null,
  selectedEmployeeId: null,
  searchQuery: '',
  expandedNodeIds: new Set(),
  focusedNodeIds: new Set(),
  assignmentsEmployeeId: null,

  // Every field reset here is chart-relative and would otherwise leak
  // selections/expansions from one org chart into another after a switch.
  setCurrentOrgChartId: (id) =>
    set({
      currentOrgChartId: id,
      selectedEmployeeId: null,
      expandedNodeIds: new Set(),
      focusedNodeIds: new Set(),
      searchQuery: '',
      assignmentsEmployeeId: null,
    }),
  setSelectedEmployee: (id) => set({ selectedEmployeeId: id }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setAssignmentsEmployeeId: (id) => set({ assignmentsEmployeeId: id }),

  toggleExpanded: (id) =>
    set((state) => {
      const next = new Set(state.expandedNodeIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { expandedNodeIds: next };
    }),

  setExpandedNodeIds: (ids) => set({ expandedNodeIds: ids }),

  toggleFocused: (id) =>
    set((state) => {
      const next = new Set(state.focusedNodeIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { focusedNodeIds: next };
    }),

  expandAncestors: (id, getPrimaryManagerId) =>
    set((state) => {
      const next = new Set(state.expandedNodeIds);
      const visited = new Set<string>();
      let current: string | null = getPrimaryManagerId(id);
      while (current && !visited.has(current)) {
        visited.add(current);
        next.add(current);
        current = getPrimaryManagerId(current);
      }
      return { expandedNodeIds: next };
    }),
}));
