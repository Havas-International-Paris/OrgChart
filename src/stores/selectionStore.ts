import { create } from 'zustand';

interface EtpRange {
  min: number;
  max: number;
}

// Full-bounds range = "no filter" — same convention as an empty Set/null for
// the other filter fields below. Matches RangeSlider.tsx's own bounds.
const ETP_RANGE_BOUNDS: EtpRange = { min: 0, max: 150 };

// The 5 filter dimensions that live inside the header's FiltersPanel — kept
// as one object so `resetAllFilters` and `setCurrentOrgChartId`'s own reset
// can't drift apart on what "default" means. Deliberately excludes
// `searchQuery`: the search box lives outside the panel (always visible in
// the header, per the user's request), so it isn't part of "reset the
// filters panel" and keeps its own separate reset in setCurrentOrgChartId,
// same as before this panel existed.
const defaultFilterState = {
  clientMissionFilterIds: new Set<string>(),
  deptFilterNames: new Set<string>(),
  jobTitleFilterNames: new Set<string>(),
  etpVenduRange: { ...ETP_RANGE_BOUNDS },
  etpReelRange: { ...ETP_RANGE_BOUNDS },
};

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
  // Client/mission ids currently used to focus the grid + chart on the team
  // staffed there (union across every selected id). Chart-relative like
  // expandedNodeIds/focusedNodeIds above, since assignments are scoped by
  // org_chart_id — reset on every chart switch.
  clientMissionFilterIds: Set<string>;
  // Business Unit filter — department NAMES currently selected (union across
  // the selection, same semantics as clientMissionFilterIds). Multi-select,
  // like every other set-membership filter in the header's FiltersPanel.
  deptFilterNames: Set<string>;
  // Poste (job title) filter — job_title NAMES currently selected. Matched
  // by name string, not id: job_titles has no FK from employees.job_title
  // (a curated suggestion list enforced only at the UI layer), same
  // convention departments already use.
  jobTitleFilterNames: Set<string>;
  // ETP range filters (item 44) — an employee matches when their SUM across
  // assignments (useAssignments' totalEtpOf/totalEtpReelOf) falls within
  // [min, max]. Bounds go to 150, not 100: an employee can be staffed above
  // 100% across several missions (etpStatus.ts's own "amber" band extends to
  // 115), so 100 would silently exclude real, expected data.
  etpVenduRange: EtpRange;
  etpReelRange: EtpRange;
  setCurrentOrgChartId: (id: string) => void;
  setSelectedEmployee: (id: string | null) => void;
  setSearchQuery: (query: string) => void;
  toggleExpanded: (id: string) => void;
  setExpandedNodeIds: (ids: Set<string>) => void;
  toggleFocused: (id: string) => void;
  setFocusedNodeIds: (ids: Set<string>) => void;
  expandAncestors: (id: string, getPrimaryManagerId: (employeeId: string) => string | null) => void;
  setAssignmentsEmployeeId: (id: string | null) => void;
  toggleClientMissionFilter: (id: string) => void;
  clearClientMissionFilter: () => void;
  toggleDeptFilter: (name: string) => void;
  clearDeptFilter: () => void;
  toggleJobTitleFilter: (name: string) => void;
  clearJobTitleFilter: () => void;
  setEtpVenduRange: (range: EtpRange) => void;
  setEtpReelRange: (range: EtpRange) => void;
  // Resets only the 5 FiltersPanel-owned dimensions above (not searchQuery,
  // which lives outside the panel) — backs the panel's own "Réinitialiser"
  // button.
  resetAllFilters: () => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  currentOrgChartId: null,
  selectedEmployeeId: null,
  searchQuery: '',
  expandedNodeIds: new Set(),
  focusedNodeIds: new Set(),
  assignmentsEmployeeId: null,
  ...defaultFilterState,

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
      ...defaultFilterState,
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

  setFocusedNodeIds: (ids) => set({ focusedNodeIds: ids }),

  toggleClientMissionFilter: (id) =>
    set((state) => {
      const next = new Set(state.clientMissionFilterIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { clientMissionFilterIds: next };
    }),

  clearClientMissionFilter: () => set({ clientMissionFilterIds: new Set() }),

  toggleDeptFilter: (name) =>
    set((state) => {
      const next = new Set(state.deptFilterNames);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return { deptFilterNames: next };
    }),

  clearDeptFilter: () => set({ deptFilterNames: new Set() }),

  toggleJobTitleFilter: (name) =>
    set((state) => {
      const next = new Set(state.jobTitleFilterNames);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return { jobTitleFilterNames: next };
    }),

  clearJobTitleFilter: () => set({ jobTitleFilterNames: new Set() }),

  setEtpVenduRange: (range) => set({ etpVenduRange: range }),
  setEtpReelRange: (range) => set({ etpReelRange: range }),

  resetAllFilters: () => set({ ...defaultFilterState }),

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
