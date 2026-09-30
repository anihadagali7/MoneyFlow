/** The MoneyFlow mark as an element for next/og ImageResponse (app icons). */
export function BrandIcon({ size, rounded }: { size: number; rounded: boolean }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #2a78d6 0%, #1baf7a 100%)",
        borderRadius: rounded ? size * 0.22 : 0,
      }}
    >
      <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.4} strokeLinecap="round">
        <path d="M3 15c3 0 3-6 6-6s3 6 6 6 3-6 6-6" />
      </svg>
    </div>
  );
}
