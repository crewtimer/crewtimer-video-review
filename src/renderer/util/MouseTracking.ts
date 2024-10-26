/**
 * Type representing a 2D position with x and y coordinates.
 */
type Position = {
  x: number;
  y: number;
};

/**
 * Callback type for handling mouse velocity and position updates.
 *
 * @callback MouseVelocityCallback
 * @param {Position} position - The current mouse position.
 * @param {number} velocity - The calculated mouse velocity in pixels per second.
 * @param {number} pct - Percent of the element that the mouse is over.
 */
type MouseVelocityCallback = (
  position: Position,
  velocity: number,
  pct: number
) => void;

/**
 * Creates a mouse move event handler function that calculates smoothed mouse velocity
 * and updates the mouse position. The function adjusts the behavior based on velocity thresholds:
 * - If velocity is less than 'velocityKnee' px/s, the position is reduced to 1/4 of the actual velocity.
 * - If the position is less than expected and velocity is more than 'velocityKnee' px/s, the position gradually catches up.
 *
 * @param {MouseVelocityCallback} callback - A callback function to be called with updated position and velocity
 * at approximately 10 times per second.
 * @returns {(event: MouseEvent) => void} A mouse move event handler function.
 *
 * @example
 * // Create a handler that logs the position and velocity
 * const handleMouseMove = createMouseMoveHandler((position, velocity) => {
 *   console.log("Position:", position, "Velocity:", velocity);
 * });
 *
 * // Attach the handler to an element's onMouseMove event in a React component:
 * // <div onMouseMove={handleMouseMove}></div>
 */
export function createMouseMoveHandler(callback: MouseVelocityCallback) {
  let lastPosition: Position | null = null;
  let lastTimestamp: number | null = null;
  let smoothedVelocity = 0;
  let smoothedX = 0;
  const velocityKnee = 20; // velocity threshold for ramping up or down
  const alpha = 0.5; // smoothing factor for exponential average
  const xAlpha = 0.33; // smoothing factor for exponential average

  /**
   * Updates the position based on the calculated velocity, adjusting the behavior if necessary.
   *
   * @param {Position} newPosition - The new mouse position.
   * @param {number} velocity - The current velocity in pixels per second.
   * @param {number} pct - Percent of the element that the mouse is over.
   */
  const updatePosition = (
    newPosition: Position,
    velocity: number,
    pct: number
  ) => {
    if (velocity < velocityKnee) {
      // Slow down the position calculation if velocity is below velocityKnee px/s
      newPosition.x += (newPosition.x - lastPosition!.x) * 0.25;
    } else if (lastPosition && velocity > velocityKnee) {
      // Adjust position based on velocity, ramping up if necessary
      const predictedX = lastPosition.x + smoothedVelocity / 10;

      if (newPosition.x < predictedX)
        newPosition.x += (predictedX - newPosition.x) * 0.25;
    }

    smoothedX = xAlpha * newPosition.x + (1 - xAlpha) * smoothedX;
    newPosition.x = smoothedX;
    callback(newPosition, smoothedVelocity, pct);
  };

  /**
   * Handles the mouse move event, calculating the velocity and position adjustments, then calls the callback.
   *
   * @param {MouseEvent} event - The mouse move event containing the current mouse position.
   */
  return (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    const currentTime = Date.now();
    const currentPosition = { x: event.clientX, y: event.clientY };
    let pct = 0.5;
    if (event.target instanceof Element) {
      const elementLeft = event.target.getBoundingClientRect().left;
      currentPosition.x -= elementLeft;
      pct = Math.min(
        100,
        Math.max(0, currentPosition.x / (event.target.clientWidth - 1))
      );
    }

    if (lastPosition && lastTimestamp) {
      const timeElapsed = (currentTime - lastTimestamp) / 1000; // convert to seconds
      if (timeElapsed == 0) {
        return;
      }
      const distance = currentPosition.x - lastPosition.x;
      const velocity = distance / timeElapsed;

      // Exponential smoothing for velocity
      smoothedVelocity = alpha * velocity + (1 - alpha) * smoothedVelocity;

      updatePosition(currentPosition, smoothedVelocity, pct);
    }

    lastPosition = currentPosition;
    lastTimestamp = currentTime;
  };
}
