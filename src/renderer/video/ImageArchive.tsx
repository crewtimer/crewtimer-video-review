import {
  Box,
  Typography,
  Button,
  TextField,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  SelectChangeEvent,
  Checkbox,
  FormControlLabel,
} from '@mui/material';
import Stack from '@mui/material/Stack';
import React, { useCallback, useEffect, useMemo } from 'react';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import {
  getConnectionProps,
  milliToString,
  timeToMilli,
} from 'renderer/util/Util';
import { UseDatum } from 'react-usedatum';
import { convertTimestampToString } from '../shared/Util';
import { setDialogConfig } from '../util/ConfirmDialog';
import { ProgressBarComponent } from '../util/ProgressBarComponent';
import {
  setProgressBar,
  useDay,
  useMobileID,
  useWaypoint,
} from '../util/UseSettings';
import { useClickerData } from './UseClickerData';
import { requestVideoFrame } from './RequestVideoFrame';
import { getFinishLine, moveToFileIndex } from './VideoUtils';
import { UseStoredDatum } from '../store/UseElectronDatum';
import { TimeObject } from './VideoTypes';
import { useFileStatusList } from './VideoFileStatus';
import { getTravelRightToLeft } from './VideoSettings';
import { parseTimeToSeconds } from '../util/StringUtils';
import type { BowDetection, Rect } from '../shared/AppTypes';

const { openDirDialog } = window.Util;

const [useArchiveFolder] = UseStoredDatum('ArchiveFolder', '/tmp');
const [useArchivePrefix] = UseStoredDatum('ArchivePrefix', 'CT');
const [useArchiveTimeOffset] = UseStoredDatum('ArchiveTimeOffset', 0);
const [useArchiveRace, setArchiveRace] = UseDatum('');
const [useArchiveYoloLabels, setArchiveYoloLabels] = UseDatum(true);
const [useArchivePruneSide, setArchivePruneSide] = UseDatum('none');
const [useArchivePrunePercentage, setArchivePrunePercentage] = UseDatum(0);
const [, setArchiveCancel, getArchiveCancel] = UseDatum(false);

type ArchiveCardLabel = {
  boatIndex: number;
  boatBox: Rect;
  box: Rect;
  normalizedBox: {
    xCenter: number;
    yCenter: number;
    width: number;
    height: number;
  };
  value: string;
  digits: string;
  detectedDigits: string;
  verified: boolean;
  bowMismatch?: boolean;
  confidence: number;
  prefix: string;
  visibility: string;
  partial: boolean;
  polarity: string;
  legible: boolean;
};

type ArchiveDetectionResult = {
  boatIdentified: boolean;
  bowMatched: boolean;
  bowMismatch: boolean;
};

type ArchiveSummary = {
  exported: number;
  bowMismatch: number;
  boatsIdentified: number;
  bowsMatched: number;
};

const formatDetectionCount = (count: number, total: number) =>
  `${count}/${total} (${total ? ((count / total) * 100).toFixed(2) : '0.00'}%)`;

interface FolderInputProps {}
const ImageArchiveConfig: React.FC<FolderInputProps> = () => {
  const [folderPath, setFolderPath] = useArchiveFolder();
  const [prefix, setPrefix] = useArchivePrefix();
  const [timeOffset, setTimeOffset] = useArchiveTimeOffset();
  const [selectedRace, setSelectedRace] = useArchiveRace();
  const [augmentYoloLabels, setAugmentYoloLabels] = useArchiveYoloLabels();
  const [pruneSide, setPruneSide] = useArchivePruneSide();
  const [prunePercentage, setPrunePercentage] = useArchivePrunePercentage();
  const [scoredWaypoint] = useWaypoint();
  const scoredLapdata = useClickerData(scoredWaypoint) as TimeObject[];
  const races = useMemo(
    () =>
      Array.from(
        new Set(
          scoredLapdata
            .map((timeObj) => timeObj.EventNum)
            .filter((eventNum) => eventNum && eventNum !== '?'),
        ),
      ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [scoredLapdata],
  );

  const chooseDir = () => {
    openDirDialog('Choose Folder', folderPath)
      .then((result) => {
        if (!result.cancelled) {
          if (result.path !== folderPath) {
            setFolderPath(result.path);
          }
        }
        return undefined;
      })
      .catch(() => {});
  };

  // Function to handle prefix input change
  const handlePrefixChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newPrefix = event.target.value;
    setPrefix(newPrefix);
  };

  const handleTimeOffsetChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    let newTimeOffset = Number(event.target.value);
    if (!Number.isNaN(newTimeOffset)) {
      newTimeOffset = Math.max(-10, Math.min(10, newTimeOffset));
      setTimeOffset(newTimeOffset);
    }
  };

  const handleRaceChange = (event: SelectChangeEvent) => {
    setSelectedRace(event.target.value);
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        p: 2,
        alignItems: 'center',
      }}
    >
      <TextField
        label="File Prefix"
        variant="outlined"
        value={prefix}
        onChange={handlePrefixChange}
      />

      <TextField
        label="Time Offset"
        variant="outlined"
        value={timeOffset}
        onChange={handleTimeOffsetChange}
      />

      <FormControl fullWidth>
        <InputLabel id="archive-race-select-label">Race</InputLabel>
        <Select
          labelId="archive-race-select-label"
          label="Race"
          value={races.includes(selectedRace) ? selectedRace : ''}
          onChange={handleRaceChange}
        >
          <MenuItem value="">All races</MenuItem>
          {races.map((race) => (
            <MenuItem key={race} value={race}>
              Race {race}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControlLabel
        control={
          <Checkbox
            checked={augmentYoloLabels}
            onChange={(event) => setAugmentYoloLabels(event.target.checked)}
          />
        }
        label="Augment with yolo labels"
      />

      {augmentYoloLabels && (
        <Stack direction="row" spacing={2} sx={{ width: '100%' }}>
          <FormControl sx={{ flex: 1 }}>
            <InputLabel id="archive-prune-select-label">Prune</InputLabel>
            <Select
              labelId="archive-prune-select-label"
              label="Prune"
              value={pruneSide}
              onChange={(event) => setPruneSide(event.target.value)}
            >
              <MenuItem value="none">None</MenuItem>
              <MenuItem value="top">Top</MenuItem>
              <MenuItem value="bottom">Bottom</MenuItem>
            </Select>
          </FormControl>
          <TextField
            label="Prune %"
            type="number"
            value={prunePercentage}
            disabled={pruneSide === 'none'}
            inputProps={{ min: 0, max: 95, step: 1 }}
            onChange={(event) => {
              const percentage = Number(event.target.value);
              if (!Number.isNaN(percentage)) {
                setPrunePercentage(Math.max(0, Math.min(95, percentage)));
              }
            }}
            sx={{ width: 140 }}
          />
        </Stack>
      )}

      {folderPath && (
        <Typography variant="body1" color="textSecondary">
          Folder: {folderPath}
        </Typography>
      )}
      <Button
        variant="outlined"
        startIcon={<FolderOpenIcon />}
        onClick={chooseDir}
      >
        Select Folder
      </Button>
    </Box>
  );
};

export const ImageArchive = () => {
  const [dirList] = useFileStatusList();
  const [scoredWaypoint] = useWaypoint();
  const [folderPath] = useArchiveFolder();
  const [mobileID] = useMobileID();
  const [prefix] = useArchivePrefix();
  const [day] = useDay();
  const [timeOffset] = useArchiveTimeOffset();
  const [selectedRace] = useArchiveRace();
  const [augmentYoloLabels] = useArchiveYoloLabels();
  const [pruneSide] = useArchivePruneSide();
  const [prunePercentage] = useArchivePrunePercentage();
  const prune = useMemo(
    () =>
      augmentYoloLabels &&
      (pruneSide === 'top' || pruneSide === 'bottom') &&
      prunePercentage > 0
        ? { side: pruneSide, percentage: prunePercentage }
        : undefined,
    [augmentYoloLabels, prunePercentage, pruneSide],
  );
  const scoredLapdata = useClickerData(scoredWaypoint) as TimeObject[];
  const selectedRaceTimes = useMemo(
    () =>
      selectedRace
        ? scoredLapdata.filter((timeObj) => timeObj.EventNum === selectedRace)
        : scoredLapdata,
    [scoredLapdata, selectedRace],
  );
  const dayPrefix = day ? `${day}-` : '';
  const normalizedPrefix = (prefix || 'CT').replace(/-+$/, '') || 'CT';
  const isWindows = folderPath.includes('\\');
  const separator = isWindows ? '\\' : '/';

  const joinPath = useCallback(
    (...parts: string[]) => parts.join(separator),
    [separator],
  );

  const makeBoxMetadata = useCallback(
    (box: Rect) => ({
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    }),
    [],
  );

  const selectFinishLineBoat = useCallback(
    (detections: BowDetection[], imageWidth: number, expectedBow: string) => {
      const finish = getFinishLine();
      const finishX = imageWidth / 2 + (finish.pt1 + finish.pt2) / 2;
      const eligible = detections.filter(
        ({ boatBox }) => boatBox.width > 0 && boatBox.height > 0,
      );
      const matching = eligible.filter(
        ({ text }) => text.trim() === expectedBow.trim(),
      );
      return (matching.length ? matching : eligible).sort((a, b) => {
        const distance = ({ boatBox }: BowDetection) =>
          Math.min(
            Math.abs(boatBox.x - finishX),
            Math.abs(boatBox.x + boatBox.width - finishX),
          );
        return distance(a) - distance(b);
      })[0];
    },
    [],
  );

  const saveTrainingLabels = useCallback(
    async ({
      imagePath,
      outputFolder,
      filename,
      videoFile,
      frameNum,
      expectedBow,
      width,
      height,
    }: {
      imagePath: string;
      outputFolder: string;
      filename: string;
      videoFile: string;
      frameNum: number;
      expectedBow: string;
      width: number;
      height: number;
    }) => {
      const stem = filename.replace(/\.png$/i, '');
      const detectionResult = await window.VideoUtils.detectBow({
        videoFile,
        frameNum,
        prune,
      });
      const detectedBoats = detectionResult.detections.filter(
        ({ boatBox }) => boatBox.width > 0 && boatBox.height > 0,
      );
      const selected = selectFinishLineBoat(detectedBoats, width, expectedBow);
      const selectedBoatIndex = selected ? detectedBoats.indexOf(selected) : -1;
      const detectedBow = selected?.text || '';
      const bowMismatch = detectedBow !== expectedBow;
      const cards: ArchiveCardLabel[] = [];
      const finish = getFinishLine();
      const finishX = width / 2 + (finish.pt1 + finish.pt2) / 2;
      const exportedBoats = detectedBoats.map((detection, boatIndex) => {
        if (boatIndex !== selectedBoatIndex) {
          return detection;
        }
        const right = detection.boatBox.x + detection.boatBox.width;
        const boatBox = getTravelRightToLeft()
          ? { ...detection.boatBox, x: finishX, width: right - finishX }
          : {
              ...detection.boatBox,
              width: finishX - detection.boatBox.x,
            };
        return boatBox.width > 0 ? { ...detection, boatBox } : detection;
      });
      const yoloLabel = exportedBoats
        .map(({ boatBox }) => {
          const normalizedBoat = [
            (boatBox.x + boatBox.width / 2) / width,
            (boatBox.y + boatBox.height / 2) / height,
            boatBox.width / width,
            boatBox.height / height,
          ];
          return `0 ${normalizedBoat.map((value) => value.toFixed(6)).join(' ')}`;
        })
        .join('\n');

      exportedBoats.forEach((detection, boatIndex) => {
        const { boatBox, box } = detection;
        if (box.width <= 0 || box.height <= 0) {
          return;
        }
        const verified = boatIndex === selectedBoatIndex;
        cards.push({
          boatIndex,
          boatBox: makeBoxMetadata(boatBox),
          box: makeBoxMetadata(box),
          normalizedBox: {
            xCenter: (box.x + box.width / 2) / width,
            yCenter: (box.y + box.height / 2) / height,
            width: box.width / width,
            height: box.height / height,
          },
          value: verified ? expectedBow : '',
          digits: verified ? expectedBow : '',
          detectedDigits: detection.text || '',
          verified,
          ...(verified ? { bowMismatch } : {}),
          confidence: detection.confidence,
          prefix: '',
          visibility: 'clear',
          partial: false,
          polarity: 'unknown',
          legible: verified,
        });
      });

      const labelContents = yoloLabel ? `${yoloLabel}\n` : '';

      const labelResult = await window.Util.storeTextFile(
        joinPath(outputFolder, 'labels', `${stem}.txt`),
        labelContents,
      );
      if (labelResult.status !== 'OK') {
        throw new Error(labelResult.error || labelResult.status);
      }
      const sidecarResult = await window.Util.storeJsonFile(
        joinPath(outputFolder, 'card-labels', `${stem}.json`),
        {
          image: filename,
          imagePath,
          width,
          height,
          expectedBow,
          detectedBow,
          bowMismatch,
          selectedBoatIndex,
          detectedBoatCount: detectedBoats.length,
          detectedCardCount: cards.length,
          cards,
        },
      );
      if (sidecarResult.status !== 'OK') {
        throw new Error(sidecarResult.error || sidecarResult.status);
      }
      return {
        boatIdentified: detectedBoats.length > 0,
        bowMatched: Boolean(detectedBow) && !bowMismatch,
        bowMismatch,
      } satisfies ArchiveDetectionResult;
    },
    [joinPath, makeBoxMetadata, prune, selectFinishLineBoat],
  );

  const saveImageArchive = useCallback(async () => {
    setArchiveCancel(false);
    const summary: ArchiveSummary = {
      exported: 0,
      bowMismatch: 0,
      boatsIdentified: 0,
      bowsMatched: 0,
    };
    let exportFolder = folderPath;
    let zipPath = '';
    let archiveName = '';
    if (augmentYoloLabels) {
      const tempResult =
        await window.Util.createTempDirectory('crewtimer-dataset-');
      if (tempResult.status !== 'OK') {
        throw new Error(tempResult.error || tempResult.status);
      }
      exportFolder = tempResult.path;
      const { regattaID } = getConnectionProps(mobileID);
      const safeRegattaId = regattaID || 'Regatta';
      archiveName = [
        'dataset',
        normalizedPrefix,
        safeRegattaId,
        ...(day ? [day] : []),
      ].join('-');
      zipPath = joinPath(folderPath, `${archiveName}.zip`);
      const directories = ['images', 'labels', 'card-labels'];
      for (const directory of directories) {
        // eslint-disable-next-line no-await-in-loop
        const result = await window.Util.mkdir(
          joinPath(exportFolder, directory),
        );
        if (result.error) {
          throw new Error(result.error);
        }
      }
    }
    for (let i = 0; i < dirList.length; i += 1) {
      if (getArchiveCancel()) {
        break;
      }
      setProgressBar((i / dirList.length) * 100);
      const image = dirList[i];
      const startTime = convertTimestampToString(
        image.startTime / 1000,
        image.tzOffset,
      );
      const endTime = convertTimestampToString(
        image.endTime / 1000,
        image.tzOffset,
      );
      const startSeconds = parseTimeToSeconds(startTime);
      const endSeconds = parseTimeToSeconds(endTime);

      const filteredScoredTimes = selectedRaceTimes.filter((timeObj) => {
        const timeSeconds = parseTimeToSeconds(timeObj.Time) + timeOffset;
        const valid = timeSeconds >= startSeconds && timeSeconds <= endSeconds;
        return valid;
      });
      if (filteredScoredTimes.length === 0) {
        // Avoid opening video files that contain no selected timestamps.
        // eslint-disable-next-line no-continue
        continue;
      }
      // Navigate only to video files containing timestamps selected for export.
      // eslint-disable-next-line no-await-in-loop
      await moveToFileIndex(i, 0);
      for (let j = 0; j < filteredScoredTimes.length; j += 1) {
        if (getArchiveCancel()) {
          break;
        }
        const timeObj = filteredScoredTimes[j];
        const filename =
          `${normalizedPrefix}-${dayPrefix}T${timeObj.Time}-B${timeObj.Bow}-E${timeObj.EventNum.replaceAll(' ', '_')}.png`.replaceAll(
            ':',
            '',
          );
        const saveAs = augmentYoloLabels
          ? joinPath(exportFolder, 'images', filename)
          : joinPath(folderPath, filename);
        const toTimestamp = milliToString(
          timeToMilli(timeObj.Time) + timeOffset * 1000,
        );

        console.log(`Saving image at ${toTimestamp} to ${saveAs}`);
        // eslint-disable-next-line no-await-in-loop
        const savedFrame = await requestVideoFrame({
          videoFile: image.filename,
          frameNum: 1,
          toTimestamp,
          blend: false,
          saveAs,
          prune,
        }).catch((reason) =>
          console.log(
            `Error saving: ${reason instanceof Error ? reason.message : String(reason)}`,
          ),
        );
        if (savedFrame) {
          summary.exported += 1;
        }
        if (augmentYoloLabels && savedFrame) {
          // eslint-disable-next-line no-await-in-loop
          const detection = await saveTrainingLabels({
            imagePath: `images/${filename}`,
            outputFolder: exportFolder,
            filename,
            videoFile: image.filename,
            frameNum: savedFrame.frameNum,
            expectedBow: timeObj.Bow,
            width: savedFrame.width,
            height: savedFrame.height,
          }).catch((reason) => {
            console.log(
              `Error saving YOLO labels: ${reason instanceof Error ? reason.message : String(reason)}`,
            );
            return undefined;
          });
          if (detection) {
            summary.boatsIdentified += detection.boatIdentified ? 1 : 0;
            summary.bowsMatched += detection.bowMatched ? 1 : 0;
            summary.bowMismatch += detection.bowMismatch ? 1 : 0;
          }
        }
        setProgressBar(
          ((i + j / filteredScoredTimes.length) / dirList.length) * 100,
        );
      }
    }
    if (augmentYoloLabels) {
      const zipResult = await window.Util.zipDirectory(
        exportFolder,
        zipPath,
        archiveName,
      );
      if (zipResult.status !== 'OK') {
        throw new Error(zipResult.error || zipResult.status);
      }
    }
    setProgressBar(100);
    const cancelled = getArchiveCancel();
    setDialogConfig({
      title: cancelled
        ? 'Image Archive Export Cancelled'
        : 'Image Archive Complete',
      body: (
        <Stack spacing={1}>
          <Typography>Total exported: {summary.exported}</Typography>
          {augmentYoloLabels && (
            <>
              <Typography>Bow mismatches: {summary.bowMismatch}</Typography>
              <Typography>
                Boats identified:{' '}
                {formatDetectionCount(
                  summary.boatsIdentified,
                  summary.exported,
                )}
              </Typography>
              <Typography>
                Bows detected and matched:{' '}
                {formatDetectionCount(summary.bowsMatched, summary.exported)}
              </Typography>
            </>
          )}
        </Stack>
      ),
      button: 'OK',
      showCancel: false,
    });
  }, [
    day,
    dayPrefix,
    augmentYoloLabels,
    dirList,
    folderPath,
    mobileID,
    normalizedPrefix,
    selectedRaceTimes,
    timeOffset,
    joinPath,
    saveTrainingLabels,
    prune,
  ]);

  useEffect(() => {
    saveImageArchive();
  }, [saveImageArchive]);
  return (
    <Stack>
      <ProgressBarComponent />
    </Stack>
  );
};

export const initiateImageArchive = () => {
  setArchiveRace('');
  setArchiveYoloLabels(true);
  setArchivePruneSide('none');
  setArchivePrunePercentage(0);
  const onClose = () => {
    setArchiveCancel(true);
  };
  setDialogConfig({
    title: `Create Image Archive?`,
    message: `Proceed to create Image Archive?`,
    body: <ImageArchiveConfig />,
    button: 'Proceed',
    showCancel: true,
    handleConfirm: () => {
      setProgressBar(0);
      // window.createImageArchive();
      setDialogConfig({
        title: 'Creating Image Archive',
        body: <ImageArchive />,
        button: 'OK',
        showCancel: true,
        onClose,
      });
    },
  });
};
