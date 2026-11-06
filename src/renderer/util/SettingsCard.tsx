import { ReactNode } from 'react';
import { Paper, Stack, SxProps, Theme, Typography } from '@mui/material';

interface SettingsCardProps {
  title: ReactNode;
  /** Shown at the right of the title row, e.g. a status indicator. */
  aside?: ReactNode;
  children: ReactNode;
  sx?: SxProps<Theme>;
}

/**
 * Bordered card for a section of settings. Mirrors crewtimer-recorder's
 * Panel so the companion apps look the same.
 */
const SettingsCard = ({ title, aside, children, sx }: SettingsCardProps) => (
  <Paper
    variant="outlined"
    sx={[
      { p: 2, display: 'flex', flexDirection: 'column', gap: 1 },
      ...(Array.isArray(sx) ? sx : [sx]),
    ]}
  >
    <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
      <Typography component="h2" sx={{ fontSize: 15, fontWeight: 600 }}>
        {title}
      </Typography>
      {aside}
    </Stack>
    {children}
  </Paper>
);

export default SettingsCard;
