import { describe, expect, it } from 'vitest';
import {
  buildDedupeKeys,
  findDuplicate,
  mergeLead,
  normalizeEmail,
  normalizeLinkedInUrl,
  normalizeNameCompany,
  splitName,
} from '@/lib/leads/dedupe';

describe('normalizeLinkedInUrl', () => {
  it('collapses every spelling of the same profile to one key', () => {
    const expected = '/in/jens-hansen-123';
    const variants = [
      'https://www.linkedin.com/in/jens-hansen-123',
      'https://www.linkedin.com/in/jens-hansen-123/',
      'https://linkedin.com/in/jens-hansen-123',
      'http://dk.linkedin.com/in/jens-hansen-123',
      'https://www.linkedin.com/in/Jens-Hansen-123?utm_source=share',
      'https://www.linkedin.com/in/jens-hansen-123#profile',
      '  https://www.linkedin.com/in/JENS-HANSEN-123//  ',
    ];

    for (const variant of variants) {
      expect(normalizeLinkedInUrl(variant)).toBe(expected);
    }
  });

  it('does not conflate different profiles', () => {
    expect(normalizeLinkedInUrl('https://linkedin.com/in/jens-hansen')).not.toBe(
      normalizeLinkedInUrl('https://linkedin.com/in/jens-hansen-2'),
    );
  });

  it('returns null for empty input', () => {
    expect(normalizeLinkedInUrl(null)).toBeNull();
    expect(normalizeLinkedInUrl('')).toBeNull();
    expect(normalizeLinkedInUrl('https://www.linkedin.com/')).toBeNull();
  });
});

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Jens@Firma.DK ')).toBe('jens@firma.dk');
  });

  it('returns null for empty input', () => {
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail('   ')).toBeNull();
  });
});

describe('normalizeNameCompany', () => {
  it('folds Danish characters and punctuation', () => {
    expect(normalizeNameCompany('Søren Ø. Bak', 'A/S Bak & Co.')).toBe(
      normalizeNameCompany('Soren O Bak', 'AS Bak Co'),
    );
  });

  it('folds accents', () => {
    expect(normalizeNameCompany('José Peña', 'Acme')).toBe(normalizeNameCompany('Jose Pena', 'Acme'));
  });

  it('separates name from company so a swap does not collide', () => {
    expect(normalizeNameCompany('Acme', 'Jens Hansen')).not.toBe(
      normalizeNameCompany('Jens Hansen', 'Acme'),
    );
  });

  it('returns null when both parts are empty', () => {
    expect(normalizeNameCompany('', '')).toBeNull();
    expect(normalizeNameCompany(null, null)).toBeNull();
  });
});

describe('findDuplicate', () => {
  const existing = [
    {
      id: 'lead-1',
      full_name: 'Jens Hansen',
      company_name: 'Acme A/S',
      linkedin_url: 'https://www.linkedin.com/in/jens-hansen-123',
      email: 'jens@acme.dk',
    },
    {
      id: 'lead-2',
      full_name: 'Mette Nielsen',
      company_name: 'Beta ApS',
      linkedin_url: null,
      email: 'mette@beta.dk',
    },
  ];

  it('matches on LinkedIn URL first', () => {
    const match = findDuplicate(
      {
        full_name: 'J. Hansen',
        company_name: 'Somewhere Else',
        linkedin_url: 'https://linkedin.com/in/JENS-HANSEN-123/',
        email: 'different@example.com',
      },
      existing,
    );

    expect(match?.existing.id).toBe('lead-1');
    expect(match?.reason).toBe('linkedin_url');
  });

  it('falls back to email when there is no LinkedIn URL', () => {
    const match = findDuplicate(
      { full_name: 'M. Nielsen', company_name: 'Gamma', email: 'METTE@beta.dk' },
      existing,
    );

    expect(match?.existing.id).toBe('lead-2');
    expect(match?.reason).toBe('email');
  });

  it('falls back to name plus company as the last resort', () => {
    const match = findDuplicate({ full_name: 'Jens Hansen', company_name: 'Acme AS' }, existing);

    expect(match?.existing.id).toBe('lead-1');
    expect(match?.reason).toBe('name_company');
  });

  it('returns null for a genuinely new lead', () => {
    expect(
      findDuplicate(
        {
          full_name: 'Peter Sørensen',
          company_name: 'Delta',
          linkedin_url: 'https://linkedin.com/in/peter-sorensen',
          email: 'peter@delta.dk',
        },
        existing,
      ),
    ).toBeNull();
  });

  it('does not match on name alone when companies differ', () => {
    expect(
      findDuplicate({ full_name: 'Jens Hansen', company_name: 'Totally Different ApS' }, existing),
    ).toBeNull();
  });

  it('ignores null keys rather than matching other nulls', () => {
    // lead-2 has a null linkedin_url; an incoming lead with no URL must not
    // match it on that basis.
    const match = findDuplicate({ full_name: 'Unknown Person', company_name: 'Nowhere' }, existing);
    expect(match).toBeNull();
  });
});

describe('buildDedupeKeys', () => {
  it('produces all three keys', () => {
    expect(
      buildDedupeKeys({
        full_name: 'Jens Hansen',
        company_name: 'Acme',
        linkedin_url: 'https://www.linkedin.com/in/jens/',
        email: 'Jens@Acme.dk',
      }),
    ).toEqual({
      linkedinUrlKey: '/in/jens',
      emailKey: 'jens@acme.dk',
      nameCompanyKey: 'jens hansen|acme',
    });
  });
});

describe('mergeLead', () => {
  it('fills empty fields but never overwrites existing values', () => {
    const existing: Record<string, string | null> = {
      id: 'lead-1',
      full_name: 'Jens Hansen',
      company_name: 'Acme',
      email: null,
      phone: '+45 11 22 33 44',
      status: 'qualified',
      notes: 'Called on Tuesday',
    };

    const merged = mergeLead(existing, {
      email: 'jens@acme.dk',
      phone: '+45 99 99 99 99',
      status: 'new',
      notes: 'scraped',
      company_name: 'Acme A/S',
    });

    expect(merged.email).toBe('jens@acme.dk'); // gap filled
    expect(merged.phone).toBe('+45 11 22 33 44'); // existing kept
    expect(merged.status).toBe('qualified'); // curated field untouched
    expect(merged.notes).toBe('Called on Tuesday'); // curated field untouched
    expect(merged.company_name).toBe('Acme'); // existing kept
  });

  it('ignores null, undefined and empty incoming values', () => {
    const blank: Record<string, string | null | undefined> = {
      id: '1',
      email: null,
      phone: null,
      location: null,
    };
    const merged = mergeLead(blank, { email: null, phone: undefined, location: '' });

    expect(merged.email).toBeNull();
    expect(merged.phone).toBeNull();
    expect(merged.location).toBeNull();
  });
});

describe('splitName', () => {
  it('splits on the first token', () => {
    expect(splitName('Jens Hansen')).toEqual({ firstName: 'Jens', lastName: 'Hansen' });
    expect(splitName('Anne Marie Bak Sørensen')).toEqual({
      firstName: 'Anne',
      lastName: 'Marie Bak Sørensen',
    });
  });

  it('handles a single name', () => {
    expect(splitName('Prince')).toEqual({ firstName: 'Prince', lastName: null });
  });

  it('handles blank input', () => {
    expect(splitName('   ')).toEqual({ firstName: null, lastName: null });
  });
});
