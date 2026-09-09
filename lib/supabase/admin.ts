import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { serverEnv } from '@/lib/env';
import type { Database } from '@/types/supabase';

/**
 * Service-role client. BYPASSES ROW LEVEL SECURITY.
 *
 * The `server-only` import makes importing this from a Client Component a
 * build error, so the key can never reach the browser bundle.
 *
 * Only used for things RLS deliberately cannot express: writing job_logs and
 * enforcing rate limits. Every call site still filters on user_id explicitly.
 */
export function createAdminClient() {
  const { supabaseUrl, serviceRoleKey } = serverEnv();
  return createSupabaseClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
