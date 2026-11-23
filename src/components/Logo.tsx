/** Placeholder HM wordmark in brand colours. Replace with the official ½M SVG when available. */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="HM" className="logo" direction="ltr" style={{ direction: 'ltr' }}>
      <rect width="64" height="64" rx="16" fill="var(--ink)" />
      <text x="9" y="30" fontSize="17" fontWeight="700" fill="var(--tan)" fontFamily="inherit">½</text>
      <text x="22" y="48" fontSize="30" fontWeight="700" fill="var(--bg)" fontFamily="inherit">M</text>
    </svg>
  );
}
