import type { Lead } from '@/types/database';

/**
 * Adapter for filling in contact data LinkedIn does not expose.
 *
 * The scraper writes `null` for email, phone and mobile_phone whenever the
 * profile does not publish them. It never guesses, never pattern-generates an
 * address from a name and a domain, and never fabricates a number. Enrichment
 * is where real values are supposed to come from — from a provider that has
 * them — which is why this is an interface with no default implementation.
 */
export interface EnrichmentProvider {
  readonly id: string;
  readonly name: string;

  isConfigured(): boolean;

  /**
   * Returns only the fields the provider could actually resolve. An empty
   * object is a valid, correct answer.
   */
  enrichLead(lead: Lead): Promise<EnrichmentResult>;
}

export interface EnrichmentResult {
  provider: string;
  found: boolean;
  fields: EnrichableFields;
  /** Provider's own confidence, 0–1, when it reports one. */
  confidence?: number;
}

export interface EnrichableFields {
  email?: string | null;
  phone?: string | null;
  mobile_phone?: string | null;
  company_website?: string | null;
  industry?: string | null;
  company_size?: string | null;
}

/**
 * Default provider: resolves nothing.
 *
 * TODO: implement an EnrichmentProvider against a real data vendor and
 * register it with setEnrichmentProvider().
 */
export class NoopEnrichmentProvider implements EnrichmentProvider {
  readonly id = 'noop';
  readonly name = 'No enrichment configured';

  isConfigured(): boolean {
    return false;
  }

  async enrichLead(): Promise<EnrichmentResult> {
    return { provider: this.id, found: false, fields: {} };
  }
}

let provider: EnrichmentProvider = new NoopEnrichmentProvider();

export function getEnrichmentProvider(): EnrichmentProvider {
  return provider;
}

export function setEnrichmentProvider(next: EnrichmentProvider): void {
  provider = next;
}
