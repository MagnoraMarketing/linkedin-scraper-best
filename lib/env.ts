/**
 * Environment access, split by trust boundary.
 *
 * `publicEnv` is safe in the browser. `serverEnv()` reads the service role key
 * and throws if it is called anywhere a bundler could reach — the guard is a
 * runtime backstop for the naming convention, not a replacement for it.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
};

export function requirePublicEnv() {
  return {
    supabaseUrl: required('NEXT_PUBLIC_SUPABASE_URL', publicEnv.supabaseUrl),
    supabaseAnonKey: required('NEXT_PUBLIC_SUPABASE_ANON_KEY', publicEnv.supabaseAnonKey),
  };
}

export function serverEnv() {
  if (typeof window !== 'undefined') {
    throw new Error('serverEnv() must never be called in the browser.');
  }
  return {
    supabaseUrl: required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY),
  };
}

/**
 * The three variables the app cannot run without, in the order the setup page
 * lists them.
 *
 * The service role key belongs here even though only the rate limiter reads
 * it. Leaving it out meant a deployment with two of the three variables set
 * booted and signed users in as if it were healthy, while `checkRateLimit`
 * threw on every call and failed open — so the app quietly ran with no rate
 * limiting at all and nothing on screen said so.
 */
export const REQUIRED_SUPABASE_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const;

export type RequiredSupabaseEnv = (typeof REQUIRED_SUPABASE_ENV)[number];

/**
 * Names of the required variables that are unset or empty.
 *
 * Server-side only: the two `NEXT_PUBLIC_` values are inlined at build time and
 * so read correctly anywhere, but `SUPABASE_SERVICE_ROLE_KEY` is only present
 * in a server process. Calling this in the browser would always report it
 * missing, so it refuses instead of reporting something false.
 */
export function missingSupabaseEnv(): RequiredSupabaseEnv[] {
  if (typeof window !== 'undefined') {
    throw new Error('missingSupabaseEnv() must never be called in the browser.');
  }
  const values: Record<RequiredSupabaseEnv, string | undefined> = {
    NEXT_PUBLIC_SUPABASE_URL: publicEnv.supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: publicEnv.supabaseAnonKey,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  return REQUIRED_SUPABASE_ENV.filter((name) => !values[name]);
}

/** True when Supabase is configured. Used to show a setup screen instead of crashing. */
export function isSupabaseConfigured(): boolean {
  return missingSupabaseEnv().length === 0;
}
