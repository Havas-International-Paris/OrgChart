import type { Command } from './history/types';
import { withSuppressedRecording } from '../stores/historyStore';
import type { Assignment, Employee, EmployeeInput, ReportingRelationship } from '../types/domain';

// Backlog item 48 — translates a chat write tool's result into a real
// historyStore Command, so a chat-driven write is undoable through the
// exact same header Undo button / Ctrl+Z as a grid/chart edit, not a
// parallel chat-only mechanism. See api/_lib/chatTools.ts for the tool
// definitions this mirrors and CLAUDE.md/the item 48 plan for why a
// Command's undo/redo bodies must call these frontend hook mutators
// (never raw services/*.ts) — replaying one has to re-trigger the same
// refresh()/Realtime flow a live edit does.
export interface ChatUndoMutators {
  deleteEmployee: (id: string) => Promise<void>;
  restoreEmployee: (row: Employee) => Promise<Employee>;
  updateEmployee: (id: string, changes: Partial<EmployeeInput>) => Promise<Employee>;
  addRelationship: (employeeId: string, managerId: string, isPrimary: boolean) => Promise<ReportingRelationship>;
  restoreRelationship: (row: ReportingRelationship) => Promise<ReportingRelationship>;
  removeRelationship: (relationship: ReportingRelationship) => Promise<void>;
  reassignManager: (relationship: ReportingRelationship, newManagerId: string) => Promise<void>;
  restoreAssignment: (row: Assignment) => Promise<Assignment>;
  deleteAssignment: (id: string) => Promise<void>;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

function employeeName(e: { first_name: string; last_name: string }): string {
  return `${e.first_name} ${e.last_name}`;
}

// Returns null for anything that shouldn't become a stack entry: every
// read-only tool, and a few write tools excluded deliberately (see each
// case below).
export function buildChatCommand(
  name: string,
  args: Record<string, unknown>,
  output: unknown,
  mutators: ChatUndoMutators,
  orgChartId: string,
  t: Translate,
): Command | null {
  if (!output || typeof output !== 'object' || 'error' in output) return null;
  const out = output as Record<string, unknown>;

  switch (name) {
    case 'create_employee': {
      const employee = out.employee as Employee | undefined;
      if (!employee) return null;
      // If this same call also linked a manager (args.managerId), undo
      // still correctly removes that link (deleteEmployee cascades), but
      // redo only restores the employee, not the link — create_employee's
      // tool doesn't capture the created relationship row. Same known gap
      // as create_team below; not fixed this pass.
      return {
        label: t('history.createEmployee', { name: employeeName(employee) }),
        orgChartId,
        undo: () => withSuppressedRecording(() => mutators.deleteEmployee(employee.id)),
        redo: () => withSuppressedRecording(async () => { await mutators.restoreEmployee(employee); }),
      };
    }

    case 'update_employee': {
      const employee = out.employee as Employee | undefined;
      const before = out.before as Partial<EmployeeInput> | undefined;
      if (!employee || !before) return null;
      const after: Partial<EmployeeInput> = {
        first_name: employee.first_name,
        last_name: employee.last_name,
        job_title: employee.job_title,
        department: employee.department,
      };
      return {
        label: t('history.updateEmployee', { name: employeeName(employee) }),
        orgChartId,
        undo: () => withSuppressedRecording(async () => { await mutators.updateEmployee(employee.id, before); }),
        redo: () => withSuppressedRecording(async () => { await mutators.updateEmployee(employee.id, after); }),
      };
    }

    case 'set_manager': {
      const relationship = out.relationship as ReportingRelationship | undefined;
      const action = out.action as 'created' | 'reassigned' | undefined;
      if (!relationship || !action) return null;

      if (action === 'reassigned') {
        const previousManagerId = out.previousManagerId as string | undefined;
        const newManagerId = args.managerId as string;
        if (!previousManagerId) return null;
        return {
          label: t('history.reassignManager'),
          orgChartId,
          undo: () => withSuppressedRecording(() => mutators.reassignManager(relationship, previousManagerId)),
          redo: () => withSuppressedRecording(() => mutators.reassignManager(relationship, newManagerId)),
        };
      }

      return {
        label: t('history.addReportingLink'),
        orgChartId,
        undo: () => withSuppressedRecording(() => mutators.removeRelationship(relationship)),
        redo: () => withSuppressedRecording(async () => { await mutators.restoreRelationship(relationship); }),
      };
    }

    case 'create_assignment': {
      const assignment = out.assignment as Assignment | undefined;
      const action = out.action as 'created' | 'already_exists' | undefined;
      if (!assignment || !action) return null;
      // Linking to an already-assigned client/mission changes nothing in
      // the DB (see api/_lib/chatTools.ts's create_assignment) — no stack
      // entry, same reasoning as restore_employee below.
      if (action !== 'created') return null;

      return {
        label: t('history.addAssignment'),
        orgChartId,
        undo: () => withSuppressedRecording(() => mutators.deleteAssignment(assignment.id)),
        redo: () => withSuppressedRecording(async () => { await mutators.restoreAssignment(assignment); }),
      };
    }

    case 'delete_employee': {
      const deletedEmployee = out.deletedEmployee as Employee | undefined;
      if (!deletedEmployee) return null;
      const deletedRelationships = (out.deletedRelationships as ReportingRelationship[] | undefined) ?? [];
      const deletedAssignments = (out.deletedAssignments as Assignment[] | undefined) ?? [];
      return {
        label: t('history.deleteEmployee', { name: employeeName(deletedEmployee) }),
        orgChartId,
        undo: () =>
          withSuppressedRecording(async () => {
            // The employee has to exist before anything can reference it
            // again — sequential; the dependents can go in parallel. Same
            // shape as useEmployeeDeletion.ts's grid/chart delete-undo.
            await mutators.restoreEmployee(deletedEmployee);
            await Promise.all(deletedRelationships.map((r) => mutators.restoreRelationship(r)));
            await Promise.all(deletedAssignments.map((a) => mutators.restoreAssignment(a)));
          }),
        redo: () => withSuppressedRecording(() => mutators.deleteEmployee(deletedEmployee.id)),
      };
    }

    // restore_employee's own tool call is itself an undo (the conversational
    // stopgap, see api/_lib/chatTools.ts) — it doesn't get its own stack
    // entry, that would double up with delete_employee's.
    case 'restore_employee':
      return null;

    // create_org_chart's result never belongs to the CURRENTLY open chart
    // (historyStore's own invariant — a command never outlives its chart,
    // and this one creates a different one entirely), so it can never be a
    // stack entry regardless of which chart happens to be open when it runs.
    case 'create_org_chart':
      return null;

    // create_team's relationship inserts aren't captured/returned by the
    // tool (only success/failure per row), so a correct redo can't rebuild
    // them — flagged as a followup rather than shipping an undo that loses
    // the batch's reporting links on redo. Undo-only would be inconsistent
    // with every other command in the stack, so this stays unrecorded for
    // now, same as before this item.
    case 'create_team':
      return null;

    default:
      return null;
  }
}
