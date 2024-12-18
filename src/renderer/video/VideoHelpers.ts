/**
 * Asynchronously downsizes an image by a given factor.
 *
 * @param {string} src - The source URL of the image to be downsized.
 * @param {number} factor - The factor by which to downsize the image.
 *                          A factor of 2 would reduce both the width and height by half.
 * @param {Function} callback - A callback function that will be called with the downsized image's data URL.
 */
export const downsizeImage = async (
  src: string,
  factor: number,
  callback: (downsizedDataURL: string) => void,
): Promise<void> => {
  // Create a new Image object
  const img = new Image();
  // Set the source of the image to the provided URL
  img.src = src;

  // Handle the image load event
  img.onload = () => {
    // Create a canvas element to draw the downsized image
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      callback('');
      return;
    }

    // Calculate the dimensions of the downsized image
    const downsizedWidth = Math.ceil(img.width / factor);
    const downsizedHeight = Math.ceil(img.height / factor);

    // Set the canvas size to the downsized dimensions
    canvas.width = downsizedWidth;
    canvas.height = downsizedHeight;

    // Draw the original image onto the canvas at the downsized dimensions
    // This effectively resizes the image
    ctx.drawImage(img, 0, 0, downsizedWidth, downsizedHeight);

    // Convert the canvas content to a data URL, which represents the downsized image
    const downsizedDataURL = canvas.toDataURL();

    // Call the provided callback function with the downsized image's data URL
    callback(downsizedDataURL);
  };
};
