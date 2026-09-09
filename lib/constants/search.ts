/**
 * Search vocabulary for the /search page.
 *
 * Countries carry a LinkedIn `geoUrn` — the numeric location id LinkedIn's
 * people search filters on. Only ids that have been verified against a real
 * LinkedIn search URL are listed. A country or city with `geoUrn: null` is
 * still selectable: the worker falls back to matching the location name
 * against the profile's own location text, which is less precise but never
 * silently wrong. See the README for how to read a geoUrn out of your browser
 * and fill one in.
 */

export interface CountryOption {
  code: string;
  label: string;
  geoUrn: string | null;
  enabled: boolean;
}

export const COUNTRIES: readonly CountryOption[] = [
  { code: 'DK', label: 'Denmark', geoUrn: '104514075', enabled: true },
  { code: 'SE', label: 'Sweden', geoUrn: null, enabled: false },
  { code: 'NO', label: 'Norway', geoUrn: null, enabled: false },
  { code: 'DE', label: 'Germany', geoUrn: '101282230', enabled: false },
  { code: 'NL', label: 'Netherlands', geoUrn: null, enabled: false },
  { code: 'GB', label: 'United Kingdom', geoUrn: '101165590', enabled: false },
  { code: 'ES', label: 'Spain', geoUrn: null, enabled: false },
] as const;

export const DEFAULT_COUNTRY = 'DK';

export interface LocationOption {
  value: string;
  label: string;
  country: string;
  geoUrn: string | null;
}

/**
 * City-level locations. None of the Danish city geoUrns have been verified,
 * so they are null and the worker filters on the location text instead.
 * Fill in a verified id here to switch that city to a precise LinkedIn filter.
 */
export const LOCATIONS: readonly LocationOption[] = [
  { value: 'all', label: 'All of Denmark', country: 'DK', geoUrn: '104514075' },
  { value: 'copenhagen', label: 'Copenhagen', country: 'DK', geoUrn: null },
  { value: 'aarhus', label: 'Aarhus', country: 'DK', geoUrn: null },
  { value: 'odense', label: 'Odense', country: 'DK', geoUrn: null },
  { value: 'aalborg', label: 'Aalborg', country: 'DK', geoUrn: null },
] as const;

/** Preset titles for the multi-select. Custom titles are allowed too. */
export const JOB_TITLE_PRESETS: readonly string[] = [
  'CEO',
  'CFO',
  'Founder',
  'Co-Founder',
  'Direktør',
  'Administrerende direktør',
  'Ejer',
  'Partner',
  'Finance Director',
  'HR Director',
] as const;

export const COMPANY_SIZES: readonly { value: string; label: string }[] = [
  { value: 'any', label: 'Any size' },
  { value: '1-5', label: '1–5 employees' },
  { value: '5-10', label: '5–10 employees' },
  { value: '10-25', label: '10–25 employees' },
  { value: '25-50', label: '25–50 employees' },
  { value: '50-100', label: '50–100 employees' },
  { value: '100-250', label: '100–250 employees' },
  { value: '250-500', label: '250–500 employees' },
  { value: '500+', label: '500+ employees' },
] as const;

export const INDUSTRIES: readonly { value: string; label: string }[] = [
  { value: 'all', label: 'All industries' },
  { value: 'construction', label: 'Construction' },
  { value: 'cleaning', label: 'Cleaning' },
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'saas', label: 'SaaS' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'finance', label: 'Finance' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'retail', label: 'Retail' },
  { value: 'professional-services', label: 'Professional Services' },
  { value: 'other', label: 'Other' },
] as const;

export const LEAD_COUNT_OPTIONS: readonly number[] = [10, 25, 50, 100, 250, 500] as const;

export const DEFAULT_LEAD_LIMIT = 25;
