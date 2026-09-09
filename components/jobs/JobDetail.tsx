'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { JobProgress } from '@/components/search/JobProgress';
import { SearchResults } from '@/components/search/SearchResults';
import { apiFetch } from '@/lib/api/client';
import { isTerminalJobStatus } from '@/lib/constants/leads';
import type { JobLog, ScrapingJob } from '@/types/database';

const POLL_INTERVAL_MS = 3000;

/** Job detail with the same live progress and inline results as the search page. */
export function JobDetail({
  initialJob,
  initialLogs,
}: {
  initialJob: ScrapingJob;
  initialLogs: JobLog[];
}) {
  const [job, setJob] = useState(initialJob);
  const [logs, setLogs] = useState(initialLogs);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const poll = useCallback(async () => {
    try {
      const data = await apiFetch<{ job: ScrapingJob; logs: JobLog[] }>(`/api/jobs/${initialJob.id}`);
      setJob(data.job);
      setLogs(data.logs);
      if (isTerminalJobStatus(data.job.status)) stopPolling();
    } catch {
      // Transient poll failure; the next tick retries.
    }
  }, [initialJob.id, stopPolling]);

  useEffect(() => {
    if (isTerminalJobStatus(job.status)) {
      stopPolling();
      return;
    }
    if (pollRef.current) return;
    pollRef.current = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return stopPolling;
  }, [job.status, poll, stopPolling]);

  async function cancelJob() {
    try {
      const data = await apiFetch<{ job: ScrapingJob }>(`/api/jobs/${job.id}/cancel`, {
        method: 'POST',
      });
      setJob(data.job);
    } catch {
      // The progress card keeps showing the current state; nothing to roll back.
    }
  }

  return (
    <>
      <JobProgress job={job} logs={logs} onCancel={cancelJob} />
      <SearchResults jobId={job.id} jobStatus={job.status} foundCount={job.found_count} />
    </>
  );
}
