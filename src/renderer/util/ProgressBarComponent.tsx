import React from 'react';
import { Box, Typography, LinearProgress } from '@mui/material';
import { useProgressBar } from './UseSettings';

/**
 * ProgressBarComponent is a React component that displays a progress bar
 * using Material-UI. The progress gradually increases from 0 to 100.
 *
 * @component
 * @example
 * return (
 *   <ProgressBarComponent />
 * )
 */
export const ProgressBarComponent: React.FC = () => {
  const [progress] = useProgressBar();

  return (
    <Box sx={{ width: '100%' }}>
      <Typography variant="h6" gutterBottom>
        Progress: {Math.round(progress)}%
      </Typography>
      <LinearProgress variant="determinate" value={progress} />
    </Box>
  );
};
export default ProgressBarComponent;
