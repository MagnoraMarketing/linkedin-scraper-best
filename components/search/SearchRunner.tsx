'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { JobTitlePicker } from './JobTitlePicker';
import { JobProgress } from './JobProgress';
import { SearchResults } from './SearchResults';
import { Alert, Button, Card, CardBody } from '@/components/ui';
import { ApiRequestError, apiFetch } from '@/lib/api/client';
import { isTerminalJobStatus } from '@/lib/constants/leads';
import {
  COMPANY_SIZES,
  COUNTRIES,
  DEFAULT_COUNTRY,
  DEFAULT_LEAD_LIMIT,
  INDUSTRIES,
  LEAD_COUNT_OPTIONS,
  LOCATIONS,
} from '@/lib/constants/search';
import type { JobLog, ScrapingJob, UserSettings } from '@/types/database';

const POLL_INTERVAL_MS = 3000;

export function SearchRunner({
  settings,
  initialJob,
}: {
  settings: UserSettings | null;
  initialJob: ScrapingJob | null;
}) {
  const maxLeads = settings?.max_lead_limit ?? 500;

  const [jobTitles, setJobTitles] = useState<string[]>(
    settings?.default_job_titles?.length ? settings.default_job_titles : ['CEO', 'CFO'],
  );
  const [country, setCountry] = useState(settings?.default_country ?? DEFAULT_COUNTRY);
  const [location, setLocation] = useState(settings?.default_location ?? 'all');
  const [customLocation, setCustomLocation] = useState('');
  const [companySize, setCompanySize] = useState('any');
  const [industry, setIndustry] = useState('all');
  const [requestedCount, setRequestedCount] = useState(
    settings?.default_lead_limit ?? DEFAULT_LEAD_LIMIT,
  );

  const [job, setJob] = useState<ScrapingJob | null>(initialJob);
  const [logs, setLogs] = useState<JobLog[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const poll = useCallback(
    async (jobId: string) => {
      try {
        const data = await apiFetch<{ job: ScrapingJob; logs: JobLog[] }>(`/api/jobs/${jobId}`);
        setJob(data.job);
        setLogs(data.logs);
        if (isTerminalJobStatus(data.job.status)) stopPolling();
      } catch {
        // A single failed poll is not worth interrupting the user over; the
        // next tick will most likely succeed.
      }
    },
    [stopPolling],
  );

  // Poll while a job is live. Cleared on unmount and on any terminal status.
  useEffect(() => {
    if (!job || isTerminalJobStatus(job.status)) {
      stopPolling();
      return;
    }
    if (pollRef.current) return;

    const jobId = job.id;
    void poll(jobId);
    pollRef.current = setInterval(() => void poll(jobId), POLL_INTERVAL_MS);

    return stopPolling;
  }, [job, poll, stopPolling]);

  const running = job !== null && !isTerminalJobStatus(job.status);
  const effectiveLocation = location === 'custom' ? customLocation.trim() : location;

  async function startSearch() {
    setError(null);
    setFieldErrors({});
    setLogs([]);
    setStarting(true);

    try {
      const data = await apiFetch<{ job: ScrapingJob }>('/api/search', {
        method: 'POST',
        body: JSON.stringify({
          jobTitles,
          country,
          location: effectiveLocation || 'all',
          companySize,
          industry,
          requestedCount,
        }),
      });
      setJob(data.job);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
        if (err.fields) setFieldErrors(err.fields);
      } else {
        setError('Could not start the search. Please try again.');
      }
    } finally {
      setStarting(false);
    }
  }

  async function cancelJob() {
    if (!job) return;
    try {
      const data = await apiFetch<{ job: ScrapingJob }>(`/api/jobs/${job.id}/cancel`, {
        method: 'POST',
      });
      setJob(data.job);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not cancel the job.');
    }
  }

  const countryOptions = COUNTRIES.filter((c) => c.enabled || c.code === country);
  const locationOptions = LOCATIONS.filter((l) => l.country === country);

  return (
    <div className="space-y-5">
      {error && <Alert tone="error">{error}</Alert>}

      <Card>
        <CardBody className="space-y-6">
          <JobTitlePicker value={jobTitles} onChange={setJobTitles} disabled={running} />
          {fieldErrors.jobTitles && <p className="field-error">{fieldErrors.jobTitles[0]}</p>}

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="country" className="field-label">
                Country
              </label>
              <select
                id="country"
                value={country}
                disabled={running}
                onChange={(e) => {
                  setCountry(e.target.value);
                  setLocation('all');
                }}
                className="field-input"
              >
                {countryOptions.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
              <p className="field-hint">
                More countries are wired up but disabled until their LinkedIn location id is filled
                in — see the README.
              </p>
            </div>

            <div>
              <label htmlFor="location" className="field-label">
                Location
              </label>
              <select
                id="location"
                value={location}
                disabled={running}
                onChange={(e) => setLocation(e.target.value)}
                className="field-input"
              >
                {locationOptions.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
                <option value="custom">Custom location…</option>
              </select>
              {location === 'custom' && (
                <input
                  type="text"
                  value={customLocation}
                  disabled={running}
                  onChange={(e) => setCustomLocation(e.target.value)}
                  placeholder="e.g. Esbjerg"
                  className="field-input mt-2"
                  aria-label="Custom location"
                />
              )}
            </div>

            <div>
              <label htmlFor="companySize" className="field-label">
                Company size
              </label>
              <select
                id="companySize"
                value={companySize}
                disabled={running}
                onChange={(e) => setCompanySize(e.target.value)}
                className="field-input"
              >
                {COMPANY_SIZES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="industry" className="field-label">
                Industry
              </label>
              <select
                id="industry"
                value={industry}
                disabled={running}
                onChange={(e) => setIndustry(e.target.value)}
                className="field-input"
              >
                {INDUSTRIES.map((i) => (
                  <option key={i.value} value={i.value}>
                    {i.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="requestedCount" className="field-label">
                Number of leads
              </label>
              <select
                id="requestedCount"
                value={requestedCount}
                disabled={running}
                onChange={(e) => setRequestedCount(Number(e.target.value))}
                className="field-input"
              >
                {LEAD_COUNT_OPTIONS.filter((n) => n <= maxLeads).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <p className="field-hint">Your account limit is {maxLeads}. Change it in Settings.</p>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-5">
            <Button
              type="button"
              size="lg"
              onClick={startSearch}
              loading={starting}
              disabled={running || jobTitles.length === 0}
              className="w-full sm:w-auto"
            >
              {running ? 'Search in progress…' : 'START SEARCH'}
            </Button>
            {running && (
              <p className="mt-2 text-xs text-slate-500">
                One search runs at a time. Cancel the current one to start another.
              </p>
            )}
          </div>
        </CardBody>
      </Card>

      {job && <JobProgress job={job} logs={logs} onCancel={cancelJob} />}
      {job && <SearchResults jobId={job.id} jobStatus={job.status} foundCount={job.found_count} />}
    </div>
  );
}
