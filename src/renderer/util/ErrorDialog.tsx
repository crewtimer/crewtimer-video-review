import { setDialogConfig } from './ConfirmDialog';

/**
 * Show a popup with an error message an an OK button.
 *
 * @param error Typically of type Error or string
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const showErrorDialog = (error: any) => {
  const message = error instanceof Error ? error.message : String(error);
  setDialogConfig({
    title: 'Error',
    message,
    button: 'OK',
    showCancel: false,
  });
};
