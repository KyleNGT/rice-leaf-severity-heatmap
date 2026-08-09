/**
 * ============================================================
 * cameraSupport — Live In-App Camera Feature Detection
 * ============================================================
 * `getUserMedia` requires a secure context (HTTPS, or `localhost` during
 * dev) — over plain HTTP (e.g. a phone on the same LAN hitting `vite`'s dev
 * server per the README) `navigator.mediaDevices` is `undefined` entirely,
 * not merely permission-denied. SamplePanel checks this at CLICK time (not
 * module load, and not cached) so the Camera button is correct regardless
 * of how the page happened to be reached, and falls back to the existing
 * `<input capture="environment">` system-camera handoff when it's false —
 * see CameraCaptureModal.jsx and SamplePanel.jsx.
 */
export function supportsLiveCamera() {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext === true &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}
