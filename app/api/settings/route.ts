import type { NextRequest } from 'next/server';
import { getAuthedContext } from '@/lib/api/auth';
import { fail, ok, serverError, unauthorized, validationError } from '@/lib/api/response';
import { updateSettingsSchema } from '@/lib/validation/schemas';
import type { UserSettings } from '@/types/database';

export async function GET() {
  try {
    const auth = await getAuthedContext();
    if (!auth) return unauthorized();
    const { user, supabase } = auth;

    const { data, error } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle<UserSettings>();

    if (error) return serverError('settings:get', error);
    return ok({ settings: data });
  } catch (error) {
    return serverError('settings:get', error);
  }
}

/**
 * PATCH /api/settings
 *
 * Only scraper preferences and defaults live here. LinkedIn credentials are
 * deliberately not writable through the API — they are worker-side environment
 * variables, so a compromised session cannot read or change them.
 */
export async function PATCH(request: NextRequest) {
  try {
    const auth = await getAuthedContext();
    if (!auth) return unauthorized();
    const { user, supabase } = auth;

    const parsed = updateSettingsSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);
    const patch = parsed.data;

    if (
      patch.default_lead_limit !== undefined &&
      patch.max_lead_limit !== undefined &&
      patch.default_lead_limit > patch.max_lead_limit
    ) {
      return fail('invalid_limits', 'The default lead limit cannot exceed the maximum.', 422);
    }

    const { data, error } = await supabase
      .from('user_settings')
      .upsert({ user_id: user.id, ...patch }, { onConflict: 'user_id' })
      .select()
      .single<UserSettings>();

    if (error) return serverError('settings:patch', error);
    return ok({ settings: data });
  } catch (error) {
    return serverError('settings:patch', error);
  }
}
