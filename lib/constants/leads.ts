export const LEAD_STATUSES = [
  'new',
  'qualified',
  'contacted',
  'interested',
  'meeting',
  'not_interested',
  'invalid',
  'do_not_contact',
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  qualified: 'Qualified',
  contacted: 'Contacted',
  interested: 'Interested',
  meeting: 'Meeting',
  not_interested: 'Not interested',
  invalid: 'Invalid',
  do_not_contact: 'Do not contact',
};

/** Tailwind classes per status, used by the Badge component. */
export const LEAD_STATUS_STYLES: Record<LeadStatus, string> = {
  new: 'bg-slate-100 text-slate-700 ring-slate-200',
  qualified: 'bg-blue-50 text-blue-700 ring-blue-200',
  contacted: 'bg-amber-50 text-amber-700 ring-amber-200',
  interested: 'bg-violet-50 text-violet-700 ring-violet-200',
  meeting: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  not_interested: 'bg-stone-100 text-stone-600 ring-stone-200',
  invalid: 'bg-rose-50 text-rose-700 ring-rose-200',
  do_not_contact: 'bg-red-50 text-red-700 ring-red-200',
};

export const JOB_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export const JOB_STATUS_STYLES: Record<JobStatus, string> = {
  queued: 'bg-slate-100 text-slate-700 ring-slate-200',
  running: 'bg-blue-50 text-blue-700 ring-blue-200',
  completed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  failed: 'bg-rose-50 text-rose-700 ring-rose-200',
  cancelled: 'bg-stone-100 text-stone-600 ring-stone-200',
};

export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = [
  'completed',
  'failed',
  'cancelled',
] as const;

export function isTerminalJobStatus(status: JobStatus): boolean {
  return TERMINAL_JOB_STATUSES.includes(status);
}
