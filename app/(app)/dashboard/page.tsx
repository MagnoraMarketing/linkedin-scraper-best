import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge, Button, Card, CardHeader, EmptyState, StatCard } from '@/components/ui';
import { JOB_STATUS_LABELS, JOB_STATUS_STYLES } from '@/lib/constants/leads';
import { createClient } from '@/lib/supabase/server';
import type { DashboardStats, ScrapingJob } from '@/types/database';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: statsRows }, { data: jobs }] = await Promise.all([
    supabase.rpc('dashboard_stats'),
    supabase
      .from('scraping_jobs')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(8)
      .returns<ScrapingJob[]>(),
  ]);

  const stats: DashboardStats = statsRows?.[0] ?? {
    total_leads: 0,
    new_leads: 0,
    qualified_leads: 0,
    contacted_leads: 0,
    meeting_leads: 0,
    interested_leads: 0,
    running_jobs: 0,
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">Your pipeline at a glance.</p>
        </div>
        <Link href="/search">
          <Button>New search</Button>
        </Link>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Total leads" value={stats.total_leads} />
        <StatCard label="New" value={stats.new_leads} />
        <StatCard label="Qualified" value={stats.qualified_leads} />
        <StatCard label="Contacted" value={stats.contacted_leads} />
        <StatCard label="Meetings" value={stats.meeting_leads} />
      </div>

      <Card>
        <CardHeader
          title="Recent searches"
          action={
            <Link href="/jobs" className="text-sm font-medium text-brand-600 hover:text-brand-700">
              View all
            </Link>
          }
        />

        {!jobs || jobs.length === 0 ? (
          <EmptyState
            title="No searches yet"
            description="Run your first search to start building a lead database."
            action={
              <Link href="/search">
                <Button>Start a search</Button>
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {jobs.map((job) => (
              <li key={job.id}>
                <Link
                  href={`/jobs/${job.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {job.job_titles.join(', ')}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {job.country}
                      {job.location && job.location !== 'all' ? ` · ${job.location}` : ''} ·{' '}
                      {job.requested_count} requested ·{' '}
                      {new Date(job.created_at).toLocaleDateString('en-GB')}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm tabular-nums text-slate-600">
                      {job.found_count} found
                    </span>
                    <Badge className={JOB_STATUS_STYLES[job.status]}>
                      {JOB_STATUS_LABELS[job.status]}
                    </Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
