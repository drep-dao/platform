import { Suspense } from 'react';
import type { Metadata } from 'next';
import { HomeShell } from '@/components/home-shell';
import { brand } from '@/lib/brand';

// §meta — when a DEEP LINK to a specific document/proposal is shared (the share-link button emits
// ?view=rules&doc=…, ?ip=…, ?proposal=…, ?gp=…), unfurl a card that names THAT document — its title
// on a blue /og card — instead of the generic site card. Runs server-side per request; a plain
// homepage load (no resource param) returns nothing and inherits the default (green) card, and any
// slow/failed lookup falls back to it too, so this never blocks or breaks the page.
// Render per request so generateMetadata sees the live ?doc=/?ip=/… — a static homepage would
// serve the same (default) card for every query string, defeating per-document unfurls.
export const dynamic = 'force-dynamic';

const API = `${process.env.NEXT_PUBLIC_API_URL ?? ''}/api/v1`;

type SP = Record<string, string | string[] | undefined>;

export async function generateMetadata({ searchParams }: { searchParams: Promise<SP> }): Promise<Metadata> {
  const sp = await searchParams.catch(() => ({}) as SP);
  const one = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };

  const view = one('view');
  const doc = one('doc');
  const target =
    doc && view === 'rules' ? { path: `/rule-documents/${doc}`, kind: 'Rule document' }
    : doc && view === 'decisions' ? { path: `/decisions/${doc}`, kind: 'Decision' }
    : one('ip') ? { path: `/internal-proposals/${one('ip')}`, kind: 'Internal proposal' }
    : one('proposal') ? { path: `/proposals/${one('proposal')}`, kind: 'Funding proposal' }
    : one('gp') ? { path: `/groups/proposal/${one('gp')}`, kind: 'Proposal' }
    : null;
  if (!target) return {}; // homepage / non-resource link → keep the default site card

  try {
    const res = await fetch(`${API}${target.path}`, { signal: AbortSignal.timeout(2500), headers: { accept: 'application/json' } });
    if (!res.ok) return {};
    const data = (await res.json()) as { title?: unknown; groupName?: unknown };
    const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim() : null;
    if (!title) return {};
    // OG proposals name their group (e.g. "OG proposal") rather than the generic label.
    const kind = typeof data.groupName === 'string' && data.groupName ? `${data.groupName} proposal` : target.kind;
    const desc = `${kind} · ${brand.name}`;
    const image = `/og?title=${encodeURIComponent(title)}&kind=${encodeURIComponent(kind)}`; // resolved against metadataBase
    return {
      title: `${title} · ${brand.name}`,
      description: desc,
      openGraph: { title, description: desc, images: [{ url: image, width: 1200, height: 630, alt: title }] },
      twitter: { card: 'summary_large_image', title, description: desc, images: [image] },
    };
  } catch {
    return {}; // API slow/unreachable → default card, never block the render
  }
}

export default function Home() {
  // Suspense boundary required because HomeShell reads the URL via useSearchParams.
  return (
    <Suspense>
      <HomeShell />
    </Suspense>
  );
}
