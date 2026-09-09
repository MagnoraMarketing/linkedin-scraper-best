import type { Lead } from '@/types/database';
import type { DialerExportResult, DialerProvider } from './types';

export * from './types';

/**
 * Placeholder provider used until a real dialer is wired up.
 *
 * It reports honestly that nothing was exported rather than pretending to
 * succeed, so the UI can never show a false "sent to dialer" confirmation.
 *
 * TODO: implement a DialerProvider against the existing dialer, then return it
 * from getDialerProvider() below. Nothing else in the app needs to change.
 */
export class NotConfiguredDialerProvider implements DialerProvider {
  readonly id = 'not_configured';
  readonly name = 'No dialer configured';

  isConfigured(): boolean {
    return false;
  }

  async exportLeads(leads: readonly Lead[]): Promise<DialerExportResult> {
    return {
      provider: this.id,
      exported: 0,
      failed: leads.length,
      results: leads.map((lead) => ({
        leadId: lead.id,
        status: 'failed' as const,
        reason: 'No dialer provider is configured for this deployment.',
      })),
    };
  }
}

let provider: DialerProvider = new NotConfiguredDialerProvider();

export function getDialerProvider(): DialerProvider {
  return provider;
}

/** Swaps the active provider. Used by tests and by future wiring code. */
export function setDialerProvider(next: DialerProvider): void {
  provider = next;
}
