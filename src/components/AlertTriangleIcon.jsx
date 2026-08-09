/**
 * Plain SVG, not the `⚠` glyph — the design system (CLAUDE.md) bans emoji in
 * the UI because emoji glyphs render inconsistently (often as color emoji)
 * across Android builds, which is exactly the risk on the mid-range Android
 * devices this app targets. Shared by ImageAlignmentModal (stage badge +
 * alert card) and CameraCaptureModal (permission/device error state) so
 * every alert surface in the capture flow shows the identical mark, same
 * reasoning as MaskLayersIcon.jsx.
 */
export default function AlertTriangleIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3.5 L22 20.5 H2 Z" />
      <line x1="12" y1="9.5" x2="12" y2="14.5" />
      <circle cx="12" cy="17.5" r="0.5" fill="currentColor" />
    </svg>
  );
}
