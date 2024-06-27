import { useEffect } from 'react';
import { UseDatum } from 'react-usedatum';
import { AppImage } from 'renderer/shared/AppTypes';

declare global {
  interface Window {
    cv: any;
  }
}

interface Mat {
  rows: number;
  cols: number;
  data: any;
  floatPtr: (y: number, x: number) => number[];
  delete: () => void;
}
const [useIsCvLoaded, setIsCvLoaded, getIsCvLoaded] = UseDatum(false);
export const LoadOpenCV: React.FC = () => {
  useEffect(() => {
    const loadOpenCv = () => {
      const script = document.createElement('script');
      script.src = 'opencv.js'; // Adjust the path based on your setup
      script.async = true;
      script.onload = () => {
        window.cv.onRuntimeInitialized = () => {
          console.log('OpenCV.js is ready');
          setIsCvLoaded(true);
        };
      };
      document.body.appendChild(script);
    };

    loadOpenCv();
  }, []);
  return <></>;
};

interface ImageMotion {
  x: number;
  y: number;
}

/**
 * Finds the first peak in an array starting from the right or left based on dir argument.
 * A peak is defined as an element that is greater than the next four elements to be checked.
 *
 * @param {number[]} arr - The array of numbers to search through.
 * @returns {number | null} - The first peak found, or null if no peak is found.
 */
const findFirstPeak = (arr: number[], dir: number): number | null => {
  if (arr.length < 4) {
    return null; // Not enough elements to form a peak
  }

  if (dir > 0) {
    for (let i = arr.length; i >= 3; i--) {
      if (
        arr[i] > arr[i - 1] &&
        arr[i] > arr[i - 2] &&
        arr[i] > arr[i - 3] &&
        arr[i] > arr[i - 4]
      ) {
        return i;
      }
    }
  } else {
    for (let i = 0; i < arr.length - 3; i++) {
      if (
        arr[i] > arr[i + 1] &&
        arr[i] > arr[i + 2] &&
        arr[i] > arr[i + 3] &&
        arr[i] > arr[i + 4]
      ) {
        return i;
      }
    }
  }

  return null; // No peak found
};

const calculateMotion = (flow: Mat) => {
  let sumX = 0.0;
  let sumY = 0.0;
  const histx: number[] = new Array(2000).fill(0);
  const histy: number[] = new Array(2000).fill(0);

  for (let y = 0; y < flow.rows; y++) {
    for (let x = 0; x < flow.cols; x++) {
      const flowAtXY = flow.floatPtr(y, x);
      const fx = Math.min(99, Math.max(-99, flowAtXY[0]));
      sumX += fx;
      histx[Math.round(10 * fx) + 1000]++;

      const fy = Math.min(99, Math.max(-99, flowAtXY[1]));
      sumY += fy;
      histy[Math.round(10 * fy) + 1000]++;
    }
  }

  const peakX = findFirstPeak(histx, sumX > 0 ? 1 : -1);
  const maxX = peakX ? peakX : 0;
  const peakY = findFirstPeak(histy, sumY > 0 ? 1 : -1);
  const maxY = peakY ? peakY : 0;
  return { x: (maxX - 1000) / 10, y: (maxY - 1000) / 10 };
};

const applySceneShift = (
  frame: Mat,
  motion: ImageMotion,
  percentage: number
) => {
  const cv = window.cv;
  const M = cv.matFromArray(2, 3, cv.CV_64F, [
    1,
    0,
    motion.x * percentage,
    0,
    1,
    motion.y * percentage,
  ]);
  const shifted = new cv.Mat() as Mat;
  const size = new cv.Size(frame.cols, frame.rows);
  cv.warpAffine(frame, shifted, M, size);
  // shifted.copyTo(frame);
  M.delete();
  // shifted.delete();
  return shifted;
};

const calculateOpticalFlowBetweenFrames = (frame1: Mat, frame2: Mat): Mat => {
  const cv = window.cv;
  const frame1Gray = new cv.Mat();
  const frame2Gray = new cv.Mat();
  cv.cvtColor(frame1, frame1Gray, cv.COLOR_RGBA2GRAY);
  cv.cvtColor(frame2, frame2Gray, cv.COLOR_RGBA2GRAY);

  const flow = new cv.Mat() as Mat;
  cv.calcOpticalFlowFarneback(
    frame1Gray,
    frame2Gray,
    flow,
    0.5,
    3,
    15,
    3,
    5,
    1.2,
    0
  );

  frame1Gray.delete();
  frame2Gray.delete();
  return flow;
};

export const generateInterpolatedFrame = (
  frameA: AppImage,
  frameB: AppImage,
  pctAtoB: number
) => {
  if (!getIsCvLoaded()) {
    return frameA;
  }
  const cv = window.cv;
  const matA = new cv.Mat(frameA.height, frameB.width, cv.CV_8UC4) as Mat;
  const matB = new cv.Mat(frameB.height, frameB.width, cv.CV_8UC4) as Mat;
  matA.data.set(frameA.data);
  matB.data.set(frameB.data);
  const flow = calculateOpticalFlowBetweenFrames(matA, matB);
  let motion = calculateMotion(flow);
  const interpolatedFrame = applySceneShift(matA, motion, pctAtoB);
  flow.delete;

  const newFrame = { ...frameA };
  newFrame.data = new Uint8Array(interpolatedFrame.data);
  newFrame.timestamp =
    frameA.timestamp + (frameB.timestamp - frameA.timestamp) * pctAtoB;
  newFrame.frameNum =
    frameA.frameNum + (frameB.frameNum - frameA.frameNum) * pctAtoB;
  frameA.motion = {
    ...motion,
    dt: frameB.timestamp - frameA.timestamp,
    valid: true,
  };
  return newFrame;
};
