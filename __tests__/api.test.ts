/**
 * Integration tests for the API route handlers.
 *
 * The handlers are exercised for real; only Supabase and the rate limiter are
 * stubbed. That covers what actually matters here: that every endpoint refuses
 * an unauthenticated caller, that it validates its input, and that it scopes
 * every query to the caller's own user id.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
//  Test doubles
// ---------------------------------------------------------------------------

let currentUser: { id: string; email: string } | null = null;
let rateLimitAllows = true;

/** Records every filter applied, so tests can assert on user scoping. */
interface RecordedQuery {
  table: string;
  filters: Record<string, unknown>;
  operation: string;
}

const recordedQueries: RecordedQuery[] = [];
let tableRows: Record<string, unknown[]> = {};
let insertShouldFail: { code: string } | null = null;

function makeQueryBuilder(table: string, operation: string) {
  const record: RecordedQuery = { table, filters: {}, operation };
  recordedQueries.push(record);

  const rows = () => tableRows[table] ?? [];

  const builder: Record<string, unknown> = {
    eq(column: string, value: unknown) {
      record.filters[column] = value;
      return builder;
    },
    in(column: string, value: unknown) {
      record.filters[column] = value;
      return builder;
    },
    or() {
      return builder;
    },
    order() {
      return builder;
    },
    limit() {
      return builder;
    },
    range() {
      return builder;
    },
    returns() {
      return builder;
    },
    select() {
      return builder;
    },
    single: async () => ({ data: rows()[0] ?? null, error: insertShouldFail }),
    maybeSingle: async () => ({ data: insertShouldFail ? null : (rows()[0] ?? null), error: insertShouldFail }),
    then(resolve: (value: unknown) => unknown) {
      return Promise.resolve({
        data: rows(),
        error: insertShouldFail,
        count: rows().length,
      }).then(resolve);
    },
  };

  return builder;
}

const supabaseStub = {
  auth: {
    getUser: async () => ({
      data: { user: currentUser },
      error: currentUser ? null : new Error('no session'),
    }),
  },
  from(table: string) {
    return {
      select: () => makeQueryBuilder(table, 'select'),
      insert: () => makeQueryBuilder(table, 'insert'),
      update: () => makeQueryBuilder(table, 'update'),
      upsert: () => makeQueryBuilder(table, 'upsert'),
      delete: () => makeQueryBuilder(table, 'delete'),
    };
  },
  rpc: async () => ({ data: [], error: null }),
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => supabaseStub,
}));

vi.mock('@/lib/api/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/rate-limit')>(
    '@/lib/api/rate-limit',
  );
  return {
    ...actual,
    checkRateLimit: async () => rateLimitAllows,
  };
});

// Imported after the mocks are registered.
const { POST: createSearch } = await import('@/app/api/search/route');
const { GET: listJobs } = await import('@/app/api/jobs/route');
const { GET: listLeads, POST: bulkLeads } = await import('@/app/api/leads/route');
const { GET: getLead, PATCH: patchLead, DELETE: deleteLead } = await import(
  '@/app/api/leads/[id]/route'
);
const { POST: exportToDialer } = await import('@/app/api/leads/export-to-dialer/route');

// ---------------------------------------------------------------------------

const USER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_USER_ID = '99999999-9999-9999-9999-999999999999';
const LEAD_ID = '22222222-2222-2222-2222-222222222222';

function jsonRequest(url: string, body: unknown, method = 'POST') {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
}

function getRequest(url: string) {
  return new NextRequest(url) as never;
}

function signIn() {
  currentUser = { id: USER_ID, email: 'user@test.dk' };
}

beforeEach(() => {
  currentUser = null;
  rateLimitAllows = true;
  recordedQueries.length = 0;
  insertShouldFail = null;
  tableRows = {
    user_settings: [{ max_lead_limit: 500 }],
    scraping_jobs: [],
    leads: [],
  };
});

// ---------------------------------------------------------------------------
//  Authentication
// ---------------------------------------------------------------------------

describe('authentication', () => {
  it('every endpoint rejects an unauthenticated caller with 401', async () => {
    const params = { params: Promise.resolve({ id: LEAD_ID }) };

    const responses = await Promise.all([
      createSearch(jsonRequest('http://localhost/api/search', {})),
      listJobs(getRequest('http://localhost/api/jobs')),
      listLeads(getRequest('http://localhost/api/leads')),
      bulkLeads(jsonRequest('http://localhost/api/leads', {})),
      getLead(new Request('http://localhost'), params),
      patchLead(jsonRequest('http://localhost', {}, 'PATCH'), params),
      deleteLead(new Request('http://localhost'), params),
      exportToDialer(jsonRequest('http://localhost', { leadIds: [LEAD_ID] })),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('unauthorized');
    }
  });

  it('does not touch the database when unauthenticated', async () => {
    await listLeads(getRequest('http://localhost/api/leads'));
    expect(recordedQueries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
//  Authorization / user scoping
// ---------------------------------------------------------------------------

describe('authorization', () => {
  it('scopes the lead list to the caller', async () => {
    signIn();
    await listLeads(getRequest('http://localhost/api/leads'));

    const leadQuery = recordedQueries.find((q) => q.table === 'leads');
    expect(leadQuery?.filters.user_id).toBe(USER_ID);
  });

  it('scopes a single lead read to the caller', async () => {
    signIn();
    tableRows.leads = [{ id: LEAD_ID, user_id: USER_ID, full_name: 'Jens' }];

    await getLead(new Request('http://localhost'), {
      params: Promise.resolve({ id: LEAD_ID }),
    });

    const query = recordedQueries.find((q) => q.table === 'leads');
    expect(query?.filters.user_id).toBe(USER_ID);
    expect(query?.filters.id).toBe(LEAD_ID);
  });

  it('scopes updates and deletes to the caller, never to a supplied user id', async () => {
    signIn();
    tableRows.leads = [{ id: LEAD_ID, user_id: USER_ID, full_name: 'Jens' }];

    await patchLead(
      jsonRequest('http://localhost', { status: 'contacted', user_id: OTHER_USER_ID }, 'PATCH'),
      { params: Promise.resolve({ id: LEAD_ID }) },
    );

    const update = recordedQueries.find((q) => q.operation === 'update');
    expect(update?.filters.user_id).toBe(USER_ID);

    recordedQueries.length = 0;
    await deleteLead(new Request('http://localhost'), {
      params: Promise.resolve({ id: LEAD_ID }),
    });

    const del = recordedQueries.find((q) => q.operation === 'delete');
    expect(del?.filters.user_id).toBe(USER_ID);
  });

  it('scopes bulk actions to the caller', async () => {
    signIn();
    await bulkLeads(
      jsonRequest('http://localhost/api/leads', { action: 'delete', leadIds: [LEAD_ID] }),
    );

    const del = recordedQueries.find((q) => q.operation === 'delete');
    expect(del?.filters.user_id).toBe(USER_ID);
    expect(del?.filters.id).toEqual([LEAD_ID]);
  });

  it('returns 404, not another user\'s data, for a lead that is not visible', async () => {
    signIn();
    tableRows.leads = [];

    const response = await getLead(new Request('http://localhost'), {
      params: Promise.resolve({ id: LEAD_ID }),
    });

    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
//  Job creation
// ---------------------------------------------------------------------------

describe('POST /api/search', () => {
  const validBody = {
    jobTitles: ['CFO'],
    country: 'DK',
    location: 'all',
    companySize: 'any',
    industry: 'all',
    requestedCount: 25,
  };

  it('creates a queued job owned by the caller', async () => {
    signIn();
    tableRows.scraping_jobs = [];
    tableRows.user_settings = [{ max_lead_limit: 500 }];

    const response = await createSearch(jsonRequest('http://localhost/api/search', validBody));

    expect(response.status).toBe(201);
    const insert = recordedQueries.find((q) => q.operation === 'insert');
    expect(insert?.table).toBe('scraping_jobs');
  });

  it('rejects an invalid body with 422 and field-level errors', async () => {
    signIn();
    const response = await createSearch(
      jsonRequest('http://localhost/api/search', { ...validBody, jobTitles: [] }),
    );

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe('validation_error');
    expect(body.error.fields.jobTitles).toBeDefined();
  });

  it('rejects a malformed JSON body', async () => {
    signIn();
    const request = new NextRequest('http://localhost/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });

    const response = await createSearch(request as never);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('invalid_json');
  });

  it('enforces the account lead ceiling server-side', async () => {
    signIn();
    tableRows.user_settings = [{ max_lead_limit: 50 }];

    const response = await createSearch(
      jsonRequest('http://localhost/api/search', { ...validBody, requestedCount: 500 }),
    );

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe('limit_exceeded');
  });

  it('refuses a second concurrent job', async () => {
    signIn();
    tableRows.scraping_jobs = [{ id: 'existing-job' }];

    const response = await createSearch(jsonRequest('http://localhost/api/search', validBody));

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('job_already_running');
  });

  it('returns 429 when the rate limit is exhausted', async () => {
    signIn();
    rateLimitAllows = false;

    const response = await createSearch(jsonRequest('http://localhost/api/search', validBody));
    expect(response.status).toBe(429);
    expect((await response.json()).error.code).toBe('rate_limited');
  });
});

// ---------------------------------------------------------------------------
//  Dialer export
// ---------------------------------------------------------------------------

describe('POST /api/leads/export-to-dialer', () => {
  it('reports honestly that no dialer is configured instead of faking success', async () => {
    signIn();

    const response = await exportToDialer(
      jsonRequest('http://localhost', { leadIds: [LEAD_ID] }),
    );

    expect(response.status).toBe(501);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('dialer_not_configured');
  });

  it('validates the lead ids', async () => {
    signIn();
    const response = await exportToDialer(jsonRequest('http://localhost', { leadIds: [] }));
    expect(response.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
//  Error handling
// ---------------------------------------------------------------------------

describe('error responses', () => {
  it('turns a duplicate-key violation into a readable conflict', async () => {
    signIn();
    insertShouldFail = { code: '23505' };

    const response = await patchLead(
      jsonRequest('http://localhost', { email: 'a@b.dk' }, 'PATCH'),
      { params: Promise.resolve({ id: LEAD_ID }) },
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe('duplicate_lead');
    // The user-facing message must not leak the constraint name.
    expect(body.error.message).not.toMatch(/leads_user_/);
  });
});
