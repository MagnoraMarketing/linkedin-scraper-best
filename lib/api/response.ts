import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import type { ApiError, ApiSuccess } from '@/types/api';

export function ok<T>(data: T, status = 200): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ ok: true as const, data }, { status });
}

export function fail(
  code: string,
  message: string,
  status = 400,
  fields?: Record<string, string[]>,
): NextResponse<ApiError> {
  return NextResponse.json(
    { ok: false as const, error: fields ? { code, message, fields } : { code, message } },
    { status },
  );
}

export function validationError(error: ZodError): NextResponse<ApiError> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    (fields[key] ??= []).push(issue.message);
  }
  return fail('validation_error', 'Some fields need attention.', 422, fields);
}

export const unauthorized = () =>
  fail('unauthorized', 'You need to sign in to do that.', 401);

export const notFound = (what = 'Resource') => fail('not_found', `${what} not found.`, 404);

export const rateLimited = () =>
  fail('rate_limited', 'Too many requests. Wait a moment and try again.', 429);

/**
 * Turns an unexpected exception into a safe response.
 *
 * The real error goes to the server log; the client gets a generic message, so
 * a database error string can never leak a connection string or a key.
 */
export function serverError(context: string, error: unknown): NextResponse<ApiError> {
  console.error(`[api:${context}]`, error);
  return fail('server_error', 'Something went wrong on our side. Please try again.', 500);
}
