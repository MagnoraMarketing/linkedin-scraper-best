import { getAuthedContext } from '@/lib/api/auth';
import { notFound, ok, serverError, unauthorized } from '@/lib/api/response';
import type { JobLog, ScrapingJob } from '@/types/database';

/** GET /api/jobs/[id] — one job plus its run log. Polled by the search page. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthedContext();
    if (!auth) return unauthorized();
    const { user, supabase } = auth;
    const { id } = await params;

    const { data: job, error } = await supabase
      .from('scraping_jobs')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle<ScrapingJob>();

    if (error) return serverError('jobs:get', error);
    if (!job) return notFound('Job');

    const { data: logs } = await supabase
      .from('job_logs')
      .select('*')
      .eq('job_id', id)
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(300)
      .returns<JobLog[]>();

    return ok({ job, logs: logs ?? [] });
  } catch (error) {
    return serverError('jobs:get', error);
  }
}
