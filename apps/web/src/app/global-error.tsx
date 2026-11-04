'use client';

import { useEffect } from 'react';

/** Last-resort boundary for errors thrown in the root layout itself. It must render its
 *  own <html>/<body>, so it is intentionally standalone (no app chrome, inline styles). */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('Application error (root):', error); }, [error]);
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif', background: '#0a0a0a', color: '#e5e5e5' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ maxWidth: 420, width: '100%', textAlign: 'center', border: '1px solid #262626', borderRadius: 12, padding: '1.5rem', background: '#0e0e0e' }}>
            <h1 style={{ fontSize: '1.125rem', fontWeight: 600, margin: '0 0 0.5rem' }}>Something went wrong</h1>
            <p style={{ fontSize: '0.875rem', color: '#a3a3a3', margin: '0 0 1.25rem' }}>
              The app hit an unexpected error. Please reload — your data is safe.
            </p>
            {error?.digest ? <p style={{ fontFamily: 'monospace', fontSize: 11, color: '#737373', margin: '0 0 1rem' }}>ref: {error.digest}</p> : null}
            <button
              onClick={() => reset()}
              style={{ background: '#059669', color: '#fff', border: 'none', borderRadius: 8, padding: '0.5rem 1rem', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
