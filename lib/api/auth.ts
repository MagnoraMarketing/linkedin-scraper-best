import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

export interface AuthedContext {
  user: User;
  supabase: Awaited<ReturnType<typeof createClient>>;
}

/**
 * Resolves the caller's identity from the request cookies.
 *
 * Uses getUser(), which validates the JWT against Supabase, rather than
 * getSession(), which trusts whatever is in the cookie. Returns null when the
 * caller is not signed in — every route handler must check.
 */
export async function getAuthedContext(): Promise<AuthedContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;
  return { user, supabase };
}
