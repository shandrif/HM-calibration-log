/**
 * Slowly drifting pastel light behind the glass surfaces.
 * Each blob is a soft radial gradient (no CSS filter), animated with transform only,
 * so it stays on the GPU and costs very little even on store tablets.
 */
export function LiquidBackground() {
  return (
    <div className="liquid-bg" aria-hidden>
      <span className="blob blob-1" />
      <span className="blob blob-2" />
      <span className="blob blob-3" />
      <span className="blob blob-4" />
      <span className="blob blob-5" />
      <span className="liquid-sheen" />
    </div>
  );
}
