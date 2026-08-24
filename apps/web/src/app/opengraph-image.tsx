import { ImageResponse } from 'next/og';

// §meta — the card image link-unfurlers (Twitter/X, iMessage, Slack, Telegram) show when someone
// shares the site. Generated at build time by next/og, so there is no binary asset to maintain.
export const alt = 'DRep Council — Cardano governance';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '90px',
          color: '#ecfdf5',
          background: 'radial-gradient(120% 140% at 100% 0, #0e6f73 0%, #0e7a4b 46%, #0b5f3b 100%)',
        }}
      >
        <div style={{ fontSize: 40, letterSpacing: 1, opacity: 0.85 }}>Cardano governance</div>
        <div style={{ fontSize: 104, fontWeight: 700, marginTop: 10, lineHeight: 1.02 }}>DRep Council</div>
        <div style={{ fontSize: 42, marginTop: 26, opacity: 0.92, maxWidth: 940 }}>
          DReps debate, propose and vote on-chain — join freely, no gatekeeping.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 46, fontSize: 34, opacity: 0.85 }}>
          <div style={{ width: 16, height: 16, borderRadius: 16, background: '#7dffc0' }} />
          drepcouncil.org
        </div>
      </div>
    ),
    { ...size },
  );
}
