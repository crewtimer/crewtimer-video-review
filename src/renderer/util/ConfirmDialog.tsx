import {
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  Typography,
  TextField,
  DialogActions,
} from '@mui/material';
import makeStyles from '@mui/styles/makeStyles';
import { useEffect, useState } from 'react';
import { UseDatum } from 'react-usedatum';

const useStyles = makeStyles((theme) => ({
  confirmBox: {
    marginLeft: theme.spacing(2),
  },
  confirmPrompt: {
    marginTop: theme.spacing(2),
    display: 'flex',
  },
}));

export interface ConfirmDialogProps {
  title: string;
  message: string;
  content?: React.ReactNode;
  confirmText?: string;
  button: string;
  showCancel: boolean;
  handleConfirm?: () => void;
}

// eslint-disable-next-line react-refresh/only-export-components
export const [useConfirmDialog, setDialogConfig] = UseDatum<
  ConfirmDialogProps | undefined
>(undefined);

export const ConfirmDialog = () => {
  const classes = useStyles();
  const [config, setConfig] = useConfirmDialog();
  const [okToConfirm, setOkToConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  useEffect(() => {
    // Init state since this is a persistent view
    setOkToConfirm(false);
    setConfirmText('');
  }, [config]);

  const handleClose = () => {
    setConfig(undefined);
  };

  const onConfirmTextChange: React.ChangeEventHandler<
    HTMLInputElement | HTMLTextAreaElement
  > = (event) => {
    const value = event.target.value;
    const ok = value.toLowerCase() === config?.confirmText?.toLowerCase();
    setOkToConfirm(ok);
    setConfirmText(value);
  };

  if (!config) {
    return <></>;
  }
  const actions = [
    config.showCancel ? (
      <Button
        key="cancel"
        variant="outlined"
        size="small"
        onClick={handleClose}
      >
        Cancel
      </Button>
    ) : null,
    <Button
      key={config.button}
      variant="outlined"
      size="small"
      disabled={!!config.confirmText && !okToConfirm && config.showCancel}
      onClick={() => {
        setConfig(undefined);
        config.handleConfirm?.();
      }}
    >
      {config.button}
    </Button>,
  ];

  return (
    <Dialog
      open={true}
      onClose={handleClose}
      aria-labelledby="alert-dialog-title"
      aria-describedby="alert-dialog-description"
    >
      <DialogTitle id="alert-dialog-title">{`${config.title}`}</DialogTitle>
      <DialogContent>
        {!!config.message && (
          <Typography color="secondary">{config.message}</Typography>
        )}
        {config.content}
        {config.showCancel && config.confirmText && (
          <div className={classes.confirmPrompt}>
            <Typography className={classes.confirmPrompt}>
              To confirm this action, type &apos;{config.confirmText}&apos; in
              the box:
            </Typography>
            <TextField
              className={classes.confirmBox}
              variant="outlined"
              margin="dense"
              name="confirmText"
              autoComplete="off"
              autoFocus={true}
              value={confirmText}
              onChange={onConfirmTextChange}
            />
          </div>
        )}
      </DialogContent>
      <DialogActions>{actions}</DialogActions>
    </Dialog>
  );
};
