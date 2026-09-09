import type { NextRequest } from 'next/server';
import { getAuthedContext } from '@/lib/api/auth';
import { RATE_LIMITS, checkRateLimit } from '@/lib/api/rate-limit';
import { fail, ok, rateLimited, serverError, unauthorized, validationError } from '@/lib/api/response';
import { getDialerProvider } from '@/lib/integrations/dialer';
import { exportToDialerSchema } from '@/lib/validation/schemas';
import type { Lead } from '@/types/database';

/**
 * POST /api/leads/export-to-dialer
 *
 * Loads the selected leads and hands them to the configured DialerProvider.
 * No dialer ships with this app: without one configured the endpoint returns
 * `dialer_not_configured` rather than pretending the export happened.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthedContext();
    if (!auth) return unauthorized();
    const { user, supabase } = auth;

    if (!(await checkRateLimit(user.id, RATE_LIMITS.dialerExport))) return rateLimited();

    const parsed = exportToDialerSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const provider = getDialerProvider();
    if (!provider.isConfigured()) {
      return fail(
        'dialer_not_configured',
        'No dialer is connected yet. Implement a DialerProvider in lib/integrations/dialer to enable this.',
        501,
      );
    }

    const { data: leads, error } = await supabase
      .from('leads')
      .select('*')
      .eq('user_id', user.id)
      .in('id', parsed.data.leadIds)
      .returns<Lead[]>();

    if (error) return serverError('dialer:load', error);
    if (!leads || leads.length === 0) {
      return fail('no_leads', 'None of those leads could be found.', 404);
    }

    const result = await provider.exportLeads(leads);
    return ok(result);
  } catch (error) {
    return serverError('dialer:export', error);
  }
}
