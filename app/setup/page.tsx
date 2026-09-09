import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert } from '@/components/ui';
import { REQUIRED_SUPABASE_ENV, missingSupabaseEnv, type RequiredSupabaseEnv } from '@/lib/env';

export const metadata: Metadata = { title: 'Setup required' };

/**
 * Read the environment on every request rather than at build time. The two
 * `NEXT_PUBLIC_` values are inlined into the bundle anyway, but the service
 * role key is not — a prerendered page would report whatever was set when the
 * build ran and never notice the variable being added afterwards.
 */
export const dynamic = 'force-dynamic';

const WHERE_TO_FIND: Record<RequiredSupabaseEnv, string> = {
  NEXT_PUBLIC_SUPABASE_URL: 'Project Settings → Data API → Project URL',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'Project Settings → API Keys → anon public',
  SUPABASE_SERVICE_ROLE_KEY: 'Project Settings → API Keys → service_role',
};

/**
 * Shown when Supabase env vars are missing. Without this the app would throw
 * on every request and give no indication of what is wrong.
 *
 * It names which variables are actually missing. Listing all three
 * unconditionally sent people back to re-check settings that were already
 * correct, which is the opposite of what a setup screen is for.
 */
export default function SetupPage() {
  const missing = missingSupabaseEnv();
  const missingSet = new Set<string>(missing);
  const configured = missing.length === 0;

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-lg font-semibold text-slate-900">
        {configured ? 'Setup complete' : 'Setup required'}
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        {configured
          ? 'This deployment is connected to a Supabase project.'
          : 'The app is deployed but not yet connected to a Supabase project.'}
      </p>

      <div className="mt-6 space-y-4">
        {configured ? (
          <Alert tone="success" title="All environment variables are set">
            Nothing to do here. <Link href="/login">Go to the sign-in page</Link> — if the app still
            reports a database error, the migrations below have not been run yet.
          </Alert>
        ) : (
          <Alert
            tone="warning"
            title={
              missing.length === 1
                ? '1 environment variable is missing'
                : `${missing.length} environment variables are missing`
            }
          >
            Add them on your Vercel project under Settings → Environment Variables, for the
            Production environment, then redeploy. Vercel only picks up new variables on the next
            build — saving them is not enough on its own.
          </Alert>
        )}

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">Required variables</h2>
          <dl className="mt-3 space-y-3 text-sm">
            {REQUIRED_SUPABASE_ENV.map((name) => (
              <div key={name} className="flex items-start justify-between gap-4">
                <div>
                  <dt className="font-mono text-xs text-slate-900">{name}</dt>
                  <dd className="text-slate-500">Supabase → {WHERE_TO_FIND[name]}</dd>
                </div>
                <span
                  className={
                    missingSet.has(name)
                      ? 'shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800'
                      : 'shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800'
                  }
                >
                  {missingSet.has(name) ? 'Missing' : 'Set'}
                </span>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-slate-500">
            <code className="font-mono">SUPABASE_SERVICE_ROLE_KEY</code> is server-side only. Never
            give it a <code className="font-mono">NEXT_PUBLIC_</code> prefix — that would publish it
            to every visitor&rsquo;s browser.
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">
            {configured ? 'Create the database tables' : 'Then create the database tables'}
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            In the Supabase SQL editor, run the files in{' '}
            <code className="font-mono text-xs">supabase/migrations/</code> in numeric order, or run{' '}
            <code className="font-mono text-xs">./scripts/build-setup-sql.sh</code> to concatenate
            them into one file you can paste in a single go. Until this is done, signing in works
            but every page reports a database error.
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">
            {configured ? 'Create your account' : 'Then create your account'}
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            {configured
              ? 'On the sign-in screen, "Create one" registers the first account.'
              : 'Reload this page. Once the variables are set you will land on the sign-in screen, where "Create one" registers the first account.'}
          </p>
        </div>
      </div>
    </div>
  );
}
