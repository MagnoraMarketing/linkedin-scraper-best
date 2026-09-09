import type { NextRequest } from 'next/server';
import { getAuthedContext } from '@/lib/api/auth';
import { RATE_LIMITS, checkRateLimit } from '@/lib/api/rate-limit';
import { rateLimited, serverError, unauthorized, validationError } from '@/lib/api/response';
import { csvFilename, leadsToCsv } from '@/lib/leads/csv';
import { applyLeadFilters } from '@/lib/leads/query';
import { exportLeadsSchema } from '@/lib/validation/schemas';
import type { Lead } from '@/types/database';

const MAX_EXPORT_ROWS = 5000;

/**
 * POST /api/leads/export — returns a CSV file.
 *
 * Three modes: every lead, the selected ids, or whatever the current filter
 * matches. "filtered" reuses applyLeadFilters, so the export always matches
 * the table the user is looking at.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthedContext();
    if (!auth) return unauthorized();
    const { user, supabase } = auth;

    if (!(await checkRateLimit(user.id, RATE_LIMITS.exportLeads))) return rateLimited();

    const parsed = exportLeadsSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);
    const { mode, leadIds, filters } = parsed.data;

    let query = supabase.from('leads').select('*');

    if (mode === 'selected') {
      query = query.eq('user_id', user.id).in('id', leadIds ?? []);
    } else if (mode === 'filtered') {
      query = applyLeadFilters(query, user.id, filters ?? {});
    } else {
      query = query.eq('user_id', user.id);
    }

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(MAX_EXPORT_ROWS)
      .returns<Lead[]>();

    if (error) return serverError('leads:export', error);

    const csv = leadsToCsv(data ?? []);

    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${csvFilename()}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return serverError('leads:export', error);
  }
}
