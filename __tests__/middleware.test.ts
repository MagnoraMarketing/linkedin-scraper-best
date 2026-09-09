/**
 * Middleware routing tests.
 *
 * These exist because a real bug got through: the middleware redirected
 * unauthenticated /api/* requests to the HTML login page, so a fetch client
 * asking for JSON received a login page instead of
 * `{ ok: false, error: { code: 'unauthorized' } }`. The API route tests missed
 * it because they call the handlers directly, bypassing middleware entirely.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser: { id: string } | null = null;
let envConfigured = true;

vi.mock('@/lib/env', () => ({
  get publicEnv() {
    return envConfigured
      ? { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon-key' }
      : { supabaseUrl: '', supabaseAnonKey: '' };
  },
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: currentUser }, error: null }),
    },
  }),
}));

const { updateSession } = await import('@/lib/supabase/middleware');

function request(path: string) {
  return new NextRequest(`https://app.example.com${path}`);
}

beforeEach(() => {
  currentUser = null;
  envConfigured = true;
});

describe('unauthenticated API requests', () => {
  const apiPaths = ['/api/leads', '/api/jobs', '/api/search', '/api/settings'];

  it('are passed through so the route handler can answer with JSON 401', async () => {
    for (const path of apiPaths) {
      const response = await updateSession(request(path));
      // Not a redirect: a 3xx here would hand a fetch client an HTML page.
      expect(response.status, path).toBeLessThan(300);
      expect(response.headers.get('location'), path).toBeNull();
    }
  });
});

describe('unauthenticated page requests', () => {
  const protectedPages = ['/', '/dashboard', '/leads', '/jobs', '/search', '/settings'];

  it('redirect to /login carrying the intended destination', async () => {
    for (const path of protectedPages) {
      const response = await updateSession(request(path));
      expect(response.status, path).toBe(307);

      const location = response.headers.get('location');
      expect(location, path).toBeTruthy();

      const url = new URL(location as string);
      expect(url.pathname, path).toBe('/login');
      expect(url.searchParams.get('next'), path).toBe(path);
    }
  });

  it('leaves public paths alone', async () => {
    for (const path of ['/login', '/setup', '/auth/signout']) {
      const response = await updateSession(request(path));
      expect(response.headers.get('location'), path).toBeNull();
    }
  });
});

describe('authenticated requests', () => {
  beforeEach(() => {
    currentUser = { id: 'user-1' };
  });

  it('reach protected pages', async () => {
    const response = await updateSession(request('/search'));
    expect(response.headers.get('location')).toBeNull();
  });

  it('are bounced off /login to the search page', async () => {
    const response = await updateSession(request('/login'));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location') as string).pathname).toBe('/search');
  });
});

describe('when Supabase is not configured', () => {
  beforeEach(() => {
    envConfigured = false;
  });

  it('sends page requests to /setup instead of throwing', async () => {
    const response = await updateSession(request('/search'));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location') as string).pathname).toBe('/setup');
  });

  it('answers API requests with a JSON error, not an HTML redirect', async () => {
    const response = await updateSession(request('/api/leads'));
    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toContain('application/json');

    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('not_configured');
  });

  it('does not redirect /setup to itself', async () => {
    const response = await updateSession(request('/setup'));
    expect(response.headers.get('location')).toBeNull();
  });
});
