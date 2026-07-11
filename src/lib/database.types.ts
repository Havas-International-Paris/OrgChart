// Hand-authored to match supabase/migrations/*.sql. Once the project is
// linked, regenerate with `supabase gen types typescript` and replace this file.

export type ClientMissionType = 'client' | 'mission';

export interface Database {
  public: {
    Tables: {
      employees: {
        Row: {
          id: string;
          first_name: string;
          last_name: string;
          job_title: string | null;
          role_desc: string | null;
          created_at: string;
          updated_at: string;
          created_by: string | null;
          updated_by: string | null;
        };
        Insert: {
          id?: string;
          first_name: string;
          last_name: string;
          job_title?: string | null;
          role_desc?: string | null;
        };
        Update: {
          first_name?: string;
          last_name?: string;
          job_title?: string | null;
          role_desc?: string | null;
        };
        Relationships: [];
      };
      reporting_relationships: {
        Row: {
          id: string;
          employee_id: string;
          manager_id: string;
          is_primary: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          manager_id: string;
          is_primary?: boolean;
        };
        Update: {
          is_primary?: boolean;
        };
        Relationships: [];
      };
      clients_missions: {
        Row: {
          id: string;
          name: string;
          type: ClientMissionType;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          type: ClientMissionType;
        };
        Update: {
          name?: string;
          type?: ClientMissionType;
        };
        Relationships: [];
      };
      assignments: {
        Row: {
          id: string;
          employee_id: string;
          client_mission_id: string;
          etp_percent: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          client_mission_id: string;
          etp_percent: number;
        };
        Update: {
          etp_percent?: number;
        };
        Relationships: [];
      };
      job_titles: {
        Row: {
          id: string;
          name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
        };
        Update: {
          name?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}
