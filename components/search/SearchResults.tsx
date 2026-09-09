'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, CardHeader, EmptyState, Spinner } from '@/components/ui';
import { apiFetch } from '@/lib/api/client';
import { LEAD_STATUS_LABELS, LEAD_STATUS_STYLES, isTerminalJobStatus } from '@/lib/constants/leads';
import type { JobStatus } from '@/lib/constants/leads';
import type { Lead } from '@/types/database';
import type { Paginated } from '@/types/api';

/**
 * The leads this job produced, refreshed while it runs, so the results appear
 * on the search page itself rather than only in the leads table.
 */
export function SearchResults({
  jobId,
  jobStatus,
  foundCount,
}: {
  jobId: string;
  jobStatus: JobStatus;
  foundCount: number;
}) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<Paginated<Lead>>(
        `/api/leads?jobId=${jobId}&pageSize=50&sort=created_at&direction=desc`,
      );
      setLeads(data.items);
    } catch {
      // Keep whatever is already on screen; the next refresh will retry.
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  // Refresh whenever the found count moves, and once more when the job ends.
  useEffect(() => {
    void load();
  }, [load, foundCount, jobStatus]);

  async function exportCsv() {
    setExporting(true);
    try {
      const response = await fetch('/api/leads/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'filtered', filters: { jobId } }),
      });
      if (!response.ok) return;

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `leads-${jobId.slice(0, 8)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  const finished = isTerminalJobStatus(jobStatus);

  return (
    <Card>
      <CardHeader
        title="Results"
        description={
          leads.length > 0
            ? `${leads.length} lead${leads.length === 1 ? '' : 's'} from this search`
            : undefined
        }
        action={
          leads.length > 0 ? (
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={exportCsv} loading={exporting}>
                Export CSV
              </Button>
              <Link href={`/leads?jobId=${jobId}`}>
                <Button variant="secondary" size="sm">
                  Open in Leads
                </Button>
              </Link>
            </div>
          ) : undefined
        }
      />

      {leads.length === 0 ? (
        <EmptyState
          title={finished ? 'No leads from this search' : 'Waiting for the first results…'}
          description={
            finished
              ? 'LinkedIn returned nothing that matched, or everything found was already in your database.'
              : 'Leads appear here as the worker saves them.'
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Title</th>
                <th className="px-4 py-2.5 font-medium">Company</th>
                <th className="px-4 py-2.5 font-medium">Location</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {leads.map((lead) => (
                <tr key={lead.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/leads/${lead.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {lead.full_name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{lead.job_title ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-600">{lead.company_name ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-600">{lead.location ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <Badge className={LEAD_STATUS_STYLES[lead.status]}>
                      {LEAD_STATUS_LABELS[lead.status]}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && (
            <div className="flex items-center gap-2 px-4 py-2 text-xs text-slate-500">
              <Spinner className="h-3 w-3" /> Refreshing…
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
