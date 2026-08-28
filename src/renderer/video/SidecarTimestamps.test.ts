import type { TimestampContext } from './TimestampContext';
import {
  addSidecarTimestamp,
  removeSidecarTimestamp,
} from './SidecarTimestamps';

const timestamp = {
  version: 2,
  uuid: 'lap-1',
  time: '12:34:56.789',
} as TimestampContext;

describe('sidecar timestamps', () => {
  it('adds context without replacing other sidecar content', () => {
    const existing = { version: 2, uuid: 'lap-0' } as TimestampContext;
    const result = addSidecarTimestamp(
      { file: { fps: 60 }, timestamps: { 'lap-0': existing } },
      timestamp,
    );
    expect(result.file).toEqual({ fps: 60 });
    expect(result.timestamps).toEqual({
      'lap-0': existing,
      'lap-1': timestamp,
    });
  });

  it('removes only the deleted timestamp context', () => {
    const existing = { version: 2, uuid: 'lap-0' } as TimestampContext;
    const result = removeSidecarTimestamp(
      {
        file: { fps: 60 },
        timestamps: { 'lap-0': existing, 'lap-1': timestamp },
      },
      'lap-1',
    );
    expect(result.file).toEqual({ fps: 60 });
    expect(result.timestamps).toEqual({ 'lap-0': existing });
  });
});
