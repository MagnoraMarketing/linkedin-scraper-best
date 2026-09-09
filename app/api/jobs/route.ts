import type { NextRequest } from 'next/server';
import { getAuthedContext } from '@/lib/api/auth';
import { ok, serverError, unauthorized } from '@/lib/api/response';
import type { ScrapingJob } from '@/types/database';

/** GET /api/jobs — the caller's job history, newest first. */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthedContext();
    if (!auth) return unauthorized();
    const { user, supabase } = auth;

    const limitParam = Number(request.nextUrl.searchParams.get('limit') ?? '25');
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 25;

    const { data, error } = await supabase
      .from('scraping_jobs')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit)
      .returns<ScrapingJob[]>();

    if (error) return serverError('jobs:list', error);

    return ok({ jobs: data ?? [] });
  } catch (error) {
    return serverError('jobs', error);
  }
}
