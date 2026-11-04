'use client';

import { useEffect } from 'react';

/** App-level error boundary — a calm, branded page instead of the raw Next.js
 *  "client-side exception" text. Shown when a view throws while rendering. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Surface the real error in the console for diagnosis (kept out of the UI).
    console.error('Application error:', error);
  }, [error]);

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-6 text-center shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6" aria-hidden="true">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <h1 className="mt-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">Something went wrong</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          This page hit an unexpected error. Try again, or reload — your data is safe.
        </p>
        {error?.digest ? (
          <p className="mt-2 font-mono text-[11px] text-neutral-400">ref: {error.digest}</p>
        ) : null}
        <div className="mt-5 flex items-center justify-center gap-2">
          <button
            onClick={() => reset()}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Try again
          </button>
          <button
            onClick={() => { window.location.href = '/'; }}
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-900"
          >
            Reload home
          </button>
        </div>
      </div>
    </div>
  );
}
