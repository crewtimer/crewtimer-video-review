import React, { useState } from 'react';
import makeStyles from '@mui/styles/makeStyles';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import MenuIcon from '@mui/icons-material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Menu from '@mui/material/Menu';
import CloudOutlinedIcon from '@mui/icons-material/CloudOutlined';
import CloudOffOutlinedIcon from '@mui/icons-material/CloudOffOutlined';
import Snackbar from '@mui/material/Snackbar';
import Tooltip from '@mui/material/Tooltip';
// import icon from '../assets/icons/crewtimer-review-white.svg';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import VisibilityIcon from '@mui/icons-material/Visibility';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import HistoryToggleOffIcon from '@mui/icons-material/HistoryToggleOff';
import InfoIcon from '@mui/icons-material/Info';
import { Button, Stack, Link } from '@mui/material';
import { useFirebaseDatum } from './util/UseFirebase';
import { setToast } from './Toast';
import { getConnectionProps } from './util/Util';
import {
  useMobileConfig,
  useMobileID,
  useFirebaseConnected,
  setProgressBar,
} from './util/UseSettings';
import icon from '../assets/icons/crewtimer-review2-white.svg';
import { setDialogConfig } from './util/ConfirmDialog';
import { addSidecarFiles } from './video/VideoFileUtils';
import { ProgressBarComponent } from './util/ProgressBarComponent';
import { initiateImageArchive } from './video/ImageArchive';
import TimezoneSelector from './util/TimezoneSelector';

const AboutText = `CrewTimer Video Review ${window.platform.appVersion}`;

const versionAsNumber = (version: string) => {
  const parts = version.split(/[.-]/);
  return Number(parts[0]) * 100 + Number(parts[1]) * 10 + Number(parts[2]);
};

const { LapStorage } = window;

const useStyles = makeStyles((theme) => ({
  root: {},
  menuButton: {
    marginRight: theme.spacing(2),
  },
  title: {
    flexGrow: 1,
    marginLeft: theme.spacing(2),
  },
}));

export default function Nav() {
  const classes = useStyles();
  const [mc] = useMobileConfig();
  const [mobileID] = useMobileID();
  const [anchorEl, setAnchorEl] = React.useState<Element | null>(null);
  const [firebaseConnected] = useFirebaseConnected();
  const [msgOpen, setMsgOpen] = useState(false);
  const [msg, setMsg] = useState('');
  const [shiftMenu, setShiftMenu] = useState(false);
  const latestVersion =
    useFirebaseDatum<string, string>(
      '/global/config/video-review/latestVersion',
    ) || '0.0.0';
  const latestText =
    useFirebaseDatum<string, string>(
      '/global/config/video-review/latestText',
    ) || '';
  const updateAvailable =
    versionAsNumber(latestVersion) >
    versionAsNumber(window.platform.appVersion);
  // console.log(
  //   `updateAvailable: ${updateAvailable} latestVersion: ${latestVersion} appVersion: ${window.platform.appVersion}`
  // );

  const open = Boolean(anchorEl);

  const handleMenu = (
    event: React.MouseEvent<HTMLButtonElement, MouseEvent>,
  ) => {
    setShiftMenu(event.shiftKey);
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleCreateImageArchive = () => {
    setAnchorEl(null);
    initiateImageArchive();
  };

  const handleAddSidecarFiles = () => {
    setAnchorEl(null);
    setDialogConfig({
      title: `Update Sidecar Files?`,
      message: `Proceed to update Sidecar JSON files?`,
      button: 'Proceed',
      body: <TimezoneSelector />,
      showCancel: true,
      handleConfirm: () => {
        setProgressBar(0);
        addSidecarFiles();
        setDialogConfig({
          title: 'Updating Sidecar Files',
          body: (
            <Stack>
              <ProgressBarComponent />
            </Stack>
          ),
          button: 'OK',
          showCancel: false,
        });
      },
    });
  };

  const handleClearData = () => {
    setAnchorEl(null);
    LapStorage.truncateLapTable();
    setMsgOpen(true);
    setMsg('Local data cleared');
  };
  const onViewResults = () => {
    setAnchorEl(null);
    const connectProps = getConnectionProps(mobileID);
    window.open(connectProps.resulturl, '_blank');
  };

  return (
    <div className={classes.root}>
      <AppBar position="fixed">
        <Toolbar>
          <img width="50px" alt="icon" src={icon} />
          <Typography variant="h6" className={classes.title}>
            {mc?.info?.Title ? mc.info.Title : AboutText}
          </Typography>
          {updateAvailable && (
            <Button
              variant="outlined"
              color="inherit"
              sx={{ marginRight: '1em' }}
              size="small"
              onClick={() =>
                setDialogConfig({
                  title: 'Software Update Available',
                  body: (
                    <Stack>
                      <Typography>
                        Version: {latestVersion}: {latestText}.
                      </Typography>
                      <Link
                        href="https://crewtimer.com/help/downloads"
                        target="_blank"
                      >
                        https://crewtimer.com/help/downloads
                      </Link>
                    </Stack>
                  ),
                  button: 'OK',
                  showCancel: false,
                })
              }
            >
              Update
            </Button>
          )}
          <div>
            <Tooltip
              title={
                firebaseConnected
                  ? 'CrewTimer Cloud Connected'
                  : 'CrewTimer Cloud Disconnected'
              }
            >
              {firebaseConnected ? (
                <CloudOutlinedIcon />
              ) : (
                <CloudOffOutlinedIcon color="error" />
              )}
            </Tooltip>
          </div>
          {
            <div>
              <IconButton
                aria-label="account of current user"
                aria-controls="menu-appbar"
                aria-haspopup="true"
                onClick={handleMenu}
                color="inherit"
                size="large"
              >
                <MenuIcon />
              </IconButton>
              <Menu
                id="menu-appbar"
                anchorEl={anchorEl}
                anchorOrigin={{
                  vertical: 'top',
                  horizontal: 'right',
                }}
                keepMounted
                transformOrigin={{
                  vertical: 'top',
                  horizontal: 'right',
                }}
                open={open}
                onClose={handleClose}
              >
                <MenuItem onClick={onViewResults}>
                  <ListItemIcon>
                    <VisibilityIcon />
                  </ListItemIcon>
                  <ListItemText primary="View Results" />
                </MenuItem>
                <MenuItem onClick={handleClearData}>
                  <ListItemIcon>
                    <HistoryToggleOffIcon />
                  </ListItemIcon>
                  <ListItemText primary="Clear Local History" />
                </MenuItem>
                {shiftMenu && (
                  <MenuItem onClick={handleAddSidecarFiles}>
                    <ListItemIcon>
                      <CreateNewFolderIcon />
                    </ListItemIcon>
                    <ListItemText primary="Create/Update Sidecar Files" />
                  </MenuItem>
                )}

                {shiftMenu && (
                  <MenuItem onClick={handleCreateImageArchive}>
                    <ListItemIcon>
                      <CreateNewFolderIcon />
                    </ListItemIcon>
                    <ListItemText primary="Create Image Archive" />
                  </MenuItem>
                )}

                {/* <MenuItem
                  onClick={() => {
                    handleClose();
                    let newDebugLevel = debugLevel + 1;
                    if (newDebugLevel > 4) {
                      setUserMessages([]);
                      newDebugLevel = 0;
                    }
                    setDebugLevel(newDebugLevel);
                    setToast({
                      severity: 'info',
                      msg: `Debug level ${newDebugLevel}`,
                    });
                  }}
                >
                  <ListItemIcon>
                    <DebugIcon />
                  </ListItemIcon>
                  <ListItemText primary="Toggle Debug" />
                </MenuItem> */}
                <MenuItem
                  onClick={() => {
                    handleClose();
                    setToast({ severity: 'info', msg: AboutText });
                  }}
                >
                  <ListItemIcon>
                    <InfoIcon />
                  </ListItemIcon>
                  <ListItemText primary="About" />
                </MenuItem>
              </Menu>
              <Snackbar
                anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
                open={msgOpen}
                onClose={() => setMsgOpen(false)}
                autoHideDuration={4000}
                ContentProps={{
                  'aria-describedby': 'message-id',
                }}
                message={<span id="message-id">{msg}</span>}
              />
            </div>
          }
        </Toolbar>
      </AppBar>
      {/* Add space for 'fixed' Toolbar height */}
      <Toolbar />
    </div>
  );
}
