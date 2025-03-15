import React, { useState, useEffect } from 'react';
import { Box } from '@mui/material';

interface BlinkingProps {
  children: React.ReactNode;
}

const Blinking: React.FC<BlinkingProps> = ({ children }) => {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible((prev) => !prev);
    }, 500); // Toggle visibility every 500ms (twice per second)

    return () => clearInterval(interval);
  }, []);

  return (
    <Box sx={{ visibility: visible ? 'visible' : 'hidden' }}>{children}</Box>
  );
};

export default Blinking;
