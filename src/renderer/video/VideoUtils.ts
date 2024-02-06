/**
 * Draws text on the canvas with specified alignment and position relative to a horizontal line.
 *
 * @param {CanvasRenderingContext2D} ctx - The canvas rendering context.
 * @param {string} text - The text to be drawn.
 * @param {number} fontSize - The size of text to be drawn.
 * @param {number} x - The x-coordinate for the text placement.
 * @param {number} y - The y-coordinate for the horizontal line around which the text is aligned.
 * @param {'above' | 'below' | 'center'} position - The position of the text relative to the horizontal line ('above', 'below', or 'center').
 * @param {'left' | 'center' | 'right'} align - The alignment of the text relative to the x-coordinate ('left', 'center', or 'right').
 */
export const drawText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  fontSize: number,
  x: number,
  y: number,
  position: 'above' | 'below' | 'center',
  align: 'left' | 'center' | 'right'
) => {
  ctx.font = `${Math.trunc(fontSize)}px Arial`;
  const textSize = ctx.measureText(text);
  const padding = 12;

  // Adjust X-Coordinate for Alignment
  let textX: number;
  let rectX: number;
  switch (align) {
    case 'center':
      textX = x - textSize.width / 2;
      break;
    case 'right':
      textX = x - textSize.width - padding / 2 - 2;
      break;
    default: // 'left'
      textX = x + padding / 2 + 2;
      break;
  }
  rectX = textX - padding / 2;

  // Adjust Y-Coordinate for Position
  let rectY: number;
  let textY: number;
  if (position === 'above') {
    rectY =
      y -
      textSize.actualBoundingBoxAscent -
      padding -
      padding / 2 -
      textSize.actualBoundingBoxDescent;
    textY = y - padding - textSize.actualBoundingBoxDescent;
  } else if (position === 'below') {
    rectY = y + padding / 2;
    textY = rectY + textSize.actualBoundingBoxAscent + padding / 2;
  } else {
    // 'center'
    rectY =
      y -
      (textSize.actualBoundingBoxAscent +
        textSize.actualBoundingBoxDescent +
        padding) /
        2;
    textY =
      y +
      (textSize.actualBoundingBoxAscent - textSize.actualBoundingBoxDescent) /
        2;
  }

  const rectWidth = textSize.width + padding;
  const rectHeight =
    textSize.actualBoundingBoxAscent +
    textSize.actualBoundingBoxDescent +
    padding;

  // Draw the background rectangle
  ctx.fillStyle = '#ffffff60';
  ctx.fillRect(rectX, rectY, rectWidth, rectHeight);

  // Draw the text
  ctx.fillStyle = 'black';
  ctx.fillText(text, textX, textY);
};
