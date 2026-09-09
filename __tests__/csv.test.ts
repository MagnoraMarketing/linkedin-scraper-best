import { describe, expect, it } from 'vitest';
import { CSV_COLUMNS, csvFilename, escapeCsvField, leadsToCsv } from '@/lib/leads/csv';
import type { Lead } from '@/types/database';

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'lead-1',
    user_id: 'user-1',
    full_name: 'Jens Hansen',
    first_name: 'Jens',
    last_name: 'Hansen',
    job_title: 'CFO',
    company_name: 'Acme A/S',
    company_website: 'https://acme.dk',
    company_linkedin_url: null,
    linkedin_url: 'https://www.linkedin.com/in/jens-hansen',
    location: 'Copenhagen, Denmark',
    country: 'Denmark',
    industry: 'finance',
    company_size: '50-100',
    email: 'jens@acme.dk',
    phone: '+45 11 22 33 44',
    mobile_phone: null,
    source: 'linkedin',
    source_url: 'https://www.linkedin.com/in/jens-hansen',
    status: 'new',
    notes: null,
    job_id: 'job-1',
    created_at: '2026-01-15T10:00:00Z',
    updated_at: '2026-01-15T10:00:00Z',
    ...overrides,
  };
}

describe('escapeCsvField', () => {
  it('leaves plain values untouched', () => {
    expect(escapeCsvField('Jens Hansen')).toBe('Jens Hansen');
  });

  it('quotes values containing a comma, quote or newline', () => {
    expect(escapeCsvField('Hansen, Jens')).toBe('"Hansen, Jens"');
    expect(escapeCsvField('He said "hi"')).toBe('"He said ""hi"""');
    expect(escapeCsvField('line one\nline two')).toBe('"line one\nline two"');
  });

  it('neutralises spreadsheet formula injection', () => {
    // A scraped company name really can start with one of these, and Excel
    // would otherwise evaluate it on open.
    expect(escapeCsvField('=1+1')).toBe("'=1+1");
    expect(escapeCsvField('+44 20 1234')).toBe("'+44 20 1234");
    expect(escapeCsvField('-lead')).toBe("'-lead");
    expect(escapeCsvField('@handle')).toBe("'@handle");
    expect(escapeCsvField('=HYPERLINK("http://evil","click")')).toBe(
      '"\'=HYPERLINK(""http://evil"",""click"")"',
    );
  });

  it('renders null and undefined as empty', () => {
    expect(escapeCsvField(null)).toBe('');
    expect(escapeCsvField(undefined)).toBe('');
  });
});

describe('leadsToCsv', () => {
  it('emits the specified header in order', () => {
    const csv = leadsToCsv([], { bom: false });
    expect(csv).toBe(CSV_COLUMNS.join(','));
    expect(CSV_COLUMNS).toEqual([
      'Name',
      'Title',
      'Company',
      'Company Website',
      'LinkedIn URL',
      'Location',
      'Industry',
      'Company Size',
      'Email',
      'Phone',
      'Mobile',
      'Status',
      'Notes',
    ]);
  });

  it('writes one CRLF-separated row per lead', () => {
    const csv = leadsToCsv([makeLead(), makeLead({ id: 'lead-2', full_name: 'Mette Nielsen' })], {
      bom: false,
    });
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('Jens Hansen');
    expect(lines[2]).toContain('Mette Nielsen');
  });

  it('renders missing values as empty rather than "null"', () => {
    const csv = leadsToCsv(
      [makeLead({ email: null, phone: null, mobile_phone: null, notes: null })],
      { bom: false },
    );
    expect(csv).not.toContain('null');
    // Email, Phone, Mobile are consecutive empty fields.
    expect(csv.split('\r\n')[1]).toContain(',,,');
  });

  it('uses the human-readable status label', () => {
    const csv = leadsToCsv([makeLead({ status: 'do_not_contact' })], { bom: false });
    expect(csv).toContain('Do not contact');
    expect(csv).not.toContain('do_not_contact');
  });

  it('prefixes a UTF-8 BOM by default so Excel reads Danish characters', () => {
    expect(leadsToCsv([makeLead({ full_name: 'Søren Ø. Bak' })]).startsWith('﻿')).toBe(true);
    expect(leadsToCsv([], { bom: false }).startsWith('﻿')).toBe(false);
  });

  it('keeps a value containing a comma in one field', () => {
    const csv = leadsToCsv([makeLead({ location: 'Copenhagen, Denmark' })], { bom: false });
    expect(csv).toContain('"Copenhagen, Denmark"');
  });
});

describe('csvFilename', () => {
  it('produces a timestamped .csv name', () => {
    expect(csvFilename()).toMatch(/^leads-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.csv$/);
    expect(csvFilename('export')).toMatch(/^export-/);
  });
});
