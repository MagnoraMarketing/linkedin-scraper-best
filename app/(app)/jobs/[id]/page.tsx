import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { JobDetail } from '@/components/jobs/JobDetail';
import { createClient } from '@/lib/supabase/server';
import type { JobLog, ScrapingJob } from '@/types/database';

export const metadata: Metadata = { title: 'Job' };
export const dynamic = 'force-dynamic';

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: job } = await supabase
    .from('scraping_jobs')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle<ScrapingJob>();

  if (!job) notFound();

  const { data: logs } = await supabase
    .from('job_logs')
    .select('*')
    .eq('job_id', id)
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })
    .limit(300)
    .returns<JobLog[]>();

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <Link href="/jobs" className="text-sm text-slate-500 hover:text-slate-700">
          ← Back to jobs
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-slate-900">
          {job.job_titles.join(', ')}
        </h1>
      </div>

      <JobDetail initialJob={job} initialLogs={logs ?? []} />
    </div>
  );
}
