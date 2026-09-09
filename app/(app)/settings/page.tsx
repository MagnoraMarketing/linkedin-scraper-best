import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SettingsForm } from '@/components/settings/SettingsForm';
import { Alert, Card, CardBody, CardHeader } from '@/components/ui';
import { createClient } from '@/lib/supabase/server';
import type { UserSettings } from '@/types/database';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: settings } = await supabase
    .from('user_settings')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle<UserSettings>();

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">Defaults for new searches and account limits.</p>
      </header>

      <SettingsForm initialSettings={settings ?? null} accountEmail={user.email ?? ''} />

      <Card>
        <CardHeader
          title="LinkedIn account"
          description="Configured on the scraper worker, not here."
        />
        <CardBody className="space-y-4">
          <Alert tone="info" title="Credentials live in the worker environment">
            The scraper signs in with <code className="font-mono text-xs">LINKEDIN_EMAIL</code> and{' '}
            <code className="font-mono text-xs">LINKEDIN_PASSWORD</code>, read from the worker
            service&rsquo;s environment variables. They are never stored in the database, never sent
            to the browser, never returned by an API, and never written to a log — which is why
            there is no field for them on this page.
          </Alert>
          <p className="text-sm text-slate-600">
            To change the account, update those variables on the worker host and restart it. Delete
            the cached session directory at the same time so the worker signs in fresh.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Scraper configuration"
          description="Tuned through worker environment variables."
        />
        <CardBody>
          <p className="mb-3 text-sm text-slate-600">
            Rate limiting is deliberately conservative. These are set on the worker, so a browser
            session can never dial them up:
          </p>
          <dl className="space-y-2 text-sm">
            {[
              ['SCRAPER_MAX_CONCURRENCY', 'Profiles fetched at once. Default 1.'],
              ['SCRAPER_DELAY_MS', 'Base delay between profile loads. Default 8000.'],
              ['SCRAPER_TIMEOUT_MS', 'Per-navigation timeout. Default 30000.'],
              ['SCRAPER_MAX_RETRIES', 'Retries per failed profile. Default 3.'],
              ['SCRAPER_MAX_SEARCH_PAGES', 'Search pages loaded per job. Default 10.'],
            ].map(([name, description]) => (
              <div key={name} className="flex flex-wrap gap-x-3">
                <dt className="font-mono text-xs text-slate-900">{name}</dt>
                <dd className="text-slate-500">{description}</dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>
    </div>
  );
}
