import { alpha, createTheme, Theme } from '@mui/material/styles';

export type ThemeMode = 'system' | 'light' | 'dark';
export type PaletteMode = 'light' | 'dark';

/** App-specific surface colors that have no standard MUI palette slot. */
interface AppColors {
  /** Zebra stripes, event chips, inactive file segments */
  subtleBg: string;
  /** Recorded/disabled bow buttons and the inactive half of status bars */
  inactiveBg: string;
  inactiveText: string;
  /** Header background of the event currently being reviewed */
  currentEventBg: string;
  /** Rows and bow buttons with an exception such as DNS */
  exceptionBg: string;
  exceptionSubtleBg: string;
  /** Hatching on video files with no clicks */
  hatch: string;
  /** The video file currently shown, in the file timeline */
  activeSegment: string;
  /** Thin outlines around timeline segments */
  outline: string;
  /** Row separators in the lap list */
  listDivider: string;
  /** Border around the bow grid */
  panelBorder: string;
  /** Matches react-data-grid's own border color */
  gridBorder: string;
  /** Matches the border MUI draws on outlined inputs and buttons */
  inputBorder: string;
  /** Event header rows in the timing list, under white text */
  eventRowBg: string;
}

declare module '@mui/material/styles' {
  interface Palette {
    app: AppColors;
  }
  interface PaletteOptions {
    app?: AppColors;
  }
}

const appColors: Record<PaletteMode, AppColors> = {
  light: {
    subtleBg: '#f0f0f0',
    inactiveBg: '#ddd',
    inactiveText: '#666',
    currentEventBg: '#f6fafb',
    exceptionBg: '#fdd',
    exceptionSubtleBg: '#fdd8',
    hatch: '#ccc',
    activeSegment: '#00ffff',
    outline: '#bbbbbb',
    listDivider: '#e0e0e0',
    panelBorder: 'rgba(0, 0, 0, 0.2)',
    gridBorder: '#ddd',
    inputBorder: 'rgba(0, 0, 0, 0.23)',
    eventRowBg: '#1f5fad',
  },
  dark: {
    subtleBg: '#232a31',
    inactiveBg: '#3a424b',
    inactiveText: '#9aa4ae',
    currentEventBg: '#1b2632',
    exceptionBg: '#5c2b2b',
    exceptionSubtleBg: '#5c2b2bcc',
    hatch: '#4a535d',
    activeSegment: '#7DB4F5', // primary blue
    outline: '#4a535d',
    listDivider: '#2c333b',
    panelBorder: 'rgba(255, 255, 255, 0.2)',
    gridBorder: '#444',
    inputBorder: 'rgba(255, 255, 255, 0.23)',
    eventRowBg: '#1f5fad',
  },
};

/**
 * Shared with crewtimer-recorder (src/renderer/App.tsx) so the two apps look
 * like one product. Keep the two in sync when changing either.
 */
const palettes = {
  light: {
    mode: 'light',
    primary: { main: '#1F5FAD' },
    error: { main: '#C9252C' },
    warning: { main: '#9A5B00' },
    success: { main: '#1A7F4B' },
    divider: '#D5DCE3',
    background: { default: '#EEF1F4', paper: '#FFFFFF' },
  },
  dark: {
    mode: 'dark',
    primary: { main: '#7DB4F5' },
    error: { main: '#FF6B70' },
    warning: { main: '#F5A524' },
    success: { main: '#3DD68C' },
    divider: '#262E37',
    background: { default: '#0E1114', paper: '#151A1F' },
  },
} as const;

/**
 * Video review's own accent for file and scrubber navigation buttons. Dark
 * mode uses the primary blue so the buttons match the tab icons.
 */
const secondary = {
  light: { main: '#19857b' },
  dark: { main: palettes.dark.primary.main },
};

export const createAppTheme = (mode: PaletteMode) =>
  createTheme({
    palette: {
      ...palettes[mode],
      secondary: secondary[mode],
      app: appColors[mode],
    },
    // Shape and typography also match crewtimer-recorder
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif',
      button: { textTransform: 'none', fontWeight: 600 },
    },
  });

const isDark = (theme: Theme) => theme.palette.mode === 'dark';

/**
 * Accent for the file and scrubber navigation buttons. Light mode is solid
 * teal; dark mode copies the recorder's selected ToggleButton, a faint primary
 * tint under primary text, which is calmer than a solid light blue.
 */
export const navAccentSx = {
  bgcolor: (theme: Theme) =>
    isDark(theme)
      ? alpha(theme.palette.primary.main, theme.palette.action.selectedOpacity)
      : theme.palette.secondary.main,
  color: (theme: Theme) =>
    isDark(theme)
      ? theme.palette.primary.main
      : theme.palette.secondary.contrastText,
};

export const navButtonSx = {
  ...navAccentSx,
  boxShadow: (theme: Theme) => (isDark(theme) ? 'none' : undefined),
  border: (theme: Theme) =>
    isDark(theme) ? `1px solid ${theme.palette.divider}` : undefined,
  '&:hover': {
    bgcolor: (theme: Theme) =>
      isDark(theme)
        ? alpha(
            theme.palette.primary.main,
            theme.palette.action.selectedOpacity +
              theme.palette.action.hoverOpacity,
          )
        : theme.palette.secondary.dark,
    boxShadow: (theme: Theme) => (isDark(theme) ? 'none' : undefined),
  },
};
