import type { Lead } from '@/types/database';
import { LEAD_STATUS_LABELS } from '@/lib/constants/leads';

/** Columns of the export, in order, exactly as specified. */
export const CSV_COLUMNS = [
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
] as const;

/**
 * Escapes one CSV field.
 *
 * The leading apostrophe on =, +, - and @ stops spreadsheet software from
 * evaluating a scraped value as a formula — a scraped company name really can
 * start with "=" and would otherwise execute on open.
 */
export function escapeCsvField(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  let field = String(value);

  if (/^[=+\-@\t\r]/.test(field)) {
    field = `'${field}`;
  }

  if (/[",\n\r]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }

  return field;
}

export function leadToCsvRow(lead: Lead): string[] {
  return [
    lead.full_name,
    lead.job_title ?? '',
    lead.company_name ?? '',
    lead.company_website ?? '',
    lead.linkedin_url ?? '',
    lead.location ?? '',
    lead.industry ?? '',
    lead.company_size ?? '',
    lead.email ?? '',
    lead.phone ?? '',
    lead.mobile_phone ?? '',
    LEAD_STATUS_LABELS[lead.status] ?? lead.status,
    lead.notes ?? '',
  ];
}

/**
 * Builds the CSV document. Uses CRLF line endings and a UTF-8 BOM so Excel on
 * Windows opens Danish characters correctly instead of mangling them.
 */
export function leadsToCsv(leads: readonly Lead[], options: { bom?: boolean } = {}): string {
  const { bom = true } = options;
  const lines: string[] = [CSV_COLUMNS.map(escapeCsvField).join(',')];

  for (const lead of leads) {
    lines.push(leadToCsvRow(lead).map(escapeCsvField).join(','));
  }

  const body = lines.join('\r\n');
  return bom ? `\uFEFF${body}` : body;
}

export function csvFilename(prefix = 'leads'): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `${prefix}-${stamp}.csv`;
}
