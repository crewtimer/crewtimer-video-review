import React, { useRef, useCallback } from 'react';

/**
 * Hook to easily differentiate between single and double click handlers.
 *
 * Usage:
 *   const { onCSinglelick, onDoubleClick } = useSingleAndDoubleClick(singleFn, doubleFn);
 *   <div onClick={onSingleClick} onDoubleClick={onDoubleClick} />
 */
export function useSingleAndDoubleClick(
  onSingleClick: (
    e: React.MouseEvent<HTMLDivElement | HTMLButtonElement, MouseEvent>,
  ) => void,
  onDoubleClick: (
    e: React.MouseEvent<HTMLDivElement | HTMLButtonElement, MouseEvent>,
  ) => void,
  delay = 250, // ms, adjust as needed
) {
  const clickTimeout = useRef<NodeJS.Timeout | null>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement | HTMLButtonElement, MouseEvent>) => {
      if (clickTimeout.current !== null) {
        clearTimeout(clickTimeout.current);
        clickTimeout.current = null;
      }
      clickTimeout.current = setTimeout(() => {
        onSingleClick(e);
        clickTimeout.current = null;
      }, delay);
    },
    [onSingleClick, delay],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement | HTMLButtonElement, MouseEvent>) => {
      if (clickTimeout.current !== null) {
        clearTimeout(clickTimeout.current);
        clickTimeout.current = null;
      }
      onDoubleClick(e);
    },
    [onDoubleClick],
  );

  return { onSingleClick: handleClick, onDoubleClick: handleDoubleClick };
}
