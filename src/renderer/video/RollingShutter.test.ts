import {
  retainedRollingShutterOffsetMs,
  rollingShutterOffsetMs,
  rollingShutterTimestampMs,
} from './RollingShutter';
import type { VideoSidecar } from './VideoSettings';

const sidecar = {
  source: {
    width: 1920,
    height: 1080,
    originalWidth: 3840,
    originalHeight: 2160,
    crop: { x: 960, y: 400, width: 1920, height: 1080 },
  },
  sensor: {
    rollingShutter: {
      direction: 'top-to-bottom',
      scanTimeMs: 13.8,
      frameTimeReference: {
        coordinateSpace: 'original-image',
        axis: 'y',
        position: 1080,
      },
    },
  },
} as VideoSidecar;

describe('rolling shutter correction', () => {
  it('retains a correction only at the frame where it was established', () => {
    const correction = {
      videoFile: 'race.mp4',
      frameNum: 1017.342,
      offsetMs: 2.5,
    };
    expect(
      retainedRollingShutterOffsetMs(correction, 'race.mp4', 1017.342),
    ).toBe(2.5);
    expect(
      retainedRollingShutterOffsetMs(correction, 'race.mp4', 1018.342),
    ).toBe(0);
    expect(
      retainedRollingShutterOffsetMs(correction, 'other.mp4', 1017.342),
    ).toBe(0);
  });

  it('uses the original sensor row after accounting for the crop', () => {
    expect(rollingShutterOffsetMs(sidecar, { x: 0, y: 500 })).toBeCloseTo(
      -1.15,
    );
  });

  it('corrects the timestamp while leaving frame selection out of the model', () => {
    expect(
      rollingShutterTimestampMs(1000, sidecar, { x: 0, y: 500 }),
    ).toBeCloseTo(998.85);
  });

  it('makes increasing Y later for a top-to-bottom scan', () => {
    expect(rollingShutterOffsetMs(sidecar, { x: 0, y: 1000 })).toBeCloseTo(
      2.044444,
    );
  });

  it('reverses the sign for a bottom-to-top scan', () => {
    expect(
      rollingShutterOffsetMs(
        {
          ...sidecar,
          sensor: {
            rollingShutter: {
              ...sidecar.sensor!.rollingShutter!,
              direction: 'bottom-to-top',
            },
          },
        },
        { x: 0, y: 500 },
      ),
    ).toBeCloseTo(1.15);
  });

  it.each([['left-to-right', -1] as const, ['right-to-left', 1] as const])(
    'uses finish-line X for a %s scan',
    (direction, expectedSign) => {
      const horizontalSidecar = {
        ...sidecar,
        sensor: {
          rollingShutter: {
            ...sidecar.sensor!.rollingShutter!,
            direction,
            frameTimeReference: {
              coordinateSpace: 'original-image',
              axis: 'x' as const,
              position: 1920,
            },
          },
        },
      };
      // crop.x + finishX = 960 + 860 = 1820, 100 px left of reference.
      expect(
        rollingShutterOffsetMs(horizontalSidecar, { x: 860, y: 999 }),
      ).toBeCloseTo((expectedSign * (100 * 13.8)) / 3840);
    },
  );

  it('does not correct videos without rolling shutter metadata', () => {
    expect(
      rollingShutterOffsetMs(
        { ...sidecar, sensor: { rollingShutter: null } },
        { x: 0, y: 500 },
      ),
    ).toBe(0);
  });

  it('does not throw for incomplete geometry from an older sidecar', () => {
    const incompleteSidecar = {
      ...sidecar,
      source: { ...sidecar.source, crop: undefined },
    } as unknown as VideoSidecar;
    expect(rollingShutterOffsetMs(incompleteSidecar, { x: 100, y: 500 })).toBe(
      0,
    );
    expect(rollingShutterOffsetMs(sidecar, undefined)).toBe(0);
  });
});
