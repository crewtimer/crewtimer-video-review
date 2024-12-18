import { Slide, Snackbar, Alert } from '@mui/material';
import { UseDatum } from 'react-usedatum';

export const [useToast, setToast] = UseDatum<{
  severity: 'success' | 'error' | 'warning' | 'info';
  msg: string;
}>({ severity: 'info', msg: '' });
export const Toast = () => {
  const [toast, setToastContent] = useToast();
  const handleClose = () => setToastContent({ severity: 'info', msg: '' });
  return (
    <Snackbar
      open={Boolean(toast.msg)}
      autoHideDuration={6000}
      onClose={handleClose}
      anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      TransitionComponent={Slide}
    >
      <Alert onClose={handleClose} severity={toast.severity}>
        {toast.msg}
      </Alert>
    </Snackbar>
  );
};
export default Toast;
