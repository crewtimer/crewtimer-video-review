import { Box, Typography, Button, TextField } from '@mui/material';
import Stack from '@mui/material/Stack';
import React, { useCallback, useEffect, useMemo } from 'react';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import { milliToString, timeToMilli } from 'renderer/util/Util';
import { UseDatum } from 'react-usedatum';
import { convertTimestampToString } from '../shared/Util';
import { setDialogConfig } from '../util/ConfirmDialog';
import { ProgressBarComponent } from '../util/ProgressBarComponent';
import { setProgressBar, useDay, useWaypoint } from '../util/UseSettings';
import { useClickerData } from './UseClickerData';
import { requestVideoFrame } from './RequestVideoFrame';
import { moveToFileIndex } from './VideoUtils';
import { UseStoredDatum } from '../store/UseElectronDatum';
import { TimeObject } from './VideoTypes';
import { useFileStatusList } from './VideoFileStatus';
import { parseTimeToSeconds } from '../util/StringUtils';

const { openDirDialog } = window.Util;

const [useArchiveFolder] = UseStoredDatum('ArchiveFolder', '/tmp');
const [useArchivePrefix] = UseStoredDatum('ArchivePrefix', 'CT');
const [useArchiveTimeOffset] = UseStoredDatum('ArchiveTimeOffset', 0);
const [, setArchiveCancel, getArchiveCancel] = UseDatum(false);
interface FolderInputProps {}
const ImageArchiveConfig: React.FC<FolderInputProps> = () => {
  const [folderPath, setFolderPath] = useArchiveFolder();
  const [prefix, setPrefix] = useArchivePrefix();
  const [timeOffset, setTimeOffset] = useArchiveTimeOffset();

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

  return (
    <Box
      display="flex"
      flexDirection="column"
      gap={2}
      p={2}
      alignItems="center"
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
  let [prefix] = useArchivePrefix();
  let [day] = useDay();
  const [timeOffset] = useArchiveTimeOffset();
  const scoredLapdata = useClickerData(scoredWaypoint) as TimeObject[];
  if (day) {
    day = `${day}-`;
  }
  prefix = prefix || 'CT';
  const isWindows = folderPath.includes('\\');
  const separator = isWindows ? '\\' : '/';

  const saveImageArchive = useCallback(async () => {
    setArchiveCancel(false);
    for (let i = 0; i < dirList.length; i += 1) {
      if (getArchiveCancel()) {
        break;
      }
      setProgressBar((i / dirList.length) * 100);
      // eslint-disable-next-line no-await-in-loop
      await moveToFileIndex(i, 0);
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

      const filteredScoredTimes = scoredLapdata.filter((timeObj) => {
        const timeSeconds = parseTimeToSeconds(timeObj.Time) + timeOffset;
        const valid = timeSeconds >= startSeconds && timeSeconds <= endSeconds;
        return valid;
      });
      for (let j = 0; j < filteredScoredTimes.length; j += 1) {
        if (getArchiveCancel()) {
          break;
        }
        const timeObj = filteredScoredTimes[j];
        const filename =
          `${prefix}-${day}T${timeObj.Time}-B${timeObj.Bow}-E${timeObj.EventNum.replaceAll(' ', '_')}.png`.replaceAll(
            ':',
            '',
          );
        const saveAs = `${folderPath}${separator}${filename}`;
        const toTimestamp = milliToString(
          timeToMilli(timeObj.Time) + timeOffset * 1000,
        );

        console.log(`Saving image at ${toTimestamp} to ${saveAs}`);
        // eslint-disable-next-line no-await-in-loop
        await requestVideoFrame({
          videoFile: image.filename,
          frameNum: 1,
          toTimestamp,
          blend: false,
          saveAs,
        }).catch((reason) =>
          console.log(
            `Error saving: ${reason instanceof Error ? reason.message : String(reason)}`,
          ),
        );
        setProgressBar(
          ((i + j / filteredScoredTimes.length) / dirList.length) * 100,
        );
      }
    }
    setProgressBar(100);
  }, [day, dirList, folderPath, prefix, scoredLapdata, timeOffset, separator]);

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
