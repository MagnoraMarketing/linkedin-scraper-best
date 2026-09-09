'use client';

import { useEffect } from 'react';

/**
 * Root error boundary. Shows a generic message: a rendering error can carry
 * internal detail, and none of it belongs on screen.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[app] unhandled error', error.digest ?? error.message);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-lg font-semibold text-slate-900">Something went wrong</h1>
        <p className="mt-1 text-sm text-slate-500">
          The page could not be displayed. Try again, and if it keeps happening check that Supabase
          is reachable and configured.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
