import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelectionStore } from '../../stores/selectionStore';
import { useHistoryStore, withSuppressedRecording } from '../../stores/historyStore';
import { usePhotoActions } from '../../hooks/usePhotoActions';
import { useEmployeeDeletion } from '../../hooks/useEmployeeDeletion';
import type { Employee, ReportingRelationship } from '../../types/domain';
import type { EmployeeNodeActions } from './EmployeeNode';
import type { ChartData } from './useChartData';

interface LinkModalState {
  employeeId: string;
  direction: 'manager' | 'subordinate';
}

// Everything the user can *do* to the chart, plus the small pieces of UI state
// those actions open and close (the link modal, the photo editor, which edge has
// its controls showing). Pulled out of OrgChartView so that file is left with
// composition and markup.
export function useChartActions(currentOrgChartId: string | null, data: ChartData) {
  const { t } = useTranslation();
  const {
    employees,
    employeeById,
    createEmployee,
    restoreEmployee,
    updateEmployee,
    deleteEmployee,
    updateEmployeePhoto,
    updateEmployeePhotoFrame,
    updateHasLeftCompany,
    relationships,
    managersOf,
    directReportsOf,
    addRelationship,
    restoreRelationship,
    removeRelationship,
    reassignManager,
    wouldCreateCycle,
    assignments,
    restoreAssignment,
    departmentColorByName,
    assignmentsOf,
    totalEtpOf,
    totalEtpReelOf,
    clientMissionNameById,
  } = data;

  const selectedEmployeeId = useSelectionStore((s) => s.selectedEmployeeId);
  const setSelectedEmployee = useSelectionStore((s) => s.setSelectedEmployee);
  const detailPanelEmployeeId = useSelectionStore((s) => s.detailPanelEmployeeId);
  const setDetailPanelEmployeeId = useSelectionStore((s) => s.setDetailPanelEmployeeId);
  const setAssignmentsEmployeeId = useSelectionStore((s) => s.setAssignmentsEmployeeId);

  const [linkModal, setLinkModal] = useState<LinkModalState | null>(null);
  const [photoEditEmployeeId, setPhotoEditEmployeeId] = useState<string | null>(null);

  const { replacePhoto, saveFrame, deletePhoto } = usePhotoActions(
    employees,
    updateEmployeePhoto,
    updateEmployeePhotoFrame,
  );

  // Create-employee + add-relationship is one user action ("quick add a
  // manager/subordinate"), so it must record as a single undo/redo command,
  // not two separate ones from createEmployee's and addRelationship's own
  // per-mutator recording. withSuppressedRecording mutes those while the two
  // raw calls run below. Both created rows are captured so redo can restore them
  // under their original ids — which is why a later, independent edit of the new
  // employee (renaming them in the grid, say) still works after an undo/redo
  // round trip: the id never changed.
  const quickAddManager = useCallback(
    async (employeeId: string) => {
      const hasPrimary = managersOf(employeeId).some((r) => r.is_primary);
      const isPrimary = !hasPrimary;
      let created!: Employee;
      let createdEdge!: ReportingRelationship;
      await withSuppressedRecording(async () => {
        created = await createEmployee({
          first_name: t('chart.quickAdd.newManagerFirstName'),
          last_name: t('chart.quickAdd.newManagerLastName'),
        });
        createdEdge = await addRelationship(employeeId, created.id, isPrimary);
      });
      setSelectedEmployee(created.id);
      setDetailPanelEmployeeId(created.id);

      if (currentOrgChartId) {
        useHistoryStore.getState().push({
          label: t('history.addManager'),
          orgChartId: currentOrgChartId,
          // Deleting the employee cascades (FK) the relationship row too.
          undo: async () => { await deleteEmployee(created.id); },
          // Restores both captured rows under their original ids — employee first,
          // since the relationship references it.
          redo: () =>
            withSuppressedRecording(async () => {
              await restoreEmployee(created);
              await restoreRelationship(createdEdge);
            }),
        });
      }
    },
    [managersOf, createEmployee, restoreEmployee, addRelationship, restoreRelationship, deleteEmployee, setSelectedEmployee, setDetailPanelEmployeeId, currentOrgChartId, t],
  );

  const quickAddSubordinate = useCallback(
    async (employeeId: string) => {
      let created!: Employee;
      let createdEdge!: ReportingRelationship;
      await withSuppressedRecording(async () => {
        created = await createEmployee({
          first_name: t('chart.quickAdd.newSubordinateFirstName'),
          last_name: t('chart.quickAdd.newSubordinateLastName'),
        });
        createdEdge = await addRelationship(created.id, employeeId, true);
      });
      setSelectedEmployee(created.id);
      setDetailPanelEmployeeId(created.id);

      if (currentOrgChartId) {
        useHistoryStore.getState().push({
          label: t('history.addSubordinate'),
          orgChartId: currentOrgChartId,
          undo: async () => { await deleteEmployee(created.id); },
          redo: () =>
            withSuppressedRecording(async () => {
              await restoreEmployee(created);
              await restoreRelationship(createdEdge);
            }),
        });
      }
    },
    [createEmployee, restoreEmployee, addRelationship, restoreRelationship, deleteEmployee, setSelectedEmployee, setDetailPanelEmployeeId, currentOrgChartId, t],
  );

  const openLinkManager = useCallback(
    (employeeId: string) => setLinkModal({ employeeId, direction: 'manager' }),
    [],
  );
  const openLinkSubordinate = useCallback(
    (employeeId: string) => setLinkModal({ employeeId, direction: 'subordinate' }),
    [],
  );

  const deleteEmployeeWithHistory = useEmployeeDeletion(
    currentOrgChartId,
    { employees, restoreEmployee, deleteEmployee },
    { relationships, restoreRelationship },
    { assignments, restoreAssignment },
  );

  const handleDeleteEmployee = useCallback(
    async (employeeId: string) => {
      await deleteEmployeeWithHistory(employeeId);
      // Avoid leaving the detail panel / assignments modal pointed at a
      // record that no longer exists.
      if (selectedEmployeeId === employeeId) setSelectedEmployee(null);
    },
    [deleteEmployeeWithHistory, selectedEmployeeId, setSelectedEmployee],
  );

  const handleDeleteRelationship = useCallback(
    (relationship: ReportingRelationship) => {
      removeRelationship(relationship);
    },
    [removeRelationship],
  );

  // The link's own right-click menu (below) only ever hands back the
  // clicked edge's id, same as handleReconnect above — resolve it back to
  // the relationship row and defer to handleDeleteRelationship rather than
  // duplicating the lookup at the call site.
  const handleDeleteRelationshipById = useCallback(
    (edgeId: string) => {
      const relationship = relationships.find((r) => r.id === edgeId);
      if (!relationship) return;
      handleDeleteRelationship(relationship);
    },
    [relationships, handleDeleteRelationship],
  );

  // Shared by the live drag-hover feedback and the drop itself, so a drop
  // can never succeed on a target the hover pass would have rejected.
  const computeDropValidity = useCallback(
    (employeeId: string, targetId: string): 'valid' | 'invalid' => {
      if (targetId === employeeId) return 'invalid';
      // Covers dropping back on the current manager too — a no-op, not an
      // error, but still routed through "invalid" so it's simply ignored.
      if (managersOf(employeeId).some((m) => m.manager_id === targetId)) return 'invalid';
      if (wouldCreateCycle(employeeId, targetId)) return 'invalid';
      return 'valid';
    },
    [managersOf, wouldCreateCycle],
  );

  const handleReassignManager = useCallback(
    (relationship: ReportingRelationship, newManagerId: string) => {
      if (computeDropValidity(relationship.employee_id, newManagerId) !== 'valid') return;
      reassignManager(relationship, newManagerId);
    },
    [computeDropValidity, reassignManager],
  );

  // Native reconnect (OrgChartView.tsx's onReconnect) only ever hands back
  // the dragged edge's id and the new manager id — this resolves that id
  // back to the actual relationship row and defers to the same
  // handleReassignManager every path already uses, so there is exactly one
  // place that validates + performs a reassignment.
  const handleReconnect = useCallback(
    (edgeId: string, newManagerId: string) => {
      const relationship = relationships.find((r) => r.id === edgeId);
      if (!relationship) return;
      handleReassignManager(relationship, newManagerId);
    },
    [relationships, handleReassignManager],
  );

  // Native connect (OrgChartView.tsx's onConnect) — dragging a brand-new
  // link between two cards ALREADY visible on the chart, a shortcut
  // alongside (not instead of) the "+" popover's "Rattacher un existant…",
  // which stays the only way to link an employee not yet on the graph at
  // all. computeDropValidity is reused unchanged: "already a manager" also
  // catches the case of dragging a duplicate of an existing link, and the
  // cycle check applies identically to a new edge. Same primary/secondary
  // rule as every other link-creation path (quickAddManager/openLinkManager
  // above): the first manager an employee gets is primary, every one after
  // is a secondary/dotted line.
  const handleConnect = useCallback(
    (managerId: string, employeeId: string) => {
      if (computeDropValidity(employeeId, managerId) !== 'valid') return;
      const hasPrimary = managersOf(employeeId).some((r) => r.is_primary);
      addRelationship(employeeId, managerId, !hasPrimary);
    },
    [computeDropValidity, managersOf, addRelationship],
  );

  // quickAddManager/quickAddSubordinate/openLinkManager/openLinkSubordinate/
  // handleDeleteEmployee deliberately are NOT in this bag (backlog item 34)
  // — the card itself no longer renders any control for them, only the
  // right-click context menu does, which reads them straight off this
  // hook's own return below instead of through per-node data.
  const actions = useMemo<EmployeeNodeActions>(
    () => ({
      openAssignments: setAssignmentsEmployeeId,
      updateEmployee,
      openPhotoEditor: setPhotoEditEmployeeId,
      // A visible, permanent-state per-card control, same category as the
      // three above (not a low-frequency action like delete/add-manager,
      // which live in NodeContextMenu instead) — see EmployeeNode.tsx's
      // DepartureFlagBadge.
      toggleHasLeftCompany: (employeeId, value) => {
        updateHasLeftCompany(employeeId, value);
      },
    }),
    [setAssignmentsEmployeeId, updateEmployee, setPhotoEditEmployeeId, updateHasLeftCompany],
  );

  // The card's own right-click context menu (backlog item 34) — absorbs
  // what used to be the ✕ delete button and the two "+" add-manager/
  // add-subordinate popovers. Deliberately does NOT absorb the collapse/
  // focus badges or the photo control: those carry a visible, permanent
  // state (a "+3" badge showing a hidden team, say) and are meant to stay
  // one direct click away, not two clicks behind a menu.
  const [contextMenu, setContextMenu] = useState<{ employeeId: string; x: number; y: number } | null>(null);
  const openContextMenu = useCallback(
    (employeeId: string, x: number, y: number) => setContextMenu({ employeeId, x, y }),
    [],
  );
  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // A link's own right-click menu — replaces the old click-to-select-then-
  // click-the-'−'-button flow entirely (2026-07-30, same session as the
  // card menu above, same reasoning: a single right-click menu instead of a
  // two-step reveal). Hovering a link already highlights it (see
  // useChartNodes.ts's hoveredEdgeId), so click-to-select no longer served
  // any purpose once its one remaining job — showing the delete button —
  // moved here.
  const [edgeContextMenu, setEdgeContextMenu] = useState<{ edgeId: string; x: number; y: number } | null>(null);
  const openEdgeContextMenu = useCallback(
    (edgeId: string, x: number, y: number) => setEdgeContextMenu({ edgeId, x, y }),
    [],
  );
  const closeEdgeContextMenu = useCallback(() => setEdgeContextMenu(null), []);

  const linkModalProps = useMemo(() => {
    if (!linkModal) return null;
    const { employeeId, direction } = linkModal;
    const currentEmployee = employeeById.get(employeeId);
    if (!currentEmployee) return null;
    const currentLabel = `${currentEmployee.first_name} ${currentEmployee.last_name}`;

    if (direction === 'manager') {
      const existingManagerIds = new Set(managersOf(employeeId).map((r) => r.manager_id));
      return {
        title: t('chart.linkModal.addManagerTo', { name: currentLabel }),
        // Hard-excludes departed employees regardless of the global "hide
        // departed" toggle — linking someone who's left as a new manager/
        // report never makes sense, unlike simply viewing them in the chart.
        candidates: employees.filter((e) => e.id !== employeeId && !existingManagerIds.has(e.id) && !e.has_left_company),
        isDisabled: (candidateId: string) => wouldCreateCycle(employeeId, candidateId),
        onLink: async (candidateId: string) => {
          const hasPrimary = managersOf(employeeId).some((r) => r.is_primary);
          await addRelationship(employeeId, candidateId, !hasPrimary);
        },
      };
    }

    const existingReportIds = new Set(directReportsOf(employeeId).map((r) => r.employee_id));
    return {
      title: t('chart.linkModal.addSubordinateTo', { name: currentLabel }),
      candidates: employees.filter((e) => e.id !== employeeId && !existingReportIds.has(e.id) && !e.has_left_company),
      isDisabled: (candidateId: string) => wouldCreateCycle(candidateId, employeeId),
      onLink: async (candidateId: string) => {
        const hasPrimary = managersOf(candidateId).some((r) => r.is_primary);
        await addRelationship(candidateId, employeeId, !hasPrimary);
      },
    };
  }, [linkModal, employeeById, employees, managersOf, directReportsOf, wouldCreateCycle, addRelationship, t]);

  const detailPanelProps = useMemo(() => {
    // A plain click on a chart card only ever selects/highlights it — the
    // panel opens only once detailPanelEmployeeId is explicitly pointed at
    // the current selection (a second click on an already-selected card, or
    // one of the "jump to this person" paths: grid row click, quick-add,
    // navigating from inside an already-open panel). Selecting a DIFFERENT
    // employee makes this mismatch on its own — no extra reset needed.
    if (!selectedEmployeeId || detailPanelEmployeeId !== selectedEmployeeId) return null;
    const employee = employeeById.get(selectedEmployeeId);
    if (!employee) return null;

    const managerRelations = managersOf(selectedEmployeeId);
    const primaryManagerId = managerRelations.find((r) => r.is_primary)?.manager_id;
    const manager = primaryManagerId ? (employeeById.get(primaryManagerId) ?? null) : null;
    const functionalManagers = managerRelations
      .filter((r) => !r.is_primary)
      .map((r) => employeeById.get(r.manager_id))
      .filter((e): e is NonNullable<typeof e> => Boolean(e));

    const reportRelations = directReportsOf(selectedEmployeeId);
    const directReports = reportRelations
      .filter((r) => r.is_primary)
      .map((r) => employeeById.get(r.employee_id))
      .filter((e): e is NonNullable<typeof e> => Boolean(e));
    const functionalReports = reportRelations
      .filter((r) => !r.is_primary)
      .map((r) => employeeById.get(r.employee_id))
      .filter((e): e is NonNullable<typeof e> => Boolean(e));

    // ETP/advertisers surfaced here too (backlog item 51) so compact-mode
    // cards, which hide these on the card itself, keep them one click away.
    const advertiserNames = assignmentsOf(selectedEmployeeId)
      .map((a) => clientMissionNameById.get(a.client_mission_id))
      .filter((name): name is string => Boolean(name));

    return {
      employee,
      departmentColor: employee.department ? (departmentColorByName.get(employee.department) ?? null) : null,
      manager,
      functionalManagers,
      directReports,
      functionalReports,
      assignmentsTotalEtpVendu: totalEtpOf(selectedEmployeeId),
      assignmentsTotalEtpReel: totalEtpReelOf(selectedEmployeeId),
      advertiserNames,
    };
  }, [
    selectedEmployeeId,
    detailPanelEmployeeId,
    employeeById,
    managersOf,
    directReportsOf,
    departmentColorByName,
    assignmentsOf,
    totalEtpOf,
    totalEtpReelOf,
    clientMissionNameById,
  ]);

  return {
    actions,
    handleDeleteRelationship,
    handleDeleteRelationshipById,
    computeDropValidity,
    handleReassignManager,
    handleReconnect,
    handleConnect,

    // Context-menu-only actions — see the EmployeeNodeActions comment above
    // for why these left that bag.
    quickAddManager,
    quickAddSubordinate,
    openLinkManager,
    openLinkSubordinate,
    handleDeleteEmployee,

    contextMenu,
    openContextMenu,
    closeContextMenu,

    edgeContextMenu,
    openEdgeContextMenu,
    closeEdgeContextMenu,

    linkModal,
    setLinkModal,
    linkModalProps,
    detailPanelProps,

    photoEditEmployeeId,
    setPhotoEditEmployeeId,
    replacePhoto,
    saveFrame,
    deletePhoto,
  };
}

export type ChartActions = ReturnType<typeof useChartActions>;
