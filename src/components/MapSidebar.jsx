import { useEffect, useState } from 'react';
import { useIsMobileViewport } from '../hooks/useIsMobileViewport';
import HeatmapControls from './HeatmapControls';
import SampleHistoryList from './SampleHistoryList';

/**
 * ============================================================
 * MapSidebar — Step 3 (Heatmap) left sidebar, tabbed
 * ============================================================
 * Replaces the old always-bottom-tray-on-every-viewport layout: on desktop
 * this sidebar is now the ONLY place heatmap controls live (the map is no
 * longer half-covered by a floating card), with a second tab for the
 * sample/photo audit trail that used to be this component's entire
 * purpose. On mobile, HeatmapControls already renders in the bottom
 * ActionPanel tray (see ActionPanel.jsx's isMobile gate and
 * HeatmapTray.jsx's "Heatmap Details" card) — so this sidebar does NOT
 * mount a second copy there. Mobile gets a single, tab-less pane: Sample
 * History only. Desktop keeps both tabs, since it has no bottom tray and
 * this sidebar is the only home HeatmapControls has there.
 *
 * Hidden by default on mobile, open by default on desktop, since this
 * component only mounts once currentStep reaches STEPS.HEATMAP, so mount
 * time IS step-entry time.
 *
 * Two different toggles open it, by viewport. Desktop's is a plain,
 * always-visible circular bubble. Mobile's is a labelled "Sample History"
 * pill (recognition over recall, same reasoning as every other tool button
 * in this app) — apt now that history is the sidebar's only content there,
 * not just its primary reason for existing. It only renders while closed,
 * same as the toggle it replaces; once open, the backdrop tap, Escape, or
 * the mobile-only × next to the (tab-less) title closes it (desktop has no
 * × — the always-visible bubble is already its close control, so a second
 * one there would be redundant).
 *
 * Both tab panes stay mounted at all times on desktop (toggled via
 * `hidden`, not conditionally rendered) so switching tabs never resets
 * SampleHistoryList's scroll position or expanded rows. Mobile never
 * mounts the Heatmap pane at all — see above.
 *
 * `selection`/`onFocusOnMap`/`activeLayer`/`onInspectMasks`/`onExportLoocv`
 * are forwarded to SampleHistoryList unchanged — see that file's docblock
 * for the map/sidebar selection-link contract. A map-originated selection
 * additionally opens this sidebar and switches it to the History tab.
 */
export default function MapSidebar({
  // History tab
  samples,
  selection,
  onFocusOnMap,
  activeLayer,
  onInspectMasks,
  onExportLoocv,
  // Heatmap tab (HeatmapControls props)
  onResumeSampling,
  heatmapOpacity,
  onOpacityChange,
  heatmapData,
  availableLayers,
  heatmapLayer,
  onHeatmapLayerChange,
  onExportReport,
  onReset,
  isProcessing,
}) {
  const isMobile = useIsMobileViewport();
  const [isOpen, setIsOpen] = useState(() => !isMobile);
  // Mobile has no Heatmap tab to land on (see docblock) — default straight
  // to History there. Desktop keeps Heatmap as the entry tab, as before.
  const [activeTab, setActiveTab] = useState(() => (isMobile ? 'history' : 'heatmap'));

  // A node clicked on the map opens this sidebar onto the History tab —
  // see SampleHistoryList's docblock for why this is gated to origin==='map'.
  useEffect(() => {
    if (!selection || selection.origin !== 'map') return;
    setIsOpen(true);
    setActiveTab('history');
  }, [selection]);

  // Escape closes the sidebar — needed on desktop now that its backdrop is
  // suppressed there (see .map-sidebar-backdrop's tablet+ media query in
  // App.css) so nodes stay clickable behind an open sidebar; without a
  // backdrop to click away on, the bubble and Escape are desktop's only
  // close paths (mobile also has the × next to the title — see docblock).
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  return (
    <>
      {isMobile ? (
        !isOpen && (
          <button
            type="button"
            className="sidebar-toggle-pill"
            onClick={() => {
              setIsOpen(true);
              setActiveTab('history');
            }}
            aria-label="Show sample history"
          >
            <span>Sample History</span>
            <span className="sidebar-toggle-count">{samples.length}</span>
          </button>
        )
      ) : (
        <button
          type="button"
          className={`sidebar-bubble ${isOpen ? 'is-open' : ''}`}
          onClick={() => setIsOpen((prev) => !prev)}
          aria-label={isOpen ? 'Hide map sidebar' : 'Show map sidebar'}
          aria-expanded={isOpen}
        >
          <span className="sidebar-bubble-arrow" aria-hidden="true" />
        </button>
      )}

      {isOpen && (
        <div className="map-sidebar-backdrop" onClick={() => setIsOpen(false)} aria-hidden="true" />
      )}

      <aside className={`map-sidebar ${isOpen ? 'is-open' : ''}`} aria-hidden={!isOpen}>
        {isMobile ? (
          <div className="sidebar-tabs">
            {/* Balances .sidebar-close-btn's width so the title text-aligns
                center on the FULL row, not just the flex remainder next to
                the button. */}
            <span className="sidebar-tabs-spacer" aria-hidden="true" />
            <span className="sidebar-tabs-title">Sample History</span>
            <button
              type="button"
              className="sidebar-close-btn"
              onClick={() => setIsOpen(false)}
              aria-label="Close sidebar"
            >
              ×
            </button>
          </div>
        ) : (
          <div className="sidebar-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'heatmap'}
              className={`sidebar-tab ${activeTab === 'heatmap' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('heatmap')}
            >
              Heatmap
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'history'}
              className={`sidebar-tab ${activeTab === 'history' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('history')}
            >
              Sample History
            </button>
          </div>
        )}

        <div className="map-sidebar-panes">
          {!isMobile && (
            <div className="map-sidebar-pane" hidden={activeTab !== 'heatmap'}>
              <HeatmapControls
                onResumeSampling={onResumeSampling}
                heatmapOpacity={heatmapOpacity}
                onOpacityChange={onOpacityChange}
                heatmapData={heatmapData}
                availableLayers={availableLayers}
                heatmapLayer={heatmapLayer}
                onHeatmapLayerChange={onHeatmapLayerChange}
                onExportReport={onExportReport}
                onReset={onReset}
                isProcessing={isProcessing}
              />
            </div>
          )}

          <div className="map-sidebar-pane" hidden={!isMobile && activeTab !== 'history'}>
            <SampleHistoryList
              samples={samples}
              selection={selection}
              onFocusOnMap={onFocusOnMap}
              activeLayer={activeLayer}
              onInspectMasks={onInspectMasks}
              onExportLoocv={onExportLoocv}
              active={isMobile || activeTab === 'history'}
            />
          </div>
        </div>
      </aside>
    </>
  );
}
