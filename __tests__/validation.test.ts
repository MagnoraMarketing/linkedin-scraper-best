import { describe, expect, it } from 'vitest';
import {
  bulkLeadActionSchema,
  createSearchSchema,
  exportLeadsSchema,
  leadListQuerySchema,
  loginSchema,
  updateLeadSchema,
  updateSettingsSchema,
} from '@/lib/validation/schemas';

describe('createSearchSchema', () => {
  const valid = {
    jobTitles: ['CFO'],
    country: 'DK',
    location: 'all',
    companySize: 'any',
    industry: 'all',
    requestedCount: 25,
  };

  it('accepts a well-formed search', () => {
    expect(createSearchSchema.safeParse(valid).success).toBe(true);
  });

  it('applies defaults for optional fields', () => {
    const parsed = createSearchSchema.parse({
      jobTitles: ['CEO'],
      country: 'DK',
      requestedCount: 10,
    });
    expect(parsed.location).toBe('all');
    expect(parsed.companySize).toBe('any');
    expect(parsed.industry).toBe('all');
  });

  it('requires at least one job title', () => {
    const result = createSearchSchema.safeParse({ ...valid, jobTitles: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/at least one/i);
    }
  });

  it('caps the number of job titles', () => {
    expect(
      createSearchSchema.safeParse({ ...valid, jobTitles: Array(11).fill('CFO') }).success,
    ).toBe(false);
  });

  it('rejects an unknown country', () => {
    expect(createSearchSchema.safeParse({ ...valid, country: 'ZZ' }).success).toBe(false);
  });

  it('accepts a custom job title', () => {
    expect(
      createSearchSchema.safeParse({ ...valid, jobTitles: ['Salgsdirektør'] }).success,
    ).toBe(true);
  });

  it('rejects a lead count outside the allowed range', () => {
    expect(createSearchSchema.safeParse({ ...valid, requestedCount: 0 }).success).toBe(false);
    expect(createSearchSchema.safeParse({ ...valid, requestedCount: 5000 }).success).toBe(false);
    expect(createSearchSchema.safeParse({ ...valid, requestedCount: 12.5 }).success).toBe(false);
  });

  it('rejects an unknown company size or industry', () => {
    expect(createSearchSchema.safeParse({ ...valid, companySize: '1000000' }).success).toBe(false);
    expect(createSearchSchema.safeParse({ ...valid, industry: 'crypto' }).success).toBe(false);
  });
});

describe('updateLeadSchema', () => {
  it('accepts a partial update', () => {
    expect(updateLeadSchema.safeParse({ status: 'qualified' }).success).toBe(true);
  });

  it('rejects an empty patch', () => {
    expect(updateLeadSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an invalid email or URL', () => {
    expect(updateLeadSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
    expect(updateLeadSchema.safeParse({ linkedin_url: 'not a url' }).success).toBe(false);
  });

  it('allows clearing a nullable field', () => {
    expect(updateLeadSchema.safeParse({ email: null, phone: null }).success).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(updateLeadSchema.safeParse({ status: 'hot_lead' }).success).toBe(false);
  });
});

describe('bulkLeadActionSchema', () => {
  const id = '11111111-1111-1111-1111-111111111111';

  it('accepts a delete action', () => {
    expect(bulkLeadActionSchema.safeParse({ action: 'delete', leadIds: [id] }).success).toBe(true);
  });

  it('requires a status for set_status', () => {
    expect(bulkLeadActionSchema.safeParse({ action: 'set_status', leadIds: [id] }).success).toBe(
      false,
    );
    expect(
      bulkLeadActionSchema.safeParse({ action: 'set_status', leadIds: [id], status: 'contacted' })
        .success,
    ).toBe(true);
  });

  it('rejects non-uuid ids', () => {
    expect(bulkLeadActionSchema.safeParse({ action: 'delete', leadIds: ['1; DROP TABLE'] }).success).toBe(
      false,
    );
  });

  it('requires a non-empty selection', () => {
    expect(bulkLeadActionSchema.safeParse({ action: 'delete', leadIds: [] }).success).toBe(false);
  });
});

describe('leadListQuerySchema', () => {
  it('applies sane defaults', () => {
    const parsed = leadListQuerySchema.parse({});
    expect(parsed).toMatchObject({
      sort: 'created_at',
      direction: 'desc',
      page: 1,
      pageSize: 50,
    });
  });

  it('coerces numeric query params from strings', () => {
    const parsed = leadListQuerySchema.parse({ page: '3', pageSize: '25' });
    expect(parsed.page).toBe(3);
    expect(parsed.pageSize).toBe(25);
  });

  it('rejects an unsortable column', () => {
    expect(leadListQuerySchema.safeParse({ sort: 'user_id' }).success).toBe(false);
  });

  it('caps the page size', () => {
    expect(leadListQuerySchema.safeParse({ pageSize: 5000 }).success).toBe(false);
  });
});

describe('exportLeadsSchema', () => {
  it('accepts each mode', () => {
    for (const mode of ['all', 'selected', 'filtered'] as const) {
      expect(exportLeadsSchema.safeParse({ mode }).success).toBe(true);
    }
  });

  it('rejects an unknown mode', () => {
    expect(exportLeadsSchema.safeParse({ mode: 'everything' }).success).toBe(false);
  });
});

describe('updateSettingsSchema', () => {
  it('accepts a partial settings patch', () => {
    expect(updateSettingsSchema.safeParse({ default_lead_limit: 50 }).success).toBe(true);
  });

  it('rejects an out-of-range limit', () => {
    expect(updateSettingsSchema.safeParse({ max_lead_limit: 99999 }).success).toBe(false);
  });

  it('has no field for a LinkedIn password', () => {
    // Credentials must stay in the worker environment; there is deliberately
    // no way to write one through the settings API.
    const parsed = updateSettingsSchema.parse({
      linkedin_account_email: 'a@b.dk',
      linkedin_password: 'hunter2',
    });
    // Zod strips unknown keys, so the password never reaches the database.
    expect('linkedin_password' in parsed).toBe(false);
  });
});

describe('loginSchema', () => {
  it('requires a valid email and an 8-character password', () => {
    expect(loginSchema.safeParse({ email: 'a@b.dk', password: 'longenough' }).success).toBe(true);
    expect(loginSchema.safeParse({ email: 'nope', password: 'longenough' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'a@b.dk', password: 'short' }).success).toBe(false);
  });
});
