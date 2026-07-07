/**
 * ============================================================
 * Mock ML Service — Disease Severity Estimation
 * ============================================================
 * Simulates the SegFormer inference API. Returns a structured
 * JSON response after a realistic delay.
 *
 * INTEGRATION NOTE:
 * When the real API is deployed, replace the body of
 * analyzePlantImage() with:
 *
 *   const formData = new FormData();
 *   formData.append('image', imageFile);
 *   const res = await fetch('/api/analyze', { method: 'POST', body: formData });
 *   return res.json();
 */

const MOCK_DISEASES = [
  'Leaf Blast',
  'Bacterial Leaf Blight',
  'Brown Spot',
];

/**
 * Simulate plant disease analysis on an uploaded image.
 *
 * @param {File} imageFile — The image file (unused in mock, but
 *   keeps the same signature as the real API call).
 * @returns {Promise<{
 *   diseaseDetected: boolean,
 *   severity: number,
 *   diseaseName: string,
 *   confidence: string
 * }>}
 */
export async function analyzePlantImage(_imageFile) {
  // Simulate 1.5–2.5 s network latency
  const delay = 1500 + Math.random() * 1000;
  await new Promise((resolve) => setTimeout(resolve, delay));

  const diseaseDetected = Math.random() > 0.25; // 75 % chance of disease
  const severity = diseaseDetected
    ? Math.round(Math.random() * 100) // PDLA 0–100 %
    : 0;

  return {
    diseaseDetected,
    severity,
    diseaseName: diseaseDetected
      ? MOCK_DISEASES[Math.floor(Math.random() * MOCK_DISEASES.length)]
      : 'Healthy',
    confidence: (0.7 + Math.random() * 0.3).toFixed(2),
  };
}
