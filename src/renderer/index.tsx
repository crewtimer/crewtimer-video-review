import { useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import CssBaseline from '@mui/material/CssBaseline';
import useMediaQuery from '@mui/material/useMediaQuery';
import {
  ThemeProvider,
  Theme,
  StyledEngineProvider,
} from '@mui/material/styles';
import { ThemeProvider as LegacyStylesThemeProvider } from '@mui/styles';
import App from './App';
import { createAppTheme } from './theme';

declare module '@mui/styles/defaultTheme' {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface DefaultTheme extends Theme {}
}

const Root = () => {
  // The main process maps the Theme menu choice onto prefers-color-scheme, so
  // MUI, the data grids, the markdown CSS and scrollbars all follow it.
  const mode = useMediaQuery('(prefers-color-scheme: dark)', { noSsr: true })
    ? 'dark'
    : 'light';
  const theme = useMemo(() => createAppTheme(mode), [mode]);
  return (
    <LegacyStylesThemeProvider theme={theme}>
      <StyledEngineProvider injectFirst>
        <ThemeProvider theme={theme}>
          {/* CssBaseline kickstart an elegant, consistent, and simple baseline to build upon. */}
          <CssBaseline enableColorScheme />
          <App />
        </ThemeProvider>
      </StyledEngineProvider>
    </LegacyStylesThemeProvider>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  // <React.StrictMode>
  <Root />,
  // </React.StrictMode>
);
