import ReactDOM from 'react-dom/client';
import CssBaseline from '@mui/material/CssBaseline';
import {
  ThemeProvider,
  Theme,
  StyledEngineProvider,
} from '@mui/material/styles';
import { ThemeProvider as LegacyStylesThemeProvider } from '@mui/styles';
import App from './App';
import theme from './theme';

declare module '@mui/styles/defaultTheme' {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface DefaultTheme extends Theme {}
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  // <React.StrictMode>
  <LegacyStylesThemeProvider theme={theme}>
    <StyledEngineProvider injectFirst>
      <ThemeProvider theme={theme}>
        {/* CssBaseline kickstart an elegant, consistent, and simple baseline to build upon. */}
        <CssBaseline />
        <App />
      </ThemeProvider>
    </StyledEngineProvider>
  </LegacyStylesThemeProvider>,
  // </React.StrictMode>
);
