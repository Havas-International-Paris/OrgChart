import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import * as employeeService from '../services/employeeService';
import * as reportingService from '../services/reportingService';
import * as assignmentService from '../services/assignmentService';
import { useHistoryStore, withSuppressedRecording } from '../stores/historyStore';
import type { Assignment, Employee, ReportingRelationship } from '../types/domain';

interface RegistryImportDeps {
  // The TARGET chart's own already-instantiated mutators — same shape
  // useChartActions.ts's quickAddManager takes from useEmployees/
  // useReportingGraph/useAssignments, reused here rather than re-deriving.
  deleteEmployee: (id: string) => Promise<void>;
  restoreEmployee: (row: Employee) => Promise<Employee>;
  addRelationship: (employeeId: string, managerId: string, isPrimary: boolean) => Promise<ReportingRelationship>;
  restoreRelationship: (row: ReportingRelationship) => Promise<ReportingRelationship>;
  createAssignment: (
    employeeId: string,
    clientMissionId: string,
    etpVendu: number | null,
    etpReel: number | null,
    remunerationModel: Assignment['remuneration_model'],
  ) => Promise<Assignment>;
  restoreAssignment: (row: Assignment) => Promise<Assignment>;
}

// Backlog item 58 flux 1 — copies a chosen subset of the registry's
// employees into the currently open chart. One-way copy, not a live link
// (see the spec) — every created row is fully independent of its registry
// source from the moment it's created.
export function useRegistryImport(targetOrgChartId: string | null, deps: RegistryImportDeps) {
  const { t } = useTranslation();
  const { deleteEmployee, restoreEmployee, addRelationship, restoreRelationship, createAssignment, restoreAssignment } =
    deps;

  const importFromRegistry = useCallback(
    async (registryChartId: string, selectedEmployeeIds: string[], includeAssignments: boolean) => {
      if (!targetOrgChartId || selectedEmployeeIds.length === 0) return;
      const selectedIdSet = new Set(selectedEmployeeIds);

      const registryEmployees = await employeeService.fetchEmployees(registryChartId);
      const sources = registryEmployees.filter((e) => selectedIdSet.has(e.id));

      const registryRelationships = await reportingService.fetchReportingRelationships(registryChartId);
      // Only relationships where BOTH ends are in the selection are recreated
      // — a link to a registry person not selected is silently dropped, per
      // the spec, same as creating any new employee today.
      const relevantRelationships = registryRelationships.filter(
        (r) => selectedIdSet.has(r.employee_id) && selectedIdSet.has(r.manager_id),
      );

      let relevantAssignments: Assignment[] = [];
      if (includeAssignments) {
        const registryAssignments = await assignmentService.fetchAssignments(registryChartId);
        relevantAssignments = registryAssignments.filter((a) => selectedIdSet.has(a.employee_id));
      }

      const createdEmployees: Employee[] = [];
      const createdRelationships: ReportingRelationship[] = [];
      const createdAssignments: Assignment[] = [];
      // Old registry id -> new id in the target chart, so relationships/
      // assignments (which reference employee ids) can be re-pointed.
      const idMap = new Map<string, string>();

      await withSuppressedRecording(async () => {
        for (const source of sources) {
          const created = await employeeService.importEmployee(targetOrgChartId, source);
          idMap.set(source.id, created.id);
          createdEmployees.push(created);
        }
        for (const rel of relevantRelationships) {
          const created = await addRelationship(
            idMap.get(rel.employee_id)!,
            idMap.get(rel.manager_id)!,
            rel.is_primary,
          );
          createdRelationships.push(created);
        }
        for (const a of relevantAssignments) {
          const created = await createAssignment(
            idMap.get(a.employee_id)!,
            a.client_mission_id,
            a.etp_vendu,
            a.etp_reel,
            a.remuneration_model,
          );
          createdAssignments.push(created);
        }
      });

      useHistoryStore.getState().push({
        label: t('history.importFromRegistry', { count: createdEmployees.length }),
        orgChartId: targetOrgChartId,
        // Deleting each employee cascades (FK) its relationships/assignments
        // too — same reasoning as quickAddManager's own undo.
        undo: async () => {
          for (const e of createdEmployees) await deleteEmployee(e.id);
        },
        // Restores every captured row under its own original id — employees
        // first, since relationships/assignments reference them.
        redo: () =>
          withSuppressedRecording(async () => {
            for (const e of createdEmployees) await restoreEmployee(e);
            for (const r of createdRelationships) await restoreRelationship(r);
            for (const a of createdAssignments) await restoreAssignment(a);
          }),
      });
    },
    [targetOrgChartId, deleteEmployee, restoreEmployee, addRelationship, restoreRelationship, createAssignment, restoreAssignment, t],
  );

  return { importFromRegistry };
}
