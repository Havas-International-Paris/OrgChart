import { useCallback } from 'react';
import { useHistoryStore, withSuppressedRecording } from '../stores/historyStore';
import { boxFor, registerIdBox } from '../stores/idRegistryStore';
import type { Assignment, Employee, EmployeeInput, ReportingRelationship, RemunerationModel } from '../types/domain';

interface EmployeesApi {
  employees: Employee[];
  createEmployee: (input: EmployeeInput) => Promise<Employee>;
  deleteEmployee: (id: string) => Promise<void>;
}

interface ReportingApi {
  relationships: ReportingRelationship[];
  addRelationship: (employeeId: string, managerId: string, isPrimary: boolean) => Promise<ReportingRelationship>;
}

interface AssignmentsApi {
  assignments: Assignment[];
  createAssignment: (
    employeeId: string,
    clientMissionId: string,
    etpVendu: number | null,
    etpReel: number | null,
    remunerationModel: RemunerationModel | null,
  ) => Promise<Assignment>;
}

// Deleting an employee cascades (FK) and silently removes every
// ReportingRelationship/Assignment row referencing them too — a plain
// "recreate the employee" undo would leave those gone. Shared by
// OrgChartView and EmployeeGrid (both call useEmployees/useReportingGraph/
// useAssignments independently, so both already have all three APIs in
// scope) so the one non-trivial delete-undo lives in a single place.
export function useEmployeeDeletion(
  orgChartId: string | null,
  employeesApi: EmployeesApi,
  reportingApi: ReportingApi,
  assignmentsApi: AssignmentsApi,
) {
  const { employees, createEmployee, deleteEmployee } = employeesApi;
  const { relationships, addRelationship } = reportingApi;
  const { assignments, createAssignment } = assignmentsApi;

  return useCallback(
    async (employeeId: string) => {
      const employee = employees.find((e) => e.id === employeeId);
      if (!employee) return;
      const relatedRelationships = relationships.filter(
        (r) => r.employee_id === employeeId || r.manager_id === employeeId,
      );
      const relatedAssignments = assignments.filter((a) => a.employee_id === employeeId);

      await deleteEmployee(employeeId);

      if (!orgChartId) return;

      const employeeBox = boxFor(employeeId);
      useHistoryStore.getState().push({
        label: `Supprimer ${employee.first_name} ${employee.last_name}`,
        orgChartId,
        undo: () =>
          withSuppressedRecording(async () => {
            // Known gap: createEmployee only accepts plain fields, so a
            // custom photo/crop isn't restored — consistent with photo
            // replace/delete being excluded from this system entirely.
            const recreated = await createEmployee({
              first_name: employee.first_name,
              last_name: employee.last_name,
              job_title: employee.job_title ?? undefined,
              role_desc: employee.role_desc ?? undefined,
              department: employee.department ?? undefined,
            });
            employeeBox.id = recreated.id;
            registerIdBox(recreated.id, employeeBox);
            await Promise.all(
              relatedRelationships.map((r) =>
                r.employee_id === employeeId
                  ? addRelationship(recreated.id, r.manager_id, r.is_primary)
                  : addRelationship(r.employee_id, recreated.id, r.is_primary),
              ),
            );
            await Promise.all(
              relatedAssignments.map((a) =>
                createAssignment(recreated.id, a.client_mission_id, a.etp_vendu, a.etp_reel, a.remuneration_model),
              ),
            );
          }),
        redo: () => withSuppressedRecording(async () => { await deleteEmployee(employeeBox.id); }),
      });
    },
    [employees, relationships, assignments, createEmployee, deleteEmployee, addRelationship, createAssignment, orgChartId],
  );
}
