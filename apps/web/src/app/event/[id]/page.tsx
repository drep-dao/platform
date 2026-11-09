import type { Metadata } from 'next';
import { brand } from '@/lib/brand';
import { EventRedirect } from './redirect';

// §events — a clean share URL for an event. Server-renders an Open Graph / Twitter card (title +
// supporting text + a generated image) so a link posted on X unfurls a rich card; a human is then
// redirected to the landing page (which shows the event). Rendered per request so the card reflects
// the live event; a slow/missing lookup falls back to the default site card and never blocks.
export const dynamic = 'force-dynamic';

const API = `${process.env.NEXT_PUBLIC_API_URL ?? ''}/api/v1`;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params.catch(() => ({ id: '' }) as { id: string });
  if (!id) return {};
  try {
    const res = await fetch(`${API}/events/${id}`, { signal: AbortSignal.timeout(2500), headers: { accept: 'application/json' } });
    if (!res.ok) return {};
    const data = (await res.json()) as { title?: unknown; description?: unknown };
    const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim() : null;
    if (!title) return {};
    const kind = 'Upcoming event';
    const rawDesc = typeof data.description === 'string' && data.description.trim() ? data.description.trim() : null;
    const desc = rawDesc ? rawDesc.slice(0, 200) : `${kind} · ${brand.name}`;
    const image = `/og?title=${encodeURIComponent(title)}&kind=${encodeURIComponent(kind)}`; // resolved against metadataBase
    return {
      title: `${title} · ${brand.name}`,
      description: desc,
      openGraph: { type: 'website', siteName: brand.name, title, description: desc, images: [{ url: image, width: 1200, height: 630, alt: title }] },
      twitter: { card: 'summary_large_image', title, description: desc, images: [image] },
    };
  } catch {
    return {};
  }
}

export default async function EventSharePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params.catch(() => ({ id: '' }) as { id: string });
  return <EventRedirect id={id} />;
}
