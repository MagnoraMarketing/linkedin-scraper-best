import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { Database } from '@/types/supabase';
import { NextResponse, type NextRequest } from 'next/server';
import { publicEnv } from '@/lib/env';

const PUBLIC_PATHS = ['/login', '/auth', '/setup'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Refreshes the auth session on every request and redirects unauthenticated
 * traffic to /login. Runs before any page or route handler, so a protected
 * route can never render for a signed-out visitor.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Without Supabase configured there is no session to refresh; send everyone
  // to the setup page rather than throwing on every request.
  if (!publicEnv.supabaseUrl || !publicEnv.supabaseAnonKey) {
    if (request.nextUrl.pathname !== '/setup') {
      const url = request.nextUrl.clone();
      url.pathname = '/setup';
      return NextResponse.redirect(url);
    }
    return response;
  }

  const supabase = createServerClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/search';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}
