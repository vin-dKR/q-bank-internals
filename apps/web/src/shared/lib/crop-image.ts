/** A crop rectangle in the source image's natural pixel coordinates. */
export type PixelCrop = { x: number; y: number; width: number; height: number };

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.addEventListener('load', () => { resolve(image); });
    image.addEventListener('error', () => { reject(new Error(`Could not load image: ${src}`)); });
    image.src = src;
  });
}

/**
 * Crop a rectangle out of `imageSrc` (coordinates in the image's NATURAL pixels) and return it as a
 * PNG blob — the TypeScript port of multiCrop's `getCroppedImg`. Used to cut a figure region from a
 * page image before uploading it as a question/option image.
 */
export async function getCroppedBlob(imageSrc: string, crop: PixelCrop): Promise<Blob> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(crop.width));
  canvas.height = Math.max(1, Math.round(crop.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get a 2D canvas context.');
  ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas produced an empty image.'));
    }, 'image/png');
  });
}
