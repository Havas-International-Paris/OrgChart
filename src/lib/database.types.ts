// Hand-authored to match supabase/migrations/*.sql. Once the project is
// linked, regenerate with `supabase gen types typescript` and replace this file.

export type ClientMissionType = 'client' | 'mission';
export type RemunerationModel = 'retainer' | 'commission';

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
          department: string | null;
          org_chart_id: string;
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
          department?: string | null;
          org_chart_id: string;
        };
        Update: {
          first_name?: string;
          last_name?: string;
          job_title?: string | null;
          role_desc?: string | null;
          department?: string | null;
        };
        Relationships: [];
      };
      reporting_relationships: {
        Row: {
          id: string;
          employee_id: string;
          manager_id: string;
          is_primary: boolean;
          org_chart_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          manager_id: string;
          is_primary?: boolean;
          org_chart_id: string;
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
          etp_vendu: number | null;
          etp_reel: number | null;
          remuneration_model: RemunerationModel | null;
          org_chart_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          client_mission_id: string;
          etp_vendu?: number | null;
          etp_reel?: number | null;
          remuneration_model?: RemunerationModel | null;
          org_chart_id: string;
        };
        Update: {
          etp_vendu?: number | null;
          etp_reel?: number | null;
          remuneration_model?: RemunerationModel | null;
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
      departments: {
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
      org_charts: {
        Row: {
          id: string;
          name: string;
          short_label: string;
          created_at: string;
          updated_at: string;
          created_by: string | null;
          updated_by: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          short_label?: string;
        };
        Update: {
          name?: string;
          short_label?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      duplicate_org_chart: {
        Args: { source_id: string; new_name: string; new_short_label: string };
        Returns: string;
      };
    };
  };
}
