import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };
export const APPLE_SIZE = { width: 180, height: 180 };

/** The mark: documents feeding one explainer. Sized by `s` (px per unit). */
function Mark({ s = 1 }: { s?: number }) {
  return (
    <svg width={64 * s} height={64 * s} viewBox="0 0 64 64">
      <g fill="#171717" stroke="#52525b" strokeWidth="1.5">
        <rect x="10" y="10" width="9" height="12" rx="1.5" />
        <rect x="22" y="10" width="9" height="12" rx="1.5" />
        <rect x="34" y="10" width="9" height="12" rx="1.5" />
        <rect x="46" y="10" width="9" height="12" rx="1.5" />
      </g>
      <g fill="none" stroke="#3f3f46" strokeWidth="1.5">
        <path d="M14.5 23 C14.5 32, 32 30, 32 36" />
        <path d="M26.5 23 C26.5 32, 32 30, 32 36" />
        <path d="M38.5 23 C38.5 32, 32 30, 32 36" />
        <path d="M50.5 23 C50.5 32, 32 30, 32 36" />
      </g>
      <rect x="14" y="37" width="36" height="18" rx="3" fill="#0f0f0f" stroke="#7dd3fc" strokeOpacity="0.85" strokeWidth="1.5" />
      <polyline points="19,50 25,48 31,48.5 37,45 43,44 48,41" fill="none" stroke="#7dd3fc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 1200×630 share card. `eyebrow` is the small line above the title (e.g. a ticker). */
export function shareImage({ title, description, eyebrow }: { title: string; description: string; eyebrow?: string }) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-start",
          gap: 56,
          padding: "64px 72px 72px",
          background: "#0a0a0a",
          color: "#e5e5e5",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <Mark s={1.25} />
          <div style={{ fontSize: 30, color: "#a3a3a3", letterSpacing: -0.5 }}>transcripts.fyi</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {eyebrow && <div style={{ fontSize: 30, color: "#7dd3fc", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{eyebrow}</div>}
          <div style={{ fontSize: 66, fontWeight: 600, lineHeight: 1.08, letterSpacing: -1.5, maxWidth: 1000 }}>{title}</div>
          <div style={{ fontSize: 30, color: "#a3a3a3", lineHeight: 1.35, maxWidth: 1000 }}>{description}</div>
        </div>
      </div>
    ),
    OG_SIZE,
  );
}

export function appleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0a0a", borderRadius: 36 }}>
        <Mark s={2.4} />
      </div>
    ),
    APPLE_SIZE,
  );
}
