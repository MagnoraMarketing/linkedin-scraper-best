'use client';

import { Alert, Badge, Button, Card, CardBody, ProgressBar, Spinner } from '@/components/ui';
import { JOB_STATUS_LABELS, JOB_STATUS_STYLES, isTerminalJobStatus } from '@/lib/constants/leads';
import type { JobLog, ScrapingJob } from '@/types/database';

/** Human-readable text for the error codes the worker can report. */
const ERROR_HELP: Record<string, string> = {
  requires_verification:
    'LinkedIn asked for a verification step (2FA, a security checkpoint or a CAPTCHA) that has to be completed by a person. Sign in to the scraper account in a normal browser, complete the challenge, and restart the worker.',
  login_failed:
    'The worker could not sign in to LinkedIn. Check LINKEDIN_EMAIL and LINKEDIN_PASSWORD in the worker environment.',
  auth_wall:
    'LinkedIn served a sign-in wall instead of search results. The scraper session has expired and needs to be re-established.',
  no_results: 'LinkedIn returned no profiles for these criteria. Try broader titles or a wider location.',
  timeout: 'The search took longer than the configured timeout and was stopped.',
  worker_error: 'The scraper hit an unexpected error. The run log below has the details.',
};

export function JobProgress({
  job,
  logs,
  onCancel,
}: {
  job: ScrapingJob;
  logs: JobLog[];
  onCancel: () => void;
}) {
  const finished = isTerminalJobStatus(job.status);
  const pct = job.requested_count > 0 ? Math.round((job.found_count / job.requested_count) * 100) : 0;

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            {!finished && <Spinner className="text-brand-600" />}
            <div>
              <p className="text-sm font-semibold text-slate-900">
                {job.status === 'queued' && 'Queued — waiting for a worker'}
                {job.status === 'running' && 'Searching…'}
                {job.status === 'completed' && `Completed — ${job.found_count} leads found`}
                {job.status === 'failed' && 'Search failed'}
                {job.status === 'cancelled' && `Cancelled — ${job.found_count} leads kept`}
              </p>
              <p className="text-xs text-slate-500">
                {job.job_titles.join(', ')} · {job.country}
                {job.location && job.location !== 'all' ? ` · ${job.location}` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Badge className={JOB_STATUS_STYLES[job.status]}>{JOB_STATUS_LABELS[job.status]}</Badge>
            {!finished && (
              <Button variant="secondary" size="sm" onClick={onCancel}>
                {job.cancel_requested ? 'Stopping…' : 'Cancel'}
              </Button>
            )}
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between text-sm">
            <span className="font-medium tabular-nums text-slate-900">
              Found {job.found_count} / {job.requested_count} leads
            </span>
            <span className="text-xs tabular-nums text-slate-500">{pct}%</span>
          </div>
          <ProgressBar
            value={job.found_count}
            max={job.requested_count}
            indeterminate={job.status === 'queued'}
          />
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
            <span>Profiles processed: {job.processed_count}</span>
            <span>Duplicates skipped: {job.duplicate_count}</span>
          </div>
        </div>

        {job.status === 'queued' && (
          <Alert tone="info">
            The job is in the queue. It starts as soon as the scraper worker picks it up — if
            nothing happens, check that the worker service is running.
          </Alert>
        )}

        {job.status === 'failed' && (
          <Alert tone="error" title={job.error_message ?? 'The search could not be completed.'}>
            {job.error_code && ERROR_HELP[job.error_code]}
          </Alert>
        )}

        {logs.length > 0 && (
          <details className="rounded-md border border-slate-200 bg-slate-50">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-700">
              Run log ({logs.length})
            </summary>
            <ol className="max-h-64 overflow-y-auto border-t border-slate-200 px-3 py-2 font-mono text-xs">
              {logs.map((log) => (
                <li key={log.id} className="flex gap-2 py-0.5">
                  <span className="shrink-0 text-slate-400">
                    {new Date(log.created_at).toLocaleTimeString('en-GB')}
                  </span>
                  <span
                    className={
                      log.level === 'error'
                        ? 'text-rose-600'
                        : log.level === 'warn'
                          ? 'text-amber-600'
                          : 'text-slate-600'
                    }
                  >
                    {log.message ?? log.event}
                  </span>
                </li>
              ))}
            </ol>
          </details>
        )}
      </CardBody>
    </Card>
  );
}
