'use client';

import { useEffect } from 'react';

/** §events — the /event/<id> share link is a clean, OG-carrying URL. A human who opens it is sent to
 *  the landing (which shows the event); crawlers (X) read the server-rendered card meta and don't run
 *  this JS. */
export function EventRedirect({ id }: { id: string }) {
  useEffect(() => {
    window.location.replace(`/?event=${encodeURIComponent(id)}`);
  }, [id]);
  return (
    <div className="mx-auto max-w-lg p-8 text-center text-sm text-neutral-600 dark:text-neutral-300">
      <p>
        Opening the event…{' '}
        <a href={`/?event=${encodeURIComponent(id)}`} className="text-emerald-700 underline dark:text-emerald-400">
          view it here
        </a>
        .
      </p>
    </div>
  );
}
