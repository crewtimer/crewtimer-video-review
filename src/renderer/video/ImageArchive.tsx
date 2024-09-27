import { Box, Typography, Button, TextField } from '@mui/material';
import Stack from '@mui/material/Stack';
import { useEffect } from 'react';
import { convertTimestampToString } from '../shared/Util';
import { setDialogConfig } from '../util/ConfirmDialog';
import ProgressBarComponent from '../util/ProgressBarComponent';
import { setProgressBar, useDay, useWaypoint } from '../util/UseSettings';
import { TimeObject } from './TimeRangeIcons';
import { useClickerData } from './UseClickerData';
import { requestVideoFrame, useFileStatusList } from './VideoFileUtils';
import { useTimezoneOffset } from './VideoSettings';
import { moveToFileIndex, parseTimeToSeconds } from './VideoUtils';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import { UseStoredDatum } from '../store/UseElectronDatum';
const { openDirDialog } = window.Util;

const [useArchiveFolder] = UseStoredDatum('ArchiveFolder', '/tmp');
const [useArchivePrefix] = UseStoredDatum('ArchivePrefix', 'CT');
interface FolderInputProps {}
const ImageArchiveConfig: React.FC<FolderInputProps> = ({}) => {
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
      })
      .catch();
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
export const ImageArchive = () => {
  const [dirList] = useFileStatusList();
  const [scoredWaypoint] = useWaypoint();
  const [timezoneOffset] = useTimezoneOffset();
  const [folderPath] = useArchiveFolder();
  let [prefix] = useArchivePrefix();
  let [day] = useDay();
  const scoredLapdata = useClickerData(scoredWaypoint) as TimeObject[];
  if (day) {
    day = `${day}-`;
  }
  prefix = prefix || 'CT';

  const saveImageArchive = async () => {
    for (let i = 0; i < dirList.length; i++) {
      setProgressBar((i / dirList.length) * 100);
      await moveToFileIndex(i, 0, false);
      const image = dirList[i];
      const startTime = convertTimestampToString(
        image.startTime / 1000,
        timezoneOffset
      );
      const endTime = convertTimestampToString(
        image.endTime / 1000,
        timezoneOffset
      );
      const startSeconds = parseTimeToSeconds(startTime);
      const endSeconds = parseTimeToSeconds(endTime);

      const filteredScoredTimes = scoredLapdata.filter((timeObj) => {
        const timeSeconds = parseTimeToSeconds(timeObj.Time);
        const valid = timeSeconds >= startSeconds && timeSeconds <= endSeconds;
        return valid;
      });
      for (let j = 0; j < filteredScoredTimes.length; j++) {
        const timeObj = filteredScoredTimes[j];
        const filename = `${folderPath}/${prefix}-${day}T${timeObj.Time}-B${
          timeObj.Bow
        }-E${timeObj.EventNum.replaceAll(' ', '_')}.png`.replaceAll(':', '');
        await requestVideoFrame({
          videoFile: image.filename,
          frameNum: 1,
          fromClick: false,
          toTimestamp: timeObj.Time,
          blend: false,
          saveAs: filename,
        });
        setProgressBar(
          ((i + j / filteredScoredTimes.length) / dirList.length) * 100
        );
      }
    }
    setProgressBar(100);
  };

  useEffect(() => {
    saveImageArchive();
  }, []);
  return (
    <Stack>
      <ProgressBarComponent />
    </Stack>
  );
};
