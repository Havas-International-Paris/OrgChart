// Hand-authored to match supabase/migrations/*.sql. Once the project is
// linked, regenerate with `supabase gen types typescript` and replace this file.

export type ClientMissionType = 'client' | 'mission';
export type RemunerationModel = 'retainer' | 'commission';
export type OrgChartVisibility = 'private' | 'public';
export type OrgChartAccessRole = 'lecteur' | 'editeur';

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
          company: string | null;
          photo_path: string | null;
          photo_zoom: number;
          photo_pan_x: number;
          photo_pan_y: number;
          sibling_order: number | null;
          org_chart_id: string;
          created_at: string;
          updated_at: string;
          created_by: string | null;
          updated_by: string | null;
          hidden_from_registry_candidates: boolean;
          has_left_company: boolean;
        };
        Insert: {
          id?: string;
          first_name: string;
          last_name: string;
          job_title?: string | null;
          role_desc?: string | null;
          department?: string | null;
          company?: string | null;
          photo_path?: string | null;
          photo_zoom?: number;
          photo_pan_x?: number;
          photo_pan_y?: number;
          sibling_order?: number | null;
          org_chart_id: string;
          hidden_from_registry_candidates?: boolean;
          has_left_company?: boolean;
        };
        Update: {
          first_name?: string;
          last_name?: string;
          job_title?: string | null;
          role_desc?: string | null;
          department?: string | null;
          company?: string | null;
          photo_path?: string | null;
          photo_zoom?: number;
          photo_pan_x?: number;
          photo_pan_y?: number;
          sibling_order?: number | null;
          hidden_from_registry_candidates?: boolean;
          has_left_company?: boolean;
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
          created_by: string | null;
          updated_by: string | null;
        };
        Insert: {
          id?: string;
          employee_id: string;
          manager_id: string;
          is_primary?: boolean;
          org_chart_id: string;
        };
        Update: {
          manager_id?: string;
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
          created_by: string | null;
          updated_by: string | null;
          etp_vendu_next_year: number | null;
          remuneration_model_next_year: RemunerationModel | null;
        };
        Insert: {
          id?: string;
          employee_id: string;
          client_mission_id: string;
          etp_vendu?: number | null;
          etp_reel?: number | null;
          remuneration_model?: RemunerationModel | null;
          org_chart_id: string;
          etp_vendu_next_year?: number | null;
          remuneration_model_next_year?: RemunerationModel | null;
        };
        Update: {
          etp_vendu?: number | null;
          etp_reel?: number | null;
          remuneration_model?: RemunerationModel | null;
          etp_vendu_next_year?: number | null;
          remuneration_model_next_year?: RemunerationModel | null;
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
          color: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          color?: string | null;
        };
        Update: {
          name?: string;
          color?: string | null;
        };
        Relationships: [];
      };
      companies: {
        Row: {
          id: string;
          name: string;
          color: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          color?: string | null;
        };
        Update: {
          name?: string;
          color?: string | null;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          user_id: string;
          email: string;
          role: string;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          email: string;
          role?: string;
          status?: string;
        };
        Update: {
          role?: string;
          status?: string;
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
          is_registry: boolean;
          visibility: OrgChartVisibility;
        };
        Insert: {
          id?: string;
          name: string;
          short_label?: string;
          is_registry?: boolean;
          visibility?: OrgChartVisibility;
        };
        Update: {
          name?: string;
          short_label?: string;
          visibility?: OrgChartVisibility;
        };
        Relationships: [];
      };
      org_chart_access: {
        Row: {
          org_chart_id: string;
          user_id: string;
          role: OrgChartAccessRole;
          created_at: string;
        };
        Insert: {
          org_chart_id: string;
          user_id: string;
          role: OrgChartAccessRole;
        };
        Update: {
          role?: OrgChartAccessRole;
        };
        Relationships: [];
      };
      time_import_batches: {
        Row: {
          id: string;
          year: number;
          filename: string;
          row_count: number;
          imported_at: string;
          imported_by: string | null;
        };
        Insert: {
          id?: string;
          year: number;
          filename: string;
          row_count: number;
          imported_by?: string | null;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      time_actuals: {
        Row: {
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
        };
        Insert: {
          id?: string;
          batch_id?: string | null;
          year: number;
          month: number;
          raw_employee_name: string;
          raw_client_name: string;
          raw_sous_dossier?: string | null;
          raw_group_annonceur?: string | null;
          raw_payroll_name?: string | null;
          raw_bu_name?: string | null;
          etp_pct: number;
          resolved_employee_id?: string | null;
          resolved_client_mission_id?: string | null;
        };
        Update: {
          batch_id?: string | null;
          etp_pct?: number;
          resolved_employee_id?: string | null;
          resolved_client_mission_id?: string | null;
        };
        Relationships: [];
      };
      time_employee_aliases: {
        Row: {
          id: string;
          raw_name: string;
          employee_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          raw_name: string;
          employee_id?: string | null;
        };
        Update: {
          employee_id?: string | null;
        };
        Relationships: [];
      };
      time_client_aliases: {
        Row: {
          id: string;
          raw_name: string;
          client_mission_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          raw_name: string;
          client_mission_id?: string | null;
        };
        Update: {
          client_mission_id?: string | null;
        };
        Relationships: [];
      };
      time_forecasts: {
        Row: {
          id: string;
          employee_id: string;
          client_mission_id: string;
          year: number;
          total_pct: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          client_mission_id: string;
          year: number;
          total_pct?: number | null;
        };
        Update: {
          total_pct?: number | null;
        };
        Relationships: [];
      };
      time_forecast_months: {
        Row: {
          id: string;
          employee_id: string;
          client_mission_id: string;
          year: number;
          month: number;
          pct: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          client_mission_id: string;
          year: number;
          month: number;
          pct: number;
        };
        Update: {
          pct?: number;
        };
        Relationships: [];
      };
      time_actual_n1_totals: {
        Row: {
          id: string;
          employee_id: string;
          client_mission_id: string;
          year: number;
          total_pct: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          client_mission_id: string;
          year: number;
          total_pct: number;
        };
        Update: {
          total_pct?: number;
        };
        Relationships: [];
      };
      time_actual_groups: {
        Row: {
          id: string;
          client_mission_id: string;
          primary_employee_id: string;
          member_employee_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_mission_id: string;
          primary_employee_id: string;
          member_employee_id: string;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      time_manual_edit_markers: {
        Row: {
          id: string;
          employee_id: string;
          client_mission_id: string;
          year: number;
          field: string;
          edited_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          client_mission_id: string;
          year: number;
          field: string;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      time_manual_rows: {
        Row: {
          id: string;
          employee_id: string;
          client_mission_id: string;
          created_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          employee_id: string;
          client_mission_id: string;
          created_by?: string | null;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      time_row_comments: {
        Row: {
          id: string;
          employee_id: string;
          client_mission_id: string;
          comment_text: string;
          created_at: string;
          updated_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          employee_id: string;
          client_mission_id: string;
          comment_text: string;
          updated_at?: string;
          created_by?: string | null;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      duplicate_org_chart: {
        Args: { source_id: string; new_name: string; new_short_label: string };
        Returns: string;
      };
      list_active_users: {
        Args: Record<string, never>;
        Returns: { user_id: string; email: string }[];
      };
    };
  };
}
