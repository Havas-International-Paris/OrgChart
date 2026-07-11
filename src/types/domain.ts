export interface Employee {
  id: string;
  first_name: string;
  last_name: string;
  job_title: string | null;
  role_desc: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export type EmployeeInput = Pick<Employee, 'first_name' | 'last_name'> &
  Partial<Pick<Employee, 'job_title' | 'role_desc'>>;

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

export interface Assignment {
  id: string;
  employee_id: string;
  client_mission_id: string;
  etp_percent: number;
  created_at: string;
  updated_at: string;
}

export type AssignmentInput = Pick<Assignment, 'employee_id' | 'client_mission_id' | 'etp_percent'>;

export interface JobTitle {
  id: string;
  name: string;
  created_at: string;
}
