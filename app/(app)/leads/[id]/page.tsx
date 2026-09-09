import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { LeadDetail } from '@/components/leads/LeadDetail';
import { createClient } from '@/lib/supabase/server';
import type { Lead } from '@/types/database';

export const metadata: Metadata = { title: 'Lead' };
export const dynamic = 'force-dynamic';

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle<Lead>();

  if (!lead) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/leads" className="text-sm text-slate-500 hover:text-slate-700">
        ← Back to leads
      </Link>
      <LeadDetail initialLead={lead} />
    </div>
  );
}
