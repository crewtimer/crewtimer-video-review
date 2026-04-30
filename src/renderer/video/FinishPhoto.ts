import { ExtendedLap, getClickerData } from './UseClickerData';
import { getOpenFilename, requestVideoFrame } from './RequestVideoFrame';
import { getFileStatusList } from './VideoFileStatus';
import {
  getImage,
  getSelectedIndex,
  setSelectedIndex,
  setVideoFile,
} from './VideoSettings';
import { downloadCanvasImage, getFinishLine } from './VideoUtils';
import { milliToString, secondsSinceLocalMidnight } from '../util/Util';
import { getMobileConfig, getWaypoint } from '../util/UseSettings';
import logoUrl from '../../assets/icons/crewtimer-review2-white.svg';

const SLICE_FRACTION_OF_WIDTH = 0.8;
const SLICE_GAP_FRACTION = 0.04;
const SIDEBAR_PADDING = 20;
const LOGO_BOTTOM_MARGIN = 20;
const LOGO_WIDTH_FRACTION = 0.4;
const LOGO_MAX_WIDTH = 140;

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

const formatDelta = (delta: number, intWidth = 1): string => {
  const sign = delta < 0 ? '-' : '+';
  const absFixed = Math.abs(delta).toFixed(3);
  const dotIdx = absFixed.indexOf('.');
  const intPart = absFixed.slice(0, dotIdx).padStart(intWidth, ' ');
  const fracPart = absFixed.slice(dotIdx);
  return `${sign}${intPart}${fracPart}`;
};

const computeIntWidth = (values: number[]): number => {
  let max = 1;
  values.forEach((v) => {
    const len = Math.floor(Math.abs(v)).toString().length;
    if (len > max) max = len;
  });
  return max;
};

const findFileForTime = (seconds: number) => {
  return getFileStatusList().find((status) => {
    const start = secondsSinceLocalMidnight(
      status.startTime / 1000000,
      status.tzOffset,
    );
    const end = secondsSinceLocalMidnight(
      status.endTime / 1000000,
      status.tzOffset,
    );
    return seconds >= start && seconds <= end;
  });
};

interface SidebarRow {
  position: number;
  label: string;
  deltaLeader: string;
  deltaPrev: string;
}

const POSITION_CIRCLE_COLOR = '#1976d2';
const MONO_FONT_FAMILY = "'Roboto Mono', Consolas, 'Courier New', monospace";
const DELTA_PREV_PLACEHOLDER = '—';

const buildSidebar = (
  finishers: ExtendedLap[],
  crewByBow: Map<string, string>,
  height: number,
  logo?: HTMLImageElement,
): HTMLCanvasElement => {
  const usableHeight = height - 2 * SIDEBAR_PADDING;
  const rowHeight = Math.min(220, Math.floor(usableHeight / finishers.length));
  const titleSize = Math.max(22, Math.floor(rowHeight * 0.22));
  const detailSize = Math.max(22, Math.floor(rowHeight * 0.18));
  const circleSize = Math.max(36, Math.round(titleSize * 1.4));
  const circleNumberSize = Math.floor(circleSize * 0.55);
  const titleTextX =
    SIDEBAR_PADDING + circleSize + Math.round(circleSize * 0.4);
  const lineGap = 8;
  const detailLabelGap = Math.round(detailSize * 0.6);
  const monoFont = `${detailSize}px ${MONO_FONT_FAMILY}`;

  const allDeltas: number[] = [0];
  for (let i = 1; i < finishers.length; i += 1) {
    allDeltas.push(finishers[i].seconds - finishers[0].seconds);
    allDeltas.push(finishers[i].seconds - finishers[i - 1].seconds);
  }
  const intWidth = computeIntWidth(allDeltas);

  const rows: SidebarRow[] = finishers.map((lap, idx) => {
    const crew = crewByBow.get(lap.Bow) || lap.Crew || lap.CrewAbbrev || '';
    const label = [lap.Bow, crew].filter(Boolean).join('  ');
    if (idx === 0) {
      return {
        position: 1,
        label,
        deltaLeader: `${formatDelta(0, intWidth)}s`,
        deltaPrev: DELTA_PREV_PLACEHOLDER,
      };
    }
    return {
      position: idx + 1,
      label,
      deltaLeader: `${formatDelta(lap.seconds - finishers[0].seconds, intWidth)}s`,
      deltaPrev: `${formatDelta(lap.seconds - finishers[idx - 1].seconds, intWidth)}s`,
    };
  });

  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');
  let titleWidth = 0;
  let labelColWidth = 0;
  let valueWidth = 0;
  if (measureCtx) {
    measureCtx.font = `bold ${titleSize}px Roboto, sans-serif`;
    rows.forEach((r) => {
      titleWidth = Math.max(titleWidth, measureCtx.measureText(r.label).width);
    });
    measureCtx.font = `${detailSize}px Roboto, sans-serif`;
    labelColWidth = Math.max(
      measureCtx.measureText('Δ 1st').width,
      measureCtx.measureText('Δ prev').width,
    );
    measureCtx.font = monoFont;
    rows.forEach((r) => {
      valueWidth = Math.max(valueWidth, measureCtx.measureText(r.deltaLeader).width);
      if (r.deltaPrev) {
        valueWidth = Math.max(valueWidth, measureCtx.measureText(r.deltaPrev).width);
      }
    });
  }

  const titleColumnRight = titleTextX - SIDEBAR_PADDING + Math.ceil(titleWidth);
  const detailColumnRight =
    titleTextX -
    SIDEBAR_PADDING +
    Math.ceil(labelColWidth + detailLabelGap + valueWidth);
  const innerWidth = Math.max(titleColumnRight, detailColumnRight);
  const sidebarWidth = innerWidth + 2 * SIDEBAR_PADDING;

  const canvas = document.createElement('canvas');
  canvas.width = sidebarWidth;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, sidebarWidth, height);

  const totalHeight = rowHeight * finishers.length;
  let y = Math.max(SIDEBAR_PADDING, Math.floor((height - totalHeight) / 2));
  const valueX = titleTextX + labelColWidth + detailLabelGap;

  rows.forEach((r) => {
    const circleCenterX = SIDEBAR_PADDING + circleSize / 2;
    const circleCenterY = y + circleSize / 2;

    ctx.fillStyle = POSITION_CIRCLE_COLOR;
    ctx.beginPath();
    ctx.arc(circleCenterX, circleCenterY, circleSize / 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = `bold ${circleNumberSize}px Roboto, sans-serif`;
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${r.position}`, circleCenterX, circleCenterY + 1);

    ctx.font = `bold ${titleSize}px Roboto, sans-serif`;
    ctx.fillStyle = 'white';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(r.label, titleTextX, circleCenterY);

    ctx.textBaseline = 'top';
    const deltasTop = y + circleSize + lineGap;

    ctx.font = `${detailSize}px Roboto, sans-serif`;
    ctx.fillStyle = '#888888';
    ctx.fillText('Δ 1st', titleTextX, deltasTop);
    ctx.font = monoFont;
    ctx.fillStyle = '#dddddd';
    ctx.fillText(r.deltaLeader, valueX, deltasTop);

    const prevTop = deltasTop + detailSize + 4;
    ctx.font = `${detailSize}px Roboto, sans-serif`;
    ctx.fillStyle = '#888888';
    ctx.fillText('Δ prev', titleTextX, prevTop);
    ctx.font = monoFont;
    ctx.fillStyle =
      r.deltaPrev === DELTA_PREV_PLACEHOLDER ? '#666666' : '#dddddd';
    ctx.fillText(r.deltaPrev, valueX, prevTop);

    y += rowHeight;
  });

  if (logo && logo.naturalWidth > 0 && logo.naturalHeight > 0) {
    const contentBottom =
      y - rowHeight + circleSize + lineGap + 2 * detailSize + 4;
    const availableHeight = height - LOGO_BOTTOM_MARGIN - contentBottom - 12;
    if (availableHeight > 40) {
      const aspect = logo.naturalHeight / logo.naturalWidth;
      let targetWidth = Math.min(
        LOGO_MAX_WIDTH,
        sidebarWidth - 2 * SIDEBAR_PADDING,
        Math.round(sidebarWidth * LOGO_WIDTH_FRACTION),
      );
      let targetHeight = Math.round(targetWidth * aspect);
      if (targetHeight > availableHeight) {
        targetHeight = Math.floor(availableHeight);
        targetWidth = Math.round(targetHeight / aspect);
      }
      const logoX = Math.round((sidebarWidth - targetWidth) / 2);
      const logoY = height - targetHeight - LOGO_BOTTOM_MARGIN;
      ctx.drawImage(logo, logoX, logoY, targetWidth, targetHeight);
    }
  }

  return canvas;
};

interface SliceRender {
  width: number;
  canvas: HTMLCanvasElement;
}

const renderSlice = async (
  finisher: ExtendedLap,
): Promise<SliceRender | undefined> => {
  const fileStatus = findFileForTime(finisher.seconds);
  if (!fileStatus) return undefined;

  const targetTimestamp = milliToString(finisher.seconds * 1000);

  setSelectedIndex(getFileStatusList().indexOf(fileStatus));
  setVideoFile(fileStatus.filename);
  const image = await requestVideoFrame({
    videoFile: fileStatus.filename,
    toTimestamp: targetTimestamp,
    blend: false,
    closeTo: false,
  });
  if (!image) return undefined;

  const finish = getFinishLine();
  const finishX = image.width / 2 + (finish.pt1 + finish.pt2) / 2;

  const sliceWidth = Math.min(
    image.width,
    Math.max(32, Math.floor(image.width * SLICE_FRACTION_OF_WIDTH)),
  );
  const sliceLeft = Math.max(
    0,
    Math.min(image.width - sliceWidth, Math.round(finishX - sliceWidth / 2)),
  );

  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = image.width;
  sourceCanvas.height = image.height;
  const sourceCtx = sourceCanvas.getContext('2d');
  if (!sourceCtx) return undefined;
  sourceCtx.putImageData(
    new ImageData(
      new Uint8ClampedArray(image.data),
      image.width,
      image.height,
    ),
    0,
    0,
  );

  const out = document.createElement('canvas');
  out.width = sliceWidth;
  out.height = image.height;
  const ctx = out.getContext('2d');
  if (!ctx) return undefined;

  ctx.drawImage(
    sourceCanvas,
    sliceLeft,
    0,
    sliceWidth,
    image.height,
    0,
    0,
    sliceWidth,
    image.height,
  );

  const finishLineInSlice = Math.round(finishX - sliceLeft);
  if (finishLineInSlice >= 0 && finishLineInSlice < sliceWidth) {
    const lineWidth = Math.max(2, Math.round(image.width * 0.0015));
    ctx.fillStyle = '#ff2222';
    ctx.fillRect(
      finishLineInSlice - Math.floor(lineWidth / 2),
      0,
      lineWidth,
      image.height,
    );
  }

  return { width: sliceWidth, canvas: out };
};

export const generateFinishPhoto = async (event: string): Promise<string> => {
  if (!event) {
    return 'No event selected.';
  }

  const finishers = getClickerData(getWaypoint())
    .filter(
      (lap) =>
        lap.EventNum === event &&
        lap.State !== 'Deleted' &&
        lap.Bow !== '?' &&
        lap.Bow !== '*',
    )
    .sort((a, b) => a.seconds - b.seconds);

  if (finishers.length === 0) {
    return `No finishers found for event ${event}.`;
  }

  const crewByBow = new Map<string, string>();
  const eventList = getMobileConfig()?.eventList || [];
  const matchingEvent = eventList.find((ev) => ev.EventNum === event);
  matchingEvent?.eventItems.forEach((entry) => {
    if (entry.Bow && entry.Crew) crewByBow.set(entry.Bow, entry.Crew);
  });

  const origFile = getOpenFilename();
  const origFrame = getImage().frameNum;
  const origIndex = getSelectedIndex();

  let logo: HTMLImageElement | undefined;
  try {
    logo = await loadImage(logoUrl);
  } catch {
    logo = undefined;
  }

  const renders: SliceRender[] = [];
  for (const finisher of finishers) {
    // eslint-disable-next-line no-await-in-loop
    const r = await renderSlice(finisher);
    if (r) renders.push(r);
  }

  if (renders.length === 0) {
    if (origFile) {
      await requestVideoFrame({ videoFile: origFile, frameNum: origFrame });
    }
    return 'Could not render any finishes — check that the video files cover the finish times.';
  }

  const height = renders[0].canvas.height;
  const sidebar = buildSidebar(finishers, crewByBow, height, logo);
  const slicesWidth = renders.reduce((s, r) => s + r.width, 0);
  const meanSliceWidth = slicesWidth / renders.length;
  const gapWidth = Math.round(meanSliceWidth * SLICE_GAP_FRACTION);
  const totalGapWidth = gapWidth * renders.length;
  const totalWidth = sidebar.width + slicesWidth + totalGapWidth;

  const composite = document.createElement('canvas');
  composite.width = totalWidth;
  composite.height = height;
  const cctx = composite.getContext('2d');
  if (!cctx) return 'Failed to allocate composite canvas.';

  cctx.fillStyle = 'black';
  cctx.fillRect(0, 0, totalWidth, height);

  cctx.drawImage(sidebar, 0, 0);
  let xOff = sidebar.width;
  for (const r of renders) {
    xOff += gapWidth;
    cctx.drawImage(r.canvas, xOff, 0);
    xOff += r.width;
  }

  downloadCanvasImage(composite, `finish-event-${event}.png`);

  if (origFile) {
    setSelectedIndex(origIndex);
    setVideoFile(origFile);
    await requestVideoFrame({ videoFile: origFile, frameNum: origFrame });
  }
  return '';
};
