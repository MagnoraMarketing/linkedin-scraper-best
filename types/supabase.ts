/**
 * Database schema types.
 *
 * Hand-written to match supabase/migrations/. Keeping this in sync with the
 * SQL is what makes every query in the app type-checked — a renamed column
 * becomes a build error rather than a runtime surprise.
 *
 * Regenerate with:
 *   npx supabase gen types typescript --project-id <ref> > types/supabase.ts
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type JobStatusEnum = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type LeadStatusEnum =
  | 'new'
  | 'qualified'
  | 'contacted'
  | 'interested'
  | 'meeting'
  | 'not_interested'
  | 'invalid'
  | 'do_not_contact';

export type LogLevelEnum = 'info' | 'warn' | 'error';

type LeadRow = {
  id: string;
  user_id: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  company_name: string | null;
  company_website: string | null;
  company_linkedin_url: string | null;
  linkedin_url: string | null;
  location: string | null;
  country: string | null;
  industry: string | null;
  company_size: string | null;
  email: string | null;
  phone: string | null;
  mobile_phone: string | null;
  source: string;
  source_url: string | null;
  status: LeadStatusEnum;
  notes: string | null;
  job_id: string | null;
  created_at: string;
  updated_at: string;
};

type ScrapingJobRow = {
  id: string;
  user_id: string;
  status: JobStatusEnum;
  job_titles: string[];
  country: string;
  location: string | null;
  company_size: string | null;
  industry: string | null;
  requested_count: number;
  found_count: number;
  duplicate_count: number;
  processed_count: number;
  cancel_requested: boolean;
  error_message: string | null;
  error_code: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  worker_id: string | null;
  claimed_at: string | null;
  heartbeat_at: string | null;
};

type JobLogRow = {
  id: number;
  job_id: string;
  user_id: string;
  level: LogLevelEnum;
  event: string;
  message: string | null;
  created_at: string;
};

type UserSettingsRow = {
  user_id: string;
  default_country: string;
  default_job_titles: string[];
  default_location: string;
  default_lead_limit: number;
  max_lead_limit: number;
  linkedin_account_email: string | null;
  created_at: string;
  updated_at: string;
};

/** Columns the client is allowed to set; generated and server-managed ones are omitted. */
type Insertable<T, Required extends keyof T> = Partial<Omit<T, Required>> & Pick<T, Required>;

export type Database = {
  public: {
    Tables: {
      leads: {
        Row: LeadRow;
        Insert: Insertable<LeadRow, 'user_id' | 'full_name'>;
        Update: Partial<Omit<LeadRow, 'id' | 'user_id'>>;
        Relationships: [];
      };
      scraping_jobs: {
        Row: ScrapingJobRow;
        Insert: Insertable<
          ScrapingJobRow,
          'user_id' | 'job_titles' | 'country' | 'requested_count'
        >;
        Update: Partial<Omit<ScrapingJobRow, 'id' | 'user_id'>>;
        Relationships: [];
      };
      job_logs: {
        Row: JobLogRow;
        Insert: Insertable<JobLogRow, 'job_id' | 'user_id' | 'event'>;
        Update: Partial<Omit<JobLogRow, 'id'>>;
        Relationships: [];
      };
      user_settings: {
        Row: UserSettingsRow;
        Insert: Insertable<UserSettingsRow, 'user_id'>;
        Update: Partial<Omit<UserSettingsRow, 'user_id'>>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      dashboard_stats: {
        Args: Record<string, never>;
        Returns: {
          total_leads: number;
          new_leads: number;
          qualified_leads: number;
          contacted_leads: number;
          meeting_leads: number;
          interested_leads: number;
          running_jobs: number;
        }[];
      };
      check_rate_limit: {
        Args: {
          p_user_id: string;
          p_bucket: string;
          p_limit: number;
          p_window_seconds: number;
        };
        Returns: boolean;
      };
    };
    Enums: {
      job_status: JobStatusEnum;
      lead_status: LeadStatusEnum;
      log_level: LogLevelEnum;
    };
    CompositeTypes: Record<string, never>;
  };
};
