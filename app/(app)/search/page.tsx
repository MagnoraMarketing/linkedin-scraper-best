import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SearchRunner } from '@/components/search/SearchRunner';
import { createClient } from '@/lib/supabase/server';
import type { ScrapingJob, UserSettings } from '@/types/database';

export const metadata: Metadata = { title: 'Search' };

/**
 * The whole product on one page: pick criteria, start the search, watch it run,
 * and read the leads it produced without navigating anywhere.
 */
export default async function SearchPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [{ data: settings }, { data: activeJobs }] = await Promise.all([
    supabase.from('user_settings').select('*').eq('user_id', user.id).maybeSingle<UserSettings>(),
    supabase
      .from('scraping_jobs')
      .select('*')
      .eq('user_id', user.id)
      .in('status', ['queued', 'running'])
      .order('created_at', { ascending: false })
      .limit(1)
      .returns<ScrapingJob[]>(),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Search</h1>
        <p className="mt-1 text-sm text-slate-500">
          Choose who you are looking for, start the search, and the results land in your leads
          database as they are found.
        </p>
      </header>

      <SearchRunner settings={settings ?? null} initialJob={activeJobs?.[0] ?? null} />
    </div>
  );
}
