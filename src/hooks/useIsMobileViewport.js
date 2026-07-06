import { useEffect, useState } from 'react';

/**
 * ============================================================
 * useIsMobileViewport — Responsive breakpoint as a boolean
 * ============================================================
 * Mirrors the app's existing 768px responsive breakpoint
 * (see App.css `@media (min-width: 768px)`), used to switch
 * field-boundary drawing into the center-anchored mobile flow.
 */
const MOBILE_QUERY = '(max-width: 767px)';

export function useIsMobileViewport() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const handleChange = (e) => setIsMobile(e.matches);
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, []);

  return isMobile;
}
