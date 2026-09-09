import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge, Button, Card, EmptyState } from '@/components/ui';
import { JOB_STATUS_LABELS, JOB_STATUS_STYLES } from '@/lib/constants/leads';
import { createClient } from '@/lib/supabase/server';
import type { ScrapingJob } from '@/types/database';

export const metadata: Metadata = { title: 'Jobs' };
export const dynamic = 'force-dynamic';

export default async function JobsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: jobs } = await supabase
    .from('scraping_jobs')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100)
    .returns<ScrapingJob[]>();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Jobs</h1>
          <p className="mt-1 text-sm text-slate-500">Every search you have run.</p>
        </div>
        <Link href="/search">
          <Button>New search</Button>
        </Link>
      </header>

      <Card>
        {!jobs || jobs.length === 0 ? (
          <EmptyState title="No jobs yet" description="Searches you run will be listed here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Search</th>
                  <th className="px-5 py-2.5 font-medium">Location</th>
                  <th className="px-5 py-2.5 font-medium">Found</th>
                  <th className="px-5 py-2.5 font-medium">Duplicates</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <Link
                        href={`/jobs/${job.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {job.job_titles.join(', ')}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {job.country}
                      {job.location && job.location !== 'all' ? ` · ${job.location}` : ''}
                    </td>
                    <td className="px-5 py-3 tabular-nums text-slate-600">
                      {job.found_count} / {job.requested_count}
                    </td>
                    <td className="px-5 py-3 tabular-nums text-slate-600">{job.duplicate_count}</td>
                    <td className="px-5 py-3">
                      <Badge className={JOB_STATUS_STYLES[job.status]}>
                        {JOB_STATUS_LABELS[job.status]}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-slate-500">
                      {new Date(job.created_at).toLocaleString('en-GB')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
