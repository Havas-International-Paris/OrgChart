import { useCallback } from 'react';
import { useHistoryStore, withSuppressedRecording } from '../stores/historyStore';
import type { Assignment, Employee, ReportingRelationship } from '../types/domain';

interface EmployeesApi {
  employees: Employee[];
  restoreEmployee: (row: Employee) => Promise<Employee>;
  deleteEmployee: (id: string) => Promise<void>;
}

interface ReportingApi {
  relationships: ReportingRelationship[];
  restoreRelationship: (row: ReportingRelationship) => Promise<ReportingRelationship>;
}

interface AssignmentsApi {
  assignments: Assignment[];
  restoreAssignment: (row: Assignment) => Promise<Assignment>;
}

// Deleting an employee cascades (FK) and silently removes every
// ReportingRelationship/Assignment row referencing them too — a plain
// "recreate the employee" undo would leave those gone. Shared by
// OrgChartView and EmployeeGrid (both call useEmployees/useReportingGraph/
// useAssignments independently, so both already have all three APIs in
// scope) so the one non-trivial delete-undo lives in a single place.
//
// Undo restores the captured ROWS rather than creating equivalents, so every id
// is preserved and the previously-documented gap is closed: a photo, its crop and
// any manual sibling_order now come back too. That is also why no id indirection
// is needed here any more — the employee's id after undo is the id it always had.
export function useEmployeeDeletion(
  orgChartId: string | null,
  employeesApi: EmployeesApi,
  reportingApi: ReportingApi,
  assignmentsApi: AssignmentsApi,
) {
  const { employees, restoreEmployee, deleteEmployee } = employeesApi;
  const { relationships, restoreRelationship } = reportingApi;
  const { assignments, restoreAssignment } = assignmentsApi;

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

      useHistoryStore.getState().push({
        label: `Supprimer ${employee.first_name} ${employee.last_name}`,
        orgChartId,
        undo: () =>
          withSuppressedRecording(async () => {
            // The employee has to exist before anything can reference it again,
            // so this one is sequential; the dependents can go in parallel.
            await restoreEmployee(employee);
            await Promise.all(relatedRelationships.map((r) => restoreRelationship(r)));
            await Promise.all(relatedAssignments.map((a) => restoreAssignment(a)));
          }),
        redo: () => withSuppressedRecording(async () => { await deleteEmployee(employeeId); }),
      });
    },
    [
      employees,
      relationships,
      assignments,
      restoreEmployee,
      deleteEmployee,
      restoreRelationship,
      restoreAssignment,
      orgChartId,
    ],
  );
}
