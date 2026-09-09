import { ImageResponse } from 'next/og';
import { brand } from '@/lib/brand';

// §meta — a per-resource link-unfurl card. When someone shares a specific document/proposal
// (?view=rules&doc=…, ?ip=…, ?proposal=…, ?gp=…), generateMetadata points og:image here with the
// resource's title + kind, so the preview shows the document name on a distinct BLUE card instead
// of the generic green site card. Rendered on demand by next/og.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const title = (searchParams.get('title') || brand.name).slice(0, 160);
  const kind = (searchParams.get('kind') || 'Cardano governance').slice(0, 60);
  // Long titles get a smaller face so they still fit within the card.
  const titleSize = title.length > 90 ? 56 : title.length > 55 ? 68 : 84;

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '84px',
          color: '#eff6ff',
          background: 'radial-gradient(120% 140% at 100% 0, #2563eb 0%, #1d4ed8 45%, #1e3a8a 100%)',
        }}
      >
        <div style={{ fontSize: 38, letterSpacing: 1, opacity: 0.85, textTransform: 'uppercase' }}>{kind}</div>
        <div style={{ display: 'flex', fontSize: titleSize, fontWeight: 700, lineHeight: 1.05, maxWidth: 1000 }}>{title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 34, opacity: 0.85 }}>
          <div style={{ width: 16, height: 16, borderRadius: 16, background: '#93c5fd' }} />
          {brand.name}
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
