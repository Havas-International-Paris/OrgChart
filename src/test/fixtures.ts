import type { Employee, ReportingRelationship } from '../types/domain';

// Minimal builders for the two domain shapes the graph/layout logic reads.
// Every test below cares about ids, primary-vs-dotted, and sibling_order only —
// the rest of the columns exist to satisfy the types, so they get fixed dummy
// values rather than anything meaningful. Never imported by app code, so it
// stays out of the production bundle.

const ORG = 'org-1';
const TS = '2026-01-01T00:00:00Z';

export function emp(id: string, overrides: Partial<Employee> = {}): Employee {
  return {
    id,
    first_name: id.toUpperCase(),
    last_name: 'Test',
    job_title: null,
    role_desc: null,
    department: null,
    photo_path: null,
    photo_zoom: 1,
    photo_pan_x: 0,
    photo_pan_y: 0,
    sibling_order: null,
    org_chart_id: ORG,
    created_at: TS,
    updated_at: TS,
    created_by: null,
    updated_by: null,
    hidden_from_registry_candidates: false,
    ...overrides,
  };
}

// `manages(m, e)` reads as "m is e's manager" — matching the row's own
// semantics (employee_id reports to manager_id), not left-to-right arrow order.
export function manages(managerId: string, employeeId: string, isPrimary = true): ReportingRelationship {
  return {
    id: `rel-${managerId}-${employeeId}`,
    employee_id: employeeId,
    manager_id: managerId,
    is_primary: isPrimary,
    org_chart_id: ORG,
    created_at: TS,
    updated_at: TS,
  };
}

export function dotted(managerId: string, employeeId: string): ReportingRelationship {
  return manages(managerId, employeeId, false);
}
