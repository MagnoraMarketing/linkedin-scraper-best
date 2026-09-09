import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

export interface RateLimitRule {
  bucket: string;
  limit: number;
  windowSeconds: number;
}

/** Deliberately tight on the expensive endpoint, generous on reads. */
export const RATE_LIMITS = {
  createSearch: { bucket: 'create_search', limit: 10, windowSeconds: 60 * 60 },
  mutateLead: { bucket: 'mutate_lead', limit: 120, windowSeconds: 60 },
  exportLeads: { bucket: 'export_leads', limit: 20, windowSeconds: 60 * 10 },
  dialerExport: { bucket: 'dialer_export', limit: 20, windowSeconds: 60 * 10 },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Counts the request and reports whether it is within the limit.
 *
 * Fails open: if the rate-limit table itself is unreachable we let the request
 * through rather than taking the whole app down. The limit is abuse control,
 * not an authorisation boundary — RLS is what actually protects the data.
 */
export async function checkRateLimit(userId: string, rule: RateLimitRule): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('check_rate_limit', {
      p_user_id: userId,
      p_bucket: rule.bucket,
      p_limit: rule.limit,
      p_window_seconds: rule.windowSeconds,
    });

    if (error) {
      console.error('[rate-limit] check failed', error.message);
      return true;
    }
    return data === true;
  } catch (error) {
    console.error('[rate-limit] unavailable', error);
    return true;
  }
}
