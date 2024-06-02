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
import icon from '../assets/icons/crewtimer.svg';
import {
  useMobileConfig,
  useMobileID,
  useFirebaseConnected,
} from './util/UseSettings';
import { getConnectionProps } from './util/Util';
import { setToast } from './Toast';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import VisibilityIcon from '@mui/icons-material/Visibility';
import HistoryToggleOffIcon from '@mui/icons-material/HistoryToggleOff';
import InfoIcon from '@mui/icons-material/Info';

const AboutText = `CrewTimer Video Review ${window.platform.appVersion}`;

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

  const open = Boolean(anchorEl);

  const handleMenu = (
    event: React.MouseEvent<HTMLButtonElement, MouseEvent>
  ) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
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
