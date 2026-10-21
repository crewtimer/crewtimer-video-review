import React, { useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Tooltip,
} from '@mui/material';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import { parseTypedTime } from 'renderer/util/StringUtils';
import { showErrorDialog } from 'renderer/util/ErrorDialog';
import { findSeekTarget, seekToTimestamp } from './RequestVideoFrame';
import { resetVideoZoom } from './VideoSettings';

/** A button that opens a dialog to jump the video to a typed time of day. */
const GoToTime: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  const close = () => {
    setOpen(false);
    setError('');
  };

  const goToTime = () => {
    const time = parseTypedTime(text);
    if (!time) {
      setError('Enter a time such as 14:23:22.123 or 142322.123');
      return;
    }
    if (!findSeekTarget(time)) {
      setError(`No video was recorded at ${time}`);
      return;
    }
    close();
    // Reset zoom before seeking. A zoom reset re-requests the frame currently
    // displayed, which would otherwise supersede a seek into another file.
    resetVideoZoom()
      .then(() => seekToTimestamp({ time }))
      .catch(showErrorDialog);
  };

  return (
    <>
      <Tooltip title="Go to Time" placement="top">
        <Button
          variant="contained"
          onClick={() => setOpen(true)}
          size="small"
          sx={{
            height: 24,
            m: 0,
            minWidth: 24,
            background: '#19857b',
            marginLeft: '0.5em',
          }}
        >
          <AccessTimeIcon fontSize="small" />
        </Button>
      </Tooltip>
      <Dialog open={open} onClose={close}>
        <DialogTitle>Go to Time</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            margin="dense"
            label="Time"
            placeholder="14:23:22.123 or 142322.123"
            value={text}
            error={!!error}
            helperText={error || ' '}
            onChange={(event) => {
              setText(event.target.value);
              setError('');
            }}
            onFocus={(event) => event.target.select()}
            onKeyDown={(event) => {
              // Keep typed keys such as '.' and space from reaching the video
              // and recorder shortcuts.
              event.stopPropagation();
              if (event.key === 'Enter') {
                event.preventDefault();
                goToTime();
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>Cancel</Button>
          <Button variant="contained" onClick={goToTime}>
            Go
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default GoToTime;
