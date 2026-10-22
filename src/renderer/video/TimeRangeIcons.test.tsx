import { render } from '@testing-library/react';
import TimeRangeIcons from './TimeRangeIcons';
import { TimeSegment } from './VideoTypes';

const segment: TimeSegment = {
  startTime: '00:00:01.000',
  endTime: '00:00:02.000',
  startTsMicro: 1000000,
  endTsMicro: 2000000,
  fps: 50,
  label: 'first.mp4',
  pctOffset: 0,
  pct: 1,
};
const times = [{ Time: '00:00:02.010', Bow: '1', EventNum: '1', Gate: 'F' }];

it('renders a gap hint at the end without the beyond-range indicator', () => {
  const { getAllByTestId } = render(
    <TimeRangeIcons
      segments={[segment]}
      times={times}
      endTime={segment.endTime}
      iconType="upper"
      showBeyondRange
    />,
  );
  const icons = getAllByTestId('ArrowDropDownIcon');
  expect(icons).toHaveLength(1);
  expect(getComputedStyle(icons[0].parentElement!).left).toBe('100%');
});

it('clamps gap hints before mapping them onto the file focus scale', () => {
  const positionOf = jest.fn(() => 1);
  render(
    <TimeRangeIcons
      segments={[segment]}
      times={times}
      endTime={segment.endTime}
      positionOf={positionOf}
    />,
  );
  expect(positionOf).toHaveBeenCalledWith(0, segment.endTsMicro);
});

it('places a gap hint on only the file with the nearer frame', () => {
  const next = {
    ...segment,
    startTime: '00:00:02.020',
    endTime: '00:00:03.000',
    startTsMicro: 2020000,
    endTsMicro: 3000000,
  };
  const positionOf = jest.fn(() => 0.5);
  render(
    <TimeRangeIcons
      segments={[segment, next]}
      times={[times[0], { ...times[0], Time: '00:00:02.012' }]}
      endTime={next.endTime}
      positionOf={positionOf}
    />,
  );
  expect(positionOf.mock.calls).toEqual([
    [0, segment.endTsMicro],
    [1, next.startTsMicro],
  ]);
});

it('renders a hint just before the first frame at the start', () => {
  const { getAllByTestId } = render(
    <TimeRangeIcons
      segments={[segment]}
      times={[{ ...times[0], Time: '00:00:00.991' }]}
      endTime={segment.endTime}
      iconType="upper"
    />,
  );
  const icons = getAllByTestId('ArrowDropDownIcon');
  expect(icons).toHaveLength(1);
  expect(getComputedStyle(icons[0].parentElement!).left).toBe('0%');
});
