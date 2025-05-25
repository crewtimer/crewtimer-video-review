import { Box, Typography, Button, TextField } from '@mui/material';
import Stack from '@mui/material/Stack';
import React, { useCallback, useEffect } from 'react';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
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
interface FolderInputProps {}
const ImageArchiveConfig: React.FC<FolderInputProps> = () => {
  const [folderPath, setFolderPath] = useArchiveFolder();
  const [prefix, setPrefix] = useArchivePrefix();

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
  const scoredLapdata = useClickerData(scoredWaypoint) as TimeObject[];
  if (day) {
    day = `${day}-`;
  }
  prefix = prefix || 'CT';

  const saveImageArchive = useCallback(async () => {
    for (let i = 0; i < dirList.length; i += 1) {
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
        const timeSeconds = parseTimeToSeconds(timeObj.Time);
        const valid = timeSeconds >= startSeconds && timeSeconds <= endSeconds;
        return valid;
      });
      for (let j = 0; j < filteredScoredTimes.length; j += 1) {
        const timeObj = filteredScoredTimes[j];
        const filename = `${folderPath}/${prefix}-${day}T${timeObj.Time}-B${
          timeObj.Bow
        }-E${timeObj.EventNum.replaceAll(' ', '_')}.png`.replaceAll(':', '');
        // eslint-disable-next-line no-await-in-loop
        await requestVideoFrame({
          videoFile: image.filename,
          frameNum: 1,
          toTimestamp: timeObj.Time,
          blend: false,
          saveAs: filename,
        });
        setProgressBar(
          ((i + j / filteredScoredTimes.length) / dirList.length) * 100,
        );
      }
    }
    setProgressBar(100);
  }, [day, dirList, folderPath, prefix, scoredLapdata]);

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
        showCancel: false,
      });
    },
  });
};
