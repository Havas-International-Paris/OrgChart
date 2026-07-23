export interface Employee {
  id: string;
  first_name: string;
  last_name: string;
  job_title: string | null;
  role_desc: string | null;
  department: string | null;
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
  org_chart_id: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface PhotoFrameValues {
  zoom: number;
  panX: number;
  panY: number;
}

export type EmployeeInput = Pick<Employee, 'first_name' | 'last_name'> &
  Partial<Pick<Employee, 'job_title' | 'role_desc' | 'department'>>;

export interface ReportingRelationship {
  id: string;
  employee_id: string;
  manager_id: string;
  is_primary: boolean;
  org_chart_id: string;
  created_at: string;
  updated_at: string;
}

export interface OrgChart {
  id: string;
  name: string;
  short_label: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export type OrgChartInput = Pick<OrgChart, 'name'> & Partial<Pick<OrgChart, 'short_label'>>;

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
  created_at: string;
}
