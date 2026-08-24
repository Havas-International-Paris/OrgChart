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
  // Added in 0025 — nullable, existing rows predate this migration.
  created_by: string | null;
  updated_by: string | null;
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
  // Added in 0025 — nullable, existing rows predate this migration.
  created_by: string | null;
  updated_by: string | null;
  // Added in 0026, reworked in 0027 — "% sold N+1"/"% expected N+1" on the
  // Time Estimation grid, using the SAME shared-column-plus-model-flag
  // mechanism as etp_vendu/remuneration_model above, but with its own
  // independent flag so editing next year's forecast can never retroactively
  // change the current year's own remuneration_model classification.
  etp_vendu_next_year: number | null;
  remuneration_model_next_year: RemunerationModel | null;
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
// 'refused' added in 0025 — refuseUser() now marks the row instead of
// deleting it, so a re-signup with the same email stays banned (the
// on_auth_user_created trigger's on-conflict-do-nothing keeps the refused
// row in place). Re-approving flips it back to 'active'.
export type UserRoleStatus = 'pending' | 'active' | 'refused';

export interface UserRole {
  user_id: string;
  email: string;
  role: UserRoleName;
  status: UserRoleStatus;
  created_at: string;
  updated_at: string;
}

// "Estimation des temps" module (admin-only) — see CLAUDE.md/plan for the
// full design. All five tables below are global, scoped in practice to the
// registry org chart's own employees (enforced application-side, not by a
// DB constraint — see 0021_time_estimation.sql).

export interface TimeImportBatch {
  id: string;
  year: number;
  filename: string;
  row_count: number;
  imported_at: string;
  imported_by: string | null;
}

// One row per (raw employee name x raw client name x month) found in an
// imported extract. resolved_* are filled in during import review (or by a
// prior alias, see TimeEmployeeAlias/TimeClientAlias) — null means "not yet
// resolved", not "resolved to nothing" (that's what an alias with a null
// target means instead).
export interface TimeActual {
  id: string;
  batch_id: string | null;
  year: number;
  month: number;
  raw_employee_name: string;
  raw_client_name: string;
  raw_sous_dossier: string | null;
  raw_group_annonceur: string | null;
  raw_payroll_name: string | null;
  raw_bu_name: string | null;
  etp_pct: number;
  resolved_employee_id: string | null;
  resolved_client_mission_id: string | null;
  created_at: string;
  updated_at: string;
}

// employee_id/client_mission_id null = "ignore this raw name forever" (e.g.
// an external contractor never tracked in the registry) — distinct from no
// alias row existing at all, which means "never reviewed yet".
export interface TimeEmployeeAlias {
  id: string;
  raw_name: string;
  employee_id: string | null;
  created_at: string;
}

export interface TimeClientAlias {
  id: string;
  raw_name: string;
  client_mission_id: string | null;
  created_at: string;
}

// total_pct is derived (see timeEstimationMath.averageOverRange applied to
// the year's 12 effective monthly values) but STORED rather than computed
// purely client-side, since it's meant to be reused outside this module
// later — kept in sync by the app on every write that affects it. The
// month-by-month figures themselves live in TimeForecastMonth, not here.
export interface TimeForecast {
  id: string;
  employee_id: string;
  client_mission_id: string;
  year: number;
  total_pct: number | null;
  created_at: string;
  updated_at: string;
}

// A manual override for one month of `year`, for one (employee, client) —
// applies to a past month (correcting/replacing the imported actual) or a
// future one (a forecast) identically; see CLAUDE.md for why this is a
// single mechanism rather than two. A month's EFFECTIVE value used
// everywhere in the grid (cells, section averages, % total, trend) is
// `override ?? sum(resolved time_actuals for that month)` — never written
// back into time_actuals itself, since several raw imported rows can
// resolve to the same (employee, client, month).
export interface TimeForecastMonth {
  id: string;
  employee_id: string;
  client_mission_id: string;
  year: number;
  month: number;
  pct: number;
  created_at: string;
  updated_at: string;
}

// Revision 2: the import source's N-1 tab ("Input N-1", shape of the real
// "Evol Etps" Havas export) only ever provides ONE annual total per
// (employee, client) — never a monthly breakdown — so it can't live in
// time_actuals (month not null, built for genuinely monthly data). This is
// the dedicated home for that single figure; `Total actual N-1` in the
// grid reads it directly.
export interface TimeActualN1Total {
  id: string;
  employee_id: string;
  client_mission_id: string;
  year: number;
  total_pct: number;
  created_at: string;
  updated_at: string;
}

// Which single cell the user directly typed into — see the migration's own
// comment (0024_time_manual_edit_markers.sql) for why only "direct" edits
// are persisted, never "derived" ones.
export interface TimeManualEditMarker {
  id: string;
  employee_id: string;
  client_mission_id: string;
  year: number;
  field: string;
  edited_at: string;
}

// "Drag a non-sold employee's row onto a sold employee's row" grouping,
// scoped per client_mission — see CLAUDE.md for the full explanation of
// why. A member_employee_id can only ever belong to one group per
// client_mission_id (DB unique constraint).
export interface TimeActualGroup {
  id: string;
  client_mission_id: string;
  primary_employee_id: string;
  member_employee_id: string;
  created_at: string;
}

// Marks an (employee, client_mission) pairing added by hand from the grid's
// "+ Ajouter une ligne" action, rather than one that surfaced via an
// assignment or an import — see 0029_time_manual_rows.sql. No `year`: the
// pairing persists across N-1/N/N+1.
export interface TimeManualRow {
  id: string;
  employee_id: string;
  client_mission_id: string;
  created_at: string;
  created_by: string | null;
}

// A free-text note on an (employee, client_mission) row — see
// 0030_time_row_comments.sql. No `year`, same reasoning as TimeManualRow
// above: the comment belongs to the pairing, not a specific period.
export interface TimeRowComment {
  id: string;
  employee_id: string;
  client_mission_id: string;
  comment_text: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}
