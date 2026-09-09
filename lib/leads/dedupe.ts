/**
 * Duplicate detection.
 *
 * These normalisers mirror the generated columns in
 * supabase/migrations/0001_init.sql exactly. The database is the authority —
 * unique indexes are what actually prevent duplicates — but the same rules are
 * implemented here so the UI and the tests can reason about matches without a
 * round trip, and so a drift between the two is caught by the test suite.
 *
 * Match priority, highest first:
 *   1. LinkedIn URL
 *   2. Email
 *   3. Name + company
 */

export type MatchReason = 'linkedin_url' | 'email' | 'name_company';

export interface DedupeKeys {
  linkedinUrlKey: string | null;
  emailKey: string | null;
  nameCompanyKey: string | null;
}

export interface DedupeCandidate {
  id?: string;
  full_name?: string | null;
  company_name?: string | null;
  linkedin_url?: string | null;
  email?: string | null;
}

/**
 * Strips protocol, subdomain, host, query, fragment and trailing slashes so
 * every spelling of the same profile collapses to one key:
 *   https://www.linkedin.com/in/Jens-Hansen-123/?utm=x  →  /in/jens-hansen-123
 *   http://dk.linkedin.com/in/jens-hansen-123          →  /in/jens-hansen-123
 */
export function normalizeLinkedInUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const normalized = url
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\/([a-z0-9-]+\.)?linkedin\.com/, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
  return normalized === '' ? null : normalized;
}

export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const normalized = email.toLowerCase().trim();
  return normalized === '' ? null : normalized;
}

/**
 * Folds one text value to its comparison form: lowercased, accents and Nordic
 * letters reduced to ASCII, punctuation removed, whitespace collapsed.
 *
 * Punctuation is removed rather than replaced with a space, so "A/S Bak & Co."
 * and "AS Bak Co" fold to the same value.
 */
function foldText(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    // Drop combining accent marks left behind by NFD decomposition.
    .replace(/[\u0300-\u036f]/g, '')
    // Nordic letters that do not decompose.
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/å/g, 'a')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Accent-folds and strips punctuation so "Søren Ø. Bak" at "A/S Bak & Co."
 * matches "Soren O Bak" at "AS Bak Co".
 *
 * The two sides are folded separately and joined with a pipe, so a name and a
 * company cannot be swapped and still collide.
 */
export function normalizeNameCompany(
  fullName: string | null | undefined,
  companyName: string | null | undefined,
): string | null {
  const key = `${foldText(fullName)}|${foldText(companyName)}`;
  return key === '|' ? null : key;
}

export function buildDedupeKeys(candidate: DedupeCandidate): DedupeKeys {
  return {
    linkedinUrlKey: normalizeLinkedInUrl(candidate.linkedin_url),
    emailKey: normalizeEmail(candidate.email),
    nameCompanyKey: normalizeNameCompany(candidate.full_name, candidate.company_name),
  };
}

export interface DuplicateMatch<T extends DedupeCandidate> {
  existing: T;
  reason: MatchReason;
}

/**
 * Finds the first existing lead that the incoming lead duplicates, checking
 * the three keys in priority order. Returns null when the lead is new.
 */
export function findDuplicate<T extends DedupeCandidate>(
  incoming: DedupeCandidate,
  existing: readonly T[],
): DuplicateMatch<T> | null {
  const keys = buildDedupeKeys(incoming);

  if (keys.linkedinUrlKey !== null) {
    const match = existing.find(
      (e) => normalizeLinkedInUrl(e.linkedin_url) === keys.linkedinUrlKey,
    );
    if (match) return { existing: match, reason: 'linkedin_url' };
  }

  if (keys.emailKey !== null) {
    const match = existing.find((e) => normalizeEmail(e.email) === keys.emailKey);
    if (match) return { existing: match, reason: 'email' };
  }

  if (keys.nameCompanyKey !== null) {
    const match = existing.find(
      (e) => normalizeNameCompany(e.full_name, e.company_name) === keys.nameCompanyKey,
    );
    if (match) return { existing: match, reason: 'name_company' };
  }

  return null;
}

/**
 * Merges a freshly scraped lead into an existing one: gaps get filled, values
 * the user already has are left alone. Mirrors upsert_lead() in SQL.
 */
export function mergeLead<T extends Record<string, unknown>>(existing: T, incoming: Partial<T>): T {
  const merged = { ...existing };
  const preserved = new Set(['id', 'user_id', 'status', 'notes', 'created_at']);

  for (const [key, value] of Object.entries(incoming)) {
    if (preserved.has(key)) continue;
    if (value === null || value === undefined || value === '') continue;
    const current = merged[key as keyof T];
    if (current === null || current === undefined || current === '') {
      merged[key as keyof T] = value as T[keyof T];
    }
  }

  return merged;
}

/** Splits a display name into first/last. Everything after the first token is the surname. */
export function splitName(fullName: string): { firstName: string | null; lastName: string | null } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0] ?? null, lastName: null };
  return {
    firstName: parts[0] ?? null,
    lastName: parts.slice(1).join(' '),
  };
}
