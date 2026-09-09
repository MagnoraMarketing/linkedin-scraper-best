import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LeadsTable } from '@/components/leads/LeadsTable';

export const metadata: Metadata = { title: 'Leads' };

export default function LeadsPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">Leads</h1>
        <p className="mt-1 text-sm text-slate-500">
          Everything found across your searches, deduplicated.
        </p>
      </header>

      <Suspense fallback={<div className="h-64 rounded-lg border border-slate-200 bg-white" />}>
        <LeadsTable />
      </Suspense>
    </div>
  );
}
