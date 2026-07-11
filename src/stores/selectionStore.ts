import { create } from 'zustand';

interface SelectionState {
  selectedEmployeeId: string | null;
  searchQuery: string;
  expandedNodeIds: Set<string>;
  assignmentsEmployeeId: string | null;
  setSelectedEmployee: (id: string | null) => void;
  setSearchQuery: (query: string) => void;
  toggleExpanded: (id: string) => void;
  setExpandedNodeIds: (ids: Set<string>) => void;
  expandAncestors: (id: string, getPrimaryManagerId: (employeeId: string) => string | null) => void;
  setAssignmentsEmployeeId: (id: string | null) => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedEmployeeId: null,
  searchQuery: '',
  expandedNodeIds: new Set(),
  assignmentsEmployeeId: null,

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
