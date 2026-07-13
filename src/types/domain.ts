export interface Employee {
  id: string;
  first_name: string;
  last_name: string;
  job_title: string | null;
  role_desc: string | null;
  department: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export type EmployeeInput = Pick<Employee, 'first_name' | 'last_name'> &
  Partial<Pick<Employee, 'job_title' | 'role_desc' | 'department'>>;

export interface ReportingRelationship {
  id: string;
  employee_id: string;
  manager_id: string;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
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
