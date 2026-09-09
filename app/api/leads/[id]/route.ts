import { getAuthedContext } from '@/lib/api/auth';
import { RATE_LIMITS, checkRateLimit } from '@/lib/api/rate-limit';
import {
  fail,
  notFound,
  ok,
  rateLimited,
  serverError,
  unauthorized,
  validationError,
} from '@/lib/api/response';
import { updateLeadSchema } from '@/lib/validation/schemas';
import type { Lead } from '@/types/database';

/** GET /api/leads/[id] */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthedContext();
    if (!auth) return unauthorized();
    const { user, supabase } = auth;
    const { id } = await params;

    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle<Lead>();

    if (error) return serverError('leads:get', error);
    if (!data) return notFound('Lead');

    return ok({ lead: data });
  } catch (error) {
    return serverError('leads:get', error);
  }
}

/** PATCH /api/leads/[id] — partial update of the editable fields. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthedContext();
    if (!auth) return unauthorized();
    const { user, supabase } = auth;
    const { id } = await params;

    if (!(await checkRateLimit(user.id, RATE_LIMITS.mutateLead))) return rateLimited();

    const parsed = updateLeadSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const { data, error } = await supabase
      .from('leads')
      .update(parsed.data)
      .eq('id', id)
      .eq('user_id', user.id)
      .select()
      .maybeSingle<Lead>();

    if (error) {
      // A unique index rejected the edit: the new value collides with a lead
      // the user already has. Say which, rather than showing a Postgres error.
      if (error.code === '23505') {
        return fail(
          'duplicate_lead',
          'Another lead already uses that LinkedIn URL or email address.',
          409,
        );
      }
      return serverError('leads:patch', error);
    }
    if (!data) return notFound('Lead');

    return ok({ lead: data });
  } catch (error) {
    return serverError('leads:patch', error);
  }
}

/** DELETE /api/leads/[id] */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getAuthedContext();
    if (!auth) return unauthorized();
    const { user, supabase } = auth;
    const { id } = await params;

    if (!(await checkRateLimit(user.id, RATE_LIMITS.mutateLead))) return rateLimited();

    const { error, count } = await supabase
      .from('leads')
      .delete({ count: 'exact' })
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) return serverError('leads:delete', error);
    if (!count) return notFound('Lead');

    return ok({ deleted: true });
  } catch (error) {
    return serverError('leads:delete', error);
  }
}
