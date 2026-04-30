import React, { useState } from 'react';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import BurstMode from '@mui/icons-material/BurstMode';
import { useVideoEvent } from './VideoSettings';
import { generateFinishPhoto } from './FinishPhoto';
import { showErrorDialog } from 'renderer/util/ErrorDialog';

const FinishPhotoButton: React.FC = () => {
  const [event] = useVideoEvent();
  const [running, setRunning] = useState(false);

  const onClick = async () => {
    if (running || !event) return;
    setRunning(true);
    try {
      const message = await generateFinishPhoto(event);
      if (message) showErrorDialog(message);
    } catch (e) {
      showErrorDialog(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const disabled = running || !event;
  const tip = !event
    ? 'Select an event first'
    : running
      ? 'Generating finish photo…'
      : `Generate finish photo for event ${event}`;

  return (
    <Tooltip title={tip}>
      <span>
        <IconButton
          color="primary"
          aria-label="generate finish photo"
          component="span"
          disabled={disabled}
          onClick={onClick}
        >
          <BurstMode />
        </IconButton>
      </span>
    </Tooltip>
  );
};

export default FinishPhotoButton;
