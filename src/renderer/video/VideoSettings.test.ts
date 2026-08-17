import { completeVideoZoomReset, resetVideoZoom } from './VideoSettings';

jest.mock('renderer/store/UseElectronDatum', () => {
  const { UseDatum } = jest.requireActual('react-usedatum');
  return {
    UseStoredDatum: (_key: string, initialValue: unknown) =>
      UseDatum(initialValue),
    UseMemDatum: (_key: string, initialValue: unknown) =>
      UseDatum(initialValue),
  };
});

describe('video zoom reset coordination', () => {
  afterEach(() => {
    completeVideoZoomReset();
  });

  test('coalesces concurrent reset callers onto the active refresh', async () => {
    const first = resetVideoZoom();
    const second = resetVideoZoom();

    expect(second).toBe(first);

    completeVideoZoomReset();
    await expect(first).resolves.toBeUndefined();
  });

  test('starts a new reset after the prior refresh completes', () => {
    const first = resetVideoZoom();
    completeVideoZoomReset();
    const second = resetVideoZoom();

    expect(second).not.toBe(first);
  });
});
