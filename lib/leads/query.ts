import type { PostgrestFilterBuilder } from '@supabase/postgrest-js';
import type { LeadListQuery } from '@/lib/validation/schemas';
import type { Database } from '@/types/supabase';
import type { Lead } from '@/types/database';

type PublicSchema = Database['public'];
type LeadRelationships = PublicSchema['Tables']['leads']['Relationships'];

/**
 * The Supabase query builder for the `leads` table, with the result type left
 * open so both `select('*')` and counted selects can be passed through.
 */
export type LeadQuery<Result, ClientOptions extends { PostgrestVersion?: string }> =
  PostgrestFilterBuilder<
    ClientOptions,
    PublicSchema,
    Lead,
    Result,
    'leads',
    LeadRelationships,
    'GET',
    false
  >;

/**
 * Applies the /leads filter and search options to a Supabase query.
 *
 * Shared by the list endpoint and the "export filtered" path, so the two can
 * never drift and hand the user a CSV that does not match what they see.
 */
export function applyLeadFilters<Result, ClientOptions extends { PostgrestVersion?: string }>(
  builder: LeadQuery<Result, ClientOptions>,
  userId: string,
  query: Partial<LeadListQuery>,
): LeadQuery<Result, ClientOptions> {
  let q = builder.eq('user_id', userId);

  if (query.status) q = q.eq('status', query.status);
  if (query.country) q = q.eq('country', query.country);
  if (query.industry) q = q.eq('industry', query.industry);
  if (query.jobId) q = q.eq('job_id', query.jobId);

  if (query.search) {
    // Strip PostgREST's `or` separators so a search term cannot alter the filter.
    const term = query.search.replace(/[,()\\*]/g, ' ').trim();
    if (term) {
      const pattern = `%${term}%`;
      q = q.or(
        [
          `full_name.ilike.${pattern}`,
          `company_name.ilike.${pattern}`,
          `job_title.ilike.${pattern}`,
          `email.ilike.${pattern}`,
        ].join(','),
      );
    }
  }

  return q;
}

export const LEAD_SORT_COLUMNS = [
  'created_at',
  'full_name',
  'company_name',
  'job_title',
  'status',
] as const;
