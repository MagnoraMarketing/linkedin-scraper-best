import { z } from 'zod';
import { COUNTRIES, COMPANY_SIZES, INDUSTRIES, LOCATIONS } from '@/lib/constants/search';
import { LEAD_STATUSES } from '@/lib/constants/leads';

const countryCodes = COUNTRIES.map((c) => c.code) as [string, ...string[]];
const companySizes = COMPANY_SIZES.map((c) => c.value) as [string, ...string[]];
const industries = INDUSTRIES.map((i) => i.value) as [string, ...string[]];

/** Free-text location values are allowed, so this validates shape not membership. */
const locationValue = z
  .string()
  .trim()
  .min(1, 'Location cannot be empty')
  .max(80, 'Location is too long');

export const jobTitleSchema = z
  .string()
  .trim()
  .min(2, 'Job title must be at least 2 characters')
  .max(60, 'Job title is too long');

export const createSearchSchema = z.object({
  jobTitles: z
    .array(jobTitleSchema)
    .min(1, 'Select at least one job title')
    .max(10, 'Select at most 10 job titles'),
  country: z.enum(countryCodes),
  location: locationValue.default('all'),
  companySize: z.enum(companySizes).default('any'),
  industry: z.enum(industries).default('all'),
  requestedCount: z
    .number()
    .int('Number of leads must be a whole number')
    .min(1, 'Request at least 1 lead')
    .max(2000, 'Request at most 2000 leads'),
});

export type CreateSearchInput = z.infer<typeof createSearchSchema>;

export const updateLeadSchema = z
  .object({
    full_name: z.string().trim().min(1).max(200),
    first_name: z.string().trim().max(100).nullable(),
    last_name: z.string().trim().max(100).nullable(),
    job_title: z.string().trim().max(200).nullable(),
    company_name: z.string().trim().max(200).nullable(),
    company_website: z.string().trim().url('Must be a valid URL').max(500).nullable(),
    company_linkedin_url: z.string().trim().url('Must be a valid URL').max(500).nullable(),
    linkedin_url: z.string().trim().url('Must be a valid URL').max(500).nullable(),
    location: z.string().trim().max(200).nullable(),
    country: z.string().trim().max(100).nullable(),
    industry: z.string().trim().max(100).nullable(),
    company_size: z.string().trim().max(50).nullable(),
    email: z.string().trim().email('Must be a valid email address').max(320).nullable(),
    phone: z.string().trim().max(50).nullable(),
    mobile_phone: z.string().trim().max(50).nullable(),
    status: z.enum(LEAD_STATUSES),
    notes: z.string().max(10000).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

export const bulkLeadActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('delete'),
    leadIds: z.array(z.string().uuid()).min(1, 'Select at least one lead').max(1000),
  }),
  z.object({
    action: z.literal('set_status'),
    leadIds: z.array(z.string().uuid()).min(1, 'Select at least one lead').max(1000),
    status: z.enum(LEAD_STATUSES),
  }),
]);

export const leadListQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  country: z.string().trim().max(100).optional(),
  industry: z.string().trim().max(100).optional(),
  jobId: z.string().uuid().optional(),
  sort: z
    .enum(['created_at', 'full_name', 'company_name', 'job_title', 'status'])
    .default('created_at'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export type LeadListQuery = z.infer<typeof leadListQuerySchema>;

export const exportLeadsSchema = z.object({
  mode: z.enum(['all', 'selected', 'filtered']),
  leadIds: z.array(z.string().uuid()).max(5000).optional(),
  filters: leadListQuerySchema.partial().optional(),
});

export const exportToDialerSchema = z.object({
  leadIds: z.array(z.string().uuid()).min(1, 'Select at least one lead').max(1000),
});

export const updateSettingsSchema = z.object({
  default_country: z.enum(countryCodes).optional(),
  default_job_titles: z.array(jobTitleSchema).max(10).optional(),
  default_location: locationValue.optional(),
  default_lead_limit: z.number().int().min(1).max(2000).optional(),
  max_lead_limit: z.number().int().min(1).max(2000).optional(),
  linkedin_account_email: z.string().trim().email().max(320).nullable().optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

/** Location value must belong to the selected country, or be free text. */
export function isKnownLocation(country: string, location: string): boolean {
  return LOCATIONS.some((l) => l.country === country && l.value === location);
}
