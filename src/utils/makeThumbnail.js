/**
 * ============================================================
 * Thumbnail Downscaler
 * ============================================================
 * Committed samples keep their photos only as small data URLs, never as
 * `URL.createObjectURL` blobs.
 *
 * Why it matters: a blob URL pins the entire original file in memory until
 * it is revoked. At one photo per sample that was up to 50 full-resolution
 * phone images; a plant node holding up to MAX_IMAGES_PER_SAMPLE photos
 * makes it up to 500, on the mid-range Android this app targets. So object
 * URLs live only for the lifetime of a draft (where the lightbox needs full
 * resolution) and are revoked at commit, with these data URLs kept instead.
 */

/** Longest edge of a stored thumbnail, in CSS pixels × 2 for retina. */
const THUMBNAIL_MAX_EDGE = 192;
const THUMBNAIL_QUALITY = 0.7;

/**
 * Downscale an image to a small JPEG data URL.
 *
 * @param {string} src — object URL or data URL of the source image.
 * @returns {Promise<string>} a data URL. Falls back to returning `src`
 *   unchanged if the image can't be decoded, so a thumbnail failure can
 *   never lose the sample — the caller must then NOT revoke that object URL.
 */
export function makeThumbnail(src) {
  return new Promise((resolve) => {
    const img = new Image();

    img.onload = () => {
      try {
        const scale = Math.min(1, THUMBNAIL_MAX_EDGE / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        resolve(canvas.toDataURL('image/jpeg', THUMBNAIL_QUALITY));
      } catch {
        // Tainted canvas or an exhausted memory budget — keep the original.
        resolve(src);
      }
    };

    img.onerror = () => resolve(src);
    img.src = src;
  });
}

/**
 * Downscale every photo of a committed plant in one pass.
 *
 * Resolves to a parallel array of data URLs. Entries that fall back to the
 * original object URL are reported so the caller knows which ones must stay
 * un-revoked.
 *
 * @param {Array<{thumbnail: string}>} images
 * @returns {Promise<Array<{thumbnail: string, downscaled: boolean}>>}
 */
export async function makeThumbnails(images) {
  return Promise.all(
    images.map(async (image) => {
      const thumbnail = await makeThumbnail(image.thumbnail);
      return { thumbnail, downscaled: thumbnail !== image.thumbnail };
    })
  );
}
