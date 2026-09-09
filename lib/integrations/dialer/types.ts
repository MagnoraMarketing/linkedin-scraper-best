import type { Lead } from '@/types/database';

/**
 * Adapter for pushing leads into an external dialer.
 *
 * No dialer is implemented here on purpose: inventing an API for a system that
 * already exists would produce code that has to be thrown away. This interface
 * is the seam — implement it against the real Supabase/dialer setup and
 * register it in `getDialerProvider()`.
 */
export interface DialerProvider {
  /** Stable identifier, surfaced in the UI and in export results. */
  readonly id: string;
  readonly name: string;

  /** True when the provider has everything it needs to run. */
  isConfigured(): boolean;

  /** Pushes leads and reports per-lead outcomes. Must not throw for partial failure. */
  exportLeads(leads: readonly Lead[]): Promise<DialerExportResult>;
}

export interface DialerExportResult {
  provider: string;
  exported: number;
  failed: number;
  results: DialerLeadResult[];
}

export interface DialerLeadResult {
  leadId: string;
  status: 'exported' | 'skipped' | 'failed';
  /** Id assigned by the dialer, when it returns one. */
  externalId?: string;
  reason?: string;
}

/** Shape handed to a dialer. Kept flat and provider-agnostic on purpose. */
export interface DialerContact {
  externalRef: string;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  jobTitle: string | null;
  phone: string | null;
  mobilePhone: string | null;
  email: string | null;
  linkedinUrl: string | null;
  country: string | null;
  notes: string | null;
}

export function leadToDialerContact(lead: Lead): DialerContact {
  return {
    externalRef: lead.id,
    fullName: lead.full_name,
    firstName: lead.first_name,
    lastName: lead.last_name,
    company: lead.company_name,
    jobTitle: lead.job_title,
    phone: lead.phone,
    mobilePhone: lead.mobile_phone,
    email: lead.email,
    linkedinUrl: lead.linkedin_url,
    country: lead.country,
    notes: lead.notes,
  };
}
