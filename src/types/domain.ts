export interface Employee {
  id: string;
  first_name: string;
  last_name: string;
  job_title: string | null;
  role_desc: string | null;
  department: string | null;
  company: string | null;
  // Object path within the "employee-photos" Storage bucket, or null for
  // no photo (initials avatar shown instead). Set via updateEmployeePhoto,
  // deliberately not part of EmployeeInput's create/edit flow below.
  photo_path: string | null;
  // Pan/zoom crop applied on top of the plain cover-fit photo (see
  // PhotoFrame.tsx). photo_zoom >= 1 (1 = just covers, no manual zoom);
  // photo_pan_x/y are percentages of the image's own rendered box, clamped
  // by the reframe editor so the crop never shows blank space.
  photo_zoom: number;
  photo_pan_x: number;
  photo_pan_y: number;
  // Manual left-to-right position among siblings sharing the same primary
  // manager (or among roots, if this employee has none) — null means "no
  // manual order set", so dagre's own natural crossing-minimization order
  // is used. Set only via drag-to-reorder in the chart (layoutEngine.ts),
  // never through the create/edit form — deliberately excluded from
  // EmployeeInput below, same as photo_path/photo_zoom.
  sibling_order: number | null;
  org_chart_id: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  // Backlog item 58 Phase B (not yet built) — only meaningful for employees
  // outside the registry chart; drives the "Salariés à promouvoir" list's
  // hide/unhide toggle. Added in Phase A's migration so Phase B needs no
  // migration of its own.
  hidden_from_registry_candidates: boolean;
}

export interface PhotoFrameValues {
  zoom: number;
  panX: number;
  panY: number;
}

export type EmployeeInput = Pick<Employee, 'first_name' | 'last_name'> &
  Partial<Pick<Employee, 'job_title' | 'role_desc' | 'department' | 'company'>>;

export interface ReportingRelationship {
  id: string;
  employee_id: string;
  manager_id: string;
  is_primary: boolean;
  org_chart_id: string;
  created_at: string;
  updated_at: string;
}

// Backlog item 53 Phase B. 'private' (default): only the owner
// (created_by) and admins can read/write. 'public': any active user can
// read; write still needs the global éditeur/admin role (see
// can_write_org_chart in 0017_org_chart_sharing.sql) or an explicit
// org_chart_access grant. A per-chart org_chart_access grant works on
// EITHER visibility and overrides the grantee's own global role for that
// one chart.
export type OrgChartVisibility = 'private' | 'public';
export type OrgChartAccessRole = 'lecteur' | 'editeur';

export interface OrgChart {
  id: string;
  name: string;
  short_label: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  // Backlog item 58 — at most one chart ever has this true (enforced by a
  // partial unique index). The registry, unlike every other chart, is never
  // offered by orgChartService.fetchOrgCharts() (the normal selector/
  // duplicate-source list) — see fetchRegistryOrgChart for how it's reached.
  is_registry: boolean;
  visibility: OrgChartVisibility;
}

export type OrgChartInput = Pick<OrgChart, 'name'> & Partial<Pick<OrgChart, 'short_label'>>;

// One row per (chart, user) grant — only the chart's owner (created_by) or
// an admin can create/update/delete these (RLS, 0017). email is resolved
// client-side against orgChartAccessService.listActiveUsers() rather than
// stored here, same "join client-side in memory" convention as
// usePromotionCandidates.ts.
export interface OrgChartAccess {
  org_chart_id: string;
  user_id: string;
  role: OrgChartAccessRole;
  created_at: string;
}

export type ClientMissionType = 'client' | 'mission';

export interface ClientMission {
  id: string;
  name: string;
  type: ClientMissionType;
  created_at: string;
}

export type RemunerationModel = 'retainer' | 'commission';

export interface Assignment {
  id: string;
  employee_id: string;
  client_mission_id: string;
  etp_vendu: number | null;
  etp_reel: number | null;
  remuneration_model: RemunerationModel | null;
  org_chart_id: string;
  created_at: string;
  updated_at: string;
}

export type AssignmentInput = Pick<Assignment, 'employee_id' | 'client_mission_id'> &
  Partial<Pick<Assignment, 'etp_vendu' | 'remuneration_model'>>;

export interface JobTitle {
  id: string;
  name: string;
  created_at: string;
}

export interface Department {
  id: string;
  name: string;
  color: string | null;
  created_at: string;
}

export interface Company {
  id: string;
  name: string;
  color: string | null;
  created_at: string;
}

// Foundation for backlog item 53 — global roles only, no per-chart
// visibility/sharing yet (see CLAUDE.md/backlog for what's deferred).
export type UserRoleName = 'admin' | 'editeur' | 'lecteur';
export type UserRoleStatus = 'pending' | 'active';

export interface UserRole {
  user_id: string;
  email: string;
  role: UserRoleName;
  status: UserRoleStatus;
  created_at: string;
  updated_at: string;
}
