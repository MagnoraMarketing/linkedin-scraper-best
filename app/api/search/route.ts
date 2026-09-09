import type { NextRequest } from 'next/server';
import { getAuthedContext } from '@/lib/api/auth';
import { RATE_LIMITS, checkRateLimit } from '@/lib/api/rate-limit';
import { fail, ok, rateLimited, serverError, unauthorized, validationError } from '@/lib/api/response';
import { createSearchSchema } from '@/lib/validation/schemas';
import type { ScrapingJob, UserSettings } from '@/types/database';

/**
 * POST /api/search — queue a scraping job.
 *
 * Returns as soon as the row is written. The worker picks it up from the queue;
 * nothing about this request waits for LinkedIn.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthedContext();
    if (!auth) return unauthorized();
    const { user, supabase } = auth;

    if (!(await checkRateLimit(user.id, RATE_LIMITS.createSearch))) return rateLimited();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return fail('invalid_json', 'Request body must be valid JSON.');
    }

    const parsed = createSearchSchema.safeParse(body);
    if (!parsed.success) return validationError(parsed.error);
    const input = parsed.data;

    // The per-user ceiling is configured in Settings, so enforce it server-side
    // rather than trusting the dropdown the browser rendered.
    const { data: settings } = await supabase
      .from('user_settings')
      .select('max_lead_limit')
      .eq('user_id', user.id)
      .maybeSingle<Pick<UserSettings, 'max_lead_limit'>>();

    const maxAllowed = settings?.max_lead_limit ?? 500;
    if (input.requestedCount > maxAllowed) {
      return fail(
        'limit_exceeded',
        `Your account is limited to ${maxAllowed} leads per search. Raise it in Settings.`,
        422,
      );
    }

    // One running job at a time keeps scraping sequential and predictable.
    const { count: activeCount, error: countError } = await supabase
      .from('scraping_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .in('status', ['queued', 'running']);

    if (countError) return serverError('search:count', countError);

    if ((activeCount ?? 0) > 0) {
      return fail(
        'job_already_running',
        'You already have a search in progress. Wait for it to finish or cancel it first.',
        409,
      );
    }

    const { data: job, error } = await supabase
      .from('scraping_jobs')
      .insert({
        user_id: user.id,
        status: 'queued',
        job_titles: input.jobTitles,
        country: input.country,
        location: input.location,
        company_size: input.companySize,
        industry: input.industry,
        requested_count: input.requestedCount,
      })
      .select()
      .single<ScrapingJob>();

    if (error) return serverError('search:insert', error);

    return ok({ job }, 201);
  } catch (error) {
    return serverError('search', error);
  }
}
