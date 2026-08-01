/**
 * Plain SVG, not an emoji glyph — CLAUDE.md bans emoji in the UI because
 * they render inconsistently across Android builds. Stacked-parallelogram
 * "layers" mark, the conventional glyph for staged/intermediate output
 * (Phase 1 leaf mask, Phase 2 disease mask). Shared by the sampling photo
 * tile (SamplePanel.jsx) and the Step 3 history row (SampleHistorySidebar.jsx)
 * so both show the identical mark, same reasoning as ImageAlignmentModal's
 * AlertTriangleIcon.
 */
export default function MaskLayersIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="12 3 21 8 12 13 3 8 12 3" />
      <polyline points="3 12 12 17 21 12" />
      <polyline points="3 16 12 21 21 16" />
    </svg>
  );
}
