// Image URLs from the "Image & video handling" doc. The original is stored once; every screen
// asks Cloudinary for the size it needs.

/** Requested widths are rounded up to these steps so phones share cached images. */
const STEPS = [200, 300, 400, 600, 800, 1000, 1200, 1600, 2000];

/** Real pixels for a card `cssWidth` dp wide on a screen with this pixel ratio. */
export function imageWidth(dpWidth: number, pixelRatio = 2): number {
  const px = Math.ceil(dpWidth * Math.min(pixelRatio, 3));
  return STEPS.find((s) => s >= px) ?? STEPS[STEPS.length - 1];
}

const base = (cloudName: string, kind: 'image' | 'video') => `https://res.cloudinary.com/${cloudName}/${kind}/upload`;

/**
 * Card image: the whole photo fits inside the card, never cropped; empty space is filled with
 * a blurred copy of the same photo (c_pad + b_blurred). Never upscaled past the original.
 */
export function cardImage(cloudName: string, publicId: string, dpWidth: number, dpHeight: number, pixelRatio = 2): string {
  const w = imageWidth(dpWidth, pixelRatio);
  const h = Math.round((w * dpHeight) / dpWidth);
  return `${base(cloudName, 'image')}/w_${w},h_${h},c_pad,b_blurred:400:15,f_auto,q_auto:good/${publicId}`;
}

/** Large photo on the vendor page: full width, original shape. */
export function wideImage(cloudName: string, publicId: string, dpWidth: number, pixelRatio = 2): string {
  return `${base(cloudName, 'image')}/w_${imageWidth(dpWidth, pixelRatio)},c_limit,f_auto,q_auto:good/${publicId}`;
}

/** Full-screen viewer with zoom: twice the screen width, best quality. */
export function zoomImage(cloudName: string, publicId: string, dpWidth: number, pixelRatio = 2): string {
  return `${base(cloudName, 'image')}/w_${imageWidth(dpWidth * 2, pixelRatio)},c_limit,f_auto,q_auto:best/${publicId}`;
}

/** Video poster (first second) and adaptive (HLS) stream. */
export function videoPoster(cloudName: string, publicId: string, dpWidth: number, pixelRatio = 2): string {
  return `${base(cloudName, 'video')}/so_1,w_${imageWidth(dpWidth, pixelRatio)},c_limit,f_auto,q_auto/${publicId}.jpg`;
}

export function videoStream(cloudName: string, publicId: string): string {
  return `${base(cloudName, 'video')}/sp_auto/${publicId}.m3u8`;
}
