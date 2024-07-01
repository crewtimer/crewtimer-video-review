import {
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  Typography,
  TextField,
  DialogActions,
  styled,
} from '@mui/material';
import { ChangeEventHandler, ReactNode, useEffect, useState } from 'react';
import { UseDatum } from 'react-usedatum';

// Styled components using MUI's styled API
const ConfirmBox = styled(TextField)(({ theme }) => ({
  marginLeft: theme.spacing(2),
}));

const ConfirmPrompt = styled('div')(({ theme }) => ({
  marginTop: theme.spacing(2),
  display: 'flex',
}));

export interface ConfirmDialogProps {
  title: string;
  message?: string;
  body?: ReactNode;
  confirmText?: string;
  button?: string;
  showCancel: boolean;
  handleConfirm?: () => void;
}

export const [useConfirmDialog, setDialogConfig] = UseDatum<
  ConfirmDialogProps | undefined
>(undefined);

export function ConfirmDialog() {
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

  const onConfirmTextChange: ChangeEventHandler<
    HTMLInputElement | HTMLTextAreaElement
  > = (event) => {
    const { value } = event.target;
    const ok = value.toLowerCase() === config?.confirmText?.toLowerCase();
    setOkToConfirm(ok);
    setConfirmText(value);
  };

  if (!config) {
    return undefined;
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
    config.button ? (
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
      </Button>
    ) : null,
  ];

  return (
    <Dialog
      open
      onClose={handleClose}
      aria-labelledby="alert-dialog-title"
      aria-describedby="alert-dialog-description"
    >
      <DialogTitle id="alert-dialog-title">{`${config.title}`}</DialogTitle>
      <DialogContent>
        {!!config.message && (
          <Typography color="secondary">{config.message}</Typography>
        )}
        {config.body}
        {config.showCancel && config.confirmText && (
          <ConfirmPrompt>
            <Typography>
              To confirm this action, type &apos;{config.confirmText}&apos; in
              the box:
            </Typography>
            <ConfirmBox
              variant="outlined"
              margin="dense"
              name="confirmText"
              autoComplete="off"
              autoFocus
              value={confirmText}
              onChange={onConfirmTextChange}
            />
          </ConfirmPrompt>
        )}
      </DialogContent>
      <DialogActions>{actions}</DialogActions>
    </Dialog>
  );
}
