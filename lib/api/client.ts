'use client';

import type { ApiResponse } from '@/types/api';

export class ApiRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string[]>,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/**
 * Thin fetch wrapper for the typed API.
 *
 * Turns every failure — non-JSON responses, network errors, API error bodies —
 * into an ApiRequestError carrying a message that is safe to show the user.
 */
export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(input, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiRequestError('network_error', 'Could not reach the server. Check your connection.');
  }

  let body: ApiResponse<T> | null = null;
  try {
    body = (await response.json()) as ApiResponse<T>;
  } catch {
    body = null;
  }

  if (!response.ok || !body || body.ok === false) {
    const error = body && body.ok === false ? body.error : null;
    throw new ApiRequestError(
      error?.code ?? 'request_failed',
      error?.message ?? 'The request failed. Please try again.',
      error?.fields,
      response.status,
    );
  }

  return body.data;
}
