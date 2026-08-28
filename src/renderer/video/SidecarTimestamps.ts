import type { KeyMap } from 'crewtimer-common';
import type { TimestampContext } from './TimestampContext';

export const addSidecarTimestamp = (
  content: KeyMap,
  timestamp: TimestampContext,
): KeyMap => ({
  ...content,
  timestamps: {
    ...(content.timestamps as Record<string, TimestampContext> | undefined),
    [timestamp.uuid]: timestamp,
  },
});

export const removeSidecarTimestamp = (
  content: KeyMap,
  uuid: string,
): KeyMap => {
  const timestamps = {
    ...(content.timestamps as Record<string, TimestampContext> | undefined),
  };
  delete timestamps[uuid];
  return { ...content, timestamps };
};
