'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Alert, Badge, Button, Card, EmptyState, Spinner, cx } from '@/components/ui';
import { ApiRequestError, apiFetch } from '@/lib/api/client';
import {
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  LEAD_STATUS_STYLES,
  type LeadStatus,
} from '@/lib/constants/leads';
import { LEAD_SORT_COLUMNS } from '@/lib/leads/query';
import type { Paginated } from '@/types/api';
import type { Lead } from '@/types/database';

type SortColumn = (typeof LEAD_SORT_COLUMNS)[number];

const PAGE_SIZE = 50;

export function LeadsTable() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const jobIdFilter = searchParams.get('jobId') ?? undefined;

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState<LeadStatus | ''>('');
  const [sort, setSort] = useState<SortColumn>('created_at');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);

  const [data, setData] = useState<Paginated<Lead> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Debounce the search box so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sort,
      direction,
    });
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (status) params.set('status', status);
    if (jobIdFilter) params.set('jobId', jobIdFilter);
    return params.toString();
  }, [page, sort, direction, debouncedSearch, status, jobIdFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await apiFetch<Paginated<Lead>>(`/api/leads?${queryString}`));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load leads.');
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void load();
  }, [load]);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const allSelected = items.length > 0 && items.every((l) => selected.has(l.id));

  function toggleSort(column: SortColumn) {
    if (sort === column) {
      setDirection(direction === 'asc' ? 'desc' : 'asc');
    } else {
      setSort(column);
      setDirection('asc');
    }
    setPage(1);
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(items.map((l) => l.id)));
  }

  function toggleOne(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function bulkStatus(newStatus: LeadStatus) {
    setBusy(true);
    try {
      await apiFetch('/api/leads', {
        method: 'POST',
        body: JSON.stringify({
          action: 'set_status',
          leadIds: [...selected],
          status: newStatus,
        }),
      });
      setSelected(new Set());
      await load();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not update those leads.');
    } finally {
      setBusy(false);
    }
  }

  async function bulkDelete() {
    setBusy(true);
    try {
      await apiFetch('/api/leads', {
        method: 'POST',
        body: JSON.stringify({ action: 'delete', leadIds: [...selected] }),
      });
      setSelected(new Set());
      setConfirmDelete(false);
      await load();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not delete those leads.');
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv(mode: 'all' | 'selected' | 'filtered') {
    setBusy(true);
    try {
      const body =
        mode === 'selected'
          ? { mode, leadIds: [...selected] }
          : mode === 'filtered'
            ? {
                mode,
                filters: {
                  ...(debouncedSearch ? { search: debouncedSearch } : {}),
                  ...(status ? { status } : {}),
                  ...(jobIdFilter ? { jobId: jobIdFilter } : {}),
                },
              }
            : { mode };

      const response = await fetch('/api/leads/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        setError('Could not build the export. Please try again.');
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'leads.csv';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}

      {jobIdFilter && (
        <Alert tone="info">
          Showing leads from one search only.{' '}
          <Link href="/leads" className="font-medium underline">
            Show all leads
          </Link>
        </Alert>
      )}

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label htmlFor="lead-search" className="field-label">
              Search
            </label>
            <input
              id="lead-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, company, title or email"
              className="field-input"
            />
          </div>

          <div>
            <label htmlFor="lead-status" className="field-label">
              Status
            </label>
            <select
              id="lead-status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as LeadStatus | '');
                setPage(1);
              }}
              className="field-input"
            >
              <option value="">All statuses</option>
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {LEAD_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>

          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={() => exportCsv('filtered')} disabled={busy}>
              Export filtered
            </Button>
            <Button variant="secondary" onClick={() => exportCsv('all')} disabled={busy}>
              Export all
            </Button>
          </div>
        </div>
      </Card>

      {selected.size > 0 && (
        <Card className="flex flex-wrap items-center gap-3 border-brand-200 bg-brand-50 p-3">
          <span className="text-sm font-medium text-brand-900">
            {selected.size} selected
          </span>
          <select
            aria-label="Change status of selected leads"
            className="field-input w-auto py-1.5 text-xs"
            value=""
            disabled={busy}
            onChange={(e) => {
              if (e.target.value) void bulkStatus(e.target.value as LeadStatus);
            }}
          >
            <option value="">Change status…</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {LEAD_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <Button size="sm" variant="secondary" onClick={() => exportCsv('selected')} disabled={busy}>
            Export selected
          </Button>
          <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)} disabled={busy}>
            Delete
          </Button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto text-xs text-brand-700 hover:underline"
          >
            Clear selection
          </button>
        </Card>
      )}

      <Card>
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
            <Spinner /> Loading leads…
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="No leads found"
            description={
              debouncedSearch || status
                ? 'Nothing matches those filters. Try clearing them.'
                : 'Run a search to start collecting leads.'
            }
            action={
              !debouncedSearch && !status ? (
                <Link href="/search">
                  <Button>Start a search</Button>
                </Link>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* Desktop / tablet: full table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="w-10 px-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label="Select all leads on this page"
                        className="h-4 w-4 rounded border-slate-300"
                      />
                    </th>
                    <SortHeader label="Name" column="full_name" {...{ sort, direction, toggleSort }} />
                    <SortHeader label="Title" column="job_title" {...{ sort, direction, toggleSort }} />
                    <SortHeader
                      label="Company"
                      column="company_name"
                      {...{ sort, direction, toggleSort }}
                    />
                    <th className="px-4 py-2.5 font-medium">Location</th>
                    <th className="px-4 py-2.5 font-medium">LinkedIn</th>
                    <th className="px-4 py-2.5 font-medium">Email</th>
                    <th className="px-4 py-2.5 font-medium">Phone</th>
                    <SortHeader label="Status" column="status" {...{ sort, direction, toggleSort }} />
                    <SortHeader
                      label="Created"
                      column="created_at"
                      {...{ sort, direction, toggleSort }}
                    />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((lead) => (
                    <tr key={lead.id} className={cx('hover:bg-slate-50', selected.has(lead.id) && 'bg-brand-50/50')}>
                      <td className="px-4 py-2.5">
                        <input
                          type="checkbox"
                          checked={selected.has(lead.id)}
                          onChange={() => toggleOne(lead.id)}
                          aria-label={`Select ${lead.full_name}`}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/leads/${lead.id}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {lead.full_name}
                        </Link>
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-2.5 text-slate-600">
                        {lead.job_title ?? '—'}
                      </td>
                      <td className="max-w-[180px] truncate px-4 py-2.5 text-slate-600">
                        {lead.company_name ?? '—'}
                      </td>
                      <td className="max-w-[150px] truncate px-4 py-2.5 text-slate-600">
                        {lead.location ?? '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        {lead.linkedin_url ? (
                          <a
                            href={lead.linkedin_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-brand-600 hover:underline"
                          >
                            Profile
                          </a>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="max-w-[180px] truncate px-4 py-2.5 text-slate-600">
                        {lead.email ?? <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {lead.phone ?? lead.mobile_phone ?? <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge className={LEAD_STATUS_STYLES[lead.status]}>
                          {LEAD_STATUS_LABELS[lead.status]}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">
                        {new Date(lead.created_at).toLocaleDateString('en-GB')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile: cards, because a 10-column table is unusable at this width */}
            <ul className="divide-y divide-slate-100 md:hidden">
              {items.map((lead) => (
                <li key={lead.id} className="flex gap-3 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(lead.id)}
                    onChange={() => toggleOne(lead.id)}
                    aria-label={`Select ${lead.full_name}`}
                    className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        href={`/leads/${lead.id}`}
                        className="truncate font-medium text-brand-700"
                      >
                        {lead.full_name}
                      </Link>
                      <Badge className={LEAD_STATUS_STYLES[lead.status]}>
                        {LEAD_STATUS_LABELS[lead.status]}
                      </Badge>
                    </div>
                    <p className="truncate text-sm text-slate-600">{lead.job_title ?? '—'}</p>
                    <p className="truncate text-sm text-slate-500">{lead.company_name ?? '—'}</p>
                    {lead.email && <p className="truncate text-xs text-slate-500">{lead.email}</p>}
                  </div>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm">
              <p className="text-slate-500">
                {total.toLocaleString('en-US')} lead{total === 1 ? '' : 's'} · page {page} of{' '}
                {totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || loading}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || loading}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete leads"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={bulkDelete} loading={busy}>
              Delete {selected.size}
            </Button>
          </>
        }
      >
        Deleting {selected.size} lead{selected.size === 1 ? '' : 's'} cannot be undone. A future
        search may find the same people again and re-add them.
      </Modal>
    </div>
  );
}

function SortHeader({
  label,
  column,
  sort,
  direction,
  toggleSort,
}: {
  label: string;
  column: SortColumn;
  sort: SortColumn;
  direction: 'asc' | 'desc';
  toggleSort: (column: SortColumn) => void;
}) {
  const active = sort === column;
  return (
    <th
      className="px-4 py-2.5 font-medium"
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => toggleSort(column)}
        className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-900"
      >
        {label}
        <span aria-hidden="true" className={active ? 'text-slate-900' : 'text-slate-300'}>
          {active && direction === 'asc' ? '▲' : '▼'}
        </span>
      </button>
    </th>
  );
}
