import type { Database } from './supabase';

export type Lead = Database['public']['Tables']['leads']['Row'];
export type LeadInsert = Database['public']['Tables']['leads']['Insert'];
export type LeadUpdate = Database['public']['Tables']['leads']['Update'];

export type ScrapingJob = Database['public']['Tables']['scraping_jobs']['Row'];
export type ScrapingJobInsert = Database['public']['Tables']['scraping_jobs']['Insert'];

export type JobLog = Database['public']['Tables']['job_logs']['Row'];
export type UserSettings = Database['public']['Tables']['user_settings']['Row'];

export type DashboardStats = Database['public']['Functions']['dashboard_stats']['Returns'][number];

export type { JobStatusEnum as JobStatus, LeadStatusEnum as LeadStatus } from './supabase';
