'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Alert, Badge, Button, Card, CardBody, CardHeader } from '@/components/ui';
import { ApiRequestError, apiFetch } from '@/lib/api/client';
import { LEAD_STATUSES, LEAD_STATUS_LABELS, LEAD_STATUS_STYLES } from '@/lib/constants/leads';
import type { Lead } from '@/types/database';

/** Fields the user can edit. Everything else is scraper-owned or generated. */
const EDITABLE_FIELDS = [
  { key: 'full_name', label: 'Full name', type: 'text' },
  { key: 'job_title', label: 'Job title', type: 'text' },
  { key: 'company_name', label: 'Company', type: 'text' },
  { key: 'company_website', label: 'Company website', type: 'url' },
  { key: 'linkedin_url', label: 'LinkedIn URL', type: 'url' },
  { key: 'location', label: 'Location', type: 'text' },
  { key: 'country', label: 'Country', type: 'text' },
  { key: 'industry', label: 'Industry', type: 'text' },
  { key: 'company_size', label: 'Company size', type: 'text' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Phone', type: 'tel' },
  { key: 'mobile_phone', label: 'Mobile', type: 'tel' },
] as const;

type EditableKey = (typeof EDITABLE_FIELDS)[number]['key'];

export function LeadDetail({ initialLead }: { initialLead: Lead }) {
  const router = useRouter();
  const [lead, setLead] = useState(initialLead);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState(initialLead.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  function startEditing() {
    const next: Record<string, string> = {};
    for (const field of EDITABLE_FIELDS) {
      next[field.key] = (lead[field.key] as string | null) ?? '';
    }
    setDraft(next);
    setEditing(true);
    setError(null);
    setFieldErrors({});
  }

  async function save() {
    setSaving(true);
    setError(null);
    setFieldErrors({});

    // Blank inputs mean "clear this field", so they are sent as null rather
    // than as an empty string the validator would reject.
    const patch: Record<string, string | null> = {};
    for (const field of EDITABLE_FIELDS) {
      const value = (draft[field.key] ?? '').trim();
      patch[field.key] = value === '' ? null : value;
    }
    // full_name is required, so never null it out.
    if (!patch.full_name) {
      setFieldErrors({ full_name: ['A name is required.'] });
      setSaving(false);
      return;
    }

    try {
      const data = await apiFetch<{ lead: Lead }>(`/api/leads/${lead.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setLead(data.lead);
      setEditing(false);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
        if (err.fields) setFieldErrors(err.fields);
      } else {
        setError('Could not save your changes.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function patch(body: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      const data = await apiFetch<{ lead: Lead }>(`/api/leads/${lead.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setLead(data.lead);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save your changes.');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    try {
      await apiFetch(`/api/leads/${lead.id}`, { method: 'DELETE' });
      router.push('/leads');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not delete this lead.');
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {error && <Alert tone="error">{error}</Alert>}

      <Card>
        <CardHeader
          title={lead.full_name}
          description={
            [lead.job_title, lead.company_name].filter(Boolean).join(' · ') || undefined
          }
          action={
            <div className="flex shrink-0 gap-2">
              {editing ? (
                <>
                  <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={save} loading={saving}>
                    Save
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="secondary" size="sm" onClick={startEditing}>
                    Edit
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
                    Delete
                  </Button>
                </>
              )}
            </div>
          }
        />

        <CardBody>
          {editing ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {EDITABLE_FIELDS.map((field) => (
                <div key={field.key}>
                  <label htmlFor={field.key} className="field-label">
                    {field.label}
                  </label>
                  <input
                    id={field.key}
                    type={field.type}
                    value={draft[field.key] ?? ''}
                    onChange={(e) => setDraft({ ...draft, [field.key]: e.target.value })}
                    className="field-input"
                  />
                  {fieldErrors[field.key] && (
                    <p className="field-error">{fieldErrors[field.key]?.[0]}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              {EDITABLE_FIELDS.map((field) => (
                <Field
                  key={field.key}
                  label={field.label}
                  value={lead[field.key as EditableKey] as string | null}
                  href={
                    field.type === 'url'
                      ? ((lead[field.key as EditableKey] as string | null) ?? undefined)
                      : undefined
                  }
                />
              ))}
              <Field label="Source" value={lead.source} />
              <Field label="Added" value={new Date(lead.created_at).toLocaleString('en-GB')} />
            </dl>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Status" />
        <CardBody className="flex flex-wrap gap-2">
          {LEAD_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              disabled={saving}
              onClick={() => void patch({ status: s })}
              className="disabled:opacity-50"
            >
              <Badge
                className={
                  lead.status === s
                    ? LEAD_STATUS_STYLES[s]
                    : 'bg-white text-slate-500 ring-slate-200 hover:bg-slate-50'
                }
              >
                {LEAD_STATUS_LABELS[s]}
              </Badge>
            </button>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Notes"
          action={
            notes !== (lead.notes ?? '') ? (
              <Button size="sm" onClick={() => void patch({ notes: notes || null })} loading={saving}>
                Save notes
              </Button>
            ) : undefined
          }
        />
        <CardBody>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={5}
            className="field-input resize-y"
            placeholder="Call outcomes, context, next steps…"
          />
        </CardBody>
      </Card>

      <div className="flex flex-wrap gap-2">
        {lead.linkedin_url && (
          <a href={lead.linkedin_url} target="_blank" rel="noopener noreferrer">
            <Button variant="secondary">Open LinkedIn profile</Button>
          </a>
        )}
        {lead.company_website && (
          <a href={lead.company_website} target="_blank" rel="noopener noreferrer">
            <Button variant="secondary">Open company website</Button>
          </a>
        )}
      </div>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete lead"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={remove} loading={saving}>
              Delete
            </Button>
          </>
        }
      >
        Delete {lead.full_name}? This cannot be undone.
      </Modal>
    </div>
  );
}

function Field({
  label,
  value,
  href,
}: {
  label: string;
  value: string | null;
  href?: string;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-slate-900">
        {value ? (
          href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-700 hover:underline"
            >
              {value}
            </a>
          ) : (
            value
          )
        ) : (
          <span className="text-slate-400">Not available</span>
        )}
      </dd>
    </div>
  );
}
