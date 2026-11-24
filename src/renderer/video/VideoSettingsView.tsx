import React from 'react';
import {
  Box,
  Button,
  Checkbox,
  Container,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  SelectChangeEvent,
  Stack,
  SxProps,
  TextField,
  Theme,
  Tooltip,
  Typography,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Settings';
import makeStyles from '@mui/styles/makeStyles';
import { setToast } from 'renderer/Toast';
import { setDialogConfig } from '../util/ConfirmDialog';
import {
  DEFAULT_GUIDE_COLOR,
  GUIDE_COLOR_OPTIONS,
  CourseArea,
  getCourseArea,
  getVideoFile,
  useAnalyzeTimes,
  useAutoFileSplitEnable,
  useJumpToNewHints,
  useAutoNextTimestamp,
  useMouseWheelInverted,
  useTravelRightToLeft,
  useVideoSettings,
  useGuideHighlight,
} from './VideoSettings';
import HyperZoomSelector from '../util/HyperZoomSelector';
import SettingsCard from '../util/SettingsCard';
import { saveVideoSidecar, saveVideoSidecarTravelDirection } from './Sidecar';
import { getFileStatusList } from './VideoFileStatus';
import {
  BowCardLength,
  useZoomToTimingGuide,
  useBowCardLength,
  useBowOcrModel,
  useFinishPhotoMaxBoats,
  useLabelBoats,
  useLabelNumbers,
  useLapImageStatus,
  useUploadLapImages,
} from '../util/UseSettings';

declare module '@mui/styles/defaultTheme' {
  interface DefaultTheme extends Theme {}
}
const useStyles = makeStyles(() => ({
  // The card already spaces its items; no extra margin here.
  settings: {},
}));

export const VideoSettingsDialog = () => {
  const classes = useStyles();
  const [videoSettings, setVideoSettings] = useVideoSettings();
  const [wheelInverted, setWheelInverted] = useMouseWheelInverted();
  const [autoFileSplit, setAutoFileSplit] = useAutoFileSplitEnable();
  const [jumpToNewHints, setJumpToNewHints] = useJumpToNewHints();
  const [rightToLeft, setRightToLeft] = useTravelRightToLeft();
  const [autoNextTimestamp, setAutoNextTimestamp] = useAutoNextTimestamp();
  const [analyzeTimes, setAnalyzeTimes] = useAnalyzeTimes();
  const [labelBoats, setLabelBoats] = useLabelBoats();
  const [labelNumbers, setLabelNumbers] = useLabelNumbers();
  const [zoomToTimingGuide, setZoomToTimingGuide] = useZoomToTimingGuide();
  const [guideHighlight, setGuideHighlight] = useGuideHighlight();
  const [bowOcrModel] = useBowOcrModel();
  const [bowCardLength, setBowCardLength] = useBowCardLength();
  const [uploadLapImages, setUploadLapImages] = useUploadLapImages();
  const [lapImageStatus] = useLapImageStatus();
  const [finishPhotoMaxBoats, setFinishPhotoMaxBoats] =
    useFinishPhotoMaxBoats();

  // Handler to update the wheelFactor state
  // const handleSliderChange = (_event: Event, newValue: number | number[]) => {
  //   setWheelFactor(newValue as number);
  // };

  // Shown as entered so typing one edge past the other does not swap them;
  // getCourseArea orders the edges wherever they are used.
  const courseArea: CourseArea = {
    ...getCourseArea(),
    ...videoSettings.courseArea,
  };
  const updateCourseArea = (change: Partial<CourseArea>) => {
    const clamp = (value: number) => Math.max(0, Math.min(1, value || 0));
    const next = { ...courseArea, ...change };
    setVideoSettings(
      {
        ...videoSettings,
        courseArea: {
          enabled: next.enabled,
          top: clamp(next.top),
          bottom: clamp(next.bottom),
        },
      },
      true,
    );
    saveVideoSidecar().catch(() => {});
  };

  const resetFinishGuide = () => {
    const newSetting = { ...videoSettings };
    const finishGuide = newSetting.guides.find((g) => g.label === 'Finish');
    if (finishGuide) {
      finishGuide.pt1 = 0;
      finishGuide.pt2 = 0;
      setVideoSettings(newSetting, true);
      saveVideoSidecar();
      setToast({
        severity: 'info',
        msg: `Finish guide set to center`,
      });
    }
  };

  const resetFinishGuideToRecording = () => {
    const videoFile = getVideoFile();
    const fileStatus = getFileStatusList().find((f) => {
      return f.filename === videoFile;
    });
    const newSetting = { ...videoSettings };
    const finishGuide = newSetting.guides.find((g) => g.label === 'Finish');
    if (finishGuide && fileStatus?.sidecar?.guide) {
      finishGuide.pt1 = fileStatus.sidecar.guide.pt1;
      finishGuide.pt2 = fileStatus.sidecar.guide.pt2;
      setVideoSettings(newSetting, true);
      saveVideoSidecar();
      setToast({
        severity: 'info',
        msg: `Finish guide set to recording default`,
      });
    }
  };

  return (
    <Container
      maxWidth="xl"
      // Tighter checkbox rows than MUI's 9px padding.
      sx={{ '& .MuiCheckbox-root': { py: '5px' } }}
      style={{
        flexGrow: 1,
        display: 'flex',
        flexFlow: 'column',
        flex: 1,
        paddingBottom: '2em',
        paddingTop: '1em',
      }}
    >
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6 }}>
          <SettingsCard title="Course Configuration" sx={{ height: '100%' }}>
            <Box className={classes.settings}>
              <Tooltip
                title="Direction of travel when crossing the finish line"
                placement="right"
                disableFocusListener
              >
                <FormControl
                  sx={{
                    marginTop: '0.5em',
                    marginBottom: '0.5em',
                    minWidth: 160,
                  }}
                  margin="dense"
                  size="small"
                >
                  <InputLabel id="travel-direction-label">
                    Travel Direction
                  </InputLabel>
                  <Select
                    labelId="travel-direction-label"
                    value={rightToLeft ? 1 : 0}
                    label="Travel Direction"
                    onChange={(event: SelectChangeEvent<number | string>) => {
                      const rtl = (event.target.value as number) === 1;
                      setRightToLeft(rtl);
                      // Kept with the video, like its guides.
                      saveVideoSidecarTravelDirection(rtl).catch(() => {});
                    }}
                  >
                    <MenuItem value={0}>Left to Right</MenuItem>
                    <MenuItem value={1}>Right to Left</MenuItem>
                  </Select>
                </FormControl>
              </Tooltip>
            </Box>
            <Box className={classes.settings}>
              <Tooltip
                title="Lane position in relation to the lane guides"
                placement="right"
                disableFocusListener
              >
                <FormControl
                  sx={{
                    marginTop: '0.5em',
                    marginBottom: '0.5em',
                    minWidth: 160,
                  }}
                  margin="dense"
                  size="small"
                >
                  <InputLabel id="lane-position-label">
                    Lane Position
                  </InputLabel>
                  <Select
                    labelId="lane-position-label"
                    value={videoSettings.laneBelowGuide ? 1 : 0}
                    label="Lane Position"
                    onChange={(event: SelectChangeEvent<number | string>) => {
                      setVideoSettings(
                        {
                          ...videoSettings,
                          laneBelowGuide: (event.target.value as number) === 1,
                        },
                        true,
                      );
                      saveVideoSidecar();
                    }}
                  >
                    <MenuItem value={0}>Lane Above Guide</MenuItem>
                    <MenuItem value={1}>Lane Below Guide</MenuItem>
                  </Select>
                </FormControl>
              </Tooltip>
            </Box>
            <Box className={classes.settings}>
              <Tooltip
                title="Color recorded times by how closely they match the timing hint: green < 700ms, yellow < 1200ms, red >= 1200ms"
                placement="right"
              >
                <FormControlLabel
                  labelPlacement="end"
                  label="Colorize scored times"
                  control={
                    <Checkbox
                      size="small"
                      checked={analyzeTimes}
                      onChange={() => setAnalyzeTimes(!analyzeTimes)}
                    />
                  }
                />
              </Tooltip>
            </Box>
            <Box className={classes.settings}>
              <Tooltip
                title="Upload an image of each recorded time to CrewTimer.  Requires the regatta admin pin."
                placement="right"
              >
                <FormControlLabel
                  labelPlacement="end"
                  label="Upload scored result photos"
                  control={
                    <Checkbox
                      size="small"
                      checked={uploadLapImages}
                      onChange={() => setUploadLapImages(!uploadLapImages)}
                    />
                  }
                />
              </Tooltip>
              {uploadLapImages &&
                (lapImageStatus.pending > 0 || lapImageStatus.error) && (
                  <Typography variant="caption" sx={{ display: 'block' }}>
                    {`${lapImageStatus.pending} pending`}
                    {lapImageStatus.error ? ` — ${lapImageStatus.error}` : ''}
                  </Typography>
                )}
            </Box>
            <Box className={classes.settings}>
              <Tooltip
                title="Most boats included in a generated finish photo.  When an event has more finishers, the photo starts at the selected bow."
                placement="right"
                disableFocusListener
              >
                <FormControl
                  sx={{
                    marginTop: '0.5em',
                    marginBottom: '0.5em',
                    minWidth: 160,
                  }}
                  margin="dense"
                  size="small"
                >
                  <InputLabel id="finish-photo-max-boats-label">
                    Finish Photo Boats
                  </InputLabel>
                  <Select
                    labelId="finish-photo-max-boats-label"
                    value={finishPhotoMaxBoats}
                    label="Finish Photo Boats"
                    onChange={(event: SelectChangeEvent<number>) =>
                      setFinishPhotoMaxBoats(Number(event.target.value))
                    }
                  >
                    {[1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20].map((n) => (
                      <MenuItem key={n} value={n}>
                        {n}
                      </MenuItem>
                    ))}
                    <MenuItem value={0}>All</MenuItem>
                  </Select>
                </FormControl>
              </Tooltip>
            </Box>
          </SettingsCard>
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <SettingsCard title="Interface Settings" sx={{ height: '100%' }}>
            <Box className={classes.settings}>
              <Tooltip title="Invert wheel direction" placement="right">
                <FormControlLabel
                  labelPlacement="end"
                  label="Invert wheel direction"
                  control={
                    <Checkbox
                      size="small"
                      checked={wheelInverted}
                      onChange={() => setWheelInverted(!wheelInverted)}
                    />
                  }
                />
              </Tooltip>
            </Box>
            <Box className={classes.settings}>
              <Tooltip
                title="After recording a time, automatically select the next available timestamp"
                placement="right"
              >
                <FormControlLabel
                  labelPlacement="end"
                  label="Automatic next timestamp"
                  control={
                    <Checkbox
                      size="small"
                      checked={autoNextTimestamp}
                      onChange={() => setAutoNextTimestamp(!autoNextTimestamp)}
                    />
                  }
                />
              </Tooltip>
            </Box>
            <Box className={classes.settings}>
              <Tooltip
                title="Ask the recorder to split its file when a timing hint arrives after the last file. Skipped while a CrewTimer Video Recorder at this hint waypoint reports that it splits on the regatta's timing hints itself."
                placement="right"
              >
                <FormControlLabel
                  labelPlacement="end"
                  label="Automatic Recorder File Splitting"
                  control={
                    <Checkbox
                      size="small"
                      checked={autoFileSplit}
                      onChange={() => setAutoFileSplit(!autoFileSplit)}
                    />
                  }
                />
              </Tooltip>
            </Box>
            <Box className={classes.settings}>
              <Tooltip
                title="When new video holds a timing hint not yet scored, jump to it"
                placement="right"
              >
                <FormControlLabel
                  labelPlacement="end"
                  label="Jump to new timing hints"
                  control={
                    <Checkbox
                      size="small"
                      checked={jumpToNewHints}
                      onChange={() => setJumpToNewHints(!jumpToNewHints)}
                    />
                  }
                />
              </Tooltip>
            </Box>
          </SettingsCard>
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <SettingsCard title="AI Assist" sx={{ height: '100%' }}>
            <Box className={classes.settings}>
              <HyperZoomSelector />
            </Box>
            <Box className={classes.settings}>
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                <FormControl size="small" sx={{ minWidth: 120 }}>
                  <InputLabel id="bow-card-length-label">
                    Card Digits
                  </InputLabel>
                  <Select
                    labelId="bow-card-length-label"
                    value={bowCardLength}
                    label="Card Digits"
                    disabled={bowOcrModel === 'alphanumeric'}
                    onChange={(event: SelectChangeEvent<string | number>) =>
                      setBowCardLength(event.target.value as BowCardLength)
                    }
                  >
                    <MenuItem value="auto">Auto</MenuItem>
                    <MenuItem value={1}>1</MenuItem>
                    <MenuItem value={2}>2</MenuItem>
                    <MenuItem value={3}>3</MenuItem>
                  </Select>
                </FormControl>
              </Stack>
            </Box>
            <Box className={classes.settings}>
              <Tooltip
                title="Show detected bow card numbers on the video and use them to fill in the bow number"
                placement="right"
              >
                <FormControlLabel
                  labelPlacement="end"
                  label="Annotate Number Detections"
                  control={
                    <Checkbox
                      size="small"
                      checked={labelNumbers}
                      onChange={(event) =>
                        setLabelNumbers(event.target.checked)
                      }
                    />
                  }
                />
              </Tooltip>
            </Box>
            <Box className={classes.settings}>
              <Tooltip
                title="Show detected boats, bow cards, bow numbers, and confidence on the video"
                placement="right"
              >
                <FormControlLabel
                  labelPlacement="end"
                  label="Annotate Boat Detections"
                  control={
                    <Checkbox
                      size="small"
                      checked={labelBoats}
                      onChange={(event) => setLabelBoats(event.target.checked)}
                    />
                  }
                />
              </Tooltip>
            </Box>
            <Box className={classes.settings}>
              <Tooltip
                title="A single click on the video detects the nearby boat and seeks to its estimated crossing of the timing guide. Jumping to a timing hint also zooms to the crossing. Dragging guides is not affected."
                placement="right"
              >
                <FormControlLabel
                  labelPlacement="end"
                  label="Zoom to Timing Guide on Single Click"
                  control={
                    <Checkbox
                      size="small"
                      checked={zoomToTimingGuide}
                      onChange={(event) =>
                        setZoomToTimingGuide(event.target.checked)
                      }
                    />
                  }
                />
              </Tooltip>
            </Box>
            <Box className={classes.settings}>
              <Tooltip
                title="When zoomed in 2x or more, mark in magenta where the timing guide crosses something unlike the water, such as the bow. Wave glints can also be marked, so judge the shape."
                placement="right"
              >
                <FormControlLabel
                  labelPlacement="end"
                  label="Highlight guide crossing when zooming (experimental)"
                  control={
                    <Checkbox
                      size="small"
                      checked={guideHighlight}
                      onChange={(event) =>
                        setGuideHighlight(event.target.checked)
                      }
                    />
                  }
                />
              </Tooltip>
            </Box>
            <Box className={classes.settings}>
              <Tooltip
                title="Ignore boats outside the dashed course guides, such as crews at the top of the frame on the far side of the water, when finding a boat to zoom to or read a bow number from. Drag the dashed guides on the video to adjust."
                placement="top"
              >
                <Stack
                  direction="row"
                  spacing={1}
                  useFlexGap
                  sx={{
                    marginTop: '0.25em',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    rowGap: 1,
                  }}
                >
                  <FormControlLabel
                    labelPlacement="end"
                    label="Limit Boat Search to Course"
                    control={
                      <Checkbox
                        size="small"
                        checked={courseArea.enabled}
                        onChange={() =>
                          updateCourseArea({ enabled: !courseArea.enabled })
                        }
                      />
                    }
                  />
                  <TextField
                    label="Top %"
                    type="number"
                    size="small"
                    disabled={!courseArea.enabled}
                    value={Math.round(courseArea.top * 100)}
                    onChange={(event) =>
                      updateCourseArea({
                        top: Number(event.target.value) / 100,
                      })
                    }
                    slotProps={{ htmlInput: { min: 0, max: 100, step: 1 } }}
                    sx={{ width: '6em' }}
                  />
                  <TextField
                    label="Bottom %"
                    type="number"
                    size="small"
                    disabled={!courseArea.enabled}
                    value={Math.round(courseArea.bottom * 100)}
                    onChange={(event) =>
                      updateCourseArea({
                        bottom: Number(event.target.value) / 100,
                      })
                    }
                    slotProps={{ htmlInput: { min: 0, max: 100, step: 1 } }}
                    sx={{ width: '6em' }}
                  />
                </Stack>
              </Tooltip>
            </Box>
          </SettingsCard>
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <SettingsCard title="Guides" sx={{ height: '100%' }}>
            <Box className={classes.settings}>
              <Box sx={{ marginBottom: '0.5em' }}>
                <FormControl
                  size="small"
                  margin="dense"
                  sx={{ minWidth: 140, marginTop: '0.5em' }}
                >
                  <InputLabel id="guide-color-label">Guide Color</InputLabel>
                  <Select
                    labelId="guide-color-label"
                    value={videoSettings.guideColor || DEFAULT_GUIDE_COLOR}
                    label="Guide Color"
                    onChange={(event: SelectChangeEvent<string>) => {
                      setVideoSettings(
                        {
                          ...videoSettings,
                          guideColor: event.target.value,
                        },
                        true,
                      );
                    }}
                  >
                    {GUIDE_COLOR_OPTIONS.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
              <Stack
                direction="row"
                spacing={1}
                useFlexGap
                sx={{ flexWrap: 'wrap' }}
              >
                <FormControlLabel
                  labelPlacement="end"
                  label="Timing Guide"
                  control={
                    <Checkbox
                      size="small"
                      checked={videoSettings.guides[0].enabled}
                      onChange={() => {
                        const guides = [...videoSettings.guides];
                        guides[0].enabled = !guides[0].enabled;
                        setVideoSettings({ ...videoSettings, guides }, true);
                        saveVideoSidecar().catch(() => {});
                      }}
                    />
                  }
                />
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => resetFinishGuide()}
                >
                  Set to Center
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => resetFinishGuideToRecording()}
                >
                  Set from Recording
                </Button>
              </Stack>
              <Stack
                direction="row"
                spacing={1}
                useFlexGap
                sx={{
                  marginTop: '0.5em',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                }}
              >
                <FormControlLabel
                  labelPlacement="end"
                  label="Enable Lane Guides"
                  control={
                    <Checkbox
                      size="small"
                      checked={videoSettings.enableLaneGuides}
                      onChange={() => {
                        setVideoSettings(
                          {
                            ...videoSettings,
                            enableLaneGuides: !videoSettings.enableLaneGuides,
                          },
                          true,
                        );
                        saveVideoSidecar().catch(() => {});
                      }}
                    />
                  }
                />
              </Stack>
              <Box>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(
                  (lane) =>
                    videoSettings.guides[lane + 1] && (
                      <FormControlLabel
                        key={lane}
                        labelPlacement="end"
                        label={`Lane ${lane}`}
                        control={
                          <Checkbox
                            size="small"
                            checked={videoSettings.guides[lane + 1].enabled}
                            disabled={!videoSettings.enableLaneGuides}
                            onChange={() => {
                              const guides = [...videoSettings.guides]; // force 'diff'
                              videoSettings.guides[lane + 1].enabled =
                                !videoSettings.guides[lane + 1].enabled;
                              setVideoSettings(
                                { ...videoSettings, guides },
                                true,
                              );
                              saveVideoSidecar().catch(() => {});
                            }}
                          />
                        }
                      />
                    ),
                )}
              </Box>
            </Box>
          </SettingsCard>
        </Grid>
      </Grid>
    </Container>
  );
};

interface VideoSettingsViewProps {
  sx?: SxProps<Theme>;
}

export const showVideoSettings = () => {
  setDialogConfig({
    title: `Video Settings`,
    message: ``,
    body: <VideoSettingsDialog />,
    button: 'Done',
    showCancel: false,
  });
};

const VideoSettingsView: React.FC<VideoSettingsViewProps> = ({ sx }) => {
  return (
    <Box onClick={showVideoSettings} sx={sx}>
      <IconButton onClick={showVideoSettings} color="inherit" size="medium">
        <MenuIcon />
      </IconButton>
      Settings
    </Box>
  );
};

export default VideoSettingsView;
