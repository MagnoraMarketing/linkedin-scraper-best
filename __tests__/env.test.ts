/**
 * Required-environment reporting.
 *
 * The service role key was originally left out of the configured check, so a
 * deployment with two of the three variables set booted as if it were healthy:
 * pages rendered, users signed in, and every rate-limit call threw and failed
 * open behind the scenes. These tests pin the variable down as required.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ALL = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
} as const;

/** `publicEnv` reads process.env at module scope, so each case needs a fresh import. */
async function loadEnv(present: Partial<Record<keyof typeof ALL, string>>) {
  vi.resetModules();
  for (const name of Object.keys(ALL) as (keyof typeof ALL)[]) {
    if (present[name]) process.env[name] = present[name];
    else delete process.env[name];
  }
  return import('@/lib/env');
}

const original = { ...process.env };

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...original };
});

describe('missingSupabaseEnv', () => {
  it('reports nothing missing when all three are set', async () => {
    const { missingSupabaseEnv, isSupabaseConfigured } = await loadEnv(ALL);
    expect(missingSupabaseEnv()).toEqual([]);
    expect(isSupabaseConfigured()).toBe(true);
  });

  it('reports the service role key when only it is absent', async () => {
    const { missingSupabaseEnv, isSupabaseConfigured } = await loadEnv({
      NEXT_PUBLIC_SUPABASE_URL: ALL.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ALL.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    });
    expect(missingSupabaseEnv()).toEqual(['SUPABASE_SERVICE_ROLE_KEY']);
    expect(isSupabaseConfigured()).toBe(false);
  });

  it('reports every variable on a bare deployment, in listing order', async () => {
    const { missingSupabaseEnv } = await loadEnv({});
    expect(missingSupabaseEnv()).toEqual([
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
    ]);
  });

  it('treats an empty string as missing, not as a value', async () => {
    const { missingSupabaseEnv } = await loadEnv({ ...ALL, SUPABASE_SERVICE_ROLE_KEY: '' });
    expect(missingSupabaseEnv()).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });
});
