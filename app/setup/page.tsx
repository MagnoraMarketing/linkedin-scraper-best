import type { Metadata } from 'next';
import { Alert } from '@/components/ui';

export const metadata: Metadata = { title: 'Setup required' };

/**
 * Shown when Supabase env vars are missing. Without this the app would throw
 * on every request and give no indication of what is wrong.
 */
export default function SetupPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-lg font-semibold text-slate-900">Setup required</h1>
      <p className="mt-2 text-sm text-slate-600">
        The app is deployed but not yet connected to a Supabase project.
      </p>

      <div className="mt-6 space-y-4">
        <Alert tone="warning" title="Missing environment variables">
          Set these on your Vercel project (Settings → Environment Variables), then redeploy.
        </Alert>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">Required</h2>
          <dl className="mt-3 space-y-3 text-sm">
            <div>
              <dt className="font-mono text-xs text-slate-900">NEXT_PUBLIC_SUPABASE_URL</dt>
              <dd className="text-slate-500">
                Supabase → Project Settings → Data API → Project URL
              </dd>
            </div>
            <div>
              <dt className="font-mono text-xs text-slate-900">NEXT_PUBLIC_SUPABASE_ANON_KEY</dt>
              <dd className="text-slate-500">Supabase → Project Settings → API Keys → anon public</dd>
            </div>
            <div>
              <dt className="font-mono text-xs text-slate-900">SUPABASE_SERVICE_ROLE_KEY</dt>
              <dd className="text-slate-500">
                Supabase → Project Settings → API Keys → service_role. Server-side only — never add
                a <code className="font-mono">NEXT_PUBLIC_</code> prefix to this one.
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">Then run the migrations</h2>
          <p className="mt-2 text-sm text-slate-600">
            Open the Supabase SQL editor and run the files in{' '}
            <code className="font-mono text-xs">supabase/migrations/</code> in numeric order. Full
            instructions are in the project README.
          </p>
        </div>
      </div>
    </div>
  );
}
