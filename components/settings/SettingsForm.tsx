'use client';

import { useState } from 'react';
import { JobTitlePicker } from '@/components/search/JobTitlePicker';
import { Alert, Button, Card, CardBody, CardHeader } from '@/components/ui';
import { ApiRequestError, apiFetch } from '@/lib/api/client';
import { COUNTRIES, LEAD_COUNT_OPTIONS, LOCATIONS } from '@/lib/constants/search';
import type { UserSettings } from '@/types/database';

export function SettingsForm({
  initialSettings,
  accountEmail,
}: {
  initialSettings: UserSettings | null;
  accountEmail: string;
}) {
  const [country, setCountry] = useState(initialSettings?.default_country ?? 'DK');
  const [location, setLocation] = useState(initialSettings?.default_location ?? 'all');
  const [jobTitles, setJobTitles] = useState<string[]>(
    initialSettings?.default_job_titles ?? ['CEO', 'CFO'],
  );
  const [defaultLimit, setDefaultLimit] = useState(initialSettings?.default_lead_limit ?? 25);
  const [maxLimit, setMaxLimit] = useState(initialSettings?.max_lead_limit ?? 500);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await apiFetch('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          default_country: country,
          default_location: location,
          default_job_titles: jobTitles,
          default_lead_limit: defaultLimit,
          max_lead_limit: maxLimit,
        }),
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save your settings.');
    } finally {
      setSaving(false);
    }
  }

  const locationOptions = LOCATIONS.filter((l) => l.country === country);

  return (
    <Card>
      <CardHeader
        title="Search defaults"
        description={`Signed in as ${accountEmail}`}
        action={
          <Button size="sm" onClick={save} loading={saving}>
            Save
          </Button>
        }
      />
      <CardBody className="space-y-5">
        {error && <Alert tone="error">{error}</Alert>}
        {saved && <Alert tone="success">Settings saved.</Alert>}

        <JobTitlePicker value={jobTitles} onChange={setJobTitles} />

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="default-country" className="field-label">
              Default country
            </label>
            <select
              id="default-country"
              value={country}
              onChange={(e) => {
                setCountry(e.target.value);
                setLocation('all');
              }}
              className="field-input"
            >
              {COUNTRIES.filter((c) => c.enabled || c.code === country).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="default-location" className="field-label">
              Default location
            </label>
            <select
              id="default-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="field-input"
            >
              {locationOptions.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="default-limit" className="field-label">
              Default lead limit
            </label>
            <select
              id="default-limit"
              value={defaultLimit}
              onChange={(e) => setDefaultLimit(Number(e.target.value))}
              className="field-input"
            >
              {LEAD_COUNT_OPTIONS.filter((n) => n <= maxLimit).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="max-limit" className="field-label">
              Maximum leads per search
            </label>
            <input
              id="max-limit"
              type="number"
              min={1}
              max={2000}
              value={maxLimit}
              onChange={(e) => setMaxLimit(Number(e.target.value))}
              className="field-input"
            />
            <p className="field-hint">
              Enforced server-side. A larger search takes proportionally longer, because the scraper
              runs sequentially with conservative delays.
            </p>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
