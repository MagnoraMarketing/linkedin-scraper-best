import { getAuthedContext } from '@/lib/api/auth';
import { fail, notFound, ok, serverError, unauthorized } from '@/lib/api/response';
import { isTerminalJobStatus } from '@/lib/constants/leads';
import type { ScrapingJob } from '@/types/database';

/**
 * POST /api/jobs/[id]/cancel
 *
 * A queued job is cancelled outright. A running job gets `cancel_requested`
 * set: the worker sees the flag on its next heartbeat, stops cleanly at the
 * next profile boundary, and keeps everything it has already saved.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
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

    if (error) return serverError('jobs:cancel:get', error);
    if (!job) return notFound('Job');

    if (isTerminalJobStatus(job.status)) {
      return fail('job_finished', 'That job has already finished.', 409);
    }

    const patch =
      job.status === 'queued'
        ? { status: 'cancelled' as const, cancel_requested: true, completed_at: new Date().toISOString() }
        : { cancel_requested: true };

    const { data: updated, error: updateError } = await supabase
      .from('scraping_jobs')
      .update(patch)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .single<ScrapingJob>();

    if (updateError) return serverError('jobs:cancel:update', updateError);

    return ok({ job: updated });
  } catch (error) {
    return serverError('jobs:cancel', error);
  }
}
